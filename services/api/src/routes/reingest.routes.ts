import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { requireDeptScope } from "../middleware/checkDeptScope";
import { listReingestCandidates, triggerReingest, listDeptReingestPriority } from "../services/reingest.service";

const reingestRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // F-19 Step 9: which depts to re-ingest first — ranked by recent query volume
  fastify.get(
    "/college/:collegeId/admin/reingest/priority",
    { preHandler: [verifyJWT, resolveCollege, requireRole("college_admin", "super_admin")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = request.params as { collegeId: string };
      const priority = await listDeptReingestPriority(collegeId);
      return reply.status(200).send({ departments: priority });
    },
  );

  // Cost estimate shown to the admin before they confirm re-ingestion
  fastify.get(
    "/college/:collegeId/admin/departments/:deptId/reingest/estimate",
    {
      preHandler: [
        verifyJWT,
        resolveCollege,
        requireRole("dept_admin", "college_admin", "super_admin"),
        requireDeptScope((req) => (req.params as { deptId: string }).deptId),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, deptId } = request.params as { collegeId: string; deptId: string };
      const result = await listReingestCandidates(collegeId, deptId);
      return reply.status(200).send(result);
    },
  );

  const triggerBodySchema = z.object({
    doc_ids: z.array(z.string()).min(1),
  });

  fastify.post(
    "/college/:collegeId/admin/departments/:deptId/reingest",
    {
      preHandler: [
        verifyJWT,
        resolveCollege,
        requireRole("dept_admin", "college_admin", "super_admin"),
        requireDeptScope((req) => (req.params as { deptId: string }).deptId),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, deptId } = request.params as { collegeId: string; deptId: string };
      const parsed = triggerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const result = await triggerReingest(collegeId, deptId, parsed.data.doc_ids);
      return reply.status(202).send(result);
    },
  );
};

export const reingestRoutes = reingestRoutesPlugin;
