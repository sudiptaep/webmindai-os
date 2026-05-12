import type { FastifyRequest, FastifyReply } from "fastify";
import { getCollegeModel } from "../models/platform/college.model";

const WARN_THRESHOLD = 0.8; // 80% — log warning but still allow

export async function checkTokenLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { collegeId } = request.params as { collegeId?: string };
  if (!collegeId) return;

  const College = getCollegeModel();
  const college = await College.findById(collegeId)
    .select("token_limit_per_month tokens_used_this_month")
    .lean();

  if (!college) return;

  const { token_limit_per_month, tokens_used_this_month } = college;
  if (!token_limit_per_month || token_limit_per_month <= 0) return;

  const ratio = tokens_used_this_month / token_limit_per_month;

  if (ratio >= 1) {
    return reply.status(429).send({
      statusCode: 429,
      error: "Token Limit Exceeded",
      message:
        "Monthly token quota exhausted. Contact your administrator to increase the limit.",
    });
  }

  if (ratio >= WARN_THRESHOLD) {
    request.log.warn(
      { collegeId, tokens_used_this_month, token_limit_per_month },
      "College approaching monthly token limit"
    );
  }
}
