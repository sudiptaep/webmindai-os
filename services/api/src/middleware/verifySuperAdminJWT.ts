import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { SuperAdminJWTPayload } from "@college-chatbot/shared";

export async function verifySuperAdminJWT(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return void reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Missing token" });
  }
  const token = authHeader.slice(7);
  const secret = process.env.SUPER_ADMIN_JWT_SECRET ?? process.env.JWT_SECRET!;
  try {
    const payload = jwt.verify(token, secret) as SuperAdminJWTPayload;
    if (payload.role !== "super_admin") {
      return void reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Super admin access required" });
    }
    request.user = payload;
  } catch {
    return void reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid or expired token" });
  }
}
