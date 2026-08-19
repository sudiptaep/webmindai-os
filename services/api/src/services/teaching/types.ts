import type { Concept, TeachingProfile, LearnerModel, Misconception, ExplanationStrategy, PendingCheck } from "@college-chatbot/shared";

/** Everything a phase/strategy/turn decision needs, assembled once per orchestrator call. */
export interface SessionContext {
  collegeId: string;
  deptId: string;
  deptName: string;
  concept: Concept;
  teachingProfile: TeachingProfile;
  learnerModel: LearnerModel;
  misconceptions: Misconception[];
  currentMisconception?: Misconception;
  hasRelevantImage: boolean;
  relevantImageAssetId?: string;
  groundingChunks: Array<{ page_num: number; text: string }>;
  /** F-13-E: live PYQ frequency for this concept's chapter — feeds CLINICAL_CONNECT. */
  pyqCount: number;
  pyqSampleExams: string[];
}

export interface CheckEvaluation {
  passed: boolean;
  confidence: number;
  diagnosed_gap: string | null;
  matched_misconception_id: string | null;
  partial_credit: boolean;
  encouragement_note: string;
}

export interface TeachingTurn {
  role: "assistant";
  phase: number;
  content: string;
  strategy?: ExplanationStrategy;
  difficulty_level?: number;
  check: PendingCheck | null;
  image_asset_id?: string;
  is_backtrack_notice?: boolean;
  nested_session_id?: string;
  is_session_complete?: boolean;
  srs_cards_created?: number;
  resume_parent_session_id?: string;
}

export type Decision =
  | { action: "BACKTRACK_PREREQUISITE"; prerequisiteId: string }
  | { action: "RETRY_LOWER_RUNG"; newLevel: number }
  /** setBuildStepsRemaining is present only when this step advance came from
   * the compression branch — decideNextAction is pure and can't mutate the
   * session itself, so the compressed value has to travel back through the
   * decision for the orchestrator to actually persist it. */
  | { action: "ADVANCE_STEP"; setBuildStepsRemaining?: number }
  | { action: "ADVANCE_PHASE"; nextPhase: number }
  | { action: "COMPLETE_SESSION" }
  /** No phase/step/rung change — generate the current phase/step's turn.
   * Covers: the very first turn of a session, and a single-turn (no-check)
   * phase that hasn't produced its one turn yet. */
  | { action: "CONTINUE" };
