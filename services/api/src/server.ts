import "dotenv/config";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { jwtPlugin } from "./plugins/jwt.plugin";
import { corsPlugin } from "./plugins/cors.plugin";
import { multipartPlugin } from "./plugins/multipart.plugin";
import { rateLimitPlugin } from "./plugins/rateLimit.plugin";
import { authRoutes } from "./routes/auth.routes";
import { uploadRoutes } from "./routes/upload.routes";
import { internalRoutes } from "./routes/internal.routes";
import { chatRoutes } from "./routes/chat.routes";
import { filesRoutes } from "./routes/files.routes";
import { libraryRoutes } from "./routes/library.routes";
import { quizRoutes } from "./routes/quiz.routes";
import { pyqRoutes } from "./routes/pyq.routes";
import { connectPlatformDb } from "./db/platform.db";
import { appRouter } from "./trpc/router";
import { createContext } from "./trpc/context";
import { startScheduler, stopScheduler } from "./jobs/scheduler";

const server = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  bodyLimit: 210 * 1024 * 1024, // 210 MB — covers 200 MB file + multipart overhead
});

async function bootstrap() {
  await server.register(corsPlugin);
  await server.register(jwtPlugin);
  await server.register(multipartPlugin);
  await server.register(rateLimitPlugin);

  // Public auth routes
  await server.register(authRoutes, { prefix: "/api/v1/auth" });

  // Dept admin upload (multipart → R2 → BullMQ)
  await server.register(uploadRoutes, { prefix: "/api/v1" });

  // Internal webhook for ingestion worker callbacks
  await server.register(internalRoutes, { prefix: "/api/v1/internal" });

  // Student SSE chat (outside tRPC — streaming not supported)
  await server.register(chatRoutes, { prefix: "/api/v1" });

  // Token-gated file server — no prefix, route is /files/serve
  await server.register(filesRoutes);

  // Student document library (browse, download, extract, AI summary)
  await server.register(libraryRoutes, { prefix: "/api/v1" });

  // Student quiz engine (generate, answer, results)
  await server.register(quizRoutes, { prefix: "/api/v1" });

  // PYQ intelligence — admin upload + student list
  await server.register(pyqRoutes, { prefix: "/api/v1" });

  // tRPC — all admin CRUD
  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError: ({ path, error }: { path: string | undefined; error: Error }) => {
        server.log.error({ path, err: error }, "tRPC error");
      },
    },
  });

  // Health check
  server.get("/api/v1/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  await connectPlatformDb();
  await startScheduler();

  server.addHook("onClose", async () => {
    await stopScheduler();
  });

  const port = Number(process.env.PORT ?? 3000);
  await server.listen({ port, host: "0.0.0.0" });
  server.log.info(`API server listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { server };
