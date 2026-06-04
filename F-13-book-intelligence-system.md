# F-13: Book Intelligence System
## Chapter Navigator · Chapter Chat · Smart Quiz · PYQ Radar

> **Parent doc:** `college-chatbot-architecture.md` v2.0 · `F-11-student-document-library.md` v1.1  
> **Scope:** Transform the student Document Library from passive file browser into an intelligent study system. Every PDF textbook becomes chapter-aware — students can chat with a specific chapter, generate quizzes from it, and see which past exam questions it covers.  
> **Entry point:** The existing Document Library card (Preview / AI buttons). New "Study" button added alongside them.  
> **New Pinecone namespace:** `c_{cid}_d_{did}_pyq` for past year question papers (separate from textbook content)  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Schema — New Collections](#2-database-schema--new-collections)
3. [F-13-A: Chapter Extraction Engine](#3-f-13-a-chapter-extraction-engine)
4. [F-13-B: Chapter Navigator UI](#4-f-13-b-chapter-navigator-ui)
5. [F-13-C: Chapter-Scoped Chat](#5-f-13-c-chapter-scoped-chat)
6. [F-13-D: Smart Quiz Engine](#6-f-13-d-smart-quiz-engine)
7. [F-13-E: PYQ Intelligence System](#7-f-13-e-pyq-intelligence-system)
8. [F-13-F: Exam Readiness Score](#8-f-13-f-exam-readiness-score)
9. [F-13-G: Socratic Learning Mode](#9-f-13-g-socratic-learning-mode)
10. [F-13-H: Study Notes](#10-f-13-h-study-notes)
11. [API Route Map](#11-api-route-map)
12. [Frontend Component Tree](#12-frontend-component-tree)
13. [Python Worker Additions](#13-python-worker-additions)
14. [Environment Variables](#14-environment-variables)
15. [Build Order](#15-build-order)

---

## 1. System Overview

### What changes on the Document Library card

**Before:**
```
┌─────────────────────────────────┐
│ [Book thumbnail]                │
│ guyton_13.pdf                   │
│ PDF · 46.5 MB · 1046p          │
│ ████████████ 90%               │
│ [Preview]          [AI]         │
└─────────────────────────────────┘
```

**After:**
```
┌─────────────────────────────────┐
│ [Book thumbnail]      [48 ch.]  │
│ guyton_13.pdf                   │
│ PDF · 46.5 MB · 1046p          │
│ ████████████ 90%               │
│ [Preview] [Study ▼]  [AI]      │
└─────────────────────────────────┘
```

The `[Study ▼]` dropdown reveals:
- Open Chapter Navigator
- Quick Quiz (random chapter)
- Exam Prep Mode

Clicking "Open Chapter Navigator" opens the **Book Study Workspace** — a full-screen overlay with three panels: Chapter List (left), Content/Chat (center), Quiz/PYQ (right).

### The Book Study Workspace layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Library    Guyton & Hall — Medical Physiology (13th Ed)      [Exit Study] │
├────────────────┬───────────────────────────────────┬────────────────────────┤
│                │                                   │                        │
│  CHAPTERS      │   Chapter 12: The Heart            │   TOOLS               │
│  ──────────    │   ──────────────────────────────   │   ──────────          │
│  Ch 1  Pg 3   │   [Chat tab] [Read tab]            │   [Quiz]              │
│  Ch 2  Pg 29  │                                   │   [PYQ Radar]         │
│  ▶ Ch 12       │   💬 Chapter Chat                  │   [My Notes]          │
│    Pg 210     │   Scoped to pages 210–240          │                        │
│  Ch 13 Pg 241  │                                   │   Quiz Settings:      │
│  ...           │   [AI streaming chat UI]           │   Type: [MCQ ▼]       │
│                │                                   │   Difficulty: [App ▼]  │
│  PYQs:         │   You: Explain the cardiac         │   Count: [10]         │
│  ● 2024 (3Q)   │   output equation                 │   [Generate Quiz]     │
│  ● 2023 (2Q)   │                                   │                        │
│  ● 2022 (1Q)   │   AI: Cardiac output (CO) is      │   PYQ Radar:          │
│                │   defined as the product of        │   Ch 12 → 6 Questions │
│  [Teach me]    │   stroke volume (SV) and           │   ████████████ 2024   │
│  [Quiz me]     │   heart rate (HR). According       │   ████████  2023      │
│  [Exam prep]   │   to Guyton Ch.12 Pg.214:         │   ████  2022          │
│                │   CO = SV × HR                    │   [See questions]     │
└────────────────┴───────────────────────────────────┴────────────────────────┘
```

---

## 2. Database Schema — New Collections

### 2.1 `chapter_maps` collection (per-college DB)

```js
{
  _id: UUID,
  doc_id: UUID,                          // ref → documents collection
  college_id: UUID,
  dept_id: UUID,

  // Extraction metadata
  extraction_method: Enum[
    "pdf_bookmarks",     // from PDF outline/bookmark tree — most accurate
    "heuristic",         // from heading detection — fallback
    "manual"             // admin manually defined — override
  ],
  confidence_score: Number,              // 0.0–1.0 — quality of extraction
  total_chapters: Number,
  total_pages: Number,

  chapters: [
    {
      chapter_index: Number,             // 1-based
      title: String,                     // "The Heart as a Pump"
      subtitle: String,                  // optional — detected subheading
      start_page: Number,
      end_page: Number,
      page_count: Number,                // end_page - start_page + 1
      chunk_ids: [String],               // Pinecone vector IDs within this range
      chunk_count: Number,

      // Populated after PYQ analysis (async, runs after PYQ upload)
      pyq_count: Number,                 // total PYQ matches for this chapter
      pyq_years: [String],               // ["2022","2023","2024"]
      pyq_question_ids: [UUID],          // refs → pyq_questions collection
      pyq_coverage_score: Number,        // 0.0–1.0 — how "exam-important" this chapter is

      // Student progress (aggregated from quiz_sessions)
      avg_class_score: Number,           // populated nightly — class average on this chapter
      study_session_count: Number        // how many students studied this chapter
    }
  ],

  created_at: Date,
  updated_at: Date
}

// Indexes
db.chapter_maps.createIndex({ doc_id: 1 }, { unique: true });
db.chapter_maps.createIndex({ college_id: 1, dept_id: 1 });
```

### 2.2 `pyq_papers` collection (per-college DB)

```js
{
  _id: UUID,                             // pyq_paper_id
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,

  // Paper metadata (set by Dept Admin on upload)
  year: String,                          // "2024"
  month: String,                         // "June" — exam sitting
  exam_name: String,                     // "VTU June 2024" / "KLE Internal 2023"
  university: String,                    // "VTU" / "KLE" / "Rajiv Gandhi"

  // File reference
  doc_id: UUID,                          // the uploaded PYQ PDF in documents collection
  file_path: String,                     // local path to raw PYQ PDF

  // Ingestion state
  ingestion_status: Enum["pending","processing","completed","failed"],
  question_count: Number,                // populated after extraction

  // Pinecone namespace for this paper's questions
  pinecone_namespace: String,            // "c_{cid}_d_{did}_pyq"

  created_at: Date,
  updated_at: Date
}
```

### 2.3 `pyq_questions` collection (per-college DB)

```js
{
  _id: UUID,                             // pyq_question_id
  pyq_paper_id: UUID,                    // ref → pyq_papers
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,

  // Question content
  question_text: String,                 // full question text
  question_type: Enum["MCQ","SAQ","LAQ","CASE","FIB"],
  marks: Number,                         // 2 / 5 / 10 / 16
  unit_number: String,                   // "3" — if detectable from paper
  section: String,                       // "Section A" — if applicable

  // Paper metadata (denormalised for fast queries)
  year: String,
  exam_name: String,

  // Chapter mapping (populated during PYQ→chapter analysis)
  mapped_chapter_indices: [Number],      // which chapters answer this question
  mapping_confidence: Number,            // 0.0–1.0

  // Pinecone vector ID
  pinecone_vector_id: String,            // "pyq_{pyq_question_id}"

  created_at: Date
}

// Indexes
db.pyq_questions.createIndex({ dept_id: 1, subject_id: 1, year: 1 });
db.pyq_questions.createIndex({ mapped_chapter_indices: 1, dept_id: 1 });
```

### 2.4 `quiz_sessions` collection (per-college DB)

```js
{
  _id: UUID,
  student_id: UUID,
  doc_id: UUID,
  chapter_index: Number,                 // null = full book quiz
  subject_id: UUID,
  college_id: UUID,
  dept_id: UUID,

  // Quiz config
  quiz_mode: Enum["practice","test","timed","pyq_sim","weak_spots"],
  question_type: Enum["MCQ","TF","SAQ","CASE","MIXED","PYQ"],
  difficulty: Enum["recall","application","analysis","adaptive"],
  time_limit_seconds: Number,            // null = untimed

  // Questions and answers
  questions: [
    {
      question_id: String,               // generated UUID per question
      question_text: String,
      question_type: String,
      options: [String],                 // MCQ options — empty for SAQ
      correct_answer: String,
      explanation: String,               // AI-generated explanation
      source_page: Number,               // page in the textbook
      bloom_level: String,               // "remember" / "understand" / "apply" / "analyse"
      difficulty: String,
      is_pyq: Boolean,                   // sourced from real past year paper
      pyq_question_id: UUID,             // ref if is_pyq = true
      pyq_year: String,                  // "2023" if is_pyq = true

      // Student response
      student_answer: String,            // null if not yet answered
      is_correct: Boolean,
      time_taken_seconds: Number,
      answered_at: Date
    }
  ],

  // Results
  status: Enum["in_progress","completed","abandoned"],
  score_pct: Number,                     // 0–100
  correct_count: Number,
  total_count: Number,
  time_taken_seconds: Number,

  // Analysis (populated on completion)
  weak_topics: [String],                 // subtopics where student scored <60%
  strong_topics: [String],
  pyq_coverage_pct: Number,             // % of recent PYQs student could answer
  pyq_would_pass_count: Number,         // of recent exam PYQs, how many student answered correctly
  recommendation: String,               // AI-generated study recommendation

  started_at: Date,
  completed_at: Date
}

// Indexes
db.quiz_sessions.createIndex({ student_id: 1, doc_id: 1, completed_at: -1 });
db.quiz_sessions.createIndex({ student_id: 1, chapter_index: 1, completed_at: -1 });
```

### 2.5 `student_notes` collection (per-college DB)

```js
{
  _id: UUID,
  student_id: UUID,
  doc_id: UUID,
  chapter_index: Number,
  college_id: UUID,

  notes: [
    {
      note_id: UUID,
      content: String,                   // student's own text
      source_page: Number,               // page they're studying
      pinned_ai_response: String,        // optional — saved AI answer
      created_at: Date,
      updated_at: Date
    }
  ],

  created_at: Date,
  updated_at: Date
}
```

---

## 3. F-13-A: Chapter Extraction Engine

### 3.1 When extraction runs

Chapter extraction is added as step 10 of the existing ingestion pipeline (after Pinecone upsert). It does not block the main ingestion — it runs as a separate async job queued after ingestion completes.

```
Existing ingestion steps 1–9 (parse → chunk → embed → upsert)
  ↓
Step 10 (NEW): Enqueue chapter extraction job
  ↓ (async)
Python worker: extract_chapters.py
  ↓
Create chapter_maps record
  ↓
Update documents record: has_chapter_map = true
```

### 3.2 Python worker: `extract_chapters.py`

```python
import fitz  # PyMuPDF
import re
import json
from datetime import datetime

async def extract_chapters(job_data: dict):
    doc_id = job_data["doc_id"]
    college_id = job_data["college_id"]
    dept_id = job_data["dept_id"]
    file_path = job_data["file_path"]

    doc = fitz.open(file_path)
    total_pages = len(doc)

    # ── Method 1: PDF bookmark/outline tree ──────────────────────────────
    toc = doc.get_toc()  # [(level, title, page_num), ...]
    chapters = []

    if toc and len(toc) >= 3:
        # Filter to top-level items only (level == 1)
        top_level = [(t, p) for level, t, p in toc if level == 1]

        for i, (title, start_page) in enumerate(top_level):
            end_page = top_level[i+1][1] - 1 if i < len(top_level) - 1 else total_pages
            chapters.append({
                "chapter_index": i + 1,
                "title": title.strip(),
                "subtitle": "",
                "start_page": start_page,
                "end_page": end_page,
                "page_count": end_page - start_page + 1,
                "chunk_ids": [],       # populated below
                "chunk_count": 0,
                "pyq_count": 0,
                "pyq_years": [],
                "pyq_question_ids": [],
                "pyq_coverage_score": 0.0,
                "avg_class_score": None,
                "study_session_count": 0
            })

        method = "pdf_bookmarks"
        confidence = 0.95

    else:
        # ── Method 2: Heuristic heading detection ─────────────────────────
        chapters = detect_chapters_heuristic(doc)
        method = "heuristic"
        confidence = 0.70 if chapters else 0.0

    doc.close()

    if not chapters:
        # No chapters detected — store a single "Full Book" pseudo-chapter
        chapters = [{
            "chapter_index": 1, "title": "Full Book",
            "start_page": 1, "end_page": total_pages,
            "page_count": total_pages, "chunk_ids": [], "chunk_count": 0,
            "pyq_count": 0, "pyq_years": [], "pyq_question_ids": [],
            "pyq_coverage_score": 0.0, "avg_class_score": None, "study_session_count": 0
        }]
        method = "heuristic"
        confidence = 0.0

    # ── Populate chunk_ids for each chapter from existing Pinecone metadata ─
    chapters = await populate_chunk_ids(chapters, doc_id, college_id, dept_id)

    # ── Persist to MongoDB ────────────────────────────────────────────────
    chapter_map = {
        "_id": generate_uuid(),
        "doc_id": doc_id,
        "college_id": college_id,
        "dept_id": dept_id,
        "extraction_method": method,
        "confidence_score": confidence,
        "total_chapters": len(chapters),
        "total_pages": total_pages,
        "chapters": chapters,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    await mongo.college_db(college_id).chapter_maps.replace_one(
        {"doc_id": doc_id}, chapter_map, upsert=True
    )

    # ── Update documents record ───────────────────────────────────────────
    await mongo.college_db(college_id).documents.update_one(
        {"_id": doc_id},
        {"$set": {"has_chapter_map": True, "chapter_count": len(chapters)}}
    )


def detect_chapters_heuristic(doc) -> list:
    """
    Scan pages for chapter headings based on font size + bold + common patterns.
    Returns list of chapter dicts (without chunk_ids or pyq fields).
    """
    chapter_patterns = [
        r"^chapter\s+\d+",
        r"^unit\s+\d+",
        r"^\d+\.\s+[A-Z]",
        r"^section\s+\d+"
    ]
    chapters = []
    chapter_starts = []

    for page_num in range(min(len(doc), 600)):  # scan first 600 pages
        page = doc[page_num]
        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span["text"].strip()
                    size = span["size"]
                    bold = span["flags"] & 16  # bold flag
                    if size >= 14 and (bold or size >= 18):
                        for pattern in chapter_patterns:
                            if re.match(pattern, text, re.IGNORECASE):
                                chapter_starts.append((page_num + 1, text))
                                break

    for i, (start_page, title) in enumerate(chapter_starts):
        end_page = chapter_starts[i+1][0] - 1 if i < len(chapter_starts) - 1 else len(doc)
        chapters.append({
            "chapter_index": i + 1,
            "title": title,
            "subtitle": "",
            "start_page": start_page,
            "end_page": end_page,
            "page_count": end_page - start_page + 1,
            "chunk_ids": [],
            "chunk_count": 0,
            "pyq_count": 0, "pyq_years": [], "pyq_question_ids": [],
            "pyq_coverage_score": 0.0, "avg_class_score": None, "study_session_count": 0
        })

    return chapters


async def populate_chunk_ids(chapters: list, doc_id: str, college_id: str, dept_id: str) -> list:
    """
    Query Pinecone to find which chunk_ids fall within each chapter's page range.
    Uses metadata filter on page_num.
    """
    namespace = f"c_{college_id}_d_{dept_id}"
    pinecone_index = get_pinecone_index()

    for ch in chapters:
        result = await pinecone_index.query(
            vector=[0.0] * 1536,          # zero vector — metadata filter only
            filter={
                "doc_id": {"$eq": doc_id},
                "page_num": {"$gte": ch["start_page"], "$lte": ch["end_page"]}
            },
            top_k=500,
            namespace=namespace,
            include_metadata=False
        )
        ch["chunk_ids"] = [m.id for m in result.matches]
        ch["chunk_count"] = len(result.matches)

    return chapters
```

### 3.3 Quality indicator for Dept Admin

After extraction, the document card in the Admin panel shows:

```
Guyton 13th Ed.pdf — Chapter map: ✓ 48 chapters detected (PDF bookmarks, 95% confidence)
Kandel Neuroscience.pdf — Chapter map: ⚠ 12 chapters detected (heading scan, 70% confidence)
Custom Notes.pdf — Chapter map: ✗ No chapters detected (single-topic document)
```

Admin can click "Re-extract" or "Edit chapters manually" if confidence is low.

---

## 4. F-13-B: Chapter Navigator UI

### 4.1 Entry point

The Document Library card gets two additions:
1. Chapter count badge: `48 ch.` in top-right corner of card
2. `[Study ▼]` button dropdown replacing or alongside `[AI]` button

### 4.2 Chapter Navigator panel (slide-over, full Book Study Workspace)

```
GET /api/v1/college/:cid/student/library/:docId/chapters
Response: { chapters[], doc_name, total_chapters, extraction_method, confidence }
```

**React component: `ChapterNavigator.tsx`**

```tsx
interface Chapter {
  chapter_index: number;
  title: string;
  start_page: number;
  end_page: number;
  page_count: number;
  chunk_count: number;
  pyq_count: number;
  pyq_years: string[];
  pyq_coverage_score: number;
}

// Rendered as a scrollable list in the left panel
function ChapterList({ chapters, selectedIndex, onSelect }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {chapters.map((ch) => (
        <button
          key={ch.chapter_index}
          onClick={() => onSelect(ch)}
          className={`text-left px-4 py-3 border-b border-slate-800 hover:bg-slate-800 transition-all
            ${selectedIndex === ch.chapter_index ? 'bg-teal-900/40 border-l-2 border-l-teal-400' : ''}`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs text-slate-500 mt-0.5 flex-shrink-0">
              Ch {ch.chapter_index}
            </span>
            <span className="text-sm text-slate-200 flex-1 leading-tight">{ch.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 ml-5">
            <span className="text-xs text-slate-500">Pg {ch.start_page}–{ch.end_page}</span>
            {ch.pyq_count > 0 && (
              <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded">
                {ch.pyq_count} PYQs
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
```

### 4.3 Selected chapter header in center panel

When a chapter is selected, the center panel chat/read area shows:

```
┌──────────────────────────────────────────────────────────┐
│ 📖 Chapter 12: The Heart as a Pump          Pg 210–240   │
│ Scoped chat · 31 pages · 47 content chunks              │
│ [Chat] [Read] [Summary]                                  │
└──────────────────────────────────────────────────────────┘
```

---

## 5. F-13-C: Chapter-Scoped Chat

### 5.1 How it differs from existing dept-scoped chat

| Dimension | Existing chat (F-07) | Chapter-scoped chat (F-13-C) |
|---|---|---|
| Pinecone namespace | `c_{cid}_d_{did}` | Same namespace |
| Pinecone filter | `dept_id = did` | `doc_id = X AND page_num >= 210 AND page_num <= 240` |
| System prompt scope | "Answer from dept materials" | "Answer only from Chapter 12 (pages 210–240) of Guyton 13th Ed" |
| topK | 5–8 | 8–12 (narrower page range needs more chunks to get full coverage) |
| UI indicator | Dept name in header | "Chapter 12: The Heart" in chat header |
| Fallback | Generic dept | "This topic isn't in Chapter 12 — check Chapter 14 which covers it." |

### 5.2 Chapter-scoped RAG pipeline modification

```javascript
// services/api/src/services/rag.service.ts — chapter-scoped variant

async function queryChapterScoped(params: {
  query: string;
  collegeId: string;
  deptId: string;
  docId: string;
  chapter: Chapter;                      // { start_page, end_page, title, chapter_index }
  conversationHistory: Message[];
  studentId: string;
  mode: "answer" | "socratic";
}) {
  const namespace = `c_${params.collegeId}_d_${params.deptId}`;

  // 1. Embed the query
  const queryVector = await embedText(params.query);

  // 2. Retrieve — chapter-scoped via metadata filter
  const retrieved = await pinecone.query({
    vector: queryVector,
    namespace,
    filter: {
      doc_id: { $eq: params.docId },
      page_num: {
        $gte: params.chapter.start_page,
        $lte: params.chapter.end_page
      }
    },
    topK: 10,
    includeMetadata: true
  });

  // 3. Rerank
  const reranked = await cohereRerank(params.query, retrieved.matches);
  const topChunks = reranked.slice(0, 5);

  // 4. Confidence check
  if (topChunks.length === 0 || topChunks[0].score < 0.55) {
    // Suggest which chapter might have the answer
    const suggestion = await findChapterWithAnswer(params.query, params.collegeId, params.deptId, params.docId);
    return {
      answered: false,
      fallback: suggestion
        ? `This topic isn't covered in Chapter ${params.chapter.chapter_index}. It appears to be in Chapter ${suggestion.chapter_index}: "${suggestion.title}".`
        : `This topic doesn't appear to be covered in Chapter ${params.chapter.chapter_index}.`
    };
  }

  // 5. Assemble prompt
  const systemPrompt = buildChapterSystemPrompt(params.chapter, params.mode);
  const userPrompt = buildUserPrompt(params.query, topChunks, params.conversationHistory);

  // 6. Stream via Claude Haiku
  return streamLLMResponse(systemPrompt, userPrompt, params);
}

function buildChapterSystemPrompt(chapter: Chapter, mode: "answer" | "socratic"): string {
  const base = `You are a study assistant helping a student understand Chapter ${chapter.chapter_index}: "${chapter.title}".
Answer ONLY from the provided context chunks, which are excerpts from pages ${chapter.start_page}–${chapter.end_page}.
Always cite the page number: "— Page X".
If the student asks about a topic not covered in these pages, say: "That topic isn't in this chapter."`;

  if (mode === "socratic") {
    return base + `\n\nIMPORTANT: Do NOT give direct answers. Instead:
1. Ask what the student already knows about the topic.
2. Guide them with leading questions toward the answer.
3. Confirm understanding when they get it right.
4. If they're very stuck after 3 exchanges, give a hint (not the full answer).
This is Socratic tutoring — the goal is that THEY reason their way to the answer.`;
  }

  return base;
}
```

### 5.3 Chapter cross-reference (find which chapter has the answer)

```javascript
async function findChapterWithAnswer(query: string, collegeId: string, deptId: string, docId: string) {
  // Search across ALL pages of the same doc (no page filter)
  const namespace = `c_${collegeId}_d_${deptId}`;
  const queryVector = await embedText(query);
  const result = await pinecone.query({
    vector: queryVector, namespace,
    filter: { doc_id: { $eq: docId } },
    topK: 3, includeMetadata: true
  });
  if (!result.matches.length) return null;
  const topPage = result.matches[0].metadata.page_num;

  // Load chapter map and find which chapter owns that page
  const chapterMap = await getChapterMap(docId, collegeId);
  return chapterMap.chapters.find(ch => ch.start_page <= topPage && ch.end_page >= topPage) || null;
}
```

---

## 6. F-13-D: Smart Quiz Engine

### 6.1 Quiz generation endpoint

```
POST /api/v1/college/:cid/student/library/:docId/chapters/:chapterIdx/quiz
Body: {
  question_type: "MCQ" | "TF" | "SAQ" | "CASE" | "MIXED" | "PYQ",
  difficulty: "recall" | "application" | "analysis" | "adaptive",
  count: 5 | 10 | 15 | 20,
  include_pyq: Boolean,       // include real past year questions in the mix
  timed: Boolean,
  time_limit_per_question: 60 | 90 | 120  // seconds (if timed)
}
Response: { quiz_session_id, questions[], total_count }
```

### 6.2 Quiz generation server logic

```javascript
async function generateQuiz(params) {
  const { docId, chapterIdx, question_type, difficulty, count, include_pyq } = params;

  // 1. Load chapter metadata
  const chapterMap = await getChapterMap(docId, params.collegeId);
  const chapter = chapterMap.chapters.find(c => c.chapter_index === chapterIdx);

  // 2. Retrieve chapter chunks from Pinecone (all of them, ordered)
  const allChunks = await getAllChapterChunks(chapter, docId, params.collegeId, params.deptId);
  const contextText = allChunks.map(c => c.metadata.text).join("\n\n").slice(0, 60000);

  // 3. If include_pyq, pull real past year questions for this chapter
  let pyqExamples = "";
  if (include_pyq && chapter.pyq_count > 0) {
    const pyqSamples = await getPyqForChapter(chapter, params.collegeId, params.deptId, 5);
    pyqExamples = `\n\nExam question style examples from previous years:\n${
      pyqSamples.map(q => `(${q.year}, ${q.marks} marks): ${q.question_text}`).join("\n")
    }`;
  }

  // 4. Build quiz generation prompt
  const systemPrompt = `You are an expert medical exam question generator.
Generate questions STRICTLY from the provided chapter content.
Respond ONLY with a valid JSON array. No preamble, no markdown code fences, no explanation.
Each question object must follow this exact schema:
{
  "question_text": "...",
  "question_type": "${question_type}",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],  // empty array for SAQ
  "correct_answer": "A",                                   // letter for MCQ, full text for SAQ
  "explanation": "Brief explanation citing the source",
  "source_page": 215,                                      // specific page number
  "bloom_level": "remember | understand | apply | analyse",
  "difficulty": "${difficulty}"
}`;

  const userPrompt = `Generate ${count} ${question_type} questions at ${difficulty} level.
Chapter: ${chapter.chapter_index} — "${chapter.title}" (pages ${chapter.start_page}–${chapter.end_page})
${pyqExamples}

Chapter content:
${contextText}`;

  // 5. Call Claude Sonnet (richer reasoning for question generation)
  const response = await anthropic.messages.create({
    model: process.env.LLM_MODEL_EXAM,          // claude-sonnet-4-6
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt
  });

  // 6. Parse JSON response safely
  const rawText = response.content[0].text.trim();
  const questions = JSON.parse(rawText.replace(/^```json\n?|```$/g, ""));

  // 7. If include_pyq — append real PYQ questions
  let finalQuestions = questions;
  if (include_pyq && chapter.pyq_count > 0) {
    const realPyqs = await getPyqForChapter(chapter, params.collegeId, params.deptId, 3);
    const pyqFormatted = realPyqs.map(q => ({
      question_text: q.question_text,
      question_type: q.question_type,
      options: [],
      correct_answer: null,                      // SAQ/LAQ — no provided answer
      explanation: `This question appeared in ${q.exam_name} (${q.marks} marks)`,
      source_page: null,
      bloom_level: "apply",
      difficulty: "application",
      is_pyq: true,
      pyq_year: q.year,
      pyq_question_id: q._id
    }));
    finalQuestions = [...questions, ...pyqFormatted].slice(0, count + 3);
  }

  // 8. Create quiz session record
  const session = await createQuizSession({
    student_id: params.studentId,
    doc_id: docId,
    chapter_index: chapterIdx,
    questions: finalQuestions.map(q => ({ ...q, student_answer: null, is_correct: null })),
    quiz_mode: params.timed ? "timed" : "practice",
    question_type,
    difficulty,
    time_limit_seconds: params.time_limit_per_question * finalQuestions.length || null
  });

  return { quiz_session_id: session._id, questions: finalQuestions, total_count: finalQuestions.length };
}
```

### 6.3 Quiz UI — interactive quiz component

```
┌──────────────────────────────────────────────────────────────┐
│ Quiz — Ch 12: The Heart   Question 4 of 10   [⏱ 1:32]     │
│ ████████░░░░░░░░░░░░  40%                                   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Which of the following best describes cardiac output?        │
│ (Application · Page 214)                                     │
│                                                              │
│ ○ A) Volume of blood pumped per heartbeat                   │
│ ● B) Volume pumped per minute = SV × HR          ← selected │
│ ○ C) Pressure generated by ventricular contraction          │
│ ○ D) Resistance offered by systemic vasculature             │
│                                                              │
│              [Submit Answer]                                 │
│                                                              │
│ — After submit (practice mode) —                            │
│ ✅ Correct! Cardiac output = Stroke Volume × Heart Rate.    │
│ Guyton states: "Normal CO at rest is ~5 L/min" — Page 214  │
│                                                              │
│              [Next Question →]                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.4 Quiz submit endpoint

```
POST /api/v1/college/:cid/student/quiz-sessions/:sessionId/submit
Body: { answers: [{ question_id, student_answer }] }
Response: {
  score_pct, correct_count, total_count,
  weak_topics, strong_topics,
  pyq_coverage_pct, pyq_would_pass_count,
  recommendation, question_results[]
}
```

---

## 7. F-13-E: PYQ Intelligence System

### 7.1 Dept Admin: uploading PYQ papers

**Admin panel addition:** New document type option on the upload form:
```
Document type: [Textbook ▼]  ← existing options
               [Lecture Notes]
               [Lab Manual]
               ► [Previous Year Question Paper]  ← NEW

If "Previous Year Question Paper" selected:
  Year: [2024]
  Exam: [VTU June 2024]
  Subject: [Pharmacology ▼]  ← from existing subjects list
```

On upload, documents tagged as PYQ are routed to the PYQ ingestion pipeline instead of the standard textbook pipeline.

### 7.2 PYQ ingestion pipeline (Python worker)

```python
# services/ingestion-worker/jobs/ingest_pyq.py

async def ingest_pyq_paper(job_data: dict):
    """
    Ingests a previous year question paper PDF.
    Extracts individual questions, embeds them, stores in PYQ namespace.
    Then maps questions to chapters of textbooks in the same dept.
    """
    pyq_paper_id = job_data["pyq_paper_id"]
    college_id = job_data["college_id"]
    dept_id = job_data["dept_id"]
    file_path = job_data["file_path"]

    # ── Step 1: Extract raw text ──────────────────────────────────────────
    doc = fitz.open(file_path)
    full_text = "\n".join([page.get_text() for page in doc])

    # ── Step 2: Extract individual questions using Claude Haiku ──────────
    extraction_prompt = f"""Extract all exam questions from this question paper.
Return ONLY a JSON array. Each item: 
  {{ "question_text": "...", "marks": 2, "section": "A", "question_type": "SAQ" }}
question_type: MCQ | SAQ | LAQ | CASE | FIB

Question paper text:
{full_text[:8000]}"""

    response = await call_claude_haiku(extraction_prompt)
    questions_raw = json.loads(response.strip())

    # ── Step 3: Embed each question + store in PYQ Pinecone namespace ─────
    pyq_namespace = f"c_{college_id}_d_{dept_id}_pyq"
    vectors = []
    question_records = []

    for i, q in enumerate(questions_raw):
        embedding = await embed_text(q["question_text"])
        pyq_q_id = generate_uuid()
        vector_id = f"pyq_{pyq_q_id}"

        vectors.append({
            "id": vector_id,
            "values": embedding,
            "metadata": {
                "pyq_question_id": pyq_q_id,
                "pyq_paper_id": pyq_paper_id,
                "college_id": college_id,
                "dept_id": dept_id,
                "question_text": q["question_text"][:500],
                "marks": q.get("marks", 0),
                "question_type": q.get("question_type", "SAQ"),
                "year": job_data["year"],
                "exam_name": job_data["exam_name"]
            }
        })
        question_records.append({
            "_id": pyq_q_id,
            "pyq_paper_id": pyq_paper_id,
            "college_id": college_id,
            "dept_id": dept_id,
            "subject_id": job_data["subject_id"],
            "question_text": q["question_text"],
            "question_type": q.get("question_type", "SAQ"),
            "marks": q.get("marks", 0),
            "section": q.get("section", ""),
            "year": job_data["year"],
            "exam_name": job_data["exam_name"],
            "mapped_chapter_indices": [],
            "mapping_confidence": 0.0,
            "pinecone_vector_id": vector_id,
            "created_at": datetime.utcnow()
        })

    # Upsert to Pinecone PYQ namespace
    await pinecone_index.upsert(vectors=vectors, namespace=pyq_namespace)

    # Save question records to MongoDB
    await mongo.college_db(college_id).pyq_questions.insert_many(question_records)

    # Update pyq_paper record
    await mongo.college_db(college_id).pyq_papers.update_one(
        {"_id": pyq_paper_id},
        {"$set": {"ingestion_status": "completed", "question_count": len(question_records)}}
    )

    # ── Step 4: Map questions to chapters ────────────────────────────────
    await map_pyq_to_chapters(college_id, dept_id, question_records)


async def map_pyq_to_chapters(college_id: str, dept_id: str, new_questions: list):
    """
    For each chapter in all textbooks in this dept, find which PYQ questions
    are semantically answered by that chapter's content.
    """
    textbook_namespace = f"c_{college_id}_d_{dept_id}"
    pyq_namespace = f"c_{college_id}_d_{dept_id}_pyq"

    # Get all chapter maps for this dept
    chapter_maps = await mongo.college_db(college_id).chapter_maps.find(
        {"dept_id": dept_id}
    ).to_list(None)

    for chapter_map in chapter_maps:
        for ch in chapter_map["chapters"]:
            if not ch["chunk_ids"]:
                continue

            # Build chapter summary: embed title + first 3 chunks' text
            chapter_summary = f"{ch['title']}: " + " ".join(
                await get_chunk_texts(ch["chunk_ids"][:5], textbook_namespace)
            )
            ch_embedding = await embed_text(chapter_summary[:2000])

            # Query PYQ namespace to find questions this chapter answers
            pyq_results = await pinecone_index.query(
                vector=ch_embedding,
                namespace=pyq_namespace,
                filter={"dept_id": {"$eq": dept_id}},
                top_k=50,
                include_metadata=True
            )

            # Filter to high-confidence matches only
            matched = [m for m in pyq_results.matches if m.score >= 0.72]
            matched_years = list({m.metadata["year"] for m in matched})
            matched_q_ids = [m.metadata["pyq_question_id"] for m in matched]

            # Update chapter map
            await mongo.college_db(college_id).chapter_maps.update_one(
                {"doc_id": chapter_map["doc_id"], "chapters.chapter_index": ch["chapter_index"]},
                {"$set": {
                    "chapters.$.pyq_count": len(matched),
                    "chapters.$.pyq_years": sorted(matched_years, reverse=True),
                    "chapters.$.pyq_question_ids": matched_q_ids,
                    "chapters.$.pyq_coverage_score": min(len(matched) / 10.0, 1.0)
                }}
            )
```

### 7.3 PYQ Radar UI on the chapter row

```
Chapter 12: The Heart as a Pump              Pg 210–240
─────────────────────────────────────────────────────────
[🎯 6 PYQs]  ●2024 ●2023 ●2022   ████████████ High
[Chat] [Quiz] [Exam prep]
```

Clicking `[🎯 6 PYQs]` opens a panel:

```
┌────────────────────────────────────────────────────────┐
│ Past Year Questions — Chapter 12: The Heart            │
│ 6 questions from 3 exam sittings                       │
├────────────────────────────────────────────────────────┤
│ 2024 June (VTU)  · 10 marks                           │
│ "Describe the Frank-Starling law of the heart and      │
│  its clinical significance."                           │
│ [Get model answer] [Add to quiz]                       │
│ ──────────────────────────────────────────────────     │
│ 2023 December (VTU)  · 2 marks                        │
│ "Define cardiac output."                               │
│ [Get model answer] [Add to quiz]                       │
│ ──────────────────────────────────────────────────     │
│ [Generate 10 more similar questions]                   │
└────────────────────────────────────────────────────────┘
```

---

## 8. F-13-F: Exam Readiness Score

### 8.1 Computed after every quiz session

```javascript
async function computeExamReadiness(sessionId: string) {
  const session = await getQuizSession(sessionId);
  const chapter = await getChapter(session.doc_id, session.chapter_index, session.college_id);

  // 1. Score breakdown
  const correct = session.questions.filter(q => q.is_correct).length;
  const score_pct = Math.round((correct / session.questions.length) * 100);

  // 2. PYQ coverage analysis
  const pyqQsForChapter = await getPyqForChapter(chapter, session.college_id, session.dept_id);
  const pyqQuestionsInSession = session.questions.filter(q => q.is_pyq);
  const pyqPassCount = pyqQuestionsInSession.filter(q => q.is_correct).length;

  // 3. Estimate how many real PYQs student could answer
  // Use quiz score as a proxy for chapter mastery
  const estimatedPyqPass = Math.round((score_pct / 100) * chapter.pyq_count);

  // 4. Identify weak topics (AI-assisted analysis)
  const weakTopics = await identifyWeakTopics(session);

  // 5. Generate recommendation
  const recommendation = await generateRecommendation(session, weakTopics, estimatedPyqPass, chapter);

  // Update quiz session
  await updateQuizSession(sessionId, {
    score_pct,
    correct_count: correct,
    weak_topics: weakTopics,
    pyq_coverage_pct: Math.round((estimatedPyqPass / Math.max(chapter.pyq_count, 1)) * 100),
    pyq_would_pass_count: estimatedPyqPass,
    recommendation
  });

  return { score_pct, weak_topics, estimatedPyqPass, recommendation };
}
```

### 8.2 Exam Readiness result screen UI

```
┌──────────────────────────────────────────────────────────────┐
│ Quiz Complete — Ch 12: The Heart                            │
├──────────────────────────────────────────────────────────────┤
│              7/10 Correct  (70%)                            │
│              ██████████░░░░░░░░░░                           │
│                                                              │
│ Exam Readiness                                              │
│ ─────────────────────────────────────────────────────────  │
│ Based on 6 real past exam questions for this chapter:       │
│ You'd likely pass ≈ 4 of 6 (67%)                          │
│                                                              │
│ Strong areas          Weak areas                           │
│ ✅ Cardiac output     ⚠️  Frank-Starling mechanism         │
│ ✅ Heart rate control ⚠️  Preload vs afterload             │
│ ✅ Stroke volume      ⚠️  Ventricular compliance           │
│                                                              │
│ AI Recommendation:                                          │
│ "Re-read pages 218–222 on the Frank-Starling law.          │
│  This topic appeared in both the 2024 and 2023 exams       │
│  as a 10-mark question."                                   │
│                                                              │
│ [Retry weak areas] [Study Frank-Starling] [Next chapter]   │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. F-13-G: Socratic Learning Mode

Toggle available in the chapter chat header:

```
[Chat mode: Answer ●  |  Teach me ○]
```

When "Teach me" is active, the system prompt switches to Socratic mode (see Section 5.2). The chat UI also changes:

- Bot starts with: "What do you already know about cardiac output?"
- After student responds, bot guides with questions
- After 3 exchanges, bot can offer a "hint"
- "Reveal answer" button appears after 5 exchanges (emergency escape)
- Session logged as `quiz_mode: "socratic"` for analytics

---

## 10. F-13-H: Study Notes

Simple sticky note system pinned to chapters:

```
POST /api/v1/college/:cid/student/library/:docId/chapters/:chapterIdx/notes
Body: { content: String, source_page: Number, pinned_ai_response: String }

GET  /api/v1/college/:cid/student/library/:docId/chapters/:chapterIdx/notes
Response: { notes[] }

DELETE /api/v1/college/:cid/student/library/:docId/chapters/:chapterIdx/notes/:noteId
```

**"Save this response" button** appears below every AI chat message. One click saves the AI response as a pinned note on the current chapter.

**Export notes** — `GET /student/library/:docId/chapters/:chapterIdx/notes/export` — returns a PDF with all notes for that chapter, formatted as a study sheet.

---

## 11. API Route Map

All student routes require `role: student` JWT + dept scope. All admin routes require `role: dept_admin`.

```
# Chapter map
GET    /api/v1/college/:cid/student/library/:docId/chapters
POST   /api/v1/college/:cid/admin/documents/:docId/extract-chapters    (trigger/re-trigger)
PATCH  /api/v1/college/:cid/admin/documents/:docId/chapters/:idx       (manual edit)

# Chapter chat
POST   /api/v1/college/:cid/student/library/:docId/chapters/:idx/chat/session
POST   /api/v1/college/:cid/student/library/:docId/chapters/:idx/chat/:sessionId/message  (SSE)
PATCH  /api/v1/college/:cid/student/library/:docId/chapters/:idx/chat/:sessionId/mode
       Body: { mode: "answer" | "socratic" }

# PYQs
GET    /api/v1/college/:cid/student/library/:docId/chapters/:idx/pyq
       Response: { questions[], years_covered, total_count }
POST   /api/v1/college/:cid/admin/pyq/upload                           (multipart, with year/exam metadata)
POST   /api/v1/college/:cid/admin/pyq/:pyqPaperId/remap                (trigger chapter re-mapping)

# Quiz
POST   /api/v1/college/:cid/student/library/:docId/chapters/:idx/quiz  (generate)
GET    /api/v1/college/:cid/student/quiz-sessions/:sessionId
POST   /api/v1/college/:cid/student/quiz-sessions/:sessionId/answer    (submit single answer — practice mode)
POST   /api/v1/college/:cid/student/quiz-sessions/:sessionId/submit    (submit all — test mode)
GET    /api/v1/college/:cid/student/quiz-sessions/:sessionId/results
GET    /api/v1/college/:cid/student/quiz-history?docId=&chapterIdx=

# Study notes
GET    /api/v1/college/:cid/student/library/:docId/chapters/:idx/notes
POST   /api/v1/college/:cid/student/library/:docId/chapters/:idx/notes
DELETE /api/v1/college/:cid/student/library/:docId/chapters/:idx/notes/:noteId
GET    /api/v1/college/:cid/student/library/:docId/chapters/:idx/notes/export (PDF download)
```

---

## 12. Frontend Component Tree

```
apps/student/app/library/[docId]/
├── study/
│   └── page.tsx                         # Book Study Workspace (full-screen)

apps/student/components/library/study/
├── BookStudyWorkspace.tsx               # Three-panel layout
├── panels/
│   ├── ChapterListPanel.tsx             # Left: chapter list + PYQ badges
│   ├── ContentPanel.tsx                 # Center: tab switcher (Chat / Read / Summary)
│   └── ToolsPanel.tsx                   # Right: Quiz settings, PYQ Radar, Notes
├── chapter/
│   ├── ChapterList.tsx                  # Scrollable chapter rows
│   ├── ChapterRow.tsx                   # Single chapter row with PYQ badge + actions
│   ├── ChapterHeader.tsx                # "Chapter 12 · Pg 210–240 · 47 chunks"
│   └── ChapterPyqModal.tsx              # Past year questions for selected chapter
├── chat/
│   ├── ChapterChat.tsx                  # SSE chat UI (reuses existing chat components)
│   ├── SocraticToggle.tsx               # Mode switcher
│   └── SaveResponseButton.tsx           # "Save this answer to notes"
├── quiz/
│   ├── QuizConfigForm.tsx               # Type / difficulty / count / timed settings
│   ├── QuizRunner.tsx                   # Interactive quiz UI
│   ├── QuizQuestion.tsx                 # Single question with options
│   ├── QuizResults.tsx                  # Score + readiness + recommendations
│   └── QuizHistory.tsx                  # Past quiz sessions for this chapter
├── pyq/
│   ├── PyqRadar.tsx                     # Coverage bar + year badges
│   ├── PyqQuestionList.tsx              # Actual past questions list
│   └── PyqQuestion.tsx                  # Single PYQ with "get answer" / "add to quiz"
└── notes/
    ├── StudyNotes.tsx                   # Notes sidebar
    ├── NoteCard.tsx                     # Individual note with pin/delete
    └── NoteExportButton.tsx             # Download as PDF
```

---

## 13. Python Worker Additions

### New job types added to `worker.py`

```python
# services/ingestion-worker/worker.py — additions

JOB_HANDLERS = {
    # ... existing handlers ...
    "extract_chapters": handle_extract_chapters,      # F-13-A
    "ingest_pyq": handle_ingest_pyq_paper,           # F-13-E
    "map_pyq_to_chapters": handle_map_pyq_to_chapters # F-13-E (triggered after pyq ingest)
}
```

### New files

```
services/ingestion-worker/jobs/
├── extract_chapters.py          # Chapter extraction from PDF bookmarks or heuristic
└── ingest_pyq.py                # PYQ paper ingestion + question extraction + chapter mapping
```

### New Python dependencies

```
# Addition to requirements.txt
openai>=1.30.0                   # already present — used for question extraction via Claude
PyPDF2==3.0.1                    # already present from F-11-E — reused for page extraction
```

No new Python dependencies needed — the existing stack covers everything.

---

## 14. Environment Variables

```bash
# Addition to services/api/.env

# Quiz generation model (Sonnet for richer question quality)
QUIZ_GENERATION_MODEL=claude-sonnet-4-6
QUIZ_MAX_TOKENS=4096

# Chapter extraction
CHAPTER_EXTRACTION_MIN_CHAPTERS=3         # if heuristic finds fewer, mark as low confidence
CHAPTER_HEURISTIC_SCAN_PAGES=600         # how many pages to scan for headings

# PYQ analysis
PYQ_CHAPTER_MAPPING_THRESHOLD=0.72       # minimum cosine similarity for PYQ→chapter match
PYQ_NAMESPACE_SUFFIX=_pyq                # appended to dept namespace for PYQ vectors

# Socratic mode
SOCRATIC_HINT_AFTER_EXCHANGES=3          # exchanges before bot can give a hint
SOCRATIC_REVEAL_AFTER_EXCHANGES=5        # exchanges before "reveal answer" button appears
```

---

## 15. Build Order

Add as **Phase 11 — Book Intelligence System** in main architecture doc:

```
Phase 11 — Book Intelligence System

Step 1 — Database setup
  → Add has_chapter_map (Boolean) and chapter_count (Number) to documents collection
  → Create chapter_maps collection + indexes
  → Create pyq_papers collection + indexes
  → Create pyq_questions collection + indexes
  → Create quiz_sessions collection + indexes
  → Create student_notes collection + indexes
  → Add _pyq suffix namespace support in Pinecone (no schema change needed — namespace string)

Step 2 — Chapter extraction pipeline
  → services/ingestion-worker/jobs/extract_chapters.py
  → Integrate: add "extract_chapters" job enqueue at end of existing ingestion pipeline
  → Fastify route: GET /student/library/:docId/chapters (read chapter_maps)
  → Fastify route: POST /admin/documents/:docId/extract-chapters (trigger/re-trigger)
  → Test: upload Guyton PDF → verify chapter map created with 48 chapters

Step 3 — Chapter Navigator UI
  → apps/student/components/library/study/ChapterListPanel.tsx
  → apps/student/components/library/study/ChapterRow.tsx (with PYQ badge)
  → apps/student/app/library/[docId]/study/page.tsx (full workspace layout)
  → Update DocumentCard.tsx: add "Study ▼" dropdown + chapter count badge

Step 4 — Chapter-scoped chat
  → rag.service.ts: add queryChapterScoped() function
  → Add page_num range metadata filter to Pinecone query
  → Add findChapterWithAnswer() cross-reference function
  → Fastify routes: chapter chat session + message (SSE)
  → ChapterChat.tsx with SocraticToggle
  → Test: select Chapter 12 in Guyton → ask about cardiac output → verify answer cites pages 210–240 only

Step 5 — Smart quiz engine
  → generateQuiz() server function + quiz session CRUD
  → QuizConfigForm.tsx + QuizRunner.tsx + QuizResults.tsx
  → Test: generate 10 MCQs on Chapter 12 → verify all questions cite pages within range
  → Test: submit answers → verify score computed correctly

Step 6 — PYQ intelligence system
  → Admin upload form addition: PYQ document type + year/exam fields
  → services/ingestion-worker/jobs/ingest_pyq.py (question extraction + embedding + mapping)
  → Fastify routes: PYQ upload (admin) + PYQ list (student)
  → PyqRadar.tsx + PyqQuestionList.tsx
  → Test: upload VTU 2023 question paper → verify questions extracted → verify chapter mapping runs

Step 7 — Exam readiness score
  → computeExamReadiness() post-quiz computation
  → QuizResults.tsx: add readiness panel + PYQ would-pass estimate + weak topics
  → recommendation generation (Claude Haiku, async, non-blocking)

Step 8 — Study notes
  → student_notes API routes (CRUD)
  → SaveResponseButton.tsx in chat + StudyNotes.tsx panel
  → Note export endpoint (returns plain text; PDF export using existing PDF skill in Phase 9)

Step 9 — Polish + analytics
  → Chapter mastery progress bar on DocumentCard (based on quiz_sessions)
  → Dept Admin view: class-level chapter heatmap ("38% of students have studied Ch 12")
  → Cost metering hooks for quiz generation (Sonnet usage → cost_events)

Step 10 — Testing checklist
  → Upload Guyton PDF → verify 48 chapters detected via PDF bookmarks
  → Upload scanned/plain PDF → verify heuristic fallback runs with confidence < 0.90
  → Select chapter → ask question from DIFFERENT chapter → verify "not in this chapter" response + suggestion
  → Generate MCQ quiz, 10 questions → verify JSON parse succeeds + all questions cite correct page range
  → Upload VTU 2023 PYQ paper → verify questions extracted → wait for chapter mapping → check chapter 12 shows PYQ count
  → Complete a quiz → verify exam readiness panel shows PYQ estimate
  → Enable Socratic mode → ask a question → verify AI responds with a guiding question, not a direct answer
  → Save a note → verify it persists on page reload
  → Cost events: verify quiz generation creates cost_event with model=claude-sonnet-4-6
```

---

*Document: F-13-book-intelligence-system.md · v1.0 · May 2026 · Extends F-11-student-document-library.md v1.1*  
*For Claude Code: this is Phase 11. Start with Step 2 (chapter extraction) — without it, no other feature works. The PYQ system (Steps 6–7) depends on Step 5 (quiz) being complete first.*
