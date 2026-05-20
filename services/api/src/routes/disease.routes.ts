import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { getCollegeDb } from "../db/college.db";
import {
  diseaseQuery,
  streamDiseaseChat,
  getDiseaseSuggestions,
} from "../services/disease.service";
import type { StudentJWTPayload } from "@college-chatbot/shared";

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
});

const ChatSchema = z.object({
  disease:              z.string().min(1).max(200),
  query:                z.string().min(1).max(2000),
  conversation_history: z
    .array(z.object({
      role:    z.enum(["user", "assistant"]),
      content: z.string(),
    }))
    .default([]),
});

function sendSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

const diseaseRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── Disease search (cached cross-subject query) ────────────────────────────
  fastify.post(
    "/college/:collegeId/student/disease-search",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const conn = await getCollegeDb(collegeId);

      const { query } = SearchSchema.parse(req.body ?? {});
      const result = await diseaseQuery(query, collegeId, conn);
      return reply.send(result);
    },
  );

  // ── Disease chat (SSE streaming, cross-subject) ────────────────────────────
  fastify.post(
    "/college/:collegeId/student/disease-chat",
    {
      preHandler: PRE,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) =>
            `disease-chat:${(req.user as StudentJWTPayload | undefined)?.sub ?? req.ip}`,
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);

      const bodyParsed = ChatSchema.safeParse(req.body ?? {});
      if (!bodyParsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const { disease, query, conversation_history } = bodyParsed.data;

      // SSE setup — same headers as chat.routes.ts
      const reqOrigin = req.headers.origin;
      reply.raw.writeHead(200, {
        "Content-Type":                     "text/event-stream",
        "Cache-Control":                    "no-cache",
        "Connection":                       "keep-alive",
        "X-Accel-Buffering":               "no",
        ...(reqOrigin && { "Access-Control-Allow-Origin": reqOrigin }),
        "Access-Control-Allow-Credentials": "true",
      });

      try {
        const conn = await getCollegeDb(collegeId);
        await streamDiseaseChat(
          query,
          disease,
          conversation_history,
          collegeId,
          conn,
          reply,
        );
      } catch (err) {
        fastify.log.error({ err }, "Disease chat error");
        sendSSE(reply, { type: "error", message: "Internal error" });
      }

      reply.raw.end();
    },
  );

  // ── Search suggestions ─────────────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/disease-search/suggestions",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const conn = await getCollegeDb(collegeId);

      const result = await getDiseaseSuggestions(collegeId, conn);
      return reply.send(result);
    },
  );
};

export const diseaseRoutes: FastifyPluginAsync = diseaseRoutesPlugin;
