import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, studentProcedure } from "../trpc";
import { getTeachingSessionModel } from "../../models/college/teaching-session.model";
import { getConceptModel } from "../../models/college/concept-graph.model";
import { getDocumentModel } from "../../models/college/document.model";
import { createTeachingSession, loadSessionDoc } from "../../services/teaching/session.service";
import { advanceTeachingSession } from "../../services/teaching/orchestrator";
import { buildSessionContext } from "../../services/teaching/context";
import { TeachingPhase, nextNonSkippedPhase } from "../../services/teaching/phases";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const teachingRouter = router({
  // Start a new session for a concept — generates and returns the first (DIAGNOSE) turn.
  start: studentProcedure
    .input(z.object({ concept_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);
      // No dept_id filter here, matching the `concepts` browse query above:
      // concept_graph rows are keyed by the owning document's dept_id, which
      // can differ from the student's effective_dept_id when the doc was
      // reached via the library's cross-dept access. Filtering on dept_id
      // here 404s a concept the student was just shown in the browser.
      const concept = await Concept.findById(input.concept_id).lean();
      if (!concept) throw new TRPCError({ code: "NOT_FOUND", message: "Concept not found" });

      const session = await createTeachingSession(conn, {
        studentId: ctx.user.sub,
        conceptId: input.concept_id,
        collegeId: ctx.user.college_id,
        deptId: concept.dept_id,
        docId: concept.doc_id,
        subjectId: concept.subject_id,
      });

      const firstTurn = await advanceTeachingSession(conn, session._id, ctx.user.college_id, null);
      return { session_id: session._id, first_turn: firstTurn, concept };
    }),

  // Send the student's response to the pending check (or, if no check is
  // pending, just advance a single-turn phase along).
  respond: studentProcedure
    .input(z.object({ session_id: z.string(), response: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const TeachingSessionModel = getTeachingSessionModel(conn);
      const owned = await TeachingSessionModel.exists({ _id: input.session_id, student_id: ctx.user.sub });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

      return advanceTeachingSession(conn, input.session_id, ctx.user.college_id, input.response);
    }),

  // Student override controls (F-20-E §8.5). Mutates session state directly,
  // then delegates to the orchestrator to regenerate the resulting turn.
  control: studentProcedure
    .input(z.object({
      session_id: z.string(),
      control: z.enum(["i_dont_get_it", "simpler", "go_deeper", "show_picture", "just_tell_me", "skip_ahead", "end_session"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const session = await loadSessionDoc(conn, input.session_id, ctx.user.college_id);
      if (session.student_id !== ctx.user.sub) throw new TRPCError({ code: "FORBIDDEN" });
      if (session.status !== "in_progress") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session already closed" });

      switch (input.control) {
        case "i_dont_get_it":
          // Drop a rung AND force a different explanation strategy — the
          // current one demonstrably isn't landing.
          if (session.current_strategy && !session.strategies_failed.includes(session.current_strategy)) {
            session.strategies_failed.push(session.current_strategy);
          }
          session.current_strategy = undefined;
          session.current_difficulty_level = Math.max(0, session.current_difficulty_level - 1);
          break;
        case "simpler":
          session.current_difficulty_level = Math.max(0, session.current_difficulty_level - 1);
          break;
        case "go_deeper":
          session.current_difficulty_level = Math.min(3, session.current_difficulty_level + 1);
          break;
        case "show_picture": {
          // VISUALISE's own skip condition (no relevant image -> skip) only
          // ever gets consulted by automatic phase advancement — a direct
          // override here bypassed it entirely, so a student could force the
          // engine into VISUALISE with nothing to show. The prompt still
          // tells the model "a figure is being shown, reference its labels"
          // regardless, producing a fabricated description of an image that
          // was never sent.
          const picCtx = await buildSessionContext(conn, session);
          if (!picCtx.hasRelevantImage) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No figure available for this concept" });
          }
          session.current_phase = TeachingPhase.VISUALISE;
          session.current_step_index = 0;
          session.phase_turn_count = 0;
          session.strategies_failed = [];
          session.strategies_attempted = [];
          session.current_strategy = undefined;
          break;
        }
        case "just_tell_me":
          // Deliberately does NOT skip ahead — still routes through
          // MISCONCEPTION_PROBE / FEYNMAN_CHECK, since that's where
          // retention actually comes from (F-20-E §8.5).
          session.current_difficulty_level = 0;
          break;
        case "skip_ahead": {
          const skipCtx = await buildSessionContext(conn, session);
          session.current_phase = nextNonSkippedPhase(session.current_phase, skipCtx, session.enabled_phases);
          session.current_step_index = 0;
          session.phase_turn_count = 0;
          session.strategies_failed = [];
          session.strategies_attempted = [];
          session.current_strategy = undefined;
          break;
        }
        case "end_session":
          session.current_phase = TeachingPhase.CONSOLIDATE;
          session.current_step_index = 0;
          session.phase_turn_count = 0;
          session.strategies_failed = [];
          session.strategies_attempted = [];
          session.current_strategy = undefined;
          break;
      }

      // Whatever was pending is moot now — the next generated turn replaces it.
      session.awaiting_check_response = false;
      session.pending_check = null;
      await session.save();

      return advanceTeachingSession(conn, input.session_id, ctx.user.college_id, null);
    }),

  get: studentProcedure
    .input(z.object({ session_id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const TeachingSessionModel = getTeachingSessionModel(conn);
      const session = await TeachingSessionModel.findOne({ _id: input.session_id, student_id: ctx.user.sub }).lean();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      return session;
    }),

  list: studentProcedure
    .input(z.object({
      status: z.enum(["in_progress", "completed", "abandoned"]).optional(),
      concept_id: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const TeachingSessionModel = getTeachingSessionModel(conn);
      const filter: Record<string, unknown> = { student_id: ctx.user.sub };
      if (input.status) filter.status = input.status;
      if (input.concept_id) filter.concept_id = input.concept_id;

      const [sessions, total] = await Promise.all([
        TeachingSessionModel.find(filter, { turns: { $slice: -1 }, check_history: 0 })
          .sort({ started_at: -1 })
          .limit(input.limit)
          .lean(),
        TeachingSessionModel.countDocuments(filter),
      ]);
      return { sessions, total };
    }),

  abandon: studentProcedure
    .input(z.object({ session_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const TeachingSessionModel = getTeachingSessionModel(conn);
      const result = await TeachingSessionModel.updateOne(
        { _id: input.session_id, student_id: ctx.user.sub, status: "in_progress" },
        { $set: { status: "abandoned", completed_at: new Date() } },
      );
      if (result.matchedCount === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or already closed" });
      return { success: true };
    }),

  // Concept discovery — used to populate the "Teach me" concept browser
  concepts: studentProcedure
    .input(z.object({ doc_id: z.string().optional(), chapter_index: z.number().int().optional(), q: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);
      const Document = getDocumentModel(conn);
      // effective_dept_id (not dept_id) is what actually governs a student's
      // content access — it's the generic dept when using_generic_fallback,
      // same as every library route. dept_id alone under-scopes some
      // students and over-scopes others.
      const effectiveDeptId = ctx.user.effective_dept_id;

      // A doc_id already uniquely scopes to one document — filtering by
      // dept_id on top of it is redundant at best and wrong at worst (a
      // student can be shown a chapter from a document outside their own
      // dept via the library's cross-dept access, and concept_graph rows
      // are keyed by the document's own dept_id, which may not match).
      const filter: Record<string, unknown> = input.doc_id ? { doc_id: input.doc_id } : { dept_id: effectiveDeptId };
      if (input.chapter_index !== undefined) filter.chapter_index = input.chapter_index;
      if (input.q) filter.canonical_name = { $regex: escapeRegex(input.q), $options: "i" };

      const [concepts, docs] = await Promise.all([
        Concept.find(filter).sort({ chapter_index: 1, canonical_name: 1 }).lean(),
        Document.find({ dept_id: effectiveDeptId, concept_graph_extracted: true }).select("_id original_filename").lean(),
      ]);

      return { concepts, documents: docs };
    }),
});

export type TeachingRouter = typeof teachingRouter;
