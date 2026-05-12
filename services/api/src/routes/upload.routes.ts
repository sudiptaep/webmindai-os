import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_PDF,
  MAX_FILE_SIZE_PPTX,
  MAX_FILE_SIZE_VIDEO,
  MAX_FILE_SIZE_AUDIO,
  MAX_FILE_SIZE_DOCX,
  isDeptAdmin,
  isSuperAdmin,
  type FileType,
} from "@college-chatbot/shared";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { requireDeptScope } from "../middleware/checkDeptScope";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { buildDocumentKey, uploadFile, resolveLocalPath } from "../services/storage.service";
import { enqueueIngestionJob } from "../services/queue.service";

const FILE_SIZE_LIMITS: Record<FileType, number> = {
  pdf: MAX_FILE_SIZE_PDF,
  pptx: MAX_FILE_SIZE_PPTX,
  mp4: MAX_FILE_SIZE_VIDEO,
  mkv: MAX_FILE_SIZE_VIDEO,
  mp3: MAX_FILE_SIZE_AUDIO,
  m4a: MAX_FILE_SIZE_AUDIO,
  docx: MAX_FILE_SIZE_DOCX,
};

const uploadRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post(
    "/college/:collegeId/admin/documents/upload",
    {
      preHandler: [
        verifyJWT,
        resolveCollege,
        requireRole("dept_admin", "super_admin"),
        requireDeptScope((req) => (req.body as Record<string, string>)?.dept_id ?? ""),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = request.params as { collegeId: string };

      // Parse multipart
      const parts = request.parts();
      let deptId: string | undefined;
      let subjectId: string | undefined;
      let academicYear: string | undefined;
      let fileBuffer: Buffer | undefined;
      let filename: string | undefined;
      let fileExt: string | undefined;

      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "dept_id") deptId = part.value as string;
          else if (part.fieldname === "subject_id") subjectId = part.value as string;
          else if (part.fieldname === "academic_year") academicYear = part.value as string;
        } else if (part.type === "file" && part.fieldname === "file") {
          filename = part.filename;
          const ext = filename.split(".").pop()?.toLowerCase();
          if (!ext || !ALLOWED_FILE_TYPES.includes(ext as FileType)) {
            await part.toBuffer(); // drain stream
            return reply.status(400).send({
              statusCode: 400,
              error: "Bad Request",
              message: `File type ".${ext}" not allowed. Allowed: ${ALLOWED_FILE_TYPES.join(", ")}`,
            });
          }
          fileExt = ext;
          fileBuffer = await part.toBuffer();
          const sizeLimit = FILE_SIZE_LIMITS[ext as FileType];
          if (fileBuffer.byteLength > sizeLimit) {
            return reply.status(413).send({
              statusCode: 413,
              error: "Payload Too Large",
              message: `File exceeds ${(sizeLimit / 1024 / 1024).toFixed(0)} MB limit for .${ext}`,
            });
          }
        }
      }

      if (!deptId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "dept_id required" });
      }
      if (!academicYear) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "academic_year required" });
      }
      if (!fileBuffer || !filename || !fileExt) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "file required" });
      }

      // Validate uploader has scope for this dept
      const user = request.user;
      if (isDeptAdmin(user) && !user.is_college_owner && !user.dept_ids.includes(deptId)) {
        return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Dept scope not permitted" });
      }

      const docId = randomUUID();
      const fileKey = buildDocumentKey(collegeId, deptId, docId, filename);
      const filePath = resolveLocalPath(fileKey);
      const fileType = fileExt as FileType;
      const uploadedBy = user.sub;

      // Save to local filesystem
      await uploadFile(fileKey, fileBuffer, fileType);

      // Create document record
      const conn = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);
      await Document.create({
        _id: docId,
        dept_id: deptId,
        subject_id: subjectId ?? undefined,
        college_id: collegeId,
        original_filename: filename,
        file_type: fileType,
        r2_key: fileKey,
        file_path: filePath,
        file_size_bytes: fileBuffer.byteLength,
        ingestion_status: "pending",
        uploaded_by: uploadedBy,
        academic_year: academicYear,
      });

      // Enqueue ingestion job
      const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      const callbackUrl = `${apiBase}/api/v1/internal/ingest/${docId}/webhook`;
      await enqueueIngestionJob({
        job_id: docId,
        doc_id: docId,
        college_id: collegeId,
        dept_id: deptId,
        subject_id: subjectId ?? null,
        r2_key: fileKey,
        file_path: filePath,
        file_type: fileType,
        academic_year: academicYear,
        callback_url: callbackUrl,
        job_type: "ingest",
      });

      return reply.status(202).send({ doc_id: docId, status: "pending" });
    },
  );
}

export const uploadRoutes = uploadRoutesPlugin;
