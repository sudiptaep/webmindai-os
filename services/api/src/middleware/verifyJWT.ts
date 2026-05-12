import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AnyJWTPayload } from "@college-chatbot/shared";

export async function verifyJWT(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Missing token" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AnyJWTPayload;
    request.user = payload;
  } catch {
    reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid or expired token" });
  }
}
