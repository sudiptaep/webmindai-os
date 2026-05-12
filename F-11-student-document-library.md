# F-11: Student Document Library
## Implementation Specification for Claude Code

> **Parent doc:** `college-chatbot-architecture.md` v2.0  
> **Feature:** Student-facing document library with download, text extraction, page extraction, AI summary, and inline preview for all file formats  
> **Roles affected:** Student (consumer) · Dept Admin (controls visibility/download flags)  
> **New services:** 3 Fastify routes · 2 Python worker jobs · 1 new MongoDB collection  
> **Storage:** Local filesystem — files served via Fastify with token-gated access (no cloud object storage)  
> **Version:** 1.1 · May 2026 · Updated: replaced Cloudflare R2 with local filesystem storage

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Design Decisions & Rationale](#2-design-decisions--rationale)
3. [Database Changes](#3-database-changes)
4. [New API Routes](#4-new-api-routes)
5. [Feature Specs](#5-feature-specs)
   - F-11-A: Library Browse & Search
   - F-11-B: Inline Document Preview
   - F-11-C: File Download (Pre-signed URL)
   - F-11-D: Full Text Extraction
   - F-11-E: Page / Slide Range Extraction
   - F-11-F: AI Document Summary
   - F-11-G: Video / Audio Streaming
   - F-11-H: Dept Admin — Library Controls
6. [Security Model](#6-security-model)
7. [Python Worker Jobs](#7-python-worker-jobs)
8. [Frontend Components](#8-frontend-components)
9. [Schema Additions to Existing Collections](#9-schema-additions-to-existing-collections)
10. [Environment Variables (additions)](#10-environment-variables-additions)
11. [Build Order](#11-build-order)

---

## 1. Feature Overview

Students currently interact with their department's curriculum only through the AI chat interface. This feature adds a full **Document Library** to the student dashboard — a structured, searchable view of every document uploaded by their Dept Admin, with the following actions available per document:

| Action | All formats | Notes |
|---|:---:|---|
| Browse & search documents | ✓ | Grouped by subject, filterable by type |
| Inline preview | ✓ | PDF.js, slide thumbnails, HTML5 video |
| Download original file | ✓* | *Requires `download_enabled: true` on document |
| Extract full text | ✓ | Clean text from existing ingestion cache |
| Extract specific pages/slides | ✓* | *PDF and PPTX only |
| AI-generated summary | ✓ | Streams from existing Pinecone chunks |
| Stream video/audio | ✓ | MP4, MP3, M4A with transcript sidebar |

**Access boundary:** Every library action is scoped to the student's `effective_dept_id`. The same department isolation that governs RAG chat governs file access. A student registered in Pharmacology never sees Anatomy documents.

**Entry points to the library:**
1. Sidebar nav: Chat → **Library** → Sessions → Profile
2. Chat source citation chip: clicking `— [DS Unit3, Pg 47]` opens the library viewer directly at that document and page
3. Deep link: `/library/:docId?page=47`

---

## 2. Design Decisions & Rationale

### 2.1 Token-gated file serving — never expose raw filesystem paths

Raw filesystem paths are never sent to the frontend. Every file access goes through a **one-time access token** pattern served by Fastify:

```
Student request → Fastify validates JWT + dept scope + download_enabled
              → Generate a short-lived access token (UUID, stored in Redis, 15-min TTL)
              → Return token URL: GET /files/serve?token=<uuid>
              → Student's browser hits /files/serve?token= → Fastify validates token,
                reads file from local disk, streams it directly to browser
              → Token is single-use (deleted from Redis after first use for downloads)
```

**Local filesystem folder structure:**
```
/app/storage/
├── colleges/
│   └── {college_id}/
│       ├── uploads/
│       │   └── {dept_id}/
│       │       └── {doc_id}/
│       │           └── {original_filename}          ← the raw uploaded file
│       ├── thumbnails/
│       │   └── {doc_id}.jpg                         ← generated on ingestion
│       ├── text_cache/
│       │   └── {doc_id}.json                        ← extracted text, JSON format
│       ├── transcripts/
│       │   └── {doc_id}.json                        ← Whisper transcript
│       └── temp/
│           └── {job_id}.pdf                         ← ephemeral extracted pages (1-hr TTL)
```

**Important design notes for local storage:**

- The `/app/storage/` root must be on a volume with sufficient disk space. Plan for ~50 GB per active college (textbooks + lecture videos are large).
- The Fastify process must have read/write permissions on `/app/storage/`.
- Fastify serves files using `reply.sendFile()` (via `@fastify/static`) but the files are NOT publicly browsable — all access goes through the token middleware.
- For Docker deployments: mount `/app/storage/` as a named volume so it persists across container restarts.
- For production: consider an NFS/network share if running multiple API instances so all instances see the same storage root.

Benefits of this approach: no cloud egress costs, full control over access logic, works offline/intranet, simpler billing.

### 2.2 `download_enabled` flag per document

Dept Admins can block download of specific files while still allowing students to view and extract text. Use cases:
- Exam papers (view in class, not downloadable)
- Copyright-sensitive textbooks (AI-queryable, not distributable)
- Draft notes not ready for distribution

Default: `download_enabled: true`. Extract text and AI summary are always available regardless of this flag — they serve educational purposes and don't distribute the original file.

### 2.3 `is_visible_to_students` flag per document

Dept Admin can hide a document from the student library entirely (e.g., internal answer key, admin reference). Hidden documents are still indexed in Pinecone for RAG — the AI can answer from them — but they don't appear in the student library list. This is the "admin-only content" pattern.

Default: `is_visible_to_students: true`.

### 2.4 Text extraction uses ingestion cache — not re-processing

During ingestion (F-03), the Python worker already extracts text page-by-page. This extracted text is saved as a JSON cache file on the local filesystem at `/app/storage/colleges/{cid}/text_cache/{doc_id}.json`. The library text extraction endpoint reads this cache — no reprocessing. This makes text extraction instant and free of compute cost.

### 2.5 Page extraction is ephemeral

When a student requests "extract pages 10–25", the Python worker generates a new PDF with just those pages using PyPDF2. This ephemeral PDF is written to the local filesystem at `/app/storage/colleges/{cid}/temp/{job_id}.pdf` with a 1-hour TTL. A nightly cleanup job walks the `temp/` directory and deletes all files older than 1 hour.

### 2.6 AI Summary uses existing Pinecone chunks — not a new LLM call on the full file

The summary pipeline:
```
doc_id → query Pinecone for all chunks where metadata.doc_id = doc_id
       → assemble chunks (ordered by chunk_index)
       → send to Claude Haiku with summary prompt
       → stream response via SSE
```

This is fast (chunks already indexed), cheap (Haiku), and consistent with the RAG engine's grounding — the summary never says anything not in the actual document.

### 2.7 Video: token-gated streaming + transcript sidebar

MP4 lecture videos are streamed directly from the local filesystem via Fastify. A 2-hour access token is generated (long enough for a full lecture). The HTML5 `<video>` element uses the token URL `/files/serve?token=<uuid>` — Fastify handles HTTP range requests (`Range: bytes=`) so scrubbing works correctly. The token is multi-use for stream (unlike single-use for download) so seeking doesn't invalidate it. Beside the video player, the Whisper transcript (stored in `transcripts/{doc_id}.json`) renders as a scrollable, clickable list. Clicking any transcript line seeks the video to that timestamp.

---

## 3. Database Changes

### 3.1 Additions to `documents` collection (existing)

```js
// Additions to the existing documents schema (F-03)
{
  // ... all existing fields remain unchanged ...

  // NEW FIELDS:
  download_enabled: Boolean,          // default: true. If false, blocks file serving
  is_visible_to_students: Boolean,    // default: true. If false, hidden from library browse
  thumbnail_path: String,             // local path: /app/storage/colleges/{cid}/thumbnails/{doc_id}.jpg
                                      // Generated for first page of PDF and first slide of PPTX
  text_cache_path: String,            // local path: /app/storage/colleges/{cid}/text_cache/{doc_id}.json
                                      // JSON: { pages: [{ page_num, text, ocr_confidence }] }
  file_path: String,                  // local path: /app/storage/colleges/{cid}/uploads/{dept_id}/{doc_id}/{filename}
                                      // Replaces r2_key — this is the authoritative file location
  slide_count: Number,                // PPTX only: total slide count
  duration_seconds: Number,           // MP4/MP3 only: media duration
  transcript_path: String,            // local path: /app/storage/colleges/{cid}/transcripts/{doc_id}.json
                                      // JSON: [{ start_sec, end_sec, text }]
}
```

### 3.2 New collection: `download_logs`

```js
// download_logs collection (in college_{college_id} DB)
{
  _id: UUID,
  student_id: UUID,
  doc_id: UUID,
  dept_id: UUID,
  college_id: UUID,
  action: Enum[
    "download",          // student clicked Download
    "extract_text",      // student used Extract Text
    "extract_pages",     // student used Extract Pages
    "ai_summary",        // student triggered AI Summary
    "stream",            // student played a video/audio
    "preview"            // student opened inline viewer
  ],
  ip_address: String,
  user_agent: String,
  pages_extracted: [Number],  // only for action = "extract_pages"
  tokens_used: Number,        // only for action = "ai_summary"
  created_at: Date
}

// Indexes:
// { student_id: 1, created_at: -1 }
// { doc_id: 1, action: 1 }
// { college_id: 1, dept_id: 1, created_at: -1 }
```

### 3.3 New collection: `extraction_jobs`

```js
// extraction_jobs collection — tracks async page extraction jobs
{
  _id: UUID,                          // job_id
  student_id: UUID,
  doc_id: UUID,
  college_id: UUID,
  job_type: Enum["extract_pages", "extract_slides"],
  status: Enum["pending", "processing", "completed", "failed"],
  pages_requested: [Number],          // e.g. [10, 11, 12, ..., 25]
  output_file_path: String,           // local path: /app/storage/colleges/{cid}/temp/{job_id}.pdf
                                      // populated on completion
  output_token: String,               // short-lived access token for serving the file (15-min TTL)
                                      // stored in Redis; browser uses GET /files/serve?token=<this>
  error: String,                      // populated on failure
  expires_at: Date,                   // 1 hour after completion — file + token cleanup trigger
  created_at: Date,
  completed_at: Date
}
```

---

## 4. New API Routes

All routes require `role: student` JWT and enforce `effective_dept_id` scoping.

### Student Library routes (tRPC + raw Fastify)

```
# BROWSE
GET    /api/v1/college/:cid/student/library
       ?subject_id=<uuid>
       &type=pdf|pptx|mp4|mp3|docx|all
       &semester=3
       &year=2025-26
       &q=<search_term>
       &sort=name|date|size|type
       &order=asc|desc
       &page=1&limit=20
       Response: { subjects: [{ subject_id, name, docs: [DocumentCard] }], total, pagination }

GET    /api/v1/college/:cid/student/library/:docId
       Response: DocumentDetail (full metadata, no file path exposed)

# FILE ACCESS — token-gated (all file serving goes through /files/serve)
GET    /api/v1/college/:cid/student/library/:docId/access-token
       ?intent=download|preview|stream
       Validates: JWT + dept scope + download_enabled (for intent=download)
       Generates: UUID access token stored in Redis
         - download token: TTL 900s (15 min), single-use, Content-Disposition: attachment
         - preview token:  TTL 900s (15 min), multi-use (PDF.js makes multiple range requests)
         - stream token:   TTL 7200s (2 hrs), multi-use (video scrubbing needs range requests)
       Logs: download_logs { action: intent }
       Response: {
         token_url: "/files/serve?token=<uuid>",
         expires_at: ISO datetime,
         filename: "Drug_Metabolism_Unit3.pdf",
         file_size_bytes: 4500000,
         file_type: "pdf"
       }

# UNIVERSAL FILE SERVER — single endpoint that serves all local files
GET    /files/serve?token=<uuid>
       Validates: token exists in Redis + not expired
       Reads: token metadata { file_path, intent, college_id, dept_id, filename, mime_type }
       If intent = "download": deletes token after serving (single-use)
       If intent = "preview" or "stream": keeps token (multi-use until TTL)
       Supports: HTTP Range requests (required for video scrubbing and PDF.js)
       Returns: file stream with correct Content-Type and Content-Disposition headers
       Note: file_path from Redis is server-side only — never exposed to client

# TEXT EXTRACTION
GET    /api/v1/college/:cid/student/library/:docId/extract-text
       ?page=N (optional — returns single page if specified)
       Reads: text_cache_path from local filesystem (no reprocessing)
       Logs: download_logs { action: "extract_text" }
       Response: { pages: [{ page_num, text, ocr_confidence }], total_pages, ocr_used, quality_score }

GET    /api/v1/college/:cid/student/library/:docId/extract-text/download
       Reads: text_cache_path, assembles plain text
       Streams: .txt file with Content-Disposition: attachment
       Response: text/plain stream

# PAGE EXTRACTION (async — Python worker)
POST   /api/v1/college/:cid/student/library/:docId/extract-pages
       Body: { pages: [10, 11, 12, ..., 25] } OR { page_from: 10, page_to: 25 }
       Validates: file_type in ["pdf", "pptx"]
       Enqueues: BullMQ job → Python worker
       Logs: download_logs { action: "extract_pages", pages_extracted: [...] }
       Response: { job_id, status: "pending", estimated_seconds: 10 }

GET    /api/v1/college/:cid/student/library/extract-jobs/:jobId
       Polls: extraction job status
       When completed: generates access token, stores in Redis
       Response: {
         status: "completed" | "pending" | "processing" | "failed",
         token_url: "/files/serve?token=<uuid>",   // only when status=completed
         expires_at: ISO datetime,
         error: "..." // only when status=failed
       }

# AI SUMMARY (SSE streaming)
GET    /api/v1/college/:cid/student/library/:docId/ai-summary
       ?mode=brief|detailed|key-terms        (default: brief)
       Enforces: college token limit check before calling LLM
       Retrieves: Pinecone chunks where metadata.doc_id = docId (ordered by chunk_index)
       Calls: Claude Haiku, streams via SSE
       Logs: download_logs { action: "ai_summary", tokens_used: N }
       SSE events:
         data: { type: "token", content: "..." }
         data: { type: "done", tokens_used: 142, source: { doc_id, filename } }
         data: { type: "error", message: "..." }
```

### Dept Admin — library control additions (tRPC)

```
PATCH  /api/v1/college/:cid/admin/documents/:docId/library-settings
       Body: { download_enabled?: Boolean, is_visible_to_students?: Boolean }
       Response: updated document record

GET    /api/v1/college/:cid/admin/documents/:docId/download-logs
       Response: [{ student_name (masked), action, created_at }] (last 100)
```

---

## 5. Feature Specs

---

### F-11-A: Library Browse & Search

**Endpoint:** `GET /college/:cid/student/library`

**Grouping logic:**
```
1. Fetch all documents where:
   - dept_id = student.effective_dept_id
   - is_visible_to_students = true
   - ingestion_status = "completed"
2. Group by subject_id (null subject_id → "Department General" group)
3. Within each subject, sort by: created_at DESC (newest first)
4. Apply filters: type, semester, year, search query (regex on filename + subject name)
5. Return paginated results (20 per page)
```

**Response shape:**
```json
{
  "dept_name": "Pharmacology",
  "using_generic_fallback": false,
  "subjects": [
    {
      "subject_id": "uuid",
      "subject_name": "Drug Metabolism",
      "subject_code": "PHARM301",
      "semester": 3,
      "doc_count": 5,
      "docs": [
        {
          "doc_id": "uuid",
          "filename": "Drug_Metabolism_Unit3.pdf",
          "file_type": "pdf",
          "file_size_bytes": 4500000,
          "file_size_display": "4.3 MB",
          "page_count": 87,
          "quality_score": 0.94,
          "ocr_used": false,
          "download_enabled": true,
          "thumbnail_url": "<signed_thumb_url_5min>",
          "academic_year": "2025-26",
          "uploaded_at": "2026-03-12T10:30:00Z"
        }
      ]
    },
    {
      "subject_id": null,
      "subject_name": "Department General",
      "docs": [...]
    }
  ],
  "total_docs": 24,
  "pagination": { "page": 1, "limit": 20, "total_pages": 2 }
}
```

**Frontend — DocumentCard component:**
```
┌─────────────────────────────────┐
│ [PDF icon]  Drug_Metabolism.pdf │
│ PHARM301 · Semester 3 · 4.3 MB │
│ 87 pages · Uploaded Mar 12     │
│ ░░░░░░░░░░ Quality: 94%        │
│                                 │
│ [Preview] [Download] [Extract▼] │
│            [AI Summary]         │
└─────────────────────────────────┘
```

Extract dropdown options:
- Extract Full Text
- Extract Pages (PDF/PPTX only)

**Search behaviour:**
- Client-side search on already-loaded `docs` array for instant results
- If `q` param sent to API: regex match on `original_filename` + `subject_name`
- No AI/vector search in the library — that's what Chat is for

---

### F-11-B: Inline Document Preview

**Trigger:** Student clicks "Preview" on a DocumentCard or clicks a chat source citation chip

**URL pattern:** `/student/library/:docId?page=47`

**Implementation per file type:**

#### PDF Preview
```
1. GET /library/:docId → fetch metadata
2. GET /library/:docId/access-token?intent=preview → get token URL
   Token is multi-use (PDF.js makes multiple range requests for progressive loading)
3. Load PDF.js with token URL: GET /files/serve?token=<uuid>
   Fastify handles Range headers for partial content (HTTP 206)
4. If ?page=47 param: PDF.js scrolls to page 47 on load
5. PDF.js toolbar: zoom, page nav, search in PDF, fullscreen
6. Page text layer enabled for text selection (copy-paste works)
```

#### PPTX Preview
```
1. GET /library/:docId → fetch slide_count + thumbnail_path prefix
2. Request thumbnail access tokens: GET /library/:docId/access-token?intent=preview
   Fastify serves thumbnails from /app/storage/colleges/{cid}/thumbnails/{doc_id}/slide_{N}.jpg
3. Render as a scrollable slide grid (3 columns, click to enlarge)
4. Enlarged view: full-width slide image + slide text panel beside it (from text cache)
5. Download option: GET /library/:docId/access-token?intent=download → downloads original PPTX
```

#### MP4 / Audio Preview
```
Handled by F-11-G (Video/Audio Streaming)
```

#### DOCX Preview
```
1. GET /library/:docId/extract-text → get full text cache
2. Render as styled HTML: headings, paragraphs, lists
3. Tables rendered as HTML tables (from parsed DOCX structure)
4. Jump-to-section: table of contents extracted from heading styles
5. Text is selectable and copyable
```

**Slide-over layout:**
```
┌────────────────────────────────────────────────────────────┐
│ ✕  Drug_Metabolism_Unit3.pdf                 [Download] [⋮]│
├────────────────────────────────────────────────────────────┤
│                          │                                  │
│   [PDF.js viewer]        │  📋 Actions                     │
│                          │  ─────────────                  │
│   Page 1 of 87           │  ⬇ Download Original (4.3 MB)  │
│                          │  📄 Extract Full Text           │
│   [← ] [page 12] [ →]   │  ✂️  Extract Pages 10–25        │
│                          │  🤖 AI Summary (Brief)          │
│                          │  💬 Chat about this doc →       │
│                          │                                  │
│                          │  📌 Details                     │
│                          │  Subject: PHARM301              │
│                          │  Uploaded: Mar 12, 2026         │
│                          │  Quality: 94% · 87 pages        │
└────────────────────────────────────────────────────────────┘
```

---

### F-11-C: File Download (Token-Gated)

**Endpoint:** `GET /library/:docId/access-token?intent=download`  
**File server:** `GET /files/serve?token=<uuid>`

**Token generation server logic:**
```javascript
async function getAccessToken(req, reply) {
  const { docId, collegeId } = req.params;
  const intent = req.query.intent || "download";  // download | preview | stream
  const { student } = req.jwtPayload;

  // 1. Fetch document
  const doc = await collegeDb(collegeId).documents.findOne({ _id: docId });
  if (!doc) return reply.status(404).send({ error: "Document not found" });

  // 2. Dept scope check
  if (doc.dept_id !== student.effective_dept_id) {
    return reply.status(403).send({ error: "Access denied" });
  }

  // 3. Visibility check
  if (!doc.is_visible_to_students) {
    return reply.status(403).send({ error: "Document not available" });
  }

  // 4. Download enabled check (only for download intent)
  if (intent === "download" && !doc.download_enabled) {
    return reply.status(403).send({ error: "Download not permitted for this document" });
  }

  // 5. Rate limit (Redis: max 20 downloads/student/hour — only counted for intent=download)
  if (intent === "download") {
    const key = `dl_rate:${student.id}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    if (count > 20) {
      return reply.status(429).send({ error: "Download limit reached. Try again in an hour." });
    }
  }

  // 6. Generate access token and store metadata in Redis
  const token = generateUUID();
  const ttl = intent === "stream" ? 7200 : 900;          // 2hr for stream, 15min for others
  const tokenData = {
    file_path: doc.file_path,                            // absolute local path — never sent to client
    intent,
    college_id: collegeId,
    dept_id: doc.dept_id,
    student_id: student.id,
    doc_id: docId,
    filename: doc.original_filename,
    mime_type: getMimeType(doc.file_type),
    single_use: intent === "download",                   // download tokens are single-use
  };
  await redis.setex(`file_token:${token}`, ttl, JSON.stringify(tokenData));

  // 7. Log to download_logs
  await collegeDb(collegeId).download_logs.insertOne({
    _id: generateUUID(),
    student_id: student.id,
    doc_id: docId,
    dept_id: doc.dept_id,
    college_id: collegeId,
    action: intent,
    ip_address: req.ip,
    user_agent: req.headers["user-agent"],
    created_at: new Date()
  });

  return reply.send({
    token_url: `/files/serve?token=${token}`,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    filename: doc.original_filename,
    file_size_bytes: doc.file_size_bytes,
    file_type: doc.file_type
  });
}
```

**Universal file server logic (`GET /files/serve?token=`):**
```javascript
async function serveFile(req, reply) {
  const { token } = req.query;
  if (!token) return reply.status(400).send({ error: "Missing token" });

  // 1. Validate token in Redis
  const raw = await redis.get(`file_token:${token}`);
  if (!raw) return reply.status(401).send({ error: "Invalid or expired token" });

  const tokenData = JSON.parse(raw);

  // 2. Consume single-use tokens (download intent)
  if (tokenData.single_use) {
    await redis.del(`file_token:${token}`);
  }

  // 3. Resolve and validate local file path
  //    CRITICAL: never allow path traversal — validate file_path starts with STORAGE_ROOT
  const filePath = tokenData.file_path;
  if (!filePath.startsWith(process.env.STORAGE_ROOT)) {
    return reply.status(403).send({ error: "Forbidden" });
  }

  // 4. Check file exists on disk
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: "File not found on disk" });
  }

  // 5. Handle HTTP Range requests (required for video scrubbing + PDF.js)
  const stat = fs.statSync(filePath);
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const [start, end] = rangeHeader.replace("bytes=", "").split("-").map(Number);
    const chunkEnd = end || Math.min(start + 1024 * 1024 - 1, stat.size - 1);  // 1MB chunks
    reply
      .status(206)
      .header("Content-Range", `bytes ${start}-${chunkEnd}/${stat.size}`)
      .header("Accept-Ranges", "bytes")
      .header("Content-Length", chunkEnd - start + 1)
      .header("Content-Type", tokenData.mime_type);
    fs.createReadStream(filePath, { start, end: chunkEnd }).pipe(reply.raw);
  } else {
    // 6. Full file response
    const disposition = tokenData.intent === "download"
      ? `attachment; filename="${tokenData.filename}"`
      : `inline; filename="${tokenData.filename}"`;
    reply
      .header("Content-Type", tokenData.mime_type)
      .header("Content-Disposition", disposition)
      .header("Content-Length", stat.size)
      .header("Accept-Ranges", "bytes");
    fs.createReadStream(filePath).pipe(reply.raw);
  }
}
```

**Frontend — download button behaviour:**
```javascript
async function handleDownload(docId, filename) {
  setDownloading(true);
  try {
    const { token_url, filename: fname } = await api.get(
      `/college/${collegeId}/student/library/${docId}/access-token?intent=download`
    );
    // token_url = "/files/serve?token=<uuid>"
    // Trigger browser download — anchor click approach
    const link = document.createElement("a");
    link.href = token_url;
    link.download = fname;
    link.click();
  } catch (err) {
    if (err.status === 403) toast.error("Download not permitted for this document");
    if (err.status === 429) toast.error("Download limit reached. Try again in an hour.");
  } finally {
    setDownloading(false);
  }
}
```

---

### F-11-D: Full Text Extraction

**Endpoint:** `GET /library/:docId/extract-text`

**Data source:** `text_cache_path` on local filesystem — written during ingestion. No reprocessing. Instant.

**Text cache format** (stored at `/app/storage/colleges/{cid}/text_cache/{doc_id}.json`):
```json
{
  "doc_id": "uuid",
  "file_type": "pdf",
  "total_pages": 87,
  "ocr_used": false,
  "quality_score": 0.94,
  "pages": [
    {
      "page_num": 1,
      "text": "Chapter 1: Introduction to Drug Metabolism...",
      "ocr_confidence": null
    },
    {
      "page_num": 2,
      "text": "The liver is the primary site of drug metabolism...",
      "ocr_confidence": null
    }
  ]
}
```

For PPTX: `page_num` = slide number, `text` = all text elements on the slide.
For MP4/MP3: `page_num` = segment index, `text` = Whisper transcript segment.

**API response:**
```json
{
  "doc_id": "uuid",
  "filename": "Drug_Metabolism_Unit3.pdf",
  "file_type": "pdf",
  "total_pages": 87,
  "ocr_used": false,
  "quality_score": 0.94,
  "pages": [
    { "page_num": 1, "text": "Chapter 1: Introduction..." },
    ...
  ]
}
```

If `?page=N` param: returns only that page's text object.

**Text download endpoint:** `GET /library/:docId/extract-text/download`
```javascript
// Read text cache from local filesystem, stream as .txt
const textData = JSON.parse(fs.readFileSync(doc.text_cache_path, "utf-8"));
const fullText = textData.pages.map(p => `--- Page ${p.page_num} ---\n${p.text}`).join("\n\n");
reply
  .header("Content-Type", "text/plain; charset=utf-8")
  .header("Content-Disposition", `attachment; filename="${doc.original_filename.replace(/\.[^.]+$/, '')}_text.txt"`)
  .send(fullText);
```

**Frontend — Extract Text modal:**
```
┌─────────────────────────────────────────────────────┐
│ 📄 Extracted Text — Drug_Metabolism_Unit3.pdf       │
│ [Full Text] [By Page] ────────────── [Copy] [⬇ .txt]│
├─────────────────────────────────────────────────────┤
│ 🔍 Search within text...                            │
├─────────────────────────────────────────────────────┤
│ --- Page 1 ---                                       │
│ Chapter 1: Introduction to Drug Metabolism           │
│ The liver is the primary site of drug metabolism.   │
│                                                      │
│ --- Page 2 ---                                       │
│ Phase I reactions involve oxidation, reduction...    │
│                                    [... scroll ...]  │
└─────────────────────────────────────────────────────┘
```

By Page tab: number input `[Page: 12]` → displays only that page's text.
Search: client-side highlight search within loaded text.

---

### F-11-E: Page / Slide Range Extraction

**For:** PDF and PPTX only. Not applicable to MP4/MP3/DOCX.

**Endpoints:**
```
POST /library/:docId/extract-pages
GET  /library/extract-jobs/:jobId
```

**Flow:**
```
1. Student selects page range in UI (e.g. pages 10–25)
2. POST /extract-pages → body: { page_from: 10, page_to: 25 }
3. Fastify validates: file_type in ["pdf","pptx"], page range valid, rate limit (5 extractions/student/day)
4. Creates extraction_jobs record: { status: "pending" }
5. Enqueues BullMQ job: { job_type: "extract_pages", doc_id, pages: [10..25], job_id,
                          file_path: doc.file_path, college_id }
6. Returns: { job_id, status: "pending", estimated_seconds: 8 }
7. Frontend polls GET /extract-jobs/:jobId every 2 seconds
8. Python worker picks job, generates extracted PDF at /app/storage/colleges/{cid}/temp/{job_id}.pdf
9. Fastify API generates access token for the temp file, stores in Redis (15-min TTL, single-use)
10. Updates extraction_jobs: { status: "completed", output_token: token, expires_at }
11. Frontend receives completed status → shows "Download Extracted Pages (15 min)" button
    using GET /files/serve?token=<output_token>
```

**Python worker — extract_pages job:**
```python
async def extract_pages_job(job_data: dict):
    doc_id = job_data["doc_id"]
    pages = job_data["pages"]              # list of 1-indexed page numbers
    job_id = job_data["job_id"]
    college_id = job_data["college_id"]
    source_file_path = job_data["file_path"]   # absolute local path from job payload

    # Output path — write directly to local temp directory, no upload needed
    storage_root = os.environ["STORAGE_ROOT"]
    temp_dir = os.path.join(storage_root, "colleges", college_id, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    output_path = os.path.join(temp_dir, f"{job_id}.pdf")

    if job_data["file_type"] == "pdf":
        from PyPDF2 import PdfReader, PdfWriter
        reader = PdfReader(source_file_path)
        writer = PdfWriter()
        for page_num in pages:
            writer.add_page(reader.pages[page_num - 1])       # 0-indexed
        with open(output_path, "wb") as f:
            writer.write(f)

    elif job_data["file_type"] == "pptx":
        from pptx import Presentation
        prs = Presentation(source_file_path)
        new_prs = Presentation()
        new_prs.slide_width = prs.slide_width
        new_prs.slide_height = prs.slide_height
        for slide_idx in [p - 1 for p in pages]:
            xml_slide = prs.slides[slide_idx]._element
            new_prs.slides.add_slide(new_prs.slide_layouts[6])
            new_prs.slides[-1]._element.getparent().replace(new_prs.slides[-1]._element, xml_slide)
        pptx_path = os.path.join(temp_dir, f"{job_id}.pptx")
        new_prs.save(pptx_path)
        subprocess.run([
            "libreoffice", "--headless", "--convert-to", "pdf",
            pptx_path, "--outdir", temp_dir
        ], check=True)
        output_path = os.path.join(temp_dir, f"{job_id}.pdf")
        os.remove(pptx_path)

    # File is now on local disk at output_path.
    # Fastify API will generate access token for it when the job is polled.
    expires_at = datetime.utcnow() + timedelta(hours=1)
    await mongo.college_db(college_id).extraction_jobs.update_one(
        {"_id": job_id},
        {"$set": {
            "status": "completed",
            "output_file_path": output_path,     # local disk path, NOT sent to client
            "expires_at": expires_at,
            "completed_at": datetime.utcnow()
        }}
    )
    # No cleanup — file stays on disk until nightly cleanup job runs
```

**Frontend — page extraction UI:**
```
┌────────────────────────────────────┐
│ ✂️  Extract Pages                  │
│                                    │
│ Page range:  From [10] To  [25]   │
│ OR specific: [10, 12, 15, 20]     │
│                                    │
│ Estimated output: ~16 pages        │
│                                    │
│         [Extract Pages]            │
└────────────────────────────────────┘

After submit:
┌────────────────────────────────────┐
│ ⏳ Generating extracted PDF...     │
│    ████████░░░░  Estimated: 8s    │
└────────────────────────────────────┘

On complete:
┌────────────────────────────────────┐
│ ✅ Ready!                          │
│ ⬇ Download Pages 10–25 (0.9 MB)   │
│ ⚠️ Link expires in 15 minutes     │
└────────────────────────────────────┘
```

---

### F-11-F: AI Document Summary

**Endpoint:** `GET /library/:docId/ai-summary` (SSE streaming)

**Modes:**
| Mode | Prompt | Output |
|---|---|---|
| `brief` | "Summarise this document in 5 bullet points." | Markdown bullet list |
| `detailed` | "Provide a structured outline of this document with headings and key points." | Markdown with H2/H3 |
| `key-terms` | "Extract and define the 10 most important terms from this document." | Term: Definition list |

**Server logic:**
```javascript
async function getAiSummary(req, reply) {
  const { docId, collegeId } = req.params;
  const mode = req.query.mode || "brief";

  // 1. Validate JWT + dept scope
  const doc = await validateDocAccess(req, docId, collegeId);

  // 2. Check college token limit
  const college = await platformDb.colleges.findOne({ _id: collegeId });
  if (college.tokens_used_this_month >= college.token_limit_per_month) {
    return reply.status(429).send({ error: "College monthly token limit reached" });
  }

  // 3. Fetch all Pinecone chunks for this doc (ordered by chunk_index)
  const pinecone = getPineconeIndex();
  const namespace = `c_${collegeId}_d_${doc.dept_id}`;
  // Query Pinecone with a metadata filter (not a vector search)
  const queryResult = await pinecone.query({
    vector: Array(1536).fill(0),     // zero vector — we want metadata filter only
    filter: { doc_id: { $eq: docId } },
    topK: 200,                        // fetch up to 200 chunks
    includeMetadata: true,
    namespace
  });
  // Sort by chunk_index
  const chunks = queryResult.matches
    .sort((a, b) => a.metadata.chunk_index - b.metadata.chunk_index)
    .map(m => m.metadata.text || "")
    .filter(Boolean);

  if (chunks.length === 0) {
    return reply.status(404).send({ error: "Document content not yet indexed" });
  }

  // 4. Assemble context (respect Claude's context window — max ~80k tokens)
  const context = chunks.join("\n\n").slice(0, 80000);

  const prompts = {
    brief: "Summarise the following document in exactly 5 bullet points. Be concise and factual.",
    detailed: "Create a structured outline of this document. Use ## for sections, ### for subsections. Include key points under each heading.",
    "key-terms": "Extract the 10 most important technical terms from this document. For each term: **Term**: Definition (1-2 sentences from the document)."
  };

  // 5. Stream via SSE
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const stream = await anthropic.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: `${prompts[mode]}\n\nDocument content:\n\n${context}` }],
    system: `You are summarising a college curriculum document: "${doc.original_filename}". Be accurate and factual. Only use information from the provided content.`
  });

  let totalTokens = 0;
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta") {
      reply.raw.write(`data: ${JSON.stringify({ type: "token", content: chunk.delta.text })}\n\n`);
    }
    if (chunk.type === "message_delta") {
      totalTokens = chunk.usage?.output_tokens || 0;
    }
  }

  // 6. Log + update token usage
  await logDownloadAction(collegeId, req.jwtPayload.student.id, docId, "ai_summary", { tokens_used: totalTokens });
  await platformDb.colleges.updateOne({ _id: collegeId }, { $inc: { tokens_used_this_month: totalTokens } });

  reply.raw.write(`data: ${JSON.stringify({ type: "done", tokens_used: totalTokens, source: { doc_id: docId, filename: doc.original_filename } })}\n\n`);
  reply.raw.end();
}
```

**Frontend — AI Summary panel:**
```
┌──────────────────────────────────────────────────────┐
│ 🤖 AI Summary — Drug_Metabolism_Unit3.pdf            │
│ [Brief ●] [Detailed] [Key Terms]                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│ • Metformin acts by activating AMPK, reducing        │
│   hepatic glucose output...                          │
│ • Phase I metabolism involves oxidation via          │
│   CYP450 enzymes...                                  │
│ • Drug interactions occur primarily at the           │  ← streaming in
│   CYP3A4 binding site...                             │
│ ▌                                                    │
│                                                      │
│ [Copy Summary] [Download .txt] [💬 Chat about doc →] │
│                                    142 tokens used   │
└──────────────────────────────────────────────────────┘
```

"Chat about this doc →" button opens the chat interface with a pre-filled query: `Tell me more about ${doc.original_filename}` and the chat is pre-scoped to retrieve only from this document's chunks (using metadata filter `doc_id: { $eq: docId }`).

---

### F-11-G: Video / Audio Streaming

**Endpoint:** `GET /library/:docId/access-token?intent=stream`

**Server logic:**
```javascript
// Stream token TTL: 7200 seconds (2 hours for a full lecture)
// Token is multi-use — seeking/scrubbing generates multiple Range requests against same token
// File served via GET /files/serve?token=<uuid> which handles HTTP 206 Range responses
const ttl = 7200;
const token = generateUUID();
await redis.setex(`file_token:${token}`, ttl, JSON.stringify({
  file_path: doc.file_path,          // absolute local path to .mp4 / .mp3
  intent: "stream",
  single_use: false,                 // multi-use for streaming
  mime_type: doc.file_type === "mp4" ? "video/mp4" : "audio/mpeg",
  filename: doc.original_filename,
  college_id: collegeId,
  dept_id: doc.dept_id,
}));
```

The `/files/serve` route handles HTTP Range requests properly (HTTP 206 Partial Content), which the HTML5 `<video>` element requires for scrubbing to work. All reads come from local disk via `fs.createReadStream`.

**Transcript serving:** Transcript JSON is read from `doc.transcript_path` on disk via the `/extract-text` endpoint (transcript segments are included in the text cache response for audio/video files).

**Frontend — Video player layout:**
```
┌──────────────────────────────────────────────────────────────┐
│ 🎬 Lecture: Renal_Pharmacology_Week3.mp4                     │
├────────────────────────────┬─────────────────────────────────┤
│                            │ 📋 Transcript                   │
│   [HTML5 video player]     │ ─────────────────────────────── │
│                            │ 00:00  "Welcome to week 3..."   │
│   ▶ 14:23 / 48:30          │ 00:12  "Today we cover renal..." │
│   [─────●───────────────]  │ 00:45  "The kidneys filter..."  │ ←clickable
│   🔊──── 0.75x 1x 1.25x 2x│ 01:12  "GFR is defined as..."  │
│                            │ 01:38  "Creatinine clearance..."│
│   [⬇ Download (1.2 GB)]    │                                 │
│                            │ 🔍 Search transcript...         │
└────────────────────────────┴─────────────────────────────────┘
```

**Transcript sync:**
```javascript
// videoSrc comes from GET /library/:docId/access-token?intent=stream → token_url
// e.g. "/files/serve?token=abc123" — Fastify handles range requests from there
<video ref={videoRef} src={tokenUrl} controls />

// Click transcript line → seek video
function seekToTimestamp(seconds) {
  videoRef.current.currentTime = seconds;
  videoRef.current.play();
}

// Highlight active transcript line as video plays
videoRef.current.addEventListener("timeupdate", () => {
  const currentTime = videoRef.current.currentTime;
  const activeSegment = transcript.findLast(seg => seg.start_sec <= currentTime);
  setActiveSegment(activeSegment?.index);
});
```

**Download warning for large files:**
```
if (file_size_bytes > 500_000_000) {
  // Show: "This file is 1.2 GB. Download may take several minutes on slow connections."
  // with Confirm / Cancel before triggering GET /access-token?intent=download
}
```

---

### F-11-H: Dept Admin — Library Controls

**Two new toggles on the document management panel:**

#### Toggle 1: `is_visible_to_students`

```
Document: Drug_Metabolism_Unit3.pdf
Status: ● Visible to students    [Toggle OFF]

When OFF:
  - Document disappears from student library browse
  - Document still indexed in Pinecone (RAG still works)
  - Students can receive AI answers from this doc
  - Students cannot see/download/extract the file itself
  Use case: faculty uploads answer keys — AI can use them to help students,
  but students can't see the raw file
```

#### Toggle 2: `download_enabled`

```
Document: Drug_Metabolism_Unit3.pdf
Download: ● Enabled    [Toggle OFF]

When OFF:
  - Download button hidden in student library
  - /download-url endpoint returns 403
  - Inline preview still works (PDF.js, video player)
  - Extract text still works (educational, not file distribution)
  - AI Summary still works
  Use case: copyright-sensitive textbooks — students can study the content
  but the college respects publisher rights by blocking redistribution
```

**Download audit view (Dept Admin):**
```
GET /admin/documents/:docId/download-logs

Shows:
┌────────────────────────────────────────────────────────┐
│ 📊 Document Access Log — Drug_Metabolism_Unit3.pdf     │
│ Last 30 days                                           │
├────────────┬────────────────┬────────────┬────────────┤
│ Student    │ Action         │ Date       │ Time       │
├────────────┼────────────────┼────────────┼────────────┤
│ Stu***001  │ Download       │ Mar 15     │ 11:42 PM   │
│ Stu***002  │ Extract Text   │ Mar 15     │ 11:51 PM   │
│ Stu***001  │ AI Summary     │ Mar 16     │ 08:12 AM   │
│ Stu***003  │ Stream (Video) │ Mar 16     │ 02:30 PM   │
└────────────┴────────────────┴────────────┴────────────┘
Student IDs are partially masked for privacy. Full ID available to Super Admin.
```

---

## 6. Security Model

### Access control checklist (every library route)

```
1. ✓ verifyJWT middleware                    → valid, non-expired token
2. ✓ resolveCollege middleware               → :collegeId matches JWT college_id
3. ✓ checkRole middleware                    → role === "student"
4. ✓ dept scope check (per route)            → doc.dept_id === student.effective_dept_id
5. ✓ visibility check                        → doc.is_visible_to_students === true
6. ✓ download_enabled check (download only)  → doc.download_enabled === true
7. ✓ ingestion_status check                  → doc.ingestion_status === "completed"
8. ✓ rate limiting                           → Redis counters per student
9. ✓ audit log                               → download_logs entry written
10.✓ path traversal guard (/files/serve)     → file_path must start with STORAGE_ROOT
11.✓ token integrity (/files/serve)          → token must exist in Redis, not expired
```

### Rate limits (enforced via Redis)

| Action | Limit | Window |
|---|---|---|
| File downloads | 20 per student | Per hour |
| Text extractions | 50 per student | Per day |
| Page extractions | 5 per student | Per day |
| AI summaries | 10 per student | Per day |
| Video streams | 5 per student | Per hour |

### Ephemeral file cleanup

```javascript
// Nightly cron job (2 AM IST) — delete expired temp files from local disk
async function cleanupTempFiles() {
  const colleges = await platformDb.colleges.find({ status: "active" }).toArray();

  for (const college of colleges) {
    // 1. Clean expired extraction_jobs — delete the local temp file
    const expiredJobs = await collegeDb(college._id).extraction_jobs.find({
      status: "completed",
      expires_at: { $lt: new Date() }
    }).toArray();

    for (const job of expiredJobs) {
      if (job.output_file_path && fs.existsSync(job.output_file_path)) {
        fs.unlinkSync(job.output_file_path);
      }
      await collegeDb(college._id).extraction_jobs.updateOne(
        { _id: job._id },
        { $set: { status: "cleaned" } }
      );
    }

    // 2. Sweep the temp/ directory — delete any orphaned files older than 1 hour
    //    (catches files whose job record was lost)
    const tempDir = path.join(process.env.STORAGE_ROOT, "colleges", college._id, "temp");
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      const oneHourAgo = Date.now() - 3600_000;
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }
}
```

---

## 7. Python Worker Jobs

### Job type 1: `extract_pages` (existing worker + new job type)

Add to `services/ingestion-worker/jobs/`:

```python
# services/ingestion-worker/jobs/extract_pages.py

async def handle_extract_pages(job_data: dict):
    """
    Extracts a page range from a PDF or slides from a PPTX.
    Output: ephemeral PDF written to local temp/ directory on disk.
    """
    job_id = job_data["job_id"]
    doc_id = job_data["doc_id"]
    college_id = job_data["college_id"]
    pages = job_data["pages"]              # list of 1-indexed integers
    source_file_path = job_data["file_path"]   # absolute local path from job payload

    try:
        # Update job status
        await update_job_status(college_id, job_id, "processing")

        # Write output directly to local temp directory
        storage_root = os.environ["STORAGE_ROOT"]
        temp_dir = os.path.join(storage_root, "colleges", college_id, "temp")
        os.makedirs(temp_dir, exist_ok=True)
        output_path = os.path.join(temp_dir, f"{job_id}.pdf")

        if job_data["file_type"] == "pdf":
            from PyPDF2 import PdfReader, PdfWriter
            reader = PdfReader(source_file_path)
            writer = PdfWriter()
            for page_num in pages:
                writer.add_page(reader.pages[page_num - 1])   # 0-indexed
            with open(output_path, "wb") as f:
                writer.write(f)

        elif job_data["file_type"] == "pptx":
            from pptx import Presentation
            prs = Presentation(source_file_path)
            new_prs = Presentation()
            new_prs.slide_width = prs.slide_width
            new_prs.slide_height = prs.slide_height
            for slide_idx in [p - 1 for p in pages]:
                xml_slide = prs.slides[slide_idx]._element
                new_prs.slides.add_slide(new_prs.slide_layouts[6])
                new_prs.slides[-1]._element.getparent().replace(
                    new_prs.slides[-1]._element, xml_slide
                )
            pptx_path = os.path.join(temp_dir, f"{job_id}.pptx")
            new_prs.save(pptx_path)
            subprocess.run([
                "libreoffice", "--headless", "--convert-to", "pdf",
                pptx_path, "--outdir", temp_dir
            ], check=True)
            output_path = os.path.join(temp_dir, f"{job_id}.pdf")
            os.remove(pptx_path)
        else:
            raise ValueError(f"Unsupported file type: {job_data['file_type']}")

        # File is now on local disk — Fastify generates access token when polled
        expires_at = datetime.utcnow() + timedelta(hours=1)
        await update_job_completed_local(college_id, job_id, output_path, expires_at)

    except Exception as e:
        await update_job_status(college_id, job_id, "failed", error=str(e))
        raise
    # No cleanup — file stays on disk until nightly cleanup job runs
```

### Job type 2: `generate_thumbnail` (new, runs after ingestion)

Add to the ingestion pipeline (step 9, after Pinecone upsert):

```python
# services/ingestion-worker/jobs/generate_thumbnail.py

async def generate_thumbnail(doc_id: str, file_path: str, file_type: str, college_id: str):
    """
    Generates a thumbnail image written directly to local storage.
    PDF: first page as JPEG
    PPTX: first slide as JPEG
    MP4: frame at 5 seconds as JPEG
    """
    storage_root = os.environ["STORAGE_ROOT"]
    thumb_dir = os.path.join(storage_root, "colleges", college_id, "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)
    thumb_path = os.path.join(thumb_dir, f"{doc_id}.jpg")

    if file_type == "pdf":
        import fitz
        doc = fitz.open(file_path)
        page = doc[0]
        mat = fitz.Matrix(2, 2)                           # 2x zoom for quality
        pix = page.get_pixmap(matrix=mat)
        pix.save(thumb_path)
        doc.close()

    elif file_type == "pptx":
        subprocess.run([
            "libreoffice", "--headless", "--convert-to", "png",
            "--outdir", thumb_dir, file_path
        ])
        png_path = os.path.join(thumb_dir, os.path.basename(file_path).replace(".pptx", ".png"))
        from PIL import Image
        img = Image.open(png_path)
        img.thumbnail((400, 300))
        img.save(thumb_path, "JPEG", quality=int(os.environ.get("THUMBNAIL_QUALITY", 85)))
        os.remove(png_path)

    elif file_type in ["mp4", "mkv"]:
        subprocess.run([
            os.environ.get("FFMPEG_PATH", "ffmpeg"),
            "-i", file_path, "-ss", "00:00:05",
            "-vframes", "1", "-q:v", "3", thumb_path
        ])

    else:
        return None                                       # no thumbnail for audio/docx

    # Return the local filesystem path (stored in documents.thumbnail_path)
    return thumb_path
```

---

## 8. Frontend Components

### Component tree for student library

```
apps/student/app/library/
├── page.tsx                          # Library main page (server component)
├── [docId]/
│   └── page.tsx                      # Deep-link entry: /library/:docId?page=N
│
apps/student/components/library/
├── LibraryLayout.tsx                 # Layout: sidebar + main content area
├── SubjectSidebar.tsx                # Left sidebar: subject tree + filters
├── DocumentGrid.tsx                  # Grid/list view toggle for doc cards
├── DocumentCard.tsx                  # Individual doc card with action buttons
├── DocumentViewer/
│   ├── index.tsx                     # Slide-over container + routing by file type
│   ├── PdfViewer.tsx                 # PDF.js iframe wrapper
│   ├── PptxViewer.tsx                # Slide thumbnail grid
│   ├── VideoPlayer.tsx               # HTML5 video + transcript sidebar
│   ├── AudioPlayer.tsx               # HTML5 audio + transcript
│   └── DocxViewer.tsx                # Rendered HTML from extracted text
├── actions/
│   ├── DownloadButton.tsx            # Pre-signed URL download handler
│   ├── ExtractTextModal.tsx          # Full text + by-page + .txt download
│   ├── ExtractPagesModal.tsx         # Page range selector + polling UI
│   └── AiSummaryPanel.tsx            # Streaming SSE summary display
└── hooks/
    ├── useLibraryDocs.ts             # tRPC query for document list
    ├── useDocumentViewer.ts          # Viewer state management
    ├── useExtractPages.ts            # Page extraction job polling
    └── useAiSummary.ts              # SSE stream consumer
```

### Key component: `DocumentCard.tsx`

```tsx
interface DocumentCardProps {
  doc: DocumentMetadata;
  onPreview: (docId: string) => void;
}

export function DocumentCard({ doc, onPreview }: DocumentCardProps) {
  const fileTypeConfig = {
    pdf:  { icon: "📄", color: "text-red-600",  bg: "bg-red-50"  },
    pptx: { icon: "📊", color: "text-orange-600", bg: "bg-orange-50" },
    mp4:  { icon: "🎬", color: "text-purple-600", bg: "bg-purple-50" },
    mp3:  { icon: "🎵", color: "text-blue-600",  bg: "bg-blue-50"  },
    docx: { icon: "📝", color: "text-teal-600",  bg: "bg-teal-50"  },
  };

  const cfg = fileTypeConfig[doc.file_type];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-all group">
      {/* Thumbnail or file type icon */}
      <div className={`${cfg.bg} rounded-lg aspect-video flex items-center justify-center mb-3 overflow-hidden`}>
        {doc.thumbnail_url
          ? <img src={doc.thumbnail_url} alt={doc.filename} className="w-full h-full object-cover" />
          : <span className="text-4xl">{cfg.icon}</span>
        }
      </div>

      {/* File name */}
      <h3 className="text-sm font-semibold text-slate-800 truncate mb-1">{doc.filename}</h3>

      {/* Meta row */}
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
        <span className={`${cfg.bg} ${cfg.color} px-2 py-0.5 rounded font-medium uppercase`}>{doc.file_type}</span>
        <span>{formatFileSize(doc.file_size_bytes)}</span>
        {doc.page_count && <span>· {doc.page_count} pages</span>}
        {doc.duration_seconds && <span>· {formatDuration(doc.duration_seconds)}</span>}
      </div>

      {/* Quality bar (PDF/PPTX) */}
      {doc.quality_score && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 rounded-full" style={{ width: `${doc.quality_score * 100}%` }} />
          </div>
          <span className="text-xs text-slate-400">{Math.round(doc.quality_score * 100)}% quality</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onPreview(doc.doc_id)} className="flex-1 text-xs bg-teal-600 text-white py-1.5 rounded-lg hover:bg-teal-700">
          Preview
        </button>
        {doc.download_enabled && (
          <DownloadButton docId={doc.doc_id} filename={doc.filename} />
        )}
        <ExtractDropdown docId={doc.doc_id} fileType={doc.file_type} />
      </div>
    </div>
  );
}
```

---

## 9. Schema Additions to Existing Collections

### Documents collection — field additions

```javascript
// Run this as a MongoDB migration on each college DB
db.documents.updateMany(
  { download_enabled: { $exists: false } },
  {
    $set: {
      download_enabled: true,
      is_visible_to_students: true,
      thumbnail_path: null,         // was thumbnail_key (R2 key) — now local fs path
      text_cache_path: null,        // was text_cache_key (R2 key) — now local fs path
      file_path: null,              // was r2_key — now absolute local fs path
      slide_count: null,
      duration_seconds: null,
      transcript_path: null         // was transcript_key (R2 key) — now local fs path
    }
  }
);

// New indexes
db.documents.createIndex({ dept_id: 1, is_visible_to_students: 1, ingestion_status: 1 });
db.documents.createIndex({ dept_id: 1, subject_id: 1, file_type: 1 });
```

### Dept Admin permission additions

```javascript
// In the role permissions matrix (Section 3 of main spec):
// Add these rows to the table:

// | Toggle download_enabled    | ✗  | ✓ (own dept) | ✗ |
// | Toggle is_visible_to_students | ✗ | ✓ (own dept) | ✗ |
// | View download_logs         | ✓  | ✓ (own dept) | ✗ |
```

---

## 10. Environment Variables (additions)

```bash
# Addition to services/api/.env

# Local filesystem storage
STORAGE_ROOT=/app/storage                   # absolute path to local storage root
                                            # Docker: mount as named volume
                                            # Multi-instance: mount as NFS share

# Access token TTLs (in seconds)
ACCESS_TOKEN_TTL_DOWNLOAD=900               # 15 minutes — single-use download token
ACCESS_TOKEN_TTL_PREVIEW=900               # 15 minutes — multi-use preview token
ACCESS_TOKEN_TTL_STREAM=7200               # 2 hours — multi-use streaming token
ACCESS_TOKEN_TTL_EXTRACTION=900            # 15 minutes — single-use extracted pages token
TEMP_FILE_TTL_HOURS=1                      # ephemeral extracted files deleted after 1 hour

# Rate limits (students)
RATE_LIMIT_DOWNLOADS_PER_HOUR=20
RATE_LIMIT_TEXT_EXTRACTIONS_PER_DAY=50
RATE_LIMIT_PAGE_EXTRACTIONS_PER_DAY=5
RATE_LIMIT_AI_SUMMARIES_PER_DAY=10
RATE_LIMIT_STREAMS_PER_HOUR=5

# AI Summary
AI_SUMMARY_MODEL=claude-haiku-4-5-20251001
AI_SUMMARY_MAX_TOKENS=1024
AI_SUMMARY_MAX_CONTEXT_CHARS=80000         # prevent context window overflow

# Addition to services/ingestion-worker/.env
STORAGE_ROOT=/app/storage                  # must match API server — same volume
GENERATE_THUMBNAILS=true                   # can disable for dev
THUMBNAIL_QUALITY=85                       # JPEG quality 0-100
FFMPEG_PATH=/usr/bin/ffmpeg                # for MP4 thumbnails
```

---

## 11. Build Order

Add to **Phase 9 — Library** (insert after Phase 8 in main architecture doc):

```
Phase 9 — Student Document Library

Step 1 — Database migration
  → Add new fields to documents collection (download_enabled, is_visible_to_students,
    thumbnail_key, text_cache_key, slide_count, duration_seconds, transcript_key)
  → Create download_logs collection + indexes
  → Create extraction_jobs collection + indexes

Step 2 — Python worker additions
  → services/ingestion-worker/jobs/generate_thumbnail.py
  → Add thumbnail generation to end of existing ingestion pipeline
  → services/ingestion-worker/jobs/extract_pages.py
  → Register new job type in worker.py

Step 3 — Fastify API routes
  → GET  /student/library (browse + search + grouping logic)
  → GET  /student/library/:docId (single document metadata — no file path exposed)
  → GET  /student/library/:docId/access-token?intent=download|preview|stream
         (generates Redis token, logs access, returns /files/serve?token= URL)
  → GET  /files/serve?token= (universal file server: Range support, single/multi-use tokens)
  → GET  /student/library/:docId/extract-text (read text_cache_path from local disk)
  → GET  /student/library/:docId/extract-text/download (stream .txt from disk)
  → POST /student/library/:docId/extract-pages (enqueue BullMQ job)
  → GET  /student/library/extract-jobs/:jobId (poll + generate token when completed)
  → GET  /student/library/:docId/ai-summary (SSE stream)

Step 4 — Dept Admin API additions (tRPC)
  → PATCH /admin/documents/:docId/library-settings
  → GET /admin/documents/:docId/download-logs

Step 5 — Nightly cleanup cron
  → Walk /app/storage/colleges/*/temp/ — delete files older than 1 hour
  → Mark corresponding extraction_jobs as "cleaned"
  → Register in existing cron job scheduler

Step 6 — Frontend components (apps/student)
  → LibraryLayout + SubjectSidebar + DocumentGrid
  → DocumentCard with all action buttons
  → DocumentViewer: PdfViewer, PptxViewer, VideoPlayer, AudioPlayer, DocxViewer
  → actions: DownloadButton, ExtractTextModal, ExtractPagesModal, AiSummaryPanel
  → hooks: useLibraryDocs, useDocumentViewer, useExtractPages, useAiSummary
  → Deep-link support: /library/:docId?page=N

Step 7 — Chat integration
  → Source citation chips become clickable links → /library/:docId?page=N
  → "Chat about this doc" from AI Summary panel → pre-fill chat with doc scope

Step 8 — Dept Admin UI additions
  → Add download_enabled + is_visible_to_students toggles to document management
  → Add download logs view per document

Step 9 — Testing
  → Upload a PDF, PPTX, MP4, DOCX
  → Verify thumbnail written to /app/storage/colleges/{cid}/thumbnails/
  → Verify text cache written to /app/storage/colleges/{cid}/text_cache/
  → Test GET /files/serve?token= with valid token → expect file stream
  → Test GET /files/serve?token= with expired/invalid token → expect 401
  → Test GET /files/serve?token= with Range header → expect HTTP 206
  → Test download token is single-use (second request → 401)
  → Test stream token is multi-use (multiple range requests → all succeed)
  → Test download with download_enabled=false → expect 403 at /access-token
  → Test page extraction: PDF pages 10–25 → expect local temp file + token URL
  → Verify temp file deleted by cleanup job after 1 hour
  → Test AI summary in all 3 modes
  → Test video streaming + transcript sync (seek via timestamp click)
  → Test rate limits (exceed 20 downloads/hour → 429)
  → Test path traversal attempt in token metadata → expect 403
  → Test cross-dept access attempt → expect 403

---

*Document: F-11-student-document-library.md · v1.1 · May 2026 · Extends college-chatbot-architecture.md v2.0*  
*Storage updated: Cloudflare R2 replaced with local filesystem + Redis token-gated serving*  
*For Claude Code: implement Phase 9 steps in order. Each step depends on the previous.*
