import fp from "fastify-plugin";
import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { MAX_FILE_SIZE_VIDEO } from "@college-chatbot/shared";

export const multipartPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_FILE_SIZE_VIDEO,
      files: 1,
    },
  });
});
