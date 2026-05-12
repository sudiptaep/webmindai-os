import fs from "fs";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { validateFileToken, consumeFileToken } from "../services/file-token.service";
import { STORAGE_ROOT } from "../services/storage.service";

const filesRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    "/files/serve",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.query as { token?: string };

      if (!token) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Missing token" });
      }

      // 1. Validate token in Redis
      const tokenData = await validateFileToken(token);
      if (!tokenData) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid or expired token" });
      }

      // 2. Consume single-use token before serving (download intent)
      if (tokenData.single_use) {
        await consumeFileToken(token);
      }

      // 3. Path traversal guard — file_path must be under STORAGE_ROOT
      const filePath = tokenData.file_path;
      const normalizedFilePath = filePath.replace(/\\/g, "/");
      const normalizedRoot = STORAGE_ROOT.replace(/\\/g, "/");
      if (!normalizedFilePath.startsWith(normalizedRoot)) {
        return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Forbidden" });
      }

      // 4. Check file exists on disk
      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "File not found" });
      }

      const stat = fs.statSync(filePath);
      const rangeHeader = request.headers.range;

      if (rangeHeader) {
        // 5. Partial content — required for video scrubbing and PDF.js progressive loading
        const rangeMatch = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(rangeMatch[0] ?? "0", 10);
        const rawEnd = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : NaN;
        const end = isNaN(rawEnd)
          ? Math.min(start + 1024 * 1024 - 1, stat.size - 1)  // 1 MB default chunk
          : Math.min(rawEnd, stat.size - 1);

        if (start >= stat.size || start < 0) {
          return reply
            .status(416)
            .header("Content-Range", `bytes */${stat.size}`)
            .send({ statusCode: 416, error: "Range Not Satisfiable" });
        }

        // Use reply.raw directly for range responses — writeHead ensures headers are sent
        reply.raw.writeHead(206, {
          "Content-Range":  `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges":  "bytes",
          "Content-Length": String(end - start + 1),
          "Content-Type":   tokenData.mime_type,
        });
        fs.createReadStream(filePath, { start, end }).pipe(reply.raw);
      } else {
        // 6. Full file — use reply.send(stream) so Fastify flushes headers correctly
        const disposition = tokenData.intent === "download"
          ? `attachment; filename="${tokenData.filename}"`
          : `inline; filename="${tokenData.filename}"`;

        return reply
          .status(200)
          .header("Content-Type",        tokenData.mime_type)
          .header("Content-Disposition", disposition)
          .header("Content-Length",      String(stat.size))
          .header("Accept-Ranges",       "bytes")
          .send(fs.createReadStream(filePath));
      }
    },
  );
};

export const filesRoutes = filesRoutesPlugin;
