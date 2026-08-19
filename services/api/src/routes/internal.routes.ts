import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { IngestionCallbackPayload, ChapterMapCallbackPayload, PYQIngestionCallbackPayload, ParentChunk, ConceptGraphCallbackPayload } from "@college-chatbot/shared";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getExtractionJobModel } from "../models/college/extraction-job.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getStudentModel } from "../models/college/student.model";
import { getChapterMapModel } from "../models/college/chapter-map.model";
import { getPYQPaperModel } from "../models/college/pyq-paper.model";
import { getPYQQuestionModel } from "../models/college/pyq-question.model";
import { getSubjectModel } from "../models/college/subject.model";
import { getImageAssetModel } from "../models/college/image-asset.model";
import { getParentChunkModel } from "../models/college/parent-chunk.model";
import { getConceptModel } from "../models/college/concept-graph.model";
import { getCollegeModel } from "../models/platform/college.model";
import { enqueueChapterExtractionJob, enqueueImageIngestionJob, enqueueConceptGraphExtractionJob } from "../services/queue.service";
import { seedMisconceptionsForDocument } from "../services/misconception-seed.service";
import { recordCostEvent, getBillingMonth, getBillingDay } from "../services/metering.service";

const callbackSchema = z.object({
  status: z.enum(["completed", "failed"]),
  chunk_count: z.number().int().nonnegative().optional(),
  quality_score: z.number().min(0).max(1).optional(),
  ocr_used: z.boolean().optional(),
  error: z.string().optional(),
  // F-11: populated by updated ingestion worker
  text_cache_path: z.string().optional(),
  thumbnail_path: z.string().optional(),
  transcript_path: z.string().optional(),
  page_count: z.number().int().positive().optional(),
  slide_count: z.number().int().positive().optional(),
  duration_seconds: z.number().positive().optional(),
  // F-18-A: multi-signal quality scoring
  signal_breakdown: z.object({
    density: z.number(),
    ocr_confidence: z.number(),
    structural_integrity: z.number(),
    vocab_validity: z.number(),
    boilerplate_penalty: z.number(),
  }).optional(),
  quality_formula_version: z.number().int().optional(),
  extraction_artifacts_cached: z.boolean().optional(),
  // F-19-B: hierarchical (small-to-big) chunking
  parent_chunk_count: z.number().int().nonnegative().optional(),
  child_chunk_count: z.number().int().nonnegative().optional(),
  // F-19-A: contextual chunk enrichment
  contextualised: z.boolean().optional(),
  contextualiser_version: z.number().int().optional(),
  contextualiser_cost_usd: z.number().nonnegative().optional(),
});

const internalRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post(
    "/ingest/:docId/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate internal secret
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const { docId } = request.params as { docId: string };
      const parsed = callbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const payload = parsed.data as IngestionCallbackPayload;

      // Locate document across all college DBs by scanning — we need college_id
      // The ingestion worker must include college_id in callback or we look it up via docId.
      // Spec: docId doubles as jobId, college_id is in the job payload.
      // Worker should POST with x-college-id header.
      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const conn = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);
      const doc = await Document.findById(docId);
      if (!doc) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Document not found" });
      }

      if (payload.status === "completed") {
        const completedFields: Record<string, unknown> = {
          ingestion_status: "completed",
          chunk_count: payload.chunk_count ?? 0,
          quality_score: payload.quality_score ?? 0,
          ocr_used: payload.ocr_used ?? false,
          ingestion_error: undefined,
        };
        if (payload.text_cache_path)  completedFields.text_cache_path  = payload.text_cache_path;
        if (payload.thumbnail_path)   completedFields.thumbnail_path   = payload.thumbnail_path;
        if (payload.transcript_path)  completedFields.transcript_path  = payload.transcript_path;
        if (payload.page_count)       completedFields.page_count       = payload.page_count;
        if (payload.slide_count)      completedFields.slide_count      = payload.slide_count;
        if (payload.duration_seconds) completedFields.duration_seconds = payload.duration_seconds;
        if (payload.signal_breakdown)          completedFields.signal_breakdown          = payload.signal_breakdown;
        if (payload.quality_formula_version)   completedFields.quality_formula_version   = payload.quality_formula_version;
        if (payload.extraction_artifacts_cached !== undefined) completedFields.extraction_artifacts_cached = payload.extraction_artifacts_cached;
        if (payload.parent_chunk_count !== undefined) completedFields.parent_chunk_count = payload.parent_chunk_count;
        if (payload.child_chunk_count !== undefined)  completedFields.child_chunk_count  = payload.child_chunk_count;
        if (payload.contextualised !== undefined)        completedFields.contextualised        = payload.contextualised;
        if (payload.contextualiser_version !== undefined) completedFields.contextualiser_version = payload.contextualiser_version;
        if (payload.contextualiser_cost_usd !== undefined) completedFields.contextualiser_cost_usd = payload.contextualiser_cost_usd;
        // F-19 Step 9: any doc completing ingestion today ran the F-19 pipeline
        // (hierarchical chunking + contextual enrichment) — marks it done for
        // the re-ingestion backlog, whether this was a first ingest or a re-ingest.
        completedFields.pipeline_version = 2;

        await Document.findByIdAndUpdate(docId, { $set: completedFields });

        // F-19-B: clean up stale parent_chunks left over from a previous
        // pipeline version (e.g. old chunker produced more/fewer parents).
        // Safe to run now — the worker POSTs the new parents via bulk-save
        // BEFORE this webhook fires, so "new" parents are already confirmed
        // in Mongo; this only removes IDs the new pass didn't produce.
        if (payload.parent_chunk_count !== undefined) {
          const ParentChunk = getParentChunkModel(conn);
          const expectedIds = Array.from({ length: payload.parent_chunk_count }, (_, i) => `${docId}_p${i}`);
          await ParentChunk.deleteMany({ doc_id: docId, _id: { $nin: expectedIds } });
        }

        if (payload.contextualiser_cost_usd && payload.contextualiser_cost_usd > 0) {
          recordCostEvent({
            college_id: collegeId,
            dept_id: doc.dept_id,
            action_type: "contextualisation",
            service: "anthropic",
            model: process.env.CONTEXTUALISER_MODEL ?? "claude-haiku-4-5-20251001",
            cost_usd: payload.contextualiser_cost_usd,
            billing_month: getBillingMonth(),
            billing_day: getBillingDay(),
            created_at: new Date(),
          });
        }

        // F-13: enqueue chapter extraction for PDF docs that have a local file path
        if (doc.file_type === "pdf" && doc.file_path) {
          const apiBase = process.env.API_INTERNAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
          await enqueueChapterExtractionJob({
            job_id:       `chapter_${docId}`,
            doc_id:       docId,
            college_id:   collegeId,
            dept_id:      doc.dept_id,
            file_path:    doc.file_path,
            job_type:     "extract_chapters",
            callback_url: `${apiBase}/api/v1/internal/ingest/${docId}/chapter-map/webhook`,
          }).catch((err) => {
            fastify.log.warn({ err, docId }, "Failed to enqueue chapter extraction — non-fatal");
          });
        }

        // F-17: enqueue image ingestion for PDF/PPTX docs (admin-toggleable)
        if ((doc.file_type === "pdf" || doc.file_type === "pptx") && doc.file_path && doc.images_enabled !== false) {
          const apiBase = process.env.API_INTERNAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
          const Department = getDepartmentModel(conn);
          const Subject = getSubjectModel(conn);
          const [dept, subject] = await Promise.all([
            Department.findById(doc.dept_id).lean(),
            doc.subject_id ? Subject.findById(doc.subject_id).lean() : Promise.resolve(null),
          ]);

          await Document.findByIdAndUpdate(docId, { $set: { image_ingestion_status: "queued" } });

          await enqueueImageIngestionJob({
            job_id:        `image_${docId}`,
            doc_id:        docId,
            college_id:    collegeId,
            dept_id:       doc.dept_id,
            subject_id:    doc.subject_id ?? null,
            file_path:     doc.file_path,
            file_type:     doc.file_type,
            doc_filename:  doc.original_filename,
            dept_name:     dept?.name ?? "",
            subject_name:  subject?.name,
            academic_year: doc.academic_year,
            job_type:      "image_ingestion",
            callback_url:  `${apiBase}/api/v1/internal/ingest/${docId}/images/webhook`,
            bulk_save_url: `${apiBase}/api/v1/internal/ingest/${docId}/images/bulk-save`,
          }).catch((err) => {
            fastify.log.warn({ err, docId }, "Failed to enqueue image ingestion — non-fatal");
          });
        }

        // If dept had no completed docs before, re-evaluate students using generic fallback
        const Department = getDepartmentModel(conn);
        const dept = await Department.findById(doc.dept_id);
        if (dept && !dept.is_generic) {
          const completedCount = await Document.countDocuments({
            dept_id: doc.dept_id,
            ingestion_status: "completed",
          });
          if (completedCount === 1) {
            // First completed doc — migrate generic-fallback students back
            const Student = getStudentModel(conn);
            await Student.updateMany(
              { dept_id: doc.dept_id, using_generic_fallback: true },
              { $set: { using_generic_fallback: false, effective_dept_id: doc.dept_id } },
            );
          }
        }
      } else {
        await Document.findByIdAndUpdate(docId, {
          $set: {
            ingestion_status: "failed",
            ingestion_error: payload.error ?? "Unknown error",
          },
        });
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── Chapter map callback (from Python extract_chapters worker) ───────────
  const chapterMapCallbackSchema = z.object({
    status:            z.enum(["completed", "failed"]),
    chapter_count:     z.number().int().nonnegative().optional(),
    extraction_method: z.enum(["pdf_bookmarks", "heuristic", "manual"]).optional(),
    confidence_score:  z.number().min(0).max(1).optional(),
    chapters:          z.array(z.any()).optional(),
    error:             z.string().optional(),
  });

  fastify.post(
    "/ingest/:docId/chapter-map/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const { docId } = request.params as { docId: string };
      const parsed = chapterMapCallbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const cb = parsed.data as ChapterMapCallbackPayload;
      const conn = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);

      if (cb.status === "completed" && cb.chapters && cb.chapters.length > 0) {
        const ChapterMap = getChapterMapModel(conn);

        // Find doc to get dept_id
        const doc = await Document.findById(docId).lean();
        if (!doc) {
          return reply.status(404).send({ statusCode: 404, error: "Not Found" });
        }

        await ChapterMap.findOneAndUpdate(
          { doc_id: docId },
          {
            $setOnInsert: { _id: randomUUID() },
            $set: {
              doc_id:            docId,
              college_id:        collegeId,
              dept_id:           doc.dept_id,
              extraction_method: cb.extraction_method ?? "heuristic",
              confidence_score:  cb.confidence_score ?? 0,
              total_chapters:    cb.chapter_count ?? cb.chapters.length,
              total_pages:       cb.chapters.at(-1)?.end_page ?? 0,
              chapters:          cb.chapters,
            },
          },
          { upsert: true, new: true },
        );

        await Document.findByIdAndUpdate(docId, {
          $set: {
            has_chapter_map: true,
            chapter_count: cb.chapter_count ?? cb.chapters.length,
          },
        });

        // F-20-A: concept graph extraction runs once chapters are known — needs
        // the ordered chapter/page-range list to constrain prerequisites to
        // earlier chapters. Only for PDFs with a local file (same guard as
        // chapter extraction itself).
        if (doc.file_type === "pdf" && doc.file_path) {
          const [dept, college] = await Promise.all([
            getDepartmentModel(conn).findById(doc.dept_id).lean(),
            getCollegeModel().findById(collegeId).lean(),
          ]);
          const apiBase = process.env.API_INTERNAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

          await enqueueConceptGraphExtractionJob({
            job_id:       `concept_graph_${docId}`,
            doc_id:       docId,
            college_id:   collegeId,
            dept_id:      doc.dept_id,
            subject_id:   doc.subject_id,
            dept_name:    dept?.name ?? "",
            college_type: college?.type ?? "",
            file_path:    doc.file_path,
            chapters:     cb.chapters,
            job_type:     "extract_concept_graph",
            callback_url: `${apiBase}/api/v1/internal/ingest/${docId}/concept-graph/webhook`,
          }).catch((err) => {
            fastify.log.warn({ err, docId }, "Failed to enqueue concept graph extraction — non-fatal");
          });
        }
      } else if (cb.status === "failed") {
        fastify.log.warn({ docId, error: cb.error }, "Chapter extraction failed");
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── Concept graph callback (from Python extract_concept_graph worker) ────
  fastify.post(
    "/ingest/:docId/concept-graph/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const { docId } = request.params as { docId: string };
      const cb = request.body as ConceptGraphCallbackPayload;
      const conn = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);

      if (cb.status === "completed" && cb.concepts) {
        const Concept = getConceptModel(conn);

        // Re-extraction replaces the prior graph for this doc rather than
        // accumulating duplicates.
        await Concept.deleteMany({ doc_id: docId });
        if (cb.concepts.length > 0) {
          await Concept.insertMany(cb.concepts, { ordered: false }).catch((err) => {
            fastify.log.warn({ err, docId }, "Some concepts failed to insert");
          });
        }

        const docForCost = await Document.findByIdAndUpdate(docId, {
          $set: {
            concept_graph_extracted: true,
            concept_count: cb.concept_count ?? cb.concepts.length,
            concept_graph_version: 1,
          },
        }).select("dept_id").lean();

        if (cb.concept_graph_extraction_cost_usd && cb.concept_graph_extraction_cost_usd > 0 && docForCost) {
          recordCostEvent({
            college_id: collegeId,
            dept_id: docForCost.dept_id,
            action_type: "concept_graph_extraction",
            service: "anthropic",
            model: process.env.CONCEPT_GRAPH_MODEL ?? "claude-sonnet-4-6",
            cost_usd: cb.concept_graph_extraction_cost_usd,
            billing_month: getBillingMonth(),
            billing_day: getBillingDay(),
            created_at: new Date(),
          });
        }

        // F-20-B: seed misconceptions for the freshly extracted concepts.
        // Fire-and-forget — a large textbook's worth of LLM calls would
        // otherwise hold this webhook response open for many minutes.
        if (cb.concepts.length > 0) {
          seedMisconceptionsForDocument(docId, collegeId, conn).catch((err) => {
            fastify.log.warn({ err, docId }, "Misconception seeding failed — non-fatal");
          });
        }
      } else if (cb.status === "failed") {
        fastify.log.warn({ docId, error: cb.error }, "Concept graph extraction failed");
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── PYQ ingestion callback (from Python ingest_pyq worker) ─────────────
  fastify.post(
    "/ingest/pyq/:paperId/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const { paperId } = request.params as { paperId: string };
      const cb = request.body as PYQIngestionCallbackPayload;
      const conn = await getCollegeDb(collegeId);
      const PYQPaper = getPYQPaperModel(conn);

      if (cb.status === "completed") {
        await PYQPaper.findByIdAndUpdate(paperId, {
          $set: {
            ingestion_status: "completed",
            question_count:   cb.question_count ?? 0,
          },
        });
      } else {
        await PYQPaper.findByIdAndUpdate(paperId, {
          $set: { ingestion_status: "failed" },
        });
        fastify.log.warn({ paperId, error: cb.error }, "PYQ ingestion failed");
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── PYQ questions bulk-save (called by ingest_pyq.py) ───────────────────
  fastify.post(
    "/ingest/pyq/:paperId/questions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const body = request.body as { questions?: unknown[]; college_id?: string } | null;
      if (!body?.questions?.length) return reply.status(400).send({ error: "questions required" });

      const conn = await getCollegeDb(collegeId);
      const PYQQuestion = getPYQQuestionModel(conn);

      // Use insertMany with ordered:false so duplicate-key errors don't abort the batch
      await PYQQuestion.insertMany(body.questions, { ordered: false }).catch(() => {
        // Silently swallow duplicate key errors on re-runs
      });

      return reply.status(201).send({ ok: true, count: body.questions.length });
    },
  );

  // ── PYQ → chapter mapping (called by ingest_pyq.py after upsert) ─────────
  fastify.post(
    "/ingest/pyq/map-chapters",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) return reply.status(400).send({ error: "x-college-id required" });

      const body = request.body as {
        college_id: string;
        dept_id: string;
        question_records: Array<{ _id: string; question_text: string; year: string }>;
        mapping_threshold: number;
      } | null;

      if (!body) return reply.status(400).send({ error: "body required" });

      const conn = await getCollegeDb(collegeId);
      const ChapterMap = getChapterMapModel(conn);
      const PYQQuestion = getPYQQuestionModel(conn);

      // For each chapter map in this dept, check which questions are already mapped
      // This is a best-effort O(chapters × questions) text scan — lightweight version
      // without re-embedding. The Python worker does the semantic mapping;
      // this endpoint handles the MongoDB side of the result.
      const chapterMaps = await ChapterMap.find({ college_id: collegeId, dept_id: body.dept_id }).lean();

      for (const cm of chapterMaps) {
        for (const ch of cm.chapters) {
          const chTitle = ch.title.toLowerCase();

          // Simple keyword heuristic: if chapter title words appear in question text
          const titleWords = chTitle.split(/\s+/).filter(w => w.length >= 4);

          const matchedIds: string[] = [];
          const matchedYears = new Set<string>();

          for (const q of body.question_records) {
            const qText = q.question_text.toLowerCase();
            const hits   = titleWords.filter(w => qText.includes(w));
            if (hits.length >= 2) {
              matchedIds.push(q._id);
              matchedYears.add(q.year);
            }
          }

          if (matchedIds.length > 0) {
            await ChapterMap.updateOne(
              { _id: cm._id, "chapters.chapter_index": ch.chapter_index },
              {
                $addToSet: {
                  "chapters.$.pyq_question_ids": { $each: matchedIds },
                  "chapters.$.pyq_years":        { $each: Array.from(matchedYears) },
                },
                $set: {
                  "chapters.$.pyq_count":          (ch.pyq_count ?? 0) + matchedIds.length,
                  "chapters.$.pyq_coverage_score":
                    Math.min(((ch.pyq_count ?? 0) + matchedIds.length) / 10, 1.0),
                },
              },
            );

            // Update mapped_chapter_indices on the question records
            await PYQQuestion.updateMany(
              { _id: { $in: matchedIds } },
              { $addToSet: { mapped_chapter_indices: ch.chapter_index } },
            );
          }
        }
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── Extraction job callback (from Python extract_pages worker) ──────────
  const extractionCallbackSchema = z.object({
    status:           z.enum(["processing", "completed", "failed"]),
    output_file_path: z.string().optional(),
    error:            z.string().optional(),
  });

  fastify.post(
    "/extract-jobs/:jobId/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const { jobId } = request.params as { jobId: string };
      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const parsed = extractionCallbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const { status, output_file_path, error } = parsed.data;
      const conn = await getCollegeDb(collegeId);
      const ExtractionJob = getExtractionJobModel(conn);

      const patch: Record<string, unknown> = { status };
      if (status === "completed" && output_file_path) {
        patch.output_file_path = output_file_path;
        patch.completed_at     = new Date();
        patch.expires_at       = new Date(Date.now() + 3_600_000); // 1-hour TTL
      }
      if (status === "failed" && error) {
        patch.error = error;
      }

      const job = await ExtractionJob.findByIdAndUpdate(jobId, { $set: patch }, { new: true });
      if (!job) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Extraction job not found" });
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── Image ingestion callback (from Python image_ingestion worker) ───────
  const imageIngestionCallbackSchema = z.object({
    status:                 z.enum(["completed", "failed"]),
    image_count_raw:        z.number().int().nonnegative().optional(),
    image_count_analysed:   z.number().int().nonnegative().optional(),
    image_count_indexed:    z.number().int().nonnegative().optional(),
    cost_usd:               z.number().nonnegative().optional(),
    error:                  z.string().optional(),
  });

  fastify.post(
    "/ingest/:docId/images/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const { docId } = request.params as { docId: string };
      const parsed = imageIngestionCallbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const cb = parsed.data;
      const conn = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);

      if (cb.status === "completed") {
        const analysed = cb.image_count_analysed ?? 0;
        const indexed = cb.image_count_indexed ?? 0;
        await Document.findByIdAndUpdate(docId, {
          $set: {
            image_count_raw: cb.image_count_raw ?? 0,
            image_count_analysed: analysed,
            image_count_indexed: indexed,
            image_ingestion_cost_usd: cb.cost_usd ?? 0,
            image_ingestion_status: indexed < analysed && indexed > 0 ? "partial" : "completed",
          },
        });

        if (cb.cost_usd && cb.cost_usd > 0) {
          const doc = await Document.findById(docId).lean();
          if (doc) {
            recordCostEvent({
              college_id: collegeId,
              dept_id: doc.dept_id,
              action_type: "image_ingestion",
              service: "openai_vision",
              model: "gpt-4o",
              cost_usd: cb.cost_usd,
              billing_month: getBillingMonth(),
              billing_day: getBillingDay(),
              created_at: new Date(),
            });
          }
        }
      } else {
        await Document.findByIdAndUpdate(docId, {
          $set: { image_ingestion_status: "failed" },
        });
        fastify.log.warn({ docId, error: cb.error }, "Image ingestion failed");
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── Image asset bulk-save (called by image_ingestion.py) ────────────────
  fastify.post(
    "/ingest/:docId/images/bulk-save",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const body = request.body as { images?: unknown[] } | null;
      if (!body?.images?.length) return reply.status(400).send({ error: "images required" });

      const conn = await getCollegeDb(collegeId);
      const ImageAsset = getImageAssetModel(conn);

      await ImageAsset.insertMany(body.images, { ordered: false }).catch(() => {
        // Silently swallow duplicate key errors on re-runs
      });

      return reply.status(201).send({ ok: true, count: body.images.length });
    },
  );

  // ── Parent chunk bulk-save (F-19-B, called by hierarchical_chunker via ingest_document.py) ──
  fastify.post(
    "/ingest/:docId/parents/bulk-save",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const body = request.body as { parents?: unknown[] } | null;
      if (!body?.parents?.length) return reply.status(400).send({ error: "parents required" });

      const conn = await getCollegeDb(collegeId);
      const ParentChunk = getParentChunkModel(conn);

      // Batches are re-POSTed on worker retry — upsert by _id rather than insertMany
      // so a retried batch doesn't fail on duplicate keys.
      await ParentChunk.bulkWrite(
        (body.parents as Array<Record<string, unknown> & { _id: string }>).map((p) => ({
          replaceOne: {
            filter: { _id: p._id },
            replacement: { ...p, created_at: p.created_at ?? new Date() } as ParentChunk,
            upsert: true,
          },
        })),
      );

      return reply.status(201).send({ ok: true, count: body.parents.length });
    },
  );
}

export const internalRoutes = internalRoutesPlugin;
