import type { FastifyRequest, FastifyReply } from "fastify";
import { enforceCostPolicy, CostLimitError, RateLimitError } from "../services/cost-policy.service";

export async function checkTokenLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = request.params as { collegeId?: string; deptId?: string };
  const user = (request as unknown as { user?: { college_id?: string; dept_id?: string; sub?: string } }).user;

  const collegeId = params.collegeId ?? user?.college_id;
  const deptId    = params.deptId    ?? user?.dept_id;

  if (!collegeId || !deptId) return;

  const body = request.body as { model?: string } | undefined;
  const model = body?.model ?? "claude-haiku-4-5-20251001";
  const studentId = user?.sub ?? null;

  try {
    await enforceCostPolicy(collegeId, deptId, studentId, model, "chat");
  } catch (err) {
    if (err instanceof CostLimitError) {
      return reply.status(429).send({
        statusCode: 429,
        error: "Cost Limit Exceeded",
        message: err.code,
        meta: err.meta,
      });
    }
    if (err instanceof RateLimitError) {
      return reply.status(429).send({
        statusCode: 429,
        error: "Rate Limit Exceeded",
        message: err.code,
        meta: err.meta,
      });
    }
    throw err;
  }
}
