import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AnyJWTPayload } from "@college-chatbot/shared";
import { getRedisConnection } from "../services/queue.service";

export async function verifyJWT(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Missing token" });
    return;
  }
  const token = authHeader.slice(7);

  const secrets = [
    process.env.JWT_SECRET!,
    process.env.COLLEGE_ADMIN_JWT_SECRET,
    process.env.SUPER_ADMIN_JWT_SECRET,
  ].filter(Boolean) as string[];

  let payload: AnyJWTPayload | null = null;
  for (const secret of secrets) {
    try {
      payload = jwt.verify(token, secret) as AnyJWTPayload;
      break;
    } catch {
      // try next secret
    }
  }

  if (!payload) {
    reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid or expired token" });
    return;
  }

  // Force-refresh check: invalidate old dept_admin tokens that carry is_college_owner
  if (payload.role === "dept_admin" && "is_college_owner" in payload) {

    try {
      const redis = getRedisConnection();
      const forceRefresh = await redis.get("force_token_refresh:all_dept_admins");
      if (forceRefresh) {
        reply.status(401).send({
          statusCode: 401, error: "Unauthorized",
          message: "Your session has been updated. Please log in again.",
        });
        return;
      }
    } catch {
      // Redis unavailable — don't block the request
    }
  }

  request.user = payload;
}
