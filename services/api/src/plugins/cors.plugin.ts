import fp from "fastify-plugin";
import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

export const corsPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const platformDomain = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? "yourplatform.com";
      const allowed =
        origin.endsWith(`.${platformDomain}`) ||
        origin === `https://${platformDomain}` ||
        (process.env.NODE_ENV !== "production" && origin.startsWith("http://localhost"));
      cb(null, allowed);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
});
