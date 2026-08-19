import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, deptAdminProcedure } from "../trpc";
import { getConceptModel } from "../../models/college/concept-graph.model";
import { getDocumentModel } from "../../models/college/document.model";
import { getChapterMapModel } from "../../models/college/chapter-map.model";
import { getDepartmentModel } from "../../models/college/department.model";
import { getCollegeModel } from "../../models/platform/college.model";
import { enqueueConceptGraphExtractionJob } from "../../services/queue.service";

const conceptTypeEnum = z.enum([
  "process_mechanism", "structure_anatomy", "law_relationship",
  "classification", "procedure_calculation", "causal_chain", "definition",
]);
const bloomEnum = z.enum(["remember", "understand", "apply", "analyse"]);

export const conceptGraphRouter = router({
  // Dept admin: list concepts, optionally scoped to a doc/chapter
  list: deptAdminProcedure
    .input(z.object({ doc_id: z.string().optional(), chapter_index: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);
      const filter: Record<string, unknown> = { dept_id: ctx.user.dept_id };
      if (input.doc_id) filter.doc_id = input.doc_id;
      if (input.chapter_index !== undefined) filter.chapter_index = input.chapter_index;
      return Concept.find(filter).sort({ chapter_index: 1, canonical_name: 1 }).lean();
    }),

  get: deptAdminProcedure
    .input(z.object({ concept_id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);
      const concept = await Concept.findOne({ _id: input.concept_id, dept_id: ctx.user.dept_id }).lean();
      if (!concept) throw new TRPCError({ code: "NOT_FOUND", message: "Concept not found" });
      return concept;
    }),

  // Trigger (or re-trigger) extraction for a document that already has a chapter map
  extract: deptAdminProcedure
    .input(z.object({ doc_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Document = getDocumentModel(conn);
      const ChapterMap = getChapterMapModel(conn);

      const doc = await Document.findOne({ _id: input.doc_id, dept_id: ctx.user.dept_id }).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (!doc.has_chapter_map) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document has no chapter map yet — extract chapters first" });
      }
      if (!doc.file_path) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document has no local file path" });
      }

      const chapterMap = await ChapterMap.findOne({ doc_id: input.doc_id }).lean();
      if (!chapterMap || chapterMap.chapters.length === 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Chapter map is empty" });
      }

      const [dept, college] = await Promise.all([
        getDepartmentModel(conn).findById(ctx.user.dept_id).lean(),
        ctx.collegeId ? getCollegeModel().findById(ctx.collegeId).lean() : Promise.resolve(null),
      ]);

      const apiBase = process.env.API_INTERNAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      await enqueueConceptGraphExtractionJob({
        job_id:       `concept_graph_${input.doc_id}`,
        doc_id:       input.doc_id,
        college_id:   ctx.collegeId!,
        dept_id:      ctx.user.dept_id,
        subject_id:   doc.subject_id,
        dept_name:    dept?.name ?? "",
        college_type: college?.type ?? "",
        file_path:    doc.file_path,
        chapters:     chapterMap.chapters,
        job_type:     "extract_concept_graph",
        callback_url: `${apiBase}/api/v1/internal/ingest/${input.doc_id}/concept-graph/webhook`,
      });

      return { success: true };
    }),

  // Faculty edit: overrides are marked faculty_edited so they aren't blindly
  // clobbered by a future re-extraction pass.
  update: deptAdminProcedure
    .input(z.object({
      concept_id: z.string(),
      canonical_name: z.string().min(1).optional(),
      aliases: z.array(z.string()).optional(),
      concept_type: conceptTypeEnum.optional(),
      one_line_definition: z.string().optional(),
      prerequisite_ids: z.array(z.string()).optional(),
      bloom_ceiling: bloomEnum.optional(),
      difficulty_rating: z.number().min(0).max(1).optional(),
      is_examinable: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { concept_id, ...patch } = input;
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);

      const concept = await Concept.findOne({ _id: concept_id, dept_id: ctx.user.dept_id });
      if (!concept) throw new TRPCError({ code: "NOT_FOUND", message: "Concept not found" });

      // No self-reference, no cycle of length 1
      if (patch.prerequisite_ids?.includes(concept_id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A concept cannot be its own prerequisite" });
      }

      if (patch.prerequisite_ids) {
        const prereqs = await Concept.find({ _id: { $in: patch.prerequisite_ids }, dept_id: ctx.user.dept_id }).lean();
        (patch as Record<string, unknown>).prerequisite_names = patch.prerequisite_ids.map(
          (id) => prereqs.find((p) => p._id === id)?.canonical_name ?? id,
        );
      }

      Object.assign(concept, patch, { extraction_method: "faculty_edited", reviewed_by_faculty: true });
      await concept.save();
      return concept.toObject();
    }),

  delete: deptAdminProcedure
    .input(z.object({ concept_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);

      const concept = await Concept.findOne({ _id: input.concept_id, dept_id: ctx.user.dept_id }).lean();
      if (!concept) throw new TRPCError({ code: "NOT_FOUND", message: "Concept not found" });

      await Concept.deleteOne({ _id: input.concept_id });
      // Strip the deleted id from anything that listed it as a prerequisite,
      // rather than leaving a dangling reference the state machine would 404 on.
      await Concept.updateMany(
        { dept_id: ctx.user.dept_id, prerequisite_ids: input.concept_id },
        { $pull: { prerequisite_ids: input.concept_id, prerequisite_names: concept.canonical_name } },
      );
      return { success: true };
    }),

  // Cycle/orphan/suspicious-edge report for the faculty review UI
  validate: deptAdminProcedure
    .input(z.object({ doc_id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);
      const filter: Record<string, unknown> = { dept_id: ctx.user.dept_id };
      if (input.doc_id) filter.doc_id = input.doc_id;
      const concepts = await Concept.find(filter).lean();

      const byId = new Map(concepts.map((c) => [c._id, c]));

      // DFS cycle detection
      const WHITE = 0, GREY = 1, BLACK = 2;
      const colour = new Map(concepts.map((c) => [c._id, WHITE]));
      const cycles: string[][] = [];
      const dfs = (node: string, path: string[]) => {
        colour.set(node, GREY);
        for (const next of byId.get(node)?.prerequisite_ids ?? []) {
          if (!byId.has(next)) continue;
          if (colour.get(next) === GREY) {
            cycles.push([...path.slice(path.indexOf(next)), next]);
          } else if (colour.get(next) === WHITE) {
            dfs(next, [...path, next]);
          }
        }
        colour.set(node, BLACK);
      };
      for (const c of concepts) if (colour.get(c._id) === WHITE) dfs(c._id, [c._id]);

      const orphans = concepts
        .filter((c) => c.prerequisite_ids.length === 0 && c.chapter_index > 1)
        .map((c) => ({ concept_id: c._id, canonical_name: c.canonical_name, chapter_index: c.chapter_index }));

      const suspiciousEdges = concepts.flatMap((c) =>
        c.prerequisite_ids
          .filter((pid) => (byId.get(pid)?.chapter_index ?? -Infinity) > c.chapter_index)
          .map((pid) => ({
            concept_id: c._id,
            canonical_name: c.canonical_name,
            prerequisite_id: pid,
            prerequisite_name: byId.get(pid)?.canonical_name ?? pid,
          })),
      );

      return {
        cycles: cycles.map((cycle) => cycle.map((id) => byId.get(id)?.canonical_name ?? id)),
        orphans,
        suspicious_edges: suspiciousEdges,
      };
    }),
});

export type ConceptGraphRouter = typeof conceptGraphRouter;
