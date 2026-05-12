# College AI Chatbot Platform — Full Architecture & Feature Specification

> **For Claude Code** · Multi-tenant, per-college RAG chatbot for Medical & Engineering colleges  
> **Stack:** React 18 + Vite · Node.js + Express · MongoDB Atlas · Pinecone · Claude Haiku · Cloudflare R2  
> **Roles:** Super Admin → Dept Admin → Student  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
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

**Separate Python microservice** (`ingestion-worker/`) — runs as a Render background worker.

**Queue:** Bull (Node) → Redis → Python worker consumes via `rq` or `celery`  
Alternative: Use Node-based ingestion with `pdf-parse`, `node-whisper` — keep full stack in JS

**Recommended approach for Claude Code:** Node.js ingestion worker using:
- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX extraction  
- `node-pptx` or `officegen` — PPTX extraction
- `openai` Node SDK with `whisper-1` — audio/video transcription
- `@pinecone-database/pinecone` — vector upsert
- `openai` — embeddings (`text-embedding-3-small`)
- `bull` — job queue

**Chunking strategy:**
```js
function chunkText(text, chunkSize = 512, overlap = 50) {
  // Split by sentences first, then merge into chunks
  // Attach page/slide/timestamp metadata to each chunk
  // Return: [{ text, metadata: { page, chunk_index, ... } }]
}
```

**Quality score formula:**
```
quality_score = (avg_chars_per_page / 500) capped at 1.0
If ocr_used: quality_score *= 0.85 (OCR is less reliable)
If avg_chars_per_page < 50: quality_score = 0.1 (likely scanned or image-only)
```

---

## 11. Environment Variables

```bash
# Platform
NODE_ENV=production
PORT=3000
JWT_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>

# MongoDB
MONGO_PLATFORM_URI=mongodb+srv://...  # platform DB
MONGO_BASE_URI=mongodb+srv://...      # base URI, DB name appended per college

# Pinecone
PINECONE_API_KEY=<key>
PINECONE_ENVIRONMENT=us-east-1-aws
PINECONE_INDEX_NAME=college-chatbot

# OpenAI (embeddings + Whisper)
OPENAI_API_KEY=<key>

# Anthropic (LLM)
ANTHROPIC_API_KEY=<key>
LLM_MODEL=claude-haiku-4-5-20251001
LLM_MAX_TOKENS=1024

# Cohere (reranking)
COHERE_API_KEY=<key>

# Cloudflare R2
R2_ACCOUNT_ID=<id>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<key>
R2_BUCKET_NAME=college-chatbot-uploads
R2_PUBLIC_URL=https://...

# Redis (Bull queue)
REDIS_URL=redis://...

# Email (ingestion notifications)
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=noreply@yourplatform.com
SMTP_PASS=<pass>

# App URLs
PLATFORM_URL=https://app.yourplatform.com
COLLEGE_URL_TEMPLATE=https://{slug}.yourplatform.com
```

---

## 12. Folder Structure

```
/
├── apps/
│   ├── super-admin-ui/          # React — Super Admin dashboard
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Colleges.tsx
│   │       │   ├── CollegeDetail.tsx
│   │       │   ├── Analytics.tsx
│   │       │   └── Settings.tsx
│   │       └── components/
│   │
│   ├── admin-ui/                # React — Dept Admin dashboard
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Documents.tsx
│   │       │   ├── Subjects.tsx
│   │       │   ├── Analytics.tsx
│   │       │   └── Students.tsx
│   │       └── components/
│   │
│   └── student-ui/              # React — Student chat interface
│       └── src/
│           ├── pages/
│           │   ├── Register.tsx
│           │   ├── Login.tsx
│           │   ├── Chat.tsx
│           │   └── History.tsx
│           └── components/
│               ├── ChatWindow.tsx
│               ├── MessageBubble.tsx
│               ├── SourceCitation.tsx
│               └── GenericFallbackBanner.tsx
│
├── services/
│   ├── api/                     # Node.js + Express — main API
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── auth.routes.ts
│   │       │   ├── superAdmin.routes.ts
│   │       │   ├── deptAdmin.routes.ts
│   │       │   └── student.routes.ts
│   │       ├── middleware/
│   │       │   ├── verifyJWT.ts
│   │       │   ├── resolveCollege.ts
│   │       │   ├── checkRole.ts
│   │       │   └── checkDeptScope.ts
│   │       ├── controllers/
│   │       │   ├── college.controller.ts
│   │       │   ├── department.controller.ts
│   │       │   ├── document.controller.ts
│   │       │   ├── chat.controller.ts
│   │       │   └── analytics.controller.ts
│   │       ├── services/
│   │       │   ├── rag.service.ts        # RAG pipeline
│   │       │   ├── embedding.service.ts
│   │       │   ├── pinecone.service.ts
│   │       │   ├── llm.service.ts
│   │       │   └── ingestion.service.ts  # queue producer
│   │       └── db/
│   │           ├── platform.db.ts        # platform MongoDB connection
│   │           └── college.db.ts         # per-college DB connection factory
│   │
│   └── ingestion-worker/        # Node.js — background worker
│       └── src/
│           ├── worker.ts                 # Bull queue consumer
│           ├── parsers/
│           │   ├── pdf.parser.ts
│           │   ├── pptx.parser.ts
│           │   ├── docx.parser.ts
│           │   └── audio.parser.ts       # Whisper
│           ├── chunker.ts
│           ├── embedder.ts
│           └── vectorStore.ts
│
├── packages/
│   └── shared/                  # Shared types, utils
│       ├── types/
│       │   ├── college.types.ts
│       │   ├── user.types.ts
│       │   └── chat.types.ts
│       └── utils/
│           ├── jwt.util.ts
│           └── namespace.util.ts   # Pinecone namespace builder
│
└── infra/
    ├── provision-college.ts     # Script: run on college creation
    └── seed-super-admin.ts      # Script: seed first super admin
```

---

## 13. Build Order (Claude Code Sequence)

Build in this exact sequence to avoid dependency issues:

```
Phase 1 — Foundation
  1. packages/shared — types + utils
  2. services/api/db — MongoDB connections (platform + college factory)
  3. services/api/middleware — JWT, role, tenant validation
  4. services/api/routes/auth — login/register for all 3 roles

Phase 2 — Super Admin
  5. College CRUD (create + provision Generic Dept)
  6. Department CRUD
  7. Dept Admin management
  8. infra/provision-college.ts script

Phase 3 — Dept Admin
  9. Document upload endpoint + R2 integration
  10. services/ingestion-worker — full pipeline (parse → chunk → embed → upsert)
  11. Subject management
  12. Analytics endpoints

Phase 4 — Student
  13. Student registration with dept resolution + generic fallback
  14. services/api/services/rag.service.ts — full RAG pipeline
  15. Chat session + message endpoints (streaming SSE)
  16. Query logging

Phase 5 — UIs
  17. apps/super-admin-ui
  18. apps/admin-ui
  19. apps/student-ui

Phase 6 — Background jobs
  20. Nightly generic fallback re-evaluation job
  21. Unanswered query auto-flagging
  22. Monthly token usage reset

Phase 7 — Hardening
  23. Rate limiting per student (10 queries/min)
  24. Semantic response cache (same query + dept → cached response 24h)
  25. College token limit enforcement
  26. Error monitoring (Sentry)
```

---

*Document generated: May 2026 · For use with Claude Code · All API routes are versioned under `/api/v1/`*
