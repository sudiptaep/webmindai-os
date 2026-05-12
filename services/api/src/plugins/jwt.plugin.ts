import fp from "fastify-plugin";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

export const jwtPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET ?? process.env.JWT_SECRET,
  });
});
