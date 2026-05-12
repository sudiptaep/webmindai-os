# College AI Chatbot Platform — Full Architecture & Feature Specification

> **For Claude Code** · Multi-tenant, per-college RAG chatbot for Medical & Engineering colleges  
> **Frontend:** Next.js 14 (App Router) · Tailwind CSS · shadcn/ui · Zustand  
> **Backend:** Node.js + Fastify · tRPC (admin APIs) · SSE (chat streaming)  
> **Infra:** MongoDB Atlas · Pinecone · Cloudflare R2 · Redis + BullMQ · Claude Haiku  
> **Ingestion worker:** Python + FastAPI (separate microservice)  
> **Roles:** Super Admin → Dept Admin → Student  
> **Version:** 2.0 · May 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
   - 1b. [Technology Stack Decisions](#1b-technology-stack-decisions)
2. [Tenant Model](#2-tenant-model)
3. [Role Definitions & Permissions](#3-role-definitions--permissions)
4. [Database Schema](#4-database-schema)
5. [API Route Map](#5-api-route-map)
6. [Feature Specifications](#6-feature-specifications)
   - F-01: Super Admin — College Provisioning
   - F-02: Super Admin — Department & Dept Admin Management
   - F-03: Dept Admin — Document Upload & Ingestion
   - F-04: Dept Admin — Subject Management
   - F-05: Dept Admin — Analytics Dashboard
   - F-06: Student — Registration & Department Selection
   - F-07: Student — Chat Interface
   - F-08: Generic Department Fallback
   - F-09: RAG Query Pipeline
   - F-10: Unanswered Query Flagging
7. [Infrastructure Per College](#7-infrastructure-per-college)
8. [Authentication & JWT Design](#8-authentication--jwt-design)
9. [Vector Namespace Strategy](#9-vector-namespace-strategy)
10. [Ingestion Pipeline](#10-ingestion-pipeline)
11. [Environment Variables](#11-environment-variables)
12. [Folder Structure](#12-folder-structure)
13. [Build Order (Claude Code Sequence)](#13-build-order-claude-code-sequence)

---

## 1. System Overview

A multi-tenant SaaS platform where **you (Super Admin)** provision colleges. Each college gets fully isolated infrastructure — its own MongoDB database, Pinecone namespace prefix, and file storage bucket. Colleges can be Medical, Engineering, or any type.

Within each college, **Dept Admins** upload curriculum materials (PDFs, PPTs, lecture videos). **Students** self-register, select their department, and chat with an AI that is strictly grounded in that department's uploaded content.

If a student's department has not been created yet, they automatically fall back to the **Generic Department** — a system-level department that always exists in every college and cannot be deleted.

```
Your Platform (Super Admin)
├── College A  (isolated DB + vector store + storage)
│   ├── Generic Dept  [always exists, cannot delete]
│   ├── CS Dept
│   ├── Mechanical Dept
│   └── ...
├── College B
│   ├── Generic Dept
│   ├── Anatomy Dept
│   └── ...
└── College N ...
```

---

## 1b. Technology Stack Decisions

### Full revised stack

| Layer | Technology | Why this choice |
|---|---|---|
| Student UI | Next.js 14 (App Router) + Tailwind + shadcn/ui | SSR for fast mobile first paint, subdomain routing at edge, App Router handles streaming responses natively |
| Admin UIs (Super + Dept) | Next.js 14 (App Router) + Tailwind + shadcn/ui | Same monorepo, shared components, server components reduce client JS bundle |
| Global state | Zustand | Chat session state + dept resolution state — lighter than Redux, no boilerplate |
| Admin API contract | tRPC (over Fastify) | End-to-end TypeScript types from `packages/shared` flow to frontend with zero manual DTO sync. All CRUD routes use tRPC. |
| API server | Node.js + Fastify | Native streaming support for SSE chat, schema validation via `@fastify/ajv`, 2× faster than Express under load |
| Chat streaming | Server-Sent Events (raw Fastify route) | tRPC does not handle streaming — student chat endpoint stays as a raw `GET /stream` SSE route outside tRPC |
| Ingestion worker | Python + FastAPI (separate microservice) | `PyMuPDF`, `pytesseract`, `openai-whisper` are Python-native and significantly better than Node equivalents |
| Job queue | BullMQ + Redis | Node.js Fastify API enqueues jobs → Python worker consumes via Redis directly |
| Database | MongoDB Atlas | Per-college DB provisioning via connection factory; flexible schema for chunk metadata |
| Vector store | Pinecone | Namespace isolation per dept — architecturally prevents cross-tenant leakage |
| File storage | Cloudflare R2 | Near-zero egress cost, S3-compatible API |
| LLM | Claude Haiku (`claude-haiku-4-5-20251001`) | Lowest latency + cost for chat; Sonnet for exam question generation |
| Embeddings | OpenAI `text-embedding-3-small` | Best price/quality ratio at 1536 dims |
| Reranking | Cohere `rerank-english-v3` | Improves retrieval precision after vector search |
| Auth | JWT + bcrypt + httpOnly refresh cookie | Works across subdomains; refresh token rotation |
| Monorepo tooling | Turborepo + pnpm workspaces | Shared types, shared UI components, parallel builds |

### What was changed from v1.0 and why

| Old (v1.0) | New (v2.0) | Reason |
|---|---|---|
| React 18 + Vite (3 separate apps) | Next.js 14 App Router (monorepo) | SSR, subdomain routing, shared layout, edge middleware for tenant resolution |
| Express | Fastify | Native SSE streaming, schema validation, better performance |
| No tRPC | tRPC for admin APIs | Type-safe API layer — no manual interface sync between frontend/backend |
| Node.js ingestion worker | Python FastAPI ingestion microservice | PyMuPDF + Tesseract + Whisper are Python-native; far better parse quality |
| `bull` | `BullMQ` | Drop-in replacement, better TypeScript support, active maintenance |

### Inter-service communication

```
Next.js apps
  ├── tRPC client     →  Fastify API (tRPC adapter)   [admin CRUD operations]
  └── fetch/EventSource →  Fastify SSE route           [student chat streaming]

Fastify API
  └── BullMQ producer  →  Redis queue  →  Python FastAPI worker  [ingestion jobs]

Python FastAPI worker
  ├── reads from  R2          [raw uploaded files]
  ├── writes to   Pinecone    [embedded chunks]
  └── updates     MongoDB     [document ingestion status]
```

---

## 2. Tenant Model

### Isolation guarantees

| Layer | Isolation mechanism |
|---|---|
| Database | One MongoDB Atlas database per college, named `college_{college_id}` |
| Vector store | Pinecone namespace prefix `c_{college_id}_d_{dept_id}` — no cross-namespace query is possible |
| File storage | Cloudflare R2 bucket prefix `colleges/{college_id}/` |
| Auth | JWT encodes `college_id` — every API middleware validates tenant boundary |
| API | All routes prefixed `/api/v1/college/:collegeId/` — cross-college requests return 403 |

### College lifecycle

```
Super Admin creates college
  → system generates college_id (UUID)
  → provisions MongoDB DB: college_{college_id}
  → creates Generic Dept record (is_generic: true, cannot_delete: true)
  → sends invite email to assigned college owner (Dept Admin role, global scope)
  → college status: ACTIVE
```

---

## 3. Role Definitions & Permissions

### Role: `super_admin`

- **Who:** Only your team (hardcoded or seeded)
- **Scope:** Platform-wide, above all college boundaries
- **Can do:**
  - Create / deactivate colleges
  - Assign college owner (first Dept Admin with elevated scope)
  - View platform-wide analytics (usage, cost per college)
  - Set LLM token limits per college
  - Manage billing / subscription per college
- **Cannot do:** Access student PII or chat logs of any college

### Role: `dept_admin`

- **Who:** Appointed by Super Admin per college, or by college owner per dept
- **Scope:** Scoped to one or more departments within one college
- **Can do:**
  - Upload documents (PDF, PPT, MP4) to their dept
  - Manage subjects within their dept
  - Trigger re-ingestion after content update
  - View dept analytics (query volume, unanswered queries, top topics)
  - Manage student accounts within their dept (disable, reset password)
  - Create additional dept admins for their dept (if college owner)
- **Cannot do:**
  - Access other departments' data or analytics
  - See student chat history (only query text + answered/unanswered flag)
  - Modify Generic Dept unless they are the college owner

### Role: `student`

- **Who:** Anyone who self-registers on the college's registration page
- **Scope:** Strictly scoped to their registered department
- **Can do:**
  - Register with name + email + password + department selection
  - Chat with the AI bot (queries scoped to their dept namespace)
  - View their own chat history
  - Switch to Generic Dept content if their dept has no documents yet
- **Cannot do:**
  - Access any other department's content
  - Upload documents
  - See other students' conversations
  - Change their college assignment

### Permission matrix

| Action | super_admin | dept_admin | student |
|---|:---:|:---:|:---:|
| Create college | ✓ | ✗ | ✗ |
| Create department | ✓ | ✗ | ✗ |
| Assign dept admin | ✓ | ✗ | ✗ |
| Upload documents | ✓ | ✓ (own dept) | ✗ |
| Trigger ingestion | ✓ | ✓ (own dept) | ✗ |
| Chat with bot | ✗ | ✗ | ✓ |
| View dept analytics | ✓ | ✓ (own dept) | ✗ |
| View platform analytics | ✓ | ✗ | ✗ |
| Delete department | ✓ | ✗ | ✗ |
| Delete Generic Dept | ✗ | ✗ | ✗ |

---

## 4. Database Schema

### Platform DB: `platform` (shared, your infra)

```js
// colleges collection
{
  _id: UUID,                        // college_id
  name: String,                     // "MSRIT Bangalore"
  type: Enum["engineering","medical","other"],
  slug: String,                     // "msrit" — used in subdomain/URL
  status: Enum["active","suspended","deleted"],
  owner_admin_id: UUID,             // ref → admins collection
  pinecone_prefix: String,          // "c_<college_id>"
  r2_prefix: String,                // "colleges/<college_id>/"
  mongo_db_name: String,            // "college_<college_id>"
  token_limit_per_month: Number,    // LLM cost cap
  tokens_used_this_month: Number,
  created_at: Date,
  updated_at: Date
}

// platform_admins collection (super_admin users only)
{
  _id: UUID,
  email: String,
  password_hash: String,
  role: "super_admin",
  created_at: Date
}
```

### College DB: `college_{college_id}` (one per college)

```js
// departments collection
{
  _id: UUID,                        // dept_id
  college_id: UUID,
  name: String,                     // "Computer Science"
  code: String,                     // "CS"
  type: Enum["engineering","medical","generic","other"],
  is_generic: Boolean,              // true = cannot delete
  cannot_delete: Boolean,
  pinecone_namespace: String,       // "c_<cid>_d_<did>"
  subject_count: Number,
  doc_count: Number,
  chunk_count: Number,
  created_at: Date,
  updated_at: Date
}

// dept_admins collection
{
  _id: UUID,
  college_id: UUID,
  dept_ids: [UUID],                 // can manage multiple depts
  name: String,
  email: String,
  password_hash: String,
  role: "dept_admin",
  is_college_owner: Boolean,
  status: Enum["active","invited","disabled"],
  last_login: Date,
  created_at: Date
}

// subjects collection
{
  _id: UUID,
  dept_id: UUID,
  college_id: UUID,
  name: String,                     // "Data Structures"
  code: String,                     // "CS301"
  semester: Number,                 // 3
  year: Number,                     // 2025
  doc_count: Number,
  created_at: Date
}

// documents collection
{
  _id: UUID,
  dept_id: UUID,
  subject_id: UUID,                 // nullable (can be dept-level)
  college_id: UUID,
  original_filename: String,
  file_type: Enum["pdf","pptx","mp4","mp3","docx"],
  r2_key: String,                   // full R2 path
  file_size_bytes: Number,
  ingestion_status: Enum["pending","processing","completed","failed"],
  ingestion_error: String,          // null if ok
  chunk_count: Number,
  ocr_used: Boolean,
  quality_score: Number,            // 0.0 – 1.0
  uploaded_by: UUID,               // dept_admin_id
  academic_year: String,           // "2025-26"
  version: Number,                  // increments on re-upload
  created_at: Date,
  updated_at: Date
}

// students collection
{
  _id: UUID,
  college_id: UUID,
  dept_id: UUID,                    // their registered dept
  effective_dept_id: UUID,          // actual dept used (may be generic)
  using_generic_fallback: Boolean,
  name: String,
  email: String,
  password_hash: String,
  roll_number: String,              // optional
  semester: Number,
  status: Enum["active","disabled"],
  last_login: Date,
  created_at: Date
}

// sessions collection
{
  _id: UUID,
  student_id: UUID,
  college_id: UUID,
  dept_id: UUID,
  messages: [
    {
      role: Enum["user","assistant"],
      content: String,
      sources: [{ doc_id: UUID, filename: String, page: Number }],
      confidence_score: Number,
      answered: Boolean,
      timestamp: Date
    }
  ],
  started_at: Date,
  last_active: Date
}

// query_logs collection (flattened for analytics)
{
  _id: UUID,
  student_id: UUID,
  session_id: UUID,
  college_id: UUID,
  dept_id: UUID,
  query_text: String,
  answered: Boolean,
  confidence_score: Number,
  sources_used: [UUID],
  flagged_to_admin: Boolean,
  response_time_ms: Number,
  tokens_used: Number,
  created_at: Date
}
```

---

## 5. API Route Map

### Auth routes (public)

```
POST   /api/v1/auth/super-admin/login
POST   /api/v1/auth/dept-admin/login        ?college_slug=msrit
POST   /api/v1/auth/student/register        ?college_slug=msrit
POST   /api/v1/auth/student/login           ?college_slug=msrit
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
```

### Super Admin routes (JWT: super_admin)

```
GET    /api/v1/super-admin/colleges
POST   /api/v1/super-admin/colleges
GET    /api/v1/super-admin/colleges/:collegeId
PUT    /api/v1/super-admin/colleges/:collegeId
DELETE /api/v1/super-admin/colleges/:collegeId      (soft delete)

POST   /api/v1/super-admin/colleges/:collegeId/departments
DELETE /api/v1/super-admin/colleges/:collegeId/departments/:deptId

POST   /api/v1/super-admin/colleges/:collegeId/admins
DELETE /api/v1/super-admin/colleges/:collegeId/admins/:adminId

GET    /api/v1/super-admin/analytics/overview
GET    /api/v1/super-admin/analytics/college/:collegeId
```

### Dept Admin routes (JWT: dept_admin, scoped to college)

```
GET    /api/v1/college/:collegeId/admin/departments         (own depts)
GET    /api/v1/college/:collegeId/admin/departments/:deptId

GET    /api/v1/college/:collegeId/admin/subjects
POST   /api/v1/college/:collegeId/admin/subjects
PUT    /api/v1/college/:collegeId/admin/subjects/:subjectId
DELETE /api/v1/college/:collegeId/admin/subjects/:subjectId

GET    /api/v1/college/:collegeId/admin/documents
POST   /api/v1/college/:collegeId/admin/documents/upload    (multipart)
DELETE /api/v1/college/:collegeId/admin/documents/:docId
POST   /api/v1/college/:collegeId/admin/documents/:docId/reingest

GET    /api/v1/college/:collegeId/admin/analytics/queries
GET    /api/v1/college/:collegeId/admin/analytics/unanswered
GET    /api/v1/college/:collegeId/admin/analytics/topics
```

### Student routes (JWT: student, scoped to college + dept)

```
GET    /api/v1/college/:collegeId/student/profile
PUT    /api/v1/college/:collegeId/student/profile

GET    /api/v1/college/:collegeId/student/departments       (for registration dropdown)

POST   /api/v1/college/:collegeId/student/chat/session      (create new session)
POST   /api/v1/college/:collegeId/student/chat/:sessionId/message
GET    /api/v1/college/:collegeId/student/chat/sessions     (history list)
GET    /api/v1/college/:collegeId/student/chat/:sessionId   (full session)
```

### System / internal routes

```
POST   /api/v1/internal/ingest/:jobId/webhook    (ingestion worker callback)
GET    /api/v1/health
```

---

## 6. Feature Specifications

---

### F-01: Super Admin — College Provisioning

**Trigger:** Super Admin fills the "Create College" form in the Super Admin dashboard.

**Input fields:**
- `name` (required) — full college name
- `type` — `engineering` | `medical` | `other`
- `slug` (required, unique) — lowercase, no spaces, used in URL/subdomain
- `owner_email` — email to invite as the first Dept Admin (college owner)
- `token_limit_per_month` — default 5,000,000

**System actions on creation:**

```
1. Validate slug is unique across platform
2. Generate college_id (UUIDv4)
3. Create record in platform.colleges
4. Provision college MongoDB DB: college_{college_id}
   → Run schema migrations (collections + indexes)
5. Create Generic Department in college DB:
   {
     name: "General",
     code: "GEN",
     is_generic: true,
     cannot_delete: true,
     pinecone_namespace: "c_{college_id}_d_generic"
   }
6. Create Pinecone index namespace: c_{college_id}_d_generic
7. Create R2 prefix: colleges/{college_id}/
8. Create dept_admin record for owner_email with:
   { is_college_owner: true, dept_ids: [], status: "invited" }
9. Send invitation email to owner_email with setup link
10. Return college record + credentials
```

**Error cases:**
- Slug already taken → `409 Conflict`
- MongoDB provisioning fails → rollback college record, return `500`
- Invalid email format → `422 Unprocessable`

**UI:** Super Admin dashboard at `/super-admin/colleges/new`

---

### F-02: Super Admin — Department & Dept Admin Management

**Create Department:**

**Input:** `name`, `code`, `type` (`engineering` | `medical` | `other`), `college_id`

**System actions:**
```
1. Validate dept code is unique within college
2. Generate dept_id
3. Insert department record in college DB
4. Create Pinecone namespace: c_{college_id}_d_{dept_id}
5. Return dept record
```

**Delete Department:** (not Generic)
```
1. Check is_generic !== true (block if true → 403)
2. Soft-delete department (status: "deleted")
3. Migrate students in this dept → effective_dept_id = generic, using_generic_fallback = true
4. Retire Pinecone namespace (mark inactive, do not delete vectors)
5. Return success
```

**Assign Dept Admin:**
```
1. Super Admin provides: email, college_id, dept_ids[], is_college_owner
2. Check if email already exists in college → if yes, append dept_ids
3. If new: create dept_admin record, send invitation email
4. Return admin record
```

---

### F-03: Dept Admin — Document Upload & Ingestion

**Endpoint:** `POST /api/v1/college/:collegeId/admin/documents/upload`  
**Content-Type:** `multipart/form-data`

**Accepted file types:**

| Type | Extensions | Max size | Parser |
|---|---|---|---|
| PDF (text) | `.pdf` | 100 MB | PyMuPDF |
| PDF (scanned) | `.pdf` | 100 MB | Tesseract OCR fallback |
| Presentation | `.pptx` | 50 MB | python-pptx |
| Lecture video | `.mp4`, `.mkv` | 2 GB | Whisper (OpenAI) |
| Audio notes | `.mp3`, `.m4a` | 500 MB | Whisper |
| Word doc | `.docx` | 50 MB | python-docx |

**Upload flow:**

```
1. Validate JWT → extract college_id, dept_id
2. Check file type is allowed
3. Check college token limit not exceeded
4. Upload raw file to R2: colleges/{college_id}/{dept_id}/{doc_id}/{filename}
5. Create document record: { ingestion_status: "pending" }
6. Enqueue ingestion job to Bull/Redis queue
7. Return { doc_id, status: "pending" }
8. Client polls GET /documents/:docId for status update
```

**Ingestion worker (async, separate process):**

```
1. Pull job from queue
2. Download file from R2
3. Detect file type
4. Parse text:
   - PDF: PyMuPDF → extract text + page numbers
     → if text_length < 100 chars/page → trigger OCR (Tesseract)
   - PPTX: python-pptx → per-slide text + slide number
   - MP4/MP3: Whisper → timestamped transcript
   - DOCX: python-docx → paragraph text
5. Compute quality_score:
   - avg chars per page/slide (higher = better)
   - OCR confidence scores
   - Score 0.0–1.0
6. Chunk text:
   - chunk_size: 512 tokens
   - chunk_overlap: 50 tokens
   - Attach metadata to each chunk:
     { doc_id, dept_id, college_id, subject_id, filename, page/slide/timestamp, academic_year, chunk_index }
7. Embed chunks: text-embedding-3-small (1536 dims)
8. Upsert vectors to Pinecone namespace: c_{college_id}_d_{dept_id}
   - vector_id: "{doc_id}_{chunk_index}"
9. Update document record:
   { ingestion_status: "completed", chunk_count: N, quality_score: X, ocr_used: bool }
10. If error at any step:
    { ingestion_status: "failed", ingestion_error: "message" }
```

**Re-ingestion:** When dept admin clicks "Re-ingest":
```
1. Delete all vectors in Pinecone with doc_id prefix
2. Reset document: { ingestion_status: "pending", chunk_count: 0, version: version+1 }
3. Enqueue fresh ingestion job
```

**Document deletion:**
```
1. Delete vectors from Pinecone (filter by doc_id metadata)
2. Delete file from R2
3. Soft-delete document record
```

---

### F-04: Dept Admin — Subject Management

Subjects are organizational tags on documents. Not strictly required — documents can exist at dept level without a subject.

**Create Subject:**
```
POST /api/v1/college/:collegeId/admin/subjects
Body: { name, code, semester, year, dept_id }
```

**Subject record:**
```js
{ _id, dept_id, name: "Data Structures", code: "CS301", semester: 3, year: 2025 }
```

**Attach document to subject:**  
During upload, `subject_id` is an optional field. The subject tag becomes part of chunk metadata, enabling subject-scoped queries in future features (e.g., "quiz me on CS301 Unit 3 only").

---

### F-05: Dept Admin — Analytics Dashboard

**Endpoint:** `GET /api/v1/college/:collegeId/admin/analytics/queries`

**Dashboard panels:**

| Panel | Data source | Description |
|---|---|---|
| Query volume | `query_logs` grouped by date | Line chart: queries per day (last 30 days) |
| Answered vs unanswered | `query_logs.answered` | Pie chart: % answered |
| Top 10 questions | `query_logs.query_text` clustered | Most frequent query patterns |
| Confusion heatmap | `query_logs` grouped by subject_id + low confidence | Subjects with most low-confidence answers |
| Unanswered queue | `query_logs` where `answered: false, flagged: false` | Action list for faculty review |
| Student engagement | `sessions` grouped by student_id | DAU, avg session length |

**Unanswered query endpoint:**
```
GET /api/v1/college/:collegeId/admin/analytics/unanswered
Response: [{ query_text, student_id (masked), timestamp, subject_id, confidence_score }]
```

Dept Admin can mark unanswered queries as "acknowledged" or "content added" — this tracks content gap closure over time.

---

### F-06: Student — Registration & Department Selection

**Endpoint:** `POST /api/v1/auth/student/register?college_slug=msrit`

**Registration flow:**

```
1. Student visits college URL (e.g., msrit.yourplatform.com/register OR yourplatform.com/college/msrit)
2. System resolves college_slug → college_id
3. Frontend fetches active departments list for this college (excluding soft-deleted)
4. Student fills form:
   - Full name
   - Email
   - Password (min 8 chars)
   - Roll number (optional)
   - Department (dropdown — only active, non-deleted depts shown)
   - Semester
5. On submit:
   a. Validate email not already registered in this college
   b. Hash password (bcrypt, 12 rounds)
   c. Resolve effective_dept_id:
      → Check if selected dept has at least 1 completed document
      → If YES: effective_dept_id = selected_dept_id, using_generic_fallback = false
      → If NO:  effective_dept_id = generic_dept_id, using_generic_fallback = true
   d. Create student record
   e. Return JWT + student profile
6. On first login if using_generic_fallback:
   → Show banner: "Your department content is being set up. You're seeing general college content for now."
```

**Department dropdown rules:**
- Show all active departments (including Generic) sorted alphabetically
- Generic Dept shown as "General / Not listed" — always first in list
- Soft-deleted departments are not shown to new registrants

**Dept re-evaluation (background job, runs nightly):**
```
For every student where using_generic_fallback = true:
  Check if their registered dept_id now has completed documents
  If YES:
    Update: effective_dept_id = dept_id, using_generic_fallback = false
    Queue a "Your department content is now ready!" notification email
```

---

### F-07: Student — Chat Interface

**Frontend:** React chat widget, embeddable in college portal or standalone page.

**Create session:**
```
POST /api/v1/college/:collegeId/student/chat/session
Response: { session_id, dept_id, effective_dept_id, using_generic_fallback }
```

**Send message:**
```
POST /api/v1/college/:collegeId/student/chat/:sessionId/message
Body: { content: "What is a binary search tree?" }

Response (streaming, Server-Sent Events):
data: { type: "token", content: "A binary..." }
data: { type: "token", content: " search tree..." }
data: { type: "done", sources: [...], confidence_score: 0.87, answered: true }
```

**Message handling (server):**
```
1. Validate JWT → extract student_id, college_id, effective_dept_id
2. Load last 6 turns from session (conversation memory)
3. Run RAG pipeline (see F-09)
4. Append message pair to session.messages
5. Write to query_logs
6. Stream response tokens via SSE
```

**Source citations in response:**
```
Every response ends with:
"— [Data Structures (CS301), Unit 3, Page 47]"

sources array:
[{ doc_id, filename: "DS_Unit3_Notes.pdf", page: 47, subject: "CS301", chunk_preview: "..." }]
```

**UI features:**
- Message bubbles with streaming text
- Source citation chips below each AI response (clickable — shows chunk preview)
- "Regenerate" button on last response
- New chat button (starts new session)
- Session history sidebar (last 10 sessions)
- Copy response button
- If `using_generic_fallback: true` → sticky banner: "Showing general college content"

---

### F-08: Generic Department Fallback

**What is it:**  
Every college has exactly one Generic Department, created automatically at college provisioning. It has `is_generic: true` and `cannot_delete: true`. It serves as the fallback for any student whose registered department either does not exist yet or has no uploaded content.

**Fallback rules:**

```
Student registered dept not created yet
  → effective_dept_id = generic_dept_id
  → using_generic_fallback = true

Student registered dept exists but has 0 completed documents
  → effective_dept_id = generic_dept_id
  → using_generic_fallback = true

Student registered dept has ≥ 1 completed document
  → effective_dept_id = student.dept_id
  → using_generic_fallback = false
```

**Generic dept content:**  
Dept Admin (college owner) uploads general college-wide materials to the Generic Dept — college handbook, common subjects (Maths, Physics, English), placement information, etc.

**Generic dept is NEVER deleted.** API middleware blocks any delete request to a department where `is_generic: true`, regardless of caller role (including super_admin).

**Fallback exit:**  
Nightly background job re-evaluates all `using_generic_fallback = true` students. When their dept gains content, they are automatically upgraded to their real dept namespace.

---

### F-09: RAG Query Pipeline

This is the core of every student chat message. Runs on every `POST .../chat/:sessionId/message`.

```
Step 1 — Scope resolution
  effective_dept_id from JWT session
  pinecone_namespace = "c_{college_id}_d_{effective_dept_id}"

Step 2 — Query embedding
  Embed student query using text-embedding-3-small
  Result: 1536-dim query vector

Step 3 — Hybrid retrieval
  a. Dense search: query vector → Pinecone top-10 chunks (cosine similarity)
  b. BM25 keyword search: query text → keyword match on stored metadata
  c. Merge and deduplicate results
  d. Rerank via Cohere rerank-english-v3 → top 5 chunks

Step 4 — Confidence threshold
  If max similarity score < 0.60:
    → answered = false
    → skip LLM generation
    → return fallback: "This topic doesn't appear to be covered in your department's materials."
    → flag for unanswered log

Step 5 — Prompt assembly
  System prompt:
  """
  You are an academic assistant for {college_name}, {dept_name}.
  Answer ONLY using the provided context chunks.
  Always cite your source at the end: "— [filename, Page X]"
  If the answer is not in the context, say: "This topic is not covered in your uploaded materials."
  Never fabricate information outside the context.
  """

  User prompt:
  """
  Conversation history:
  {last_6_turns}

  Context from course materials:
  {top_5_chunks_with_metadata}

  Student question: {query}
  """

Step 6 — LLM generation
  Model: claude-haiku-4-5-20251001
  max_tokens: 1024
  Stream response tokens via SSE

Step 7 — Post-processing
  Extract source references from response
  Calculate answered = true
  Write to query_logs
  Update session.messages
```

**Exam question generation mode (special query type):**  
If query matches pattern like "give me important questions for Unit 3" or "generate MCQs":
```
  System prompt switches to exam mode:
  → Retrieves all chunks for the specified unit/subject
  → Generates: 5× 2-mark questions, 3× 10-mark questions, 10× MCQs
  → Format: structured JSON → rendered as formatted card in UI
  → Sources: list of documents used
```

---

### F-10: Unanswered Query Flagging

When a query is unanswered (confidence < 0.60 or explicit fallback):

```
1. query_logs entry: { answered: false, flagged_to_admin: false }
2. If 3+ unanswered queries on same topic in 24h:
   → Auto-flag: flagged_to_admin = true
   → Dept Admin sees notification in dashboard: "15 students couldn't get answers about [topic]"
3. Dept Admin can mark as:
   - "Content added" → triggers re-ingestion prompt
   - "Out of syllabus" → dismisses flag
   - "Will add later" → snoozes 7 days
```

This creates a content improvement flywheel: more students → more unanswered logs → better faculty content → better answers → more students.

---

## 7. Infrastructure Per College

When `POST /api/v1/super-admin/colleges` is called, the following is provisioned:

```
1. MongoDB Atlas
   - New database: college_{college_id}
   - Collections: departments, dept_admins, subjects, documents, students, sessions, query_logs
   - Indexes:
     → students: email (unique), dept_id
     → query_logs: college_id + dept_id + created_at (compound)
     → documents: dept_id + ingestion_status

2. Pinecone
   - Namespace created: c_{college_id}_d_generic
   - Additional namespaces created per department as they are added

3. Cloudflare R2
   - Prefix: colleges/{college_id}/
   - Sub-prefixes per dept: colleges/{college_id}/{dept_id}/

4. Redis (Bull queue)
   - Queue: ingestion_jobs (shared queue, college_id in job payload)

5. Email
   - Invite email sent to college owner
   - From: noreply@yourplatform.com
   - Template: college_invite

6. DNS (optional)
   - CNAME: {college_slug}.yourplatform.com → platform load balancer
```

---

## 8. Authentication & JWT Design

### JWT Payload structures

**Super Admin JWT:**
```json
{
  "sub": "admin_uuid",
  "role": "super_admin",
  "iat": 1234567890,
  "exp": 1234567890
}
```

**Dept Admin JWT:**
```json
{
  "sub": "admin_uuid",
  "role": "dept_admin",
  "college_id": "college_uuid",
  "dept_ids": ["dept_uuid_1", "dept_uuid_2"],
  "is_college_owner": false,
  "iat": 1234567890,
  "exp": 1234567890
}
```

**Student JWT:**
```json
{
  "sub": "student_uuid",
  "role": "student",
  "college_id": "college_uuid",
  "dept_id": "dept_uuid",
  "effective_dept_id": "dept_uuid_or_generic",
  "using_generic_fallback": false,
  "iat": 1234567890,
  "exp": 1234567890
}
```

**Token expiry:**
- Access token: 1 hour
- Refresh token: 7 days (stored in httpOnly cookie)

### Middleware stack (every protected route)

```
1. verifyJWT          → decode + validate signature
2. checkExpiry        → reject expired tokens
3. resolveCollege     → validate college_id in JWT matches route :collegeId
4. checkCollegeActive → reject if college status = "suspended"
5. checkRole          → validate role has permission for route
6. checkDeptScope     → (dept_admin only) validate dept_ids includes route dept
```

---

## 9. Vector Namespace Strategy

**Namespace pattern:** `c_{college_id}_d_{dept_id}`

**Examples:**
```
c_abc123_d_generic        → Generic dept of college abc123
c_abc123_d_cs001          → CS dept of college abc123
c_abc123_d_mech002        → Mech dept of college abc123
c_xyz789_d_generic        → Generic dept of college xyz789  (different college)
```

**Query always scoped to exactly one namespace** — the student's `effective_dept_id`. This makes cross-tenant data leakage architecturally impossible.

**Metadata on every vector:**
```json
{
  "doc_id": "uuid",
  "dept_id": "uuid",
  "college_id": "uuid",
  "subject_id": "uuid or null",
  "filename": "DS_Unit3.pdf",
  "page": 47,
  "chunk_index": 12,
  "academic_year": "2025-26",
  "file_type": "pdf"
}
```

---

## 10. Ingestion Pipeline

**Separate Python microservice** (`services/ingestion-worker/`) — runs as a standalone FastAPI + Celery/ARQ worker on Render or Railway. Consumes jobs from the shared Redis queue that the Fastify API produces.

### Why Python for ingestion

| Library | Language | Notes |
|---|---|---|
| `PyMuPDF` (fitz) | Python | Best-in-class PDF text + page extraction |
| `pytesseract` | Python | OCR fallback for scanned PDFs — far better than Node equivalents |
| `python-pptx` | Python | Slide-by-slide PPTX text extraction with layout metadata |
| `python-docx` | Python | Clean DOCX paragraph + table extraction |
| `openai-whisper` | Python | Local Whisper model for MP4/MP3 transcription (or OpenAI API) |
| `langchain` text splitter | Python | Sentence-aware chunking with overlap |

### Queue bridge

```
Fastify API (Node.js)
  └── BullMQ → Redis queue: "ingestion_jobs"
                  ↓
Python worker (ARQ or Celery)
  └── consumes job payload: { doc_id, college_id, dept_id, r2_key, file_type }
```

**Python worker payload contract:**
```json
{
  "job_id": "uuid",
  "doc_id": "uuid",
  "college_id": "uuid",
  "dept_id": "uuid",
  "subject_id": "uuid | null",
  "r2_key": "colleges/abc/cs001/doc123/notes.pdf",
  "file_type": "pdf",
  "academic_year": "2025-26",
  "callback_url": "https://api.yourplatform.com/api/v1/internal/ingest/{job_id}/webhook"
}
```

### Ingestion worker steps

```python
# 1. Pull job from Redis queue
# 2. Download file from R2 using boto3 (S3-compatible)
# 3. Parse text by file type:

if file_type == "pdf":
    import fitz  # PyMuPDF
    doc = fitz.open(file_path)
    pages = [{ "text": page.get_text(), "page_num": i+1 } for i, page in enumerate(doc)]
    # If avg_chars_per_page < 100: trigger OCR
    if needs_ocr:
        from pdf2image import convert_from_path
        import pytesseract
        pages = ocr_pages(file_path)
        ocr_used = True

elif file_type == "pptx":
    from pptx import Presentation
    prs = Presentation(file_path)
    slides = [{ "text": extract_slide_text(slide), "slide_num": i+1 }
              for i, slide in enumerate(prs.slides)]

elif file_type in ["mp4", "mp3", "m4a"]:
    import whisper
    model = whisper.load_model("base")
    result = model.transcribe(file_path)
    segments = [{ "text": s["text"], "timestamp": s["start"] }
                for s in result["segments"]]

elif file_type == "docx":
    from docx import Document
    doc = Document(file_path)
    paragraphs = [{ "text": p.text, "style": p.style.name }
                  for p in doc.paragraphs if p.text.strip()]

# 4. Chunk text
from langchain.text_splitter import RecursiveCharacterTextSplitter
splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,
    chunk_overlap=50,
    separators=["\n\n", "\n", ".", " "]
)
chunks = splitter.create_documents(texts, metadatas=metadatas)

# 5. Embed chunks
from openai import OpenAI
client = OpenAI()
embeddings = client.embeddings.create(
    model="text-embedding-3-small",
    input=[c.page_content for c in chunks]
)

# 6. Upsert to Pinecone
from pinecone import Pinecone
pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(PINECONE_INDEX_NAME)
namespace = f"c_{college_id}_d_{dept_id}"
vectors = [
    (f"{doc_id}_{i}", emb.embedding, {
        "doc_id": doc_id, "dept_id": dept_id, "college_id": college_id,
        "subject_id": subject_id, "filename": filename,
        "page": chunk.metadata.get("page_num"),
        "chunk_index": i, "academic_year": academic_year, "file_type": file_type
    })
    for i, (chunk, emb) in enumerate(zip(chunks, embeddings.data))
]
index.upsert(vectors=vectors, namespace=namespace)

# 7. Compute quality score
quality_score = min(avg_chars_per_page / 500, 1.0)
if ocr_used: quality_score *= 0.85
if avg_chars_per_page < 50: quality_score = 0.1

# 8. POST callback to Fastify API with result
requests.post(callback_url, json={
    "status": "completed",
    "chunk_count": len(chunks),
    "quality_score": quality_score,
    "ocr_used": ocr_used
})
```

### Python worker `requirements.txt`

```
fastapi==0.111.0
uvicorn==0.30.0
arq==0.25.0           # Redis job queue consumer
PyMuPDF==1.24.0       # PDF parsing
pdf2image==1.17.0     # PDF → image for OCR
pytesseract==0.3.13   # OCR engine
python-pptx==0.6.23   # PPTX parsing
python-docx==1.1.2    # DOCX parsing
openai-whisper==20231117  # Audio transcription
langchain==0.2.0      # Text splitter
openai==1.30.0        # Embeddings API
pinecone==4.1.0       # Vector upsert
boto3==1.34.0         # R2 (S3-compatible) file download
requests==2.32.0      # Callback webhook
```

---

## 11. Environment Variables

### `services/api/.env` (Fastify API — Node.js)

```bash
# Platform
NODE_ENV=production
PORT=3000
JWT_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>

# MongoDB
MONGO_PLATFORM_URI=mongodb+srv://...       # platform DB
MONGO_BASE_URI=mongodb+srv://...           # base URI — DB name appended per college

# Pinecone
PINECONE_API_KEY=<key>
PINECONE_ENVIRONMENT=us-east-1-aws
PINECONE_INDEX_NAME=college-chatbot

# OpenAI (embeddings)
OPENAI_API_KEY=<key>

# Anthropic (LLM — chat)
ANTHROPIC_API_KEY=<key>
LLM_MODEL_CHAT=claude-haiku-4-5-20251001
LLM_MODEL_EXAM=claude-sonnet-4-6              # richer model for exam generation
LLM_MAX_TOKENS=1024

# Cohere (reranking)
COHERE_API_KEY=<key>

# Cloudflare R2
R2_ACCOUNT_ID=<id>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<key>
R2_BUCKET_NAME=college-chatbot-uploads
R2_PUBLIC_URL=https://pub-xxx.r2.dev

# Redis (BullMQ queue)
REDIS_URL=redis://...

# Email
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=noreply@yourplatform.com
SMTP_PASS=<pass>

# App URLs
PLATFORM_URL=https://app.yourplatform.com
COLLEGE_URL_TEMPLATE=https://{slug}.yourplatform.com

# tRPC
TRPC_SECRET=<internal-secret>              # validates tRPC requests from Next.js
```

### `services/ingestion-worker/.env` (Python microservice)

```bash
# Redis (consume BullMQ jobs)
REDIS_URL=redis://...

# R2 (download uploaded files)
R2_ACCOUNT_ID=<id>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<key>
R2_BUCKET_NAME=college-chatbot-uploads
R2_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com

# Pinecone (upsert vectors)
PINECONE_API_KEY=<key>
PINECONE_INDEX_NAME=college-chatbot

# OpenAI (embeddings + Whisper API)
OPENAI_API_KEY=<key>
WHISPER_MODE=api                           # "api" or "local" (local = whisper model on machine)

# Callback
API_CALLBACK_BASE=https://api.yourplatform.com
API_INTERNAL_SECRET=<secret>              # validates webhook callbacks

# Worker config
WORKER_CONCURRENCY=3                      # parallel ingestion jobs
TEMP_DIR=/tmp/ingestion
```

### `apps/*/  .env.local` (Next.js apps — all three)

```bash
# tRPC server URL
NEXT_PUBLIC_API_URL=https://api.yourplatform.com
NEXT_PUBLIC_TRPC_URL=https://api.yourplatform.com/trpc

# College resolution (student + admin apps only)
NEXT_PUBLIC_PLATFORM_DOMAIN=yourplatform.com

# Auth
NEXTAUTH_SECRET=<secret>                  # if using next-auth, otherwise JWT handled by Fastify
NEXT_PUBLIC_COOKIE_DOMAIN=.yourplatform.com   # shared cookie across subdomains
```

---

## 12. Folder Structure

Managed as a **Turborepo monorepo** with `pnpm workspaces`. The Python ingestion worker is a sibling service outside the pnpm workspace.

```
/                                    ← Turborepo root
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
│
├── apps/
│   ├── super-admin/                 # Next.js 14 — Super Admin portal
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── dashboard/
│   │   │   │   ├── colleges/
│   │   │   │   │   ├── page.tsx          # College list
│   │   │   │   │   ├── new/page.tsx      # Create college form
│   │   │   │   │   └── [id]/page.tsx     # College detail
│   │   │   │   ├── analytics/page.tsx
│   │   │   │   └── settings/page.tsx
│   │   │   ├── api/trpc/[trpc]/route.ts  # tRPC handler (if co-located)
│   │   │   └── layout.tsx
│   │   ├── middleware.ts                 # Subdomain → college resolution
│   │   └── next.config.ts
│   │
│   ├── admin/                       # Next.js 14 — Dept Admin portal
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── dashboard/
│   │   │   │   ├── documents/
│   │   │   │   │   ├── page.tsx          # Document list + upload
│   │   │   │   │   └── [id]/page.tsx     # Ingestion status
│   │   │   │   ├── subjects/page.tsx
│   │   │   │   ├── students/page.tsx
│   │   │   │   └── analytics/
│   │   │   │       ├── page.tsx          # Overview dashboard
│   │   │   │       └── unanswered/page.tsx
│   │   │   └── layout.tsx
│   │   └── middleware.ts
│   │
│   └── student/                     # Next.js 14 — Student chat app
│       ├── app/
│       │   ├── (auth)/
│       │   │   ├── login/page.tsx
│       │   │   └── register/page.tsx
│       │   ├── chat/
│       │   │   ├── page.tsx              # New chat
│       │   │   └── [sessionId]/page.tsx  # Active session
│       │   ├── history/page.tsx
│       │   └── layout.tsx
│       ├── components/
│       │   ├── ChatWindow.tsx
│       │   ├── MessageBubble.tsx
│       │   ├── SourceCitation.tsx        # "— [DS Unit3, Pg 47]" chip
│       │   ├── StreamingText.tsx         # Handles SSE token stream
│       │   └── GenericFallbackBanner.tsx
│       ├── store/
│       │   ├── chat.store.ts             # Zustand — session + messages
│       │   └── auth.store.ts             # Zustand — student + dept info
│       └── middleware.ts
│
├── services/
│   ├── api/                         # Node.js + Fastify — main API server
│   │   ├── src/
│   │   │   ├── server.ts                 # Fastify instance + plugin registration
│   │   │   ├── trpc/
│   │   │   │   ├── router.ts             # Root tRPC router
│   │   │   │   ├── context.ts            # tRPC context (JWT + college DB)
│   │   │   │   └── routers/
│   │   │   │       ├── college.router.ts
│   │   │   │       ├── department.router.ts
│   │   │   │       ├── document.router.ts
│   │   │   │       ├── subject.router.ts
│   │   │   │       ├── student.router.ts
│   │   │   │       └── analytics.router.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.routes.ts        # Raw Fastify routes (login/register)
│   │   │   │   └── chat.routes.ts        # SSE streaming (outside tRPC)
│   │   │   ├── plugins/
│   │   │   │   ├── jwt.plugin.ts         # @fastify/jwt
│   │   │   │   ├── cors.plugin.ts        # @fastify/cors
│   │   │   │   ├── multipart.plugin.ts   # @fastify/multipart (file upload)
│   │   │   │   └── rateLimit.plugin.ts   # @fastify/rate-limit
│   │   │   ├── middleware/
│   │   │   │   ├── verifyJWT.ts
│   │   │   │   ├── resolveCollege.ts     # validates :collegeId against JWT
│   │   │   │   ├── checkRole.ts
│   │   │   │   └── checkDeptScope.ts
│   │   │   ├── services/
│   │   │   │   ├── rag.service.ts        # Full RAG pipeline
│   │   │   │   ├── llm.service.ts        # Claude streaming via Anthropic SDK
│   │   │   │   ├── embedding.service.ts  # OpenAI embeddings
│   │   │   │   ├── pinecone.service.ts   # Vector search + upsert
│   │   │   │   ├── r2.service.ts         # File upload to Cloudflare R2
│   │   │   │   ├── queue.service.ts      # BullMQ job producer
│   │   │   │   └── email.service.ts      # Invite + notification emails
│   │   │   └── db/
│   │   │       ├── platform.db.ts        # Platform MongoDB connection
│   │   │       └── college.db.ts         # Per-college DB factory
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ingestion-worker/            # Python — ingestion microservice
│       ├── main.py                       # FastAPI app (health endpoint)
│       ├── worker.py                     # ARQ/Celery worker entry point
│       ├── jobs/
│       │   └── ingest_document.py        # Main ingestion job handler
│       ├── parsers/
│       │   ├── pdf_parser.py             # PyMuPDF + Tesseract OCR
│       │   ├── pptx_parser.py            # python-pptx
│       │   ├── docx_parser.py            # python-docx
│       │   └── audio_parser.py           # openai-whisper
│       ├── chunker.py                    # LangChain RecursiveCharacterTextSplitter
│       ├── embedder.py                   # OpenAI text-embedding-3-small
│       ├── vector_store.py               # Pinecone upsert
│       ├── storage.py                    # R2 download via boto3
│       ├── requirements.txt
│       ├── Dockerfile
│       └── .env
│
├── packages/
│   └── shared/                      # Shared TypeScript types + utils (pnpm workspace)
│       ├── src/
│       │   ├── types/
│       │   │   ├── college.types.ts
│       │   │   ├── department.types.ts
│       │   │   ├── user.types.ts
│       │   │   ├── document.types.ts
│       │   │   └── chat.types.ts
│       │   └── utils/
│       │       ├── namespace.util.ts     # buildPineconeNamespace(collegeId, deptId)
│       │       ├── jwt.util.ts
│       │       └── constants.ts
│       ├── package.json
│       └── tsconfig.json
│
└── infra/
    ├── provision-college.ts         # Run on college creation: DB + Generic Dept + Pinecone NS
    ├── seed-super-admin.ts          # Seed first super admin account
    └── deprovision-college.ts       # Cleanup script for deleted colleges
```

### Key architectural notes on the folder structure

`apps/*/middleware.ts` (Next.js Edge Middleware) handles subdomain resolution — when a request hits `msrit.yourplatform.com`, the middleware extracts the slug, resolves the `college_id`, and injects it as a header before the page renders. This means every Server Component in the admin and student apps has access to `college_id` without a client-side fetch.

`services/api/src/trpc/` contains all type-safe CRUD operations. The tRPC router is mounted as a Fastify plugin at `/trpc`. The raw Fastify routes at `services/api/src/routes/chat.routes.ts` handle SSE streaming — these bypass tRPC because tRPC does not support streaming responses.

`packages/shared` is the single source of truth for TypeScript types. Both the Fastify API and all Next.js apps import from here. The tRPC router input/output types are defined in shared and consumed on both sides — zero manual DTO sync.

---

## 13. Build Order (Claude Code Sequence)

Build in this exact sequence to avoid dependency issues. Each phase is a Claude Code session.

```
Phase 1 — Monorepo scaffold
  1. Root turbo.json + pnpm-workspace.yaml
  2. packages/shared — all TypeScript types + namespace.util.ts
  3. services/api — Fastify server skeleton + plugins (jwt, cors, multipart, rateLimit)
  4. services/api/db — platform.db.ts + college.db.ts connection factory

Phase 2 — Auth (Fastify raw routes, no tRPC)
  5. POST /auth/super-admin/login
  6. POST /auth/dept-admin/login + invite accept
  7. POST /auth/student/register + login
  8. JWT middleware stack: verifyJWT → resolveCollege → checkRole → checkDeptScope
  9. Refresh token rotation (httpOnly cookie)

Phase 3 — tRPC router setup
  10. services/api/src/trpc/context.ts — inject college DB + user from JWT
  11. services/api/src/trpc/router.ts — root router
  12. Mount tRPC on Fastify: POST /trpc

Phase 4 — Super Admin features (tRPC)
  13. college.router.ts — CRUD + provision script call
  14. infra/provision-college.ts — MongoDB DB init + Generic Dept + Pinecone NS
  15. department.router.ts — create, list, soft-delete (block Generic)
  16. dept admin invite flow (email + accept endpoint)

Phase 5 — Dept Admin features (tRPC + raw upload route)
  17. document.router.ts — list, delete, reingest
  18. POST /upload (raw Fastify multipart → R2 → BullMQ enqueue)
  19. subject.router.ts — CRUD
  20. analytics.router.ts — query volume, unanswered, topics

Phase 6 — Python ingestion worker
  21. services/ingestion-worker/ — scaffold + .env + Dockerfile
  22. storage.py — R2 download via boto3
  23. parsers/ — pdf_parser, pptx_parser, docx_parser, audio_parser
  24. chunker.py + embedder.py + vector_store.py
  25. jobs/ingest_document.py — full pipeline
  26. POST /internal/ingest/:jobId/webhook — Fastify callback receiver
  27. End-to-end test: upload PDF → ingest → query vectors in Pinecone

Phase 7 — RAG pipeline + Student chat (SSE)
  28. services/api/services/embedding.service.ts
  29. services/api/services/pinecone.service.ts
  30. services/api/services/rag.service.ts — full pipeline (embed → retrieve → rerank → prompt → stream)
  31. services/api/services/llm.service.ts — Claude Haiku streaming via Anthropic SDK
  32. services/api/routes/chat.routes.ts — SSE endpoint
  33. student.router.ts (tRPC) — profile, dept fallback resolution, session history

Phase 8 — Next.js apps
  34. apps/student — register, login, chat page + Zustand stores + SSE StreamingText
  35. apps/admin — documents upload UI + analytics dashboard
  36. apps/super-admin — college + dept management UI
  37. All apps: Edge Middleware for subdomain → college_id resolution

Phase 9 — Background jobs
  38. Nightly: re-evaluate generic fallback students
  39. Nightly: auto-flag unanswered query clusters
  40. Monthly: reset tokens_used_this_month

Phase 10 — Hardening
  41. Rate limiting: 10 chat queries/min per student
  42. Semantic response cache: Redis (query hash + dept_id → cached response, TTL 24h)
  43. College token limit enforcement (hard stop + soft warning at 80%)
  44. Sentry error monitoring (API + worker)
  45. Dockerfile + docker-compose for local dev
  46. GitHub Actions CI: typecheck + lint + test
```

### `package.json` key dependencies

**`services/api/package.json`**
```json
{
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/jwt": "^9.0.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/multipart": "^8.3.0",
    "@fastify/rate-limit": "^9.1.0",
    "@trpc/server": "^11.0.0",
    "zod": "^3.23.0",
    "mongoose": "^8.4.0",
    "@pinecone-database/pinecone": "^3.0.0",
    "openai": "^4.52.0",
    "@anthropic-ai/sdk": "^0.27.0",
    "cohere-ai": "^7.13.0",
    "@aws-sdk/client-s3": "^3.600.0",
    "bullmq": "^5.10.0",
    "ioredis": "^5.4.0",
    "bcrypt": "^5.1.0",
    "nodemailer": "^6.9.0",
    "uuid": "^10.0.0"
  }
}
```

**`apps/*/package.json`** (all three Next.js apps)
```json
{
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.0",
    "@trpc/client": "^11.0.0",
    "@trpc/react-query": "^11.0.0",
    "@tanstack/react-query": "^5.50.0",
    "zustand": "^4.5.0",
    "tailwindcss": "^3.4.0",
    "@shadcn/ui": "latest",
    "lucide-react": "^0.400.0",
    "zod": "^3.23.0"
  }
}
```

---

*Document version 2.0 · Updated May 2026 · Stack: Next.js 14 + Fastify + tRPC + Python ingestion worker · For use with Claude Code · All API routes versioned under `/api/v1/`*
