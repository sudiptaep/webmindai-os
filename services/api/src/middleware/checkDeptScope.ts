import type { FastifyRequest, FastifyReply } from "fastify";
import { isDeptAdmin, isSuperAdmin, isCollegeAdmin } from "@college-chatbot/shared";

export function requireDeptScope(getDeptId: (req: FastifyRequest) => string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    // super_admin and college_admin bypass dept scope entirely
    if (isSuperAdmin(user) || isCollegeAdmin(user)) return;

    if (!isDeptAdmin(user)) {
      reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Not a dept admin" });
      return;
    }

    const deptId = getDeptId(request);
    if (user.dept_id !== deptId) {
      reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Department access denied" });
    }
  };
}
