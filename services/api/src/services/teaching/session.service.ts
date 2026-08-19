import { randomUUID } from "crypto";
import type { Connection, HydratedDocument } from "mongoose";
import type { TeachingSession } from "@college-chatbot/shared";
import { getTeachingSessionModel } from "../../models/college/teaching-session.model";
import { TeachingPhase } from "./phases";

const BUILD_STEPS_DEFAULT = Number(process.env.TEACHING_BUILD_STEPS_DEFAULT ?? 4);
const DEFAULT_ENTRY_LEVEL = Number(process.env.TEACHING_DEFAULT_ENTRY_LEVEL ?? 2);

export interface CreateTeachingSessionParams {
  studentId: string;
  conceptId: string;
  collegeId: string;
  deptId: string;
  docId: string;
  subjectId?: string;
  parentSessionId?: string;
  isNested?: boolean;
  enabledPhases?: TeachingPhase[];
  initialDifficultyLevel?: number;
}

export async function createTeachingSession(
  conn: Connection,
  params: CreateTeachingSessionParams,
): Promise<HydratedDocument<TeachingSession>> {
  const TeachingSessionModel = getTeachingSessionModel(conn);

  return TeachingSessionModel.create({
    _id: randomUUID(),
    student_id: params.studentId,
    college_id: params.collegeId,
    dept_id: params.deptId,
    subject_id: params.subjectId,
    doc_id: params.docId,
    concept_id: params.conceptId,

    parent_session_id: params.parentSessionId,
    is_nested: params.isNested ?? false,
    backtrack_stack: [],
    backtrack_active: false,

    // A restricted session (nested prerequisite back-track) starts at the
    // first phase it's actually allowed to run — DIAGNOSE is almost never in
    // that list, so defaulting to it here would generate a turn for a phase
    // the session isn't enabled for.
    current_phase: params.enabledPhases?.[0] ?? TeachingPhase.DIAGNOSE,
    current_step_index: 0,
    build_steps_total: BUILD_STEPS_DEFAULT,
    build_steps_remaining: BUILD_STEPS_DEFAULT,
    current_difficulty_level: params.initialDifficultyLevel ?? DEFAULT_ENTRY_LEVEL,
    strategies_attempted: [],
    strategies_failed: [],
    enabled_phases: params.enabledPhases,
    phase_turn_count: 0,
    turn_count: 0,

    awaiting_check_response: false,
    pending_check: null,

    turns: [],
    check_history: [],

    status: "in_progress",
    srs_cards_created: [],

    total_checks: 0,
    checks_passed: 0,
    rungs_dropped: 0,
    backtracks_triggered: 0,
    tokens_used: 0,
    cost_usd: 0,

    started_at: new Date(),
  });
}

export async function loadSessionDoc(conn: Connection, sessionId: string, collegeId: string): Promise<HydratedDocument<TeachingSession>> {
  const TeachingSessionModel = getTeachingSessionModel(conn);
  const session = await TeachingSessionModel.findOne({ _id: sessionId, college_id: collegeId });
  if (!session) throw new Error(`Teaching session ${sessionId} not found`);
  return session;
}
