import type { FastifyRequest, FastifyReply } from "fastify";
import { isDeptAdmin } from "@college-chatbot/shared";

export function requireDeptScope(getDeptId: (req: FastifyRequest) => string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!isDeptAdmin(user)) {
      reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Not a dept admin" });
      return;
    }
    // College owners can access all depts within their college
    if (user.is_college_owner) return;

    const deptId = getDeptId(request);
    if (!user.dept_ids.includes(deptId)) {
      reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Dept scope not permitted" });
    }
  };
}
