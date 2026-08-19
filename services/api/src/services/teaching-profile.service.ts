import { randomUUID } from "crypto";
import type { Connection } from "mongoose";
import type { TeachingProfile, ExplanationStrategy } from "@college-chatbot/shared";
import { getTeachingProfileModel } from "../models/college/teaching-profile.model";
import { getCollegeModel } from "../models/platform/college.model";

const DEFAULT_STRATEGY_ORDER: ExplanationStrategy[] = [
  "first_principles", "visual_spatial", "worked_example",
  "extreme_case", "analogy", "contrast_pair", "concrete_instance",
  "error_analysis", "narrative_history", "mnemonic",
];

/** Called on department creation (F-20-F §9) — every dept gets a sane default
 * teaching profile so the engine works before any faculty configures it. */
export async function createDefaultTeachingProfile(
  conn: Connection,
  collegeId: string,
  deptId: string,
): Promise<TeachingProfile> {
  const TeachingProfileModel = getTeachingProfileModel(conn);
  const existing = await TeachingProfileModel.findOne({ dept_id: deptId }).lean();
  if (existing) return existing;

  // CLINICAL_CONNECT is framed around clinical/practice relevance — only
  // meaningful by default for medical colleges. Engineering/"other" depts
  // previously got it enabled unconditionally regardless of college type.
  const college = await getCollegeModel().findById(collegeId).select("type").lean();
  const defaultClinicalConnect = college?.type === "medical";

  const created = await TeachingProfileModel.create({
    _id: randomUUID(),
    college_id: collegeId,
    dept_id: deptId,
    strategy_preference_order: DEFAULT_STRATEGY_ORDER,
    analogy_policy: "sparing",
    mnemonic_policy: "only_for_lists",
    rigour_level: "balanced",
    always_include_clinical_connect: defaultClinicalConnect,
    require_feynman_check: true,
    require_misconception_probe: true,
    default_bloom_target: "apply",
    default_entry_difficulty: 2,
    max_session_minutes: 20,
    max_backtrack_depth: 2,
    custom_instruction: "",
  });
  return created.toObject();
}

export async function getTeachingProfile(conn: Connection, collegeId: string, deptId: string): Promise<TeachingProfile> {
  const TeachingProfileModel = getTeachingProfileModel(conn);
  const existing = await TeachingProfileModel.findOne({ dept_id: deptId }).lean();
  if (existing) return existing;
  return createDefaultTeachingProfile(conn, collegeId, deptId);
}
