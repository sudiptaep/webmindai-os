import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { StudentJWTPayload } from "@college-chatbot/shared";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { checkTokenLimit } from "../middleware/tokenLimitCheck";
import { getCollegeDb } from "../db/college.db";
import { getSessionModel } from "../models/college/session.model";
import { getQueryLogModel } from "../models/college/query-log.model";
import { getCollegeModel } from "../models/platform/college.model";
import { getSubjectModel } from "../models/college/subject.model";
import { getDocumentModel } from "../models/college/document.model";
import { runRAG } from "../services/rag.service";

const chatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  session_id: z.string().uuid().optional(),
});

function sendSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function deriveStudentYear(sem: number, collegeType: string): number {
  if (collegeType === "medical") return sem;
  return Math.ceil(sem / 2);
}

const chatRoutePlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post(
    "/college/:collegeId/chat",
    {
      preHandler: [verifyJWT, resolveCollege, requireRole("student"), checkTokenLimit],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) =>
            `chat:${(req.user as StudentJWTPayload | undefined)?.sub ?? req.ip}`,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Setup SSE — manually add CORS headers since reply.raw.writeHead bypasses Fastify's header map
      const reqOrigin = request.headers.origin;
      reply.raw.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "X-Accel-Buffering": "no",
        ...(reqOrigin && { "Access-Control-Allow-Origin": reqOrigin }),
        "Access-Control-Allow-Credentials": "true",
      });

      const user = request.user as StudentJWTPayload;
      const { collegeId } = request.params as { collegeId: string };

      const bodyParsed = chatBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "Invalid request body" })}\n\n`);
        reply.raw.end();
        return;
      }

      const { message, session_id } = bodyParsed.data;

      // Wrap everything post-writeHead in try-catch — any unhandled throw after
      // writeHead silently kills the connection without sending SSE events.
      try {
        const conn = await getCollegeDb(collegeId);
        const Session = getSessionModel(conn);
        const QueryLog = getQueryLogModel(conn);

        // Get or create session
        let session = session_id
          ? await Session.findOne({ _id: session_id, student_id: user.sub })
          : null;

        if (!session) {
          session = await Session.create({
            _id: randomUUID(),
            student_id: user.sub,
            college_id: collegeId,
            dept_id: user.effective_dept_id,
          });
        }

        // Build history for RAG context
        const sessionMessages = session.messages
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const startTime = Date.now();
        let fullResponse = "";
        let ragDone: { sources: unknown[]; confidence_score: number; answered: boolean; tokens_used: number } | null = null;

        // Resolve doc IDs scoped to student's year of study (no dept_id dependency)
        const Document = getDocumentModel(conn);
        const Subject  = getSubjectModel(conn);
        const studentYear = deriveStudentYear(user.semester, user.college_type);
        const yearSubjects = await Subject.find({ year: studentYear }, { _id: 1 }).lean();
        const yearSubjectIds = yearSubjects.map((s) => String(s._id));

        const yearDocs = await Document.find(
          {
            is_visible_to_students: { $ne: false },
            ingestion_status: "completed",
            $or: [
              { subject_id: { $in: yearSubjectIds } },
              { subject_id: null },
              { subject_id: { $exists: false } },
            ],
          },
          { _id: 1, dept_id: 1 },
        ).lean();

        // Group by actual dept_id so each Pinecone namespace gets the right filter
        const deptDocMap = new Map<string, string[]>();
        for (const d of yearDocs) {
          const key = d.dept_id as string;
          if (!deptDocMap.has(key)) deptDocMap.set(key, []);
          deptDocMap.get(key)!.push(String(d._id));
        }
        const namespacedDocs = Array.from(deptDocMap.entries()).map(([deptId, docIds]) => ({ deptId, docIds }));
        const cacheScope = `${collegeId}:year${studentYear}`;

        for await (const event of runRAG({
          query: message,
          collegeId,
          cacheScope,
          namespacedDocs,
          sessionMessages,
        })) {
          sendSSE(reply, event);

          if (event.type === "token") {
            fullResponse += event.content;
          } else if (event.type === "done") {
            ragDone = event;
            // Echo session_id so the client can persist it for multi-turn context
            sendSSE(reply, { type: "session", session_id: session._id });
          }
        }

        const responseTimeMs = Date.now() - startTime;
        const { sources = [], confidence_score = 0, answered = false, tokens_used = 0 } = ragDone ?? {};

        // Append messages to session
        await Session.findByIdAndUpdate(session._id, {
          $push: {
            messages: {
              $each: [
                { role: "user", content: message, sources: [], answered: true },
                {
                  role: "assistant",
                  content: fullResponse,
                  sources,
                  confidence_score,
                  answered,
                },
              ],
            },
          },
          $set: { last_active: new Date() },
        });

        // Write query log
        await QueryLog.create({
          _id: randomUUID(),
          student_id: user.sub,
          session_id: session._id,
          college_id: collegeId,
          dept_id: user.effective_dept_id,
          query_text: message,
          answered,
          confidence_score,
          sources_used: (sources as Array<{ doc_id?: string }>).map((s) => s.doc_id ?? "").filter(Boolean),
          flagged_to_admin: !answered,
          response_time_ms: responseTimeMs,
          tokens_used,
        });

        // Update college monthly token counter (fire-and-forget)
        if (tokens_used > 0) {
          const College = getCollegeModel();
          College.findByIdAndUpdate(collegeId, {
            $inc: { tokens_used_this_month: tokens_used },
          }).catch((err: Error) =>
            fastify.log.error({ err, collegeId }, "Failed to update token usage")
          );
        }
      } catch (err) {
        fastify.log.error({ err }, "Chat handler error");
        sendSSE(reply, { type: "error", message: err instanceof Error ? err.message : "Internal server error" });
      }

      reply.raw.end();
    },
  );

  // Get session by ID (for history page)
  fastify.get(
    "/college/:collegeId/chat/sessions/:sessionId",
    {
      preHandler: [verifyJWT, resolveCollege, requireRole("student")],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as StudentJWTPayload;
      const { collegeId, sessionId } = request.params as { collegeId: string; sessionId: string };

      const conn = await getCollegeDb(collegeId);
      const Session = getSessionModel(conn);

      const session = await Session.findOne({ _id: sessionId, student_id: user.sub }).lean();
      if (!session) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found" });
      }

      return reply.send(session);
    },
  );

  // GET /college/:collegeId/chat/suggestions — subject chips + starter prompts for empty chat
  fastify.get(
    "/college/:collegeId/chat/suggestions",
    { preHandler: [verifyJWT, resolveCollege, requireRole("student")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as StudentJWTPayload;
      const { collegeId } = request.params as { collegeId: string };

      const studentYear = deriveStudentYear(user.semester, user.college_type);
      const conn    = await getCollegeDb(collegeId);
      const Subject = getSubjectModel(conn);

      const subjects = await Subject.find({ year: studentYear })
        .select("name code semester year")
        .lean();

      const isMedical = user.college_type === "medical";

      return reply.send({
        student_year: studentYear,
        subjects: subjects.map((s) => ({
          id:       String(s._id),
          name:     s.name,
          code:     s.code ?? null,
          semester: isMedical ? null : (s.semester ?? null),
          year:     s.year ?? null,
        })),
      });
    },
  );
}

export const chatRoutes = chatRoutePlugin;
