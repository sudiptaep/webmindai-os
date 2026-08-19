import type { Connection } from "mongoose";
import type { Concept, TeachingSession } from "@college-chatbot/shared";
import { getConceptModel } from "../../models/college/concept-graph.model";
import { getMisconceptionModel } from "../../models/college/misconception.model";
import { getDepartmentModel } from "../../models/college/department.model";
import { getImageAssetModel } from "../../models/college/image-asset.model";
import { getPYQQuestionModel } from "../../models/college/pyq-question.model";
import { getTeachingProfile } from "../teaching-profile.service";
import { getOrCreateLearnerModel } from "../learner-model.service";
import { fetchDocChunks } from "../pinecone.service";
import type { SessionContext } from "./types";

const GROUNDING_CHUNK_LIMIT = 12;

export async function getConcept(conn: Connection, conceptId: string): Promise<Concept> {
  const Concept = getConceptModel(conn);
  const concept = await Concept.findById(conceptId).lean();
  if (!concept) throw new Error(`Concept ${conceptId} not found`);
  return concept;
}

/** Assembles everything a teaching turn needs — concept, teaching profile,
 * learner model, misconceptions, grounding chunks, image availability — in
 * one pass, so the orchestrator and its helpers stay pure/testable. */
export async function buildSessionContext(
  conn: Connection,
  session: Pick<TeachingSession, "college_id" | "dept_id" | "doc_id" | "concept_id" | "student_id">,
): Promise<SessionContext> {
  const [concept, teachingProfile, learnerModel, misconceptions, dept] = await Promise.all([
    getConcept(conn, session.concept_id),
    getTeachingProfile(conn, session.college_id, session.dept_id),
    getOrCreateLearnerModel(conn, session.student_id, session.college_id, session.dept_id),
    getMisconceptionModel(conn).find({ concept_id: session.concept_id }).sort({ priority_rank: -1, observed_count: -1 }).lean(),
    getDepartmentModel(conn).findById(session.dept_id).select("name").lean(),
  ]);

  const ImageAsset = getImageAssetModel(conn);
  const relevantImage = await ImageAsset.findOne({
    doc_id: session.doc_id,
    source_page: { $in: concept.source_pages },
    vision_status: "completed",
    hidden: { $ne: true },
    was_filtered: { $ne: true },
  }).lean();

  // F-13-E PYQ frequency, live-queried rather than trusting the concept's
  // (often stale/zero) stored pyq_frequency — used to make CLINICAL_CONNECT's
  // exam-relevance claim concrete instead of generic.
  const PYQQuestion = getPYQQuestionModel(conn);
  const pyqMatches = concept.subject_id
    ? await PYQQuestion.find({ subject_id: concept.subject_id, mapped_chapter_indices: concept.chapter_index })
        .select("exam_name year")
        .limit(50)
        .lean()
    : [];

  const allChunks = await fetchDocChunks(session.college_id, session.dept_id, session.doc_id, 300);
  const pageSet = new Set(concept.source_pages);
  const groundingChunks = allChunks
    .filter((c) => pageSet.has(c.page_num))
    .slice(0, GROUNDING_CHUNK_LIMIT)
    .map((c) => ({ page_num: c.page_num, text: c.text }));

  // Uncorrected misconceptions this student already holds surface first —
  // probing a misconception the engine has evidence they still hold beats
  // probing a fresh one they may never have held.
  const heldUncorrected = new Set(
    learnerModel.held_misconceptions.filter((m) => m.concept_id === concept._id && !m.corrected).map((m) => m.misconception_id),
  );
  const currentMisconception = [...misconceptions].sort((a, b) => {
    const aHeld = heldUncorrected.has(a._id) ? 1 : 0;
    const bHeld = heldUncorrected.has(b._id) ? 1 : 0;
    return bHeld - aHeld;
  })[0];

  return {
    collegeId: session.college_id,
    deptId: session.dept_id,
    deptName: dept?.name ?? "",
    concept,
    teachingProfile,
    learnerModel,
    misconceptions,
    currentMisconception,
    hasRelevantImage: !!relevantImage,
    relevantImageAssetId: relevantImage?._id,
    pyqCount: pyqMatches.length,
    pyqSampleExams: [...new Set(pyqMatches.map((q) => `${q.exam_name} ${q.year}`))].slice(0, 3),
    groundingChunks: groundingChunks.length > 0
      ? groundingChunks
      : [{ page_num: concept.source_pages[0] ?? 0, text: concept.one_line_definition }],
  };
}
