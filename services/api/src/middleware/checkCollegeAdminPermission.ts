import type { FastifyRequest, FastifyReply } from "fastify";
import { isCollegeAdmin, isSuperAdmin } from "@college-chatbot/shared";
import type { CollegeAdminPermissionsJWT } from "@college-chatbot/shared";

export function checkCollegeAdminPermission(permissionKey: keyof CollegeAdminPermissionsJWT) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    // super_admin bypasses all permission checks
    if (isSuperAdmin(user)) return;

    if (!isCollegeAdmin(user)) {
      reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "College admin access required" });
      return;
    }

    if (!user.permissions[permissionKey]) {
      reply.status(403).send({
        statusCode: 403, error: "Forbidden",
        message: `Permission '${permissionKey}' is not granted to your account`,
      });
    }
  };
}
