import type { AnyJWTPayload } from "@college-chatbot/shared";

declare module "fastify" {
  interface FastifyRequest {
    user: AnyJWTPayload;
  }
}
