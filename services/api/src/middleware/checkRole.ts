import type { FastifyRequest, FastifyReply, RouteHandlerMethod } from "fastify";
import type { UserRole } from "@college-chatbot/shared";

export function requireRole(...roles: UserRole[]): RouteHandlerMethod {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user || !roles.includes(user.role as UserRole)) {
      reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Insufficient role" });
    }
  };
}
