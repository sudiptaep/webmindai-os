import type { FastifyRequest, FastifyReply } from "fastify";
import { isSuperAdmin, isDeptAdmin, isStudent } from "@college-chatbot/shared";

export async function resolveCollege(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user;
  if (!user) {
    reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Not authenticated" });
    return;
  }
  // Super admin bypasses college scope check
  if (isSuperAdmin(user)) return;

  const { collegeId } = request.params as { collegeId?: string };
  if (!collegeId) return;

  const userCollegeId = isDeptAdmin(user) || isStudent(user) ? user.college_id : null;
  if (userCollegeId !== collegeId) {
    reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "College scope mismatch" });
  }
}
