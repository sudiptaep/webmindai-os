# F-14: Learning Intelligence Layer
## Spaced Repetition · Clinical Cases · Disease-Based Query · Year Navigation

> **Parent docs:** `college-chatbot-architecture.md` v2.0 · `F-13-book-intelligence-system.md` v1.0  
> **Motivation:** Four features identified from Medsy.ai competitive analysis — each closes a gap where Medsy currently wins, while leveraging your core structural advantage (college-owned content) that Medsy structurally cannot replicate.  
> **Competitive context:** Medsy.ai (Chennai) has spaced repetition, clinical cases, disease-based learning, and year-wise navigation. You have none of these four. This document closes all four gaps while making each one *better* than Medsy's version because yours is grounded in the college's own uploaded textbooks.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [The Four Features — Why Each One Matters](#1-the-four-features--why-each-one-matters)
2. [Database Schema — New Collections & Field Additions](#2-database-schema--new-collections--field-additions)
3. [F-14-A: Spaced Repetition System (SRS)](#3-f-14-a-spaced-repetition-system-srs)
4. [F-14-B: Clinical Case Scenario Engine](#4-f-14-b-clinical-case-scenario-engine)
5. [F-14-C: Disease-Based Cross-Subject Query](#5-f-14-c-disease-based-cross-subject-query)
6. [F-14-D: Year-Wise Student Navigation](#6-f-14-d-year-wise-student-navigation)
7. [How the Four Features Connect](#7-how-the-four-features-connect)
8. [API Route Map](#8-api-route-map)
9. [Frontend Component Tree](#9-frontend-component-tree)
10. [Cost & LLM Impact Analysis](#10-cost--llm-impact-analysis)
11. [Environment Variables](#11-environment-variables)
12. [Build Order](#12-build-order)

---

## 1. The Four Features — Why Each One Matters

### The Ebbinghaus problem (SRS)

Without spaced repetition, a student who correctly answers a quiz question on Monday forgets 70% of it by Wednesday. Herman Ebbinghaus proved this in 1885 and every subsequent study confirms it. Medsy built SRS because it is one of the few study tools with rock-solid scientific backing for retention improvement.

Your SRS is better than Medsy's because every review card is answered through the AI chat — grounded in the specific page of the specific textbook the college uploaded. Medsy's review card prompts a generic Medsy answer. Yours prompts: "Explain cardiac output — Guyton Chapter 12, Page 214."

### The clinical reasoning problem (Clinical Cases)

MBBS students are terrified of clinical-style questions because they appear most heavily in NEET PG and in university final exams. A student can memorise the definition of Myocardial Infarction from Guyton and still fail a case question because it requires applying the knowledge to a patient presentation.

Your clinical case generator is better than Medsy's because cases are generated FROM the college's uploaded textbook chapters — not from generic medical knowledge. When the faculty uploads Harrison's Principles of Internal Medicine Chapter 35, the case questions cite Harrison Ch.35 Pg.612. Medsy cannot do this.

### The silo problem (Disease-Based Query)

Medical knowledge is inherently cross-subject. Myocardial Infarction lives in Pathology (histology of infarct), Pharmacology (antiplatelet drugs, thrombolytics), Biochemistry (cardiac enzymes, troponin), and Medicine (clinical management). Students need to see it all together, but uploaded materials live in different subjects.

Your disease query is better than Medsy's because it searches across your college's actual uploaded materials — not generic curated content. When a student asks about "Myocardial Infarction," you retrieve from Robbins Pathology (uploaded by the Pathology dept), Katzung Pharmacology (uploaded by Pharmacology dept), and Harrison (uploaded by Medicine dept), all simultaneously, and compile a cross-subject answer citing exact pages from each book.

### The navigation problem (Year-Wise View)

Students think in years ("I'm in Year 2") not departments ("I'm in the Physiology department"). Medsy's primary navigation matches how students actually think. Your current navigation is department-first, which is logical for faculty but feels unnatural to a student who just wants "everything I need to study this semester."

Your year navigation is better than Medsy's because "Year 2 Materials" means YOUR college's Year 2 materials — the exact books assigned by YOUR faculty for YOUR semester. Medsy's Year 2 is a curated generic curriculum. Yours is personalised to the student's actual college.

---

## 2. Database Schema — New Collections & Field Additions

### 2.1 New collection: `srs_cards` (per-college DB)

This is the core SRS data store. Each card represents one quiz question that a student has answered at least once and is now in the review cycle.

```js
{
  _id: UUID,                             // srs_card_id

  // Attribution
  student_id: UUID,
  college_id: UUID,
  dept_id: UUID,
  doc_id: UUID,                          // which textbook this card is from
  chapter_index: Number,                 // which chapter (from chapter_maps)
  subject_id: UUID,

  // Question (copied from quiz_sessions at first correct answer)
  question_text: String,
  question_type: Enum["MCQ","TF","SAQ","CASE","FILL"],
  options: [String],                     // MCQ options — empty for SAQ/CASE
  correct_answer: String,
  explanation: String,                   // AI-generated explanation
  source_page: Number,                   // page in the textbook
  bloom_level: String,                   // "remember" | "understand" | "apply" | "analyse"

  // SRS state (SM-2 algorithm fields)
  ease_factor: Number,                   // default 2.5 — how "easy" this card is (1.3–3.0)
  interval_days: Number,                 // current interval before next review
  repetition_count: Number,              // how many times reviewed successfully in a row
  last_quality: Number,                  // 0–5 quality of last response (0=blackout, 5=perfect)

  // Scheduling
  next_review_at: Date,                  // when to show this card next
  first_seen_at: Date,                   // when the question was first answered correctly
  last_reviewed_at: Date,

  // Lifecycle
  status: Enum["active","suspended","graduated"],
  // active = in review cycle
  // suspended = student manually paused it
  // graduated = interval > 180 days (long-term memory assumed)

  created_at: Date,
  updated_at: Date
}

// Indexes — critical for performance
db.srs_cards.createIndex({ student_id: 1, next_review_at: 1, status: 1 });
db.srs_cards.createIndex({ student_id: 1, doc_id: 1, chapter_index: 1 });
db.srs_cards.createIndex({ college_id: 1, dept_id: 1, next_review_at: 1 });
// Compound for "due today" query
db.srs_cards.createIndex({
  student_id: 1,
  status: 1,
  next_review_at: 1
});
```

### 2.2 New collection: `srs_review_logs` (per-college DB)

Append-only log of every SRS review event. Used for analytics and NEET PG readiness tracking.

```js
{
  _id: UUID,
  srs_card_id: UUID,
  student_id: UUID,
  college_id: UUID,

  // Review outcome
  quality: Number,                       // 0–5 (see SM-2 below)
  student_answer: String,
  was_correct: Boolean,
  time_taken_seconds: Number,

  // State before this review
  interval_before: Number,
  ease_before: Number,

  // State after this review (computed by SM-2)
  interval_after: Number,
  ease_after: Number,
  next_review_at: Date,

  reviewed_at: Date
}

db.srs_review_logs.createIndex({ student_id: 1, reviewed_at: -1 });
db.srs_review_logs.createIndex({ srs_card_id: 1, reviewed_at: -1 });
```

### 2.3 New collection: `clinical_cases` (per-college DB, cached)

Generated clinical cases are cached here — not regenerated on every request. Cases are expensive (Claude Sonnet) so we cache and serve cached versions first.

```js
{
  _id: UUID,
  college_id: UUID,
  dept_id: UUID,
  doc_id: UUID,
  chapter_index: Number,
  subject_id: UUID,

  // Case content
  case_text: String,                     // "A 42-year-old male presents with..."
  question: String,                      // "What is the most likely diagnosis?"
  question_type: Enum["diagnosis","management","investigation","mechanism","complication"],
  difficulty: Enum["recall","application","analysis"],
  expected_answer: String,               // model answer with page citation
  key_teaching_points: [String],         // 3–5 bullet points
  source_pages: [Number],                // pages in the textbook used for generation
  bloom_level: String,                   // "apply" | "analyse"

  // Cache management
  generated_from_chunk_ids: [String],    // Pinecone chunk IDs used for generation
  cache_version: Number,                 // increment when chapters are re-ingested
  times_served: Number,                  // analytics

  created_at: Date,
  expires_at: Date                       // null = no expiry; set when chapter is re-ingested
}

db.clinical_cases.createIndex({ doc_id: 1, chapter_index: 1, difficulty: 1 });
db.clinical_cases.createIndex({ dept_id: 1, subject_id: 1, question_type: 1 });
```

### 2.4 New collection: `disease_queries` (per-college DB, cached)

Cross-subject disease query results are cached here — expensive multi-namespace Pinecone queries should not repeat for the same disease + college.

```js
{
  _id: UUID,
  college_id: UUID,
  dept_id_scope: String,                 // "all" or specific dept_id
  disease_name: String,                  // normalised disease name: "myocardial_infarction"
  disease_aliases: [String],             // ["MI", "heart attack", "AMI"]

  // Cross-subject results
  subject_results: [
    {
      subject_id: UUID,
      subject_name: String,
      doc_id: UUID,
      doc_filename: String,
      relevant_chunks: [
        {
          chunk_id: String,
          text: String,
          page_num: Number,
          chapter_title: String,
          relevance_score: Number
        }
      ],
      summary: String,                   // AI-generated 2-3 sentence summary for this subject
    }
  ],

  // AI-compiled answer
  compiled_answer: String,              // cross-subject narrative answer
  cross_connections: [String],          // e.g. "Pathology infarct → Pharmacology thrombolytics"

  // Cache management
  cache_key: String,                    // MD5(college_id + disease_name)
  created_at: Date,
  expires_at: Date                      // 24h TTL — re-query if stale
}

db.disease_queries.createIndex({ college_id: 1, disease_name: 1 });
db.disease_queries.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
```

### 2.5 Field additions to existing `students` collection

```js
// Add to students collection (migration)
{
  // ... all existing fields ...

  // SRS
  srs_cards_due_today: Number,           // denormalised count — updated nightly
  srs_streak_days: Number,               // consecutive days with at least 1 review done
  srs_last_review_date: Date,            // date of last SRS session (for streak tracking)
  srs_total_cards: Number,               // total active SRS cards

  // Year navigation
  current_year: Number,                  // 1, 2, 3, or 4 (MBBS) — set at registration
  current_semester: Number,              // 1–8 — set at registration, updatable

  // Learning preferences (updated from settings)
  daily_srs_target: Number,              // default 20 — how many cards to review per day
  preferred_question_type: String,       // "MCQ" | "SAQ" | "CASE" | "MIXED"
}
```

### 2.6 Field additions to existing `subjects` collection

```js
// Add to subjects collection (migration)
{
  // ... all existing fields ...
  mbbs_year: Number,                     // 1, 2, 3, or 4 — for year navigation
  mbbs_semester: Number,                 // 1–8 — for year navigation
  disease_tags: [String],               // e.g. ["myocardial_infarction", "hypertension"]
                                         // populated by admin or auto-extracted on ingestion
}
```

---

## 3. F-14-A: Spaced Repetition System (SRS)

### 3.1 The SM-2 algorithm

EduMind uses SM-2 (SuperMemo 2) — the same algorithm behind Anki, the most scientifically validated flashcard app in existence. The algorithm is simple, battle-tested, and free to implement.

**Quality score mapping:**
```
5 = Perfect response — immediate correct recall
4 = Correct response after brief hesitation
3 = Correct but with difficulty (considered a "pass")
2 = Incorrect — answer was correct but could be recalled
1 = Incorrect — wrong answer, but recalled correct on review
0 = Complete blackout — no memory of this at all
```

For MCQ/TF quiz responses, quality maps automatically:
```
Correct on first attempt, answered in < 15s   → quality 5
Correct on first attempt, answered in 15–45s  → quality 4
Correct after one hint or >45s                → quality 3
Incorrect answer                              → quality 1
```

For SAQ/CASE, student rates themselves after seeing the model answer:
```
"Got it perfectly"   → quality 5
"Got the key idea"   → quality 4
"Partially correct"  → quality 3
"Mostly wrong"       → quality 1
"Had no idea"        → quality 0
```

**SM-2 interval calculation:**
```javascript
function calculateNextInterval(card, quality) {
  let { ease_factor, interval_days, repetition_count } = card;

  if (quality < 3) {
    // Failed — reset to beginning
    repetition_count = 0;
    interval_days = 1;
  } else {
    // Passed — advance interval
    if (repetition_count === 0) {
      interval_days = 1;
    } else if (repetition_count === 1) {
      interval_days = 3;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    repetition_count += 1;
  }

  // Update ease factor (clamp between 1.3 and 3.0)
  ease_factor = Math.max(1.3,
    ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  );

  const next_review_at = new Date();
  next_review_at.setDate(next_review_at.getDate() + interval_days);

  return { interval_days, ease_factor, repetition_count, next_review_at };
}
```

**Standard interval progression for a perfect learner:**
```
Day 0:  Card first answered correctly (added to SRS)
Day 1:  First review (interval = 1 day)
Day 3:  Second review (interval = 3 days if correct)
Day 10: Third review  (interval ≈ 7 days)
Day 24: Fourth review (interval ≈ 14 days)
Day 55: Fifth review  (interval ≈ 30 days)
Day 122: Sixth review (interval ≈ 66 days)
Day 300: Card graduates (interval > 180 days → long-term memory)
```

### 3.2 When cards are created

SRS cards are created from two sources:

**Source 1: Quiz completion (F-13-D)**

When a student completes a quiz session, every question they answered CORRECTLY gets added as an SRS card (if not already in their SRS deck for that question):

```javascript
async function addCorrectAnswersToSRS(sessionId, studentId, collegeId) {
  const session = await getQuizSession(sessionId, collegeId);
  const correctQuestions = session.questions.filter(q =>
    q.is_correct === true && q.bloom_level !== "remember" // skip pure recall — focus on application+
  );

  const chapter = await getChapter(session.doc_id, session.chapter_index, collegeId);

  const cardsToInsert = [];
  for (const q of correctQuestions) {
    // Check not already in SRS deck
    const existing = await srsCards.findOne({
      student_id: studentId,
      question_text: q.question_text,    // dedupe by question text
      college_id: collegeId
    });
    if (existing) continue;

    cardsToInsert.push({
      _id: generateUUID(),
      student_id: studentId,
      college_id: collegeId,
      dept_id: session.dept_id,
      doc_id: session.doc_id,
      chapter_index: session.chapter_index,
      subject_id: session.subject_id,
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      source_page: q.source_page,
      bloom_level: q.bloom_level,
      ease_factor: 2.5,
      interval_days: 1,
      repetition_count: 0,
      last_quality: 5,
      next_review_at: getTomorrow(),     // review tomorrow
      first_seen_at: new Date(),
      last_reviewed_at: new Date(),
      status: "active",
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  if (cardsToInsert.length > 0) {
    await srsCardsCollection(collegeId).insertMany(cardsToInsert);
    // Update student's srs_total_cards count
    await updateStudentSRSCount(studentId, collegeId, cardsToInsert.length);
  }

  return cardsToInsert.length;
}
```

**Source 2: Manual add from chapter chat**

Any AI response in chapter chat has an "Add to review deck" button (📌). Clicking it:
1. Creates a question-answer pair from the chat exchange
2. Formats it as an SAQ card
3. Sets `next_review_at = tomorrow`

### 3.3 The daily review session

**Entry point:** Student dashboard homepage shows a prominent card:

```
┌──────────────────────────────────────────────────┐
│ 🔄 Daily Review                  [Start Review]  │
│                                                  │
│  23 cards due today                              │
│  ████████████░░░░░ 14 done                       │
│  Streak: 🔥 7 days                               │
│                                                  │
│  Today's sources:                                │
│  Guyton Ch.12 (8 cards) · Robbins Ch.4 (9 cards)│
│  Katzung Ch.16 (6 cards)                         │
└──────────────────────────────────────────────────┘
```

**Review session flow:**

```
1. GET /srs/due-today
   → Query: { student_id, status: "active", next_review_at: { $lte: now() } }
   → Sort by next_review_at ASC (most overdue first)
   → Limit to student.daily_srs_target (default 20)
   → Return shuffled cards (prevent order memorisation)

2. For each card:
   a. Display question (same UI as quiz — MCQ, TF, SAQ, or CASE)
   b. For MCQ/TF: auto-detect correct/incorrect → assign quality score
   c. For SAQ/CASE: show model answer after student submits text
      → Student self-rates: "Got it perfectly / Key idea / Partially / Wrong"
      → Maps to quality 5 / 4 / 3 / 1

3. After each answer:
   → Run SM-2 algorithm → compute next_review_at
   → Write to srs_review_logs
   → Update srs_cards (interval, ease_factor, next_review_at)
   → Show brief feedback: "Next review: in 14 days"

4. Session complete:
   → Show: cards reviewed, correct %, new intervals
   → Update student.srs_streak_days (if today not already counted)
   → Update student.srs_last_review_date
```

### 3.4 SRS review card UI

```
┌──────────────────────────────────────────────────────────────────┐
│ 🔄 Daily Review     Card 8 of 20     [Suspend card] [Exit]      │
│ 📖 Guyton Ch.12 · Page 214                                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Cardiac output equals the product of two variables.            │
│  What are they, and what is the normal resting value?           │
│  (Application level)                                            │
│                                                                  │
│  ○ A) Preload × Afterload = 5 L/min                            │
│  ● B) Stroke Volume × Heart Rate = 5 L/min       ← selected   │
│  ○ C) Blood pressure × Resistance = 5 L/min                   │
│  ○ D) Ejection fraction × EDV = 4 L/min                       │
│                                                                  │
│                        [Submit Answer]                          │
│                                                                  │
│ ── After submit ──────────────────────────────────────────────  │
│ ✅ Correct!                                                      │
│ CO = SV × HR. Normal at rest: ~5 L/min.                        │
│ — Guyton Chapter 12, Page 214                                   │
│                                                                  │
│ Next review: in 14 days (Jul 3)       Ease: 2.6 ↑             │
│                                        [Next Card →]            │
└──────────────────────────────────────────────────────────────────┘
```

For SAQ/CASE — after student submits their text answer, model answer is shown, then self-rating buttons:

```
┌──────────────────────────────────────────────────┐
│ How well did you recall this?                    │
│                                                  │
│ [Perfect] [Key idea] [Partly] [Wrong] [Blank]   │
│    (5)       (4)       (3)     (1)     (0)       │
└──────────────────────────────────────────────────┘
```

### 3.5 Streak and gamification

```javascript
// Called after every completed review session
async function updateSRSStreak(studentId, collegeId) {
  const student = await getStudent(studentId, collegeId);
  const today = getDateString();                          // "2026-05-20"
  const yesterday = getYesterdayString();

  if (student.srs_last_review_date === today) {
    return;                                              // already counted today
  }

  let newStreak = student.srs_streak_days;
  if (student.srs_last_review_date === yesterday) {
    newStreak += 1;                                      // maintained streak
  } else {
    newStreak = 1;                                       // streak broken — reset to 1
  }

  await studentsCollection.updateOne({ _id: studentId }, {
    $set: {
      srs_streak_days: newStreak,
      srs_last_review_date: today
    }
  });

  // Milestone notifications
  const milestones = [3, 7, 14, 30, 60, 100];
  if (milestones.includes(newStreak)) {
    await createNotification(studentId, {
      type: "streak_milestone",
      message: `🔥 ${newStreak}-day streak! Keep going.`
    });
  }
}
```

### 3.6 Nightly SRS maintenance job

```javascript
// Runs at midnight IST
async function nightlySRSMaintenance() {
  // 1. Update srs_cards_due_today count for all active students
  const tomorrow = getTomorrow();
  const colleges = await platformDb.colleges.find({ status: "active" }).toArray();

  for (const college of colleges) {
    const students = await collegeDb(college._id).students.find({ status: "active" }).toArray();
    for (const student of students) {
      const dueCount = await collegeDb(college._id).srs_cards.countDocuments({
        student_id: student._id,
        status: "active",
        next_review_at: { $lte: tomorrow }
      });
      await collegeDb(college._id).students.updateOne(
        { _id: student._id },
        { $set: { srs_cards_due_today: dueCount } }
      );
    }
  }

  // 2. Graduate cards with interval > 180 days
  await collegeDb(college._id).srs_cards.updateMany(
    { status: "active", interval_days: { $gte: 180 } },
    { $set: { status: "graduated" } }
  );
}
```

---

## 4. F-14-B: Clinical Case Scenario Engine

### 4.1 What a clinical case is (and why it's different from a standard quiz question)

A clinical case question has a specific structure:
1. **Patient presentation** — age, gender, symptoms, duration, relevant history
2. **Clinical findings** — vitals, examination findings, relevant negatives
3. **Investigation results** — labs, imaging, ECG findings (optional)
4. **The question** — diagnosis / next investigation / management / mechanism / complication

The critical difference: the student must **reason from evidence** rather than recall a definition. This is what NEET PG tests. Medsy's clinical case module is their most cited differentiator in student testimonials ("Clinical case integration helped me connect theory to practice").

### 4.2 Case generation pipeline

Cases are generated from existing chapter chunks — no new ingestion needed. The case generator is Claude Sonnet with a specialised medical case prompt.

**Endpoint:** `POST /student/library/:docId/chapters/:chapterIdx/cases/generate`

```javascript
async function generateClinicalCase(params) {
  const { docId, chapterIdx, question_type, difficulty, collegeId, deptId } = params;

  // 1. Check cache first (same chapter + type + difficulty)
  const cached = await clinicalCasesCollection(collegeId).findOne({
    doc_id: docId,
    chapter_index: chapterIdx,
    question_type,
    difficulty,
    expires_at: { $gt: new Date() }
  });
  if (cached && cached.times_served < 10) {
    // Serve cached version (with times_served increment)
    await clinicalCasesCollection(collegeId).updateOne(
      { _id: cached._id },
      { $inc: { times_served: 1 } }
    );
    return formatCaseForStudent(cached);
  }

  // 2. Retrieve chapter content from Pinecone
  const chapterMap = await getChapterMap(docId, collegeId);
  const chapter = chapterMap.chapters.find(c => c.chapter_index === chapterIdx);
  const chunks = await getChapterChunks(chapter, docId, collegeId, deptId, 15);
  const contextText = chunks.map(c => c.metadata.text).join("\n\n").slice(0, 40000);

  // 3. Build case generation prompt
  const caseTypePrompts = {
    diagnosis: `Create a case where the student must identify the most likely diagnosis.
      Include 2–3 classic features that point to the diagnosis from the textbook content.
      Include 1–2 "distractors" (conditions that might seem similar but can be excluded).`,
    management: `Create a case where the patient has already been diagnosed.
      The question should focus on immediate management or next best step.
      Include relevant vitals/labs that guide management decision.`,
    investigation: `Create a case where the student must choose the most appropriate investigation.
      Include clinical context that makes the investigation choice non-obvious.`,
    mechanism: `Create a case that requires understanding the pathophysiological mechanism.
      The question should start with clinical presentation and ask WHY it occurs.`,
    complication: `Create a case where a patient on treatment develops a new finding.
      The student must identify the complication and connect it to the mechanism.`
  };

  const difficultyPrompts = {
    recall: "Use classic, textbook-perfect presentations. Avoid unusual features.",
    application: "Use slightly atypical presentations requiring application of principles.",
    analysis: "Include multiple possible diagnoses, subtle clues, and require reasoning through differentials."
  };

  const systemPrompt = `You are a medical case writer creating exam questions for MBBS students.
Generate cases STRICTLY from the provided textbook content — every clinical feature, lab value, and management step must be defensible from the source material.
Respond ONLY with a valid JSON object. No markdown, no preamble.
Schema:
{
  "case_text": "Detailed patient presentation (3–5 sentences)",
  "question": "Single clear question",
  "question_type": "${question_type}",
  "difficulty": "${difficulty}",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correct_answer": "A",
  "expected_answer": "Full explanation with source citation",
  "key_teaching_points": ["point 1", "point 2", "point 3"],
  "source_pages": [214, 215],
  "bloom_level": "apply"
}`;

  const userPrompt = `${caseTypePrompts[question_type]}
${difficultyPrompts[difficulty]}
Chapter: ${chapter.chapter_index} — "${chapter.title}" (pages ${chapter.start_page}–${chapter.end_page})
Document: ${await getDocFilename(docId, collegeId)}

Textbook content:
${contextText}`;

  const response = await anthropic.messages.create({
    model: process.env.CASE_GENERATION_MODEL,   // claude-sonnet-4-6
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt
  });

  const rawCase = JSON.parse(response.content[0].text.trim());

  // 4. Store in cache with 7-day expiry
  const caseRecord = {
    _id: generateUUID(),
    college_id: collegeId,
    dept_id: deptId,
    doc_id: docId,
    chapter_index: chapterIdx,
    subject_id: chapter.subject_id,
    ...rawCase,
    generated_from_chunk_ids: chunks.map(c => c.id),
    cache_version: 1,
    times_served: 1,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000)   // 7 days
  };
  await clinicalCasesCollection(collegeId).insertOne(caseRecord);

  return formatCaseForStudent(caseRecord);
}
```

### 4.3 Case type selector UI

Accessed from the Chapter Navigator tools panel (right panel, F-13 Book Study Workspace):

```
CLINICAL CASES
──────────────────────────────────────────
Case type:   [Diagnosis ▼]
             Diagnosis
             Management
             Investigation
             Mechanism
             Complication

Difficulty:  [Application ▼]
             Recall
             Application ← default
             Analysis (NEET PG style)

             [Generate Case]
──────────────────────────────────────────
```

### 4.4 Case display UI

```
┌──────────────────────────────────────────────────────────────────┐
│ 🏥 Clinical Case — Ch 12: The Heart           [Add to SRS] [💬] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ A 58-year-old male presents to the emergency department with     │
│ sudden onset crushing chest pain radiating to the left arm for  │
│ 3 hours. He has a history of hypertension and type 2 diabetes.  │
│ On examination: BP 150/95 mmHg, HR 95 bpm, diaphoresis present. │
│ ECG shows ST elevation in leads II, III, and aVF.               │
│                                                                  │
│ What is the most likely diagnosis?                               │
│                                                                  │
│ ○ A) Stable angina pectoris                                     │
│ ○ B) Inferior wall STEMI            ← correct                  │
│ ○ C) Aortic dissection                                         │
│ ○ D) Pulmonary embolism                                        │
│                                                                  │
│                    [Submit Answer]                               │
│                                                                  │
│ ── After submit ────────────────────────────────────────────── │
│ ✅ Correct — Inferior wall STEMI                               │
│                                                                  │
│ Key teaching points:                                            │
│ • ST elevation in II, III, aVF = inferior wall (RCA territory) │
│ • Crushing pain + radiation + diaphoresis = classic ACS        │
│ • Diabetes can mask typical symptoms (silent MI risk)          │
│                                                                  │
│ — Harrison's Principles, Chapter 35, Pages 612–614            │
│                                                                  │
│ [Add to daily review] [Ask AI about this case] [New case →]    │
└──────────────────────────────────────────────────────────────────┘
```

The `[💬]` button opens chapter-scoped chat pre-filled with the case context — student can ask "Explain the ST elevation in inferior leads" and get an answer from the exact chapter pages.

### 4.5 Clinical cases in the SRS loop

When a student adds a clinical case to daily review via `[Add to daily review]`, it becomes an SRS card of type CASE. The case text is the question; the answer is the expected_answer. Self-rating is used (quality 0–5) since case answers are open-ended.

---

## 5. F-14-C: Disease-Based Cross-Subject Query

### 5.1 The mental model

Think of it as a "Google for a disease across your college's entire uploaded curriculum." When a student types "Myocardial Infarction" in the disease search box, the system:

1. Identifies which subjects have uploaded materials (Pathology, Pharmacology, Medicine, Biochemistry)
2. Queries each subject's Pinecone namespace simultaneously for "Myocardial Infarction"
3. Retrieves the top relevant chunks from EACH subject
4. Generates a cross-subject compiled answer showing: what each subject says about this disease and how they connect

This is architecturally possible only for you — Medsy's disease-based learning is pre-authored content. Yours is live retrieval from the college's own uploaded textbooks.

### 5.2 Disease search entry points

**Entry point 1:** New "Disease Search" tab in the student navigation sidebar (alongside Chat, Library, Sessions)

**Entry point 2:** From chapter chat — when the AI detects a disease name in the student's question with no doc-scoping, it offers: "Would you like to see what all your subjects say about [Myocardial Infarction]?"

**Entry point 3:** Disease tag on subject page — each subject shows its disease tags; clicking a tag opens the disease query

### 5.3 Disease normalisation

User may type "heart attack", "MI", "myocardial infarction" — all map to the same query.

```javascript
// Pre-built disease alias map (seed from ICD-10 common conditions)
// Stored in a lightweight lookup table in the platform DB
const diseaseAliasMap = {
  "myocardial_infarction": ["heart attack", "MI", "AMI", "acute MI", "myocardial infarction",
                             "STEMI", "NSTEMI", "acute coronary syndrome"],
  "diabetes_mellitus": ["diabetes", "DM", "type 2 diabetes", "type 1 diabetes", "T2DM"],
  "hypertension": ["HTN", "high blood pressure", "HBP", "raised BP"],
  // ... 200 most common MBBS diseases pre-seeded
};

function normaliseDiseaseQuery(userInput) {
  const lower = userInput.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(diseaseAliasMap)) {
    if (aliases.some(alias => lower.includes(alias.toLowerCase()))) {
      return canonical;
    }
  }
  // If not in alias map, use the user's input as-is (normalised)
  return lower.replace(/\s+/g, "_");
}
```

### 5.4 Cross-subject query pipeline

```javascript
async function diseaseQuery(params) {
  const { userInput, collegeId, studentId } = params;
  const student = await getStudent(studentId, collegeId);

  // 1. Normalise disease name
  const diseaseCanonical = normaliseDiseaseQuery(userInput);

  // 2. Check cache (TTL 24h)
  const cacheKey = `${collegeId}_${diseaseCanonical}`;
  const cached = await diseaseQueriesCollection(collegeId).findOne({
    cache_key: cacheKey,
    expires_at: { $gt: new Date() }
  });
  if (cached) return formatDiseaseResult(cached);

  // 3. Get all subjects accessible to this student
  //    (subjects in their effective_dept_id, plus any cross-dept subjects if enabled)
  const subjects = await getStudentSubjects(studentId, collegeId);
  if (subjects.length === 0) {
    return { error: "No subjects found for your department" };
  }

  // 4. Embed the disease query once
  const queryVector = await embedText(`${userInput}: pathology, pharmacology,
    clinical features, management, mechanisms, complications`);

  // 5. Query each subject's namespace in PARALLEL
  const subjectResults = await Promise.all(subjects.map(async (subject) => {
    const namespace = `c_${collegeId}_d_${subject.dept_id}`;

    const result = await pineconeIndex.query({
      vector: queryVector,
      namespace,
      filter: {
        subject_id: { $eq: subject._id.toString() }
      },
      topK: 5,
      includeMetadata: true
    });

    // Filter to relevant results only
    const relevant = result.matches.filter(m => m.score >= 0.68);
    if (relevant.length === 0) return null;

    // Generate a 2–3 sentence subject-level summary (cheap: Haiku)
    const chunkTexts = relevant.map(m => m.metadata.text).join("\n\n");
    const summary = await quickSummarise(chunkTexts, subject.name, userInput);

    return {
      subject_id: subject._id,
      subject_name: subject.name,
      doc_id: relevant[0].metadata.doc_id,
      doc_filename: relevant[0].metadata.filename,
      relevant_chunks: relevant.map(m => ({
        chunk_id: m.id,
        text: m.metadata.text,
        page_num: m.metadata.page_num,
        chapter_title: m.metadata.chapter_title || "",
        relevance_score: m.score
      })),
      summary
    };
  }));

  // Filter out null results (subjects with no relevant content)
  const filledResults = subjectResults.filter(Boolean);

  if (filledResults.length === 0) {
    return {
      disease_name: userInput,
      message: `No content about "${userInput}" found in your uploaded materials.
        Ask your faculty to upload relevant textbooks.`
    };
  }

  // 6. Compile cross-subject answer (Claude Haiku — synthesis task)
  const crossSubjectContext = filledResults.map(r =>
    `${r.subject_name}:\n${r.relevant_chunks.map(c =>
      `[Page ${c.page_num}] ${c.text}`
    ).join("\n")}`
  ).join("\n\n---\n\n");

  const compiledAnswer = await compileDiseaseCrossSubject(
    userInput, crossSubjectContext, filledResults.map(r => r.subject_name)
  );

  // 7. Identify cross-connections (what links the subject findings)
  const crossConnections = identifyCrossConnections(filledResults, userInput);

  // 8. Cache result (24h)
  const result = {
    _id: generateUUID(),
    college_id: collegeId,
    disease_name: diseaseCanonical,
    disease_aliases: [userInput],
    subject_results: filledResults,
    compiled_answer: compiledAnswer,
    cross_connections: crossConnections,
    cache_key: cacheKey,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 24 * 3600 * 1000)
  };
  await diseaseQueriesCollection(collegeId).insertOne(result);

  return formatDiseaseResult(result);
}

async function compileDiseaseCrossSubject(disease, context, subjectNames) {
  const prompt = `Compile a structured medical summary of "${disease}" from these different subject perspectives.
Create clear sections — one per subject. Then write a "Cross-subject connections" section showing
how the subjects link (e.g., "The Pathology infarct → triggers → the Biochemistry troponin release → guides → the Pharmacology thrombolytic choice").
Keep each subject section to 3–5 sentences. Cite page numbers where available.
Only use information from the provided content.

${context}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }]
  });
  return response.content[0].text;
}

function identifyCrossConnections(subjectResults, disease) {
  // Simple heuristic: find if subjects share terminology (drug → enzyme → disease)
  const subjects = subjectResults.map(r => r.subject_name.toLowerCase());
  const connections = [];

  if (subjects.includes("pathology") && subjects.includes("pharmacology")) {
    connections.push(`Pathology (disease mechanism) → Pharmacology (drug targets the mechanism)`);
  }
  if (subjects.includes("biochemistry") && subjects.includes("medicine")) {
    connections.push(`Biochemistry (diagnostic markers) → Medicine (clinical interpretation)`);
  }
  if (subjects.includes("physiology") && subjects.includes("pathology")) {
    connections.push(`Physiology (normal function) → Pathology (what goes wrong)`);
  }
  return connections;
}
```

### 5.5 Disease query result UI

```
┌──────────────────────────────────────────────────────────────────┐
│ 🔬 Disease Search: Myocardial Infarction    [Add to notes] [💬] │
│ Found in 4 of your subjects                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ PATHOLOGY — Robbins (Ch.14, Pg.532–541)                        │
│ Myocardial infarction results from prolonged ischaemia          │
│ leading to irreversible coagulative necrosis. The left          │
│ anterior descending artery supplies the anterior wall...        │
│ [Read more] [Open chapter]                                      │
│                                                                  │
│ ──────────────────────────────────────────────────────────────  │
│                                                                  │
│ PHARMACOLOGY — Katzung (Ch.16, Pg.298–305)                     │
│ Management involves antiplatelet agents (aspirin, clopidogrel), │
│ thrombolytics (streptokinase, tPA), beta-blockers and ACE...   │
│ [Read more] [Open chapter]                                      │
│                                                                  │
│ ──────────────────────────────────────────────────────────────  │
│                                                                  │
│ BIOCHEMISTRY — Harper (Ch.11, Pg.149)                          │
│ Troponin I and T are highly specific cardiac biomarkers.        │
│ Elevated within 3–6 hours, peak at 24h, persist for 7–10 days │
│ [Read more] [Open chapter]                                      │
│                                                                  │
│ ──────────────────────────────────────────────────────────────  │
│                                                                  │
│ ↔️  Cross-subject connections                                   │
│ • Pathology (coagulative necrosis) → Biochemistry (troponin    │
│   release from necrotic cells) → Medicine (diagnostic marker)  │
│ • Pathology (platelet aggregation) → Pharmacology (antiplatelet│
│   drugs target this exact mechanism)                           │
│                                                                  │
│ [Chat about Myocardial Infarction across all subjects]          │
└──────────────────────────────────────────────────────────────────┘
```

### 5.6 "Chat about this disease" cross-subject mode

When a student clicks `[Chat about Myocardial Infarction across all subjects]`, the chat opens in **disease mode** — a special RAG configuration that queries ALL subject namespaces simultaneously:

```javascript
async function chatDiseaseMode(params) {
  const { query, disease, collegeId, studentId } = params;
  const student = await getStudent(studentId, collegeId);
  const subjects = await getStudentSubjects(studentId, collegeId);

  // Query ALL subject namespaces in parallel — no doc_id or subject filter
  const allChunks = await Promise.all(subjects.map(subject =>
    pineconeIndex.query({
      vector: await embedText(query),
      namespace: `c_${collegeId}_d_${subject.dept_id}`,
      filter: { subject_id: { $eq: subject._id.toString() } },
      topK: 3,
      includeMetadata: true
    })
  ));

  // Flatten, filter by score, rerank the combined pool
  const combined = allChunks.flatMap(r => r.matches)
    .filter(m => m.score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Build cross-subject system prompt
  const systemPrompt = `You are answering a question about "${disease}" drawing from multiple subjects:
${subjects.map(s => s.name).join(", ")}.
The student's college has uploaded: ${subjects.map(s => `${s.name} (${s.code})`).join(", ")}.
Use content from ALL provided chunks. Clearly attribute each point to its source subject and page.
Format your answer with subject headings where relevant.
Always cite: "— [Subject Name, Book, Page X]"`;

  return streamLLMResponse(systemPrompt, query, combined, params);
}
```

---

## 6. F-14-D: Year-Wise Student Navigation

### 6.1 The problem this solves

Currently a student in Year 2 MBBS navigates to: Library → Pharmacology Dept → filter by semester → see materials. Four steps to get to their semester's content.

Medsy's navigation is: Year 2 → see all Year 2 subjects immediately. One step.

Year-wise navigation adds a `My Year` view that is a curated, filtered view of the library showing only materials relevant to the student's current year and semester — but from YOUR college's actual uploaded content.

### 6.2 Data requirements

For year navigation to work, subjects must be tagged with `mbbs_year` and `mbbs_semester`. This requires a one-time admin setup step and an automatic tagging system.

**Admin setup:** When creating a subject, Dept Admin now specifies:
- Year: [1 / 2 / 3 / 4]
- Semester: [1 / 2 / 3 / 4 / 5 / 6 / 7 / 8]

**Auto-tagging from subject name:** A lightweight classifier pre-fills these based on standard MBBS subject-to-year mapping:

```javascript
const mbbs_year_map = {
  1: {
    year: 1,
    subjects: ["Human Anatomy", "Physiology", "Biochemistry", "Introduction to Community Medicine"],
    semesters: { 1: ["Human Anatomy", "Physiology"], 2: ["Biochemistry"] }
  },
  2: {
    year: 2,
    subjects: ["Pathology", "Pharmacology", "Microbiology", "Forensic Medicine"],
    semesters: { 3: ["Pathology", "Pharmacology"], 4: ["Microbiology", "Forensic Medicine"] }
  },
  3: {
    year: 3,
    subjects: ["Community Medicine", "Ophthalmology", "ENT"],
    semesters: { 5: ["Community Medicine"], 6: ["Ophthalmology", "ENT"] }
  },
  4: {
    year: 4,
    subjects: ["General Medicine", "General Surgery", "Obstetrics & Gynaecology",
               "Paediatrics", "Psychiatry", "Orthopaedics", "Dermatology",
               "Anaesthesiology", "Radiology"],
    semesters: { 7: ["General Medicine", "General Surgery", "OBG"],
                 8: ["Paediatrics", "Psychiatry", "Orthopaedics"] }
  }
};

function autoTagSubject(subjectName) {
  for (const [year, data] of Object.entries(mbbs_year_map)) {
    const match = data.subjects.find(s =>
      subjectName.toLowerCase().includes(s.toLowerCase())
    );
    if (match) {
      for (const [semester, subjects] of Object.entries(data.semesters)) {
        if (subjects.some(s => subjectName.toLowerCase().includes(s.toLowerCase()))) {
          return { mbbs_year: parseInt(year), mbbs_semester: parseInt(semester) };
        }
      }
      return { mbbs_year: parseInt(year), mbbs_semester: null };
    }
  }
  return { mbbs_year: null, mbbs_semester: null };
}
```

For engineering colleges, the same pattern applies with VTU/Anna University semester mapping. Admin can override auto-tagging at any time.

### 6.3 My Year view API

```
GET /api/v1/college/:cid/student/my-year
Response: {
  student_year: 2,
  student_semester: 3,
  subjects: [
    {
      subject_id, name, code, mbbs_year, mbbs_semester,
      dept_name, doc_count, docs: [DocumentCard]
    }
  ],
  total_subjects: 4,
  total_docs: 14,
  srs_cards_due_today: 23,     // from student record
  study_streak: 7
}
```

**Query logic:**
```javascript
async function getMyYearView(studentId, collegeId) {
  const student = await getStudent(studentId, collegeId);
  const { current_year, current_semester, effective_dept_id } = student;

  // Get all subjects for this year AND semester (or year-only if semester not set)
  const subjects = await subjectsCollection(collegeId).find({
    dept_id: effective_dept_id,
    $or: [
      { mbbs_year: current_year, mbbs_semester: current_semester },
      { mbbs_year: current_year, mbbs_semester: null }    // year-tagged but not semester-tagged
    ]
  }).toArray();

  // For each subject, get its documents
  const enrichedSubjects = await Promise.all(subjects.map(async (subject) => {
    const docs = await documentsCollection(collegeId).find({
      subject_id: subject._id,
      is_visible_to_students: true,
      ingestion_status: "completed"
    }).toArray();

    return { ...subject, doc_count: docs.length, docs };
  }));

  return {
    student_year: current_year,
    student_semester: current_semester,
    subjects: enrichedSubjects,
    total_subjects: enrichedSubjects.length,
    total_docs: enrichedSubjects.reduce((sum, s) => sum + s.doc_count, 0),
    srs_cards_due_today: student.srs_cards_due_today,
    study_streak: student.srs_streak_days
  };
}
```

### 6.4 My Year view UI

The `My Year` view becomes the student dashboard homepage — the first thing they see after login:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Good morning, Ravi.  MBBS Year 2 · Semester 3                               │
│                                                                              │
│ ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│ │ 🔄 Review due   │  │ 🔥 Streak       │  │ 📚 Materials    │             │
│ │ 23 cards        │  │ 7 days          │  │ 14 docs, 4 subj │             │
│ │ [Start Review]  │  │ Keep going!     │  │ [Browse all]    │             │
│ └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
│ Your Year 2 / Semester 3 Materials                                          │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│ PATHOLOGY                                          4 documents              │
│ ──────────────────────────────────────────────────────────                 │
│ [Robbins Basic Pathology]  [Harsh Mohan]  [Faculty Notes Ch.4]  [PYQs 23] │
│                                                              [Study all →] │
│                                                                              │
│ PHARMACOLOGY                                       3 documents              │
│ ──────────────────────────────────────────────────────────                 │
│ [Katzung BPT]  [KD Tripathi]  [PYQs 2022–24]                              │
│                                                              [Study all →] │
│                                                                              │
│ MICROBIOLOGY                                       5 documents              │
│ ──────────────────────────────────────────────────────────                 │
│ [Ananthanarayan]  [Jawetz]  [Lecture Notes]  [Lab Manual]  [PYQs]         │
│                                                              [Study all →] │
│                                                                              │
│ FORENSIC MEDICINE                                  2 documents              │
│ ──────────────────────────────────────────────────────────                 │
│ [Reddy's Forensic Medicine]  [PYQs 2020–24]                               │
│                                                              [Study all →] │
│                                                                              │
│ 🔬 Disease Search ─────────────────────────────────────────────────────── │
│ [Search any disease across all your Year 2 subjects...]                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.5 Year/semester update by student

Students can update their year and semester from the profile settings. This triggers a re-evaluation of the My Year view:

```
POST /api/v1/college/:cid/student/update-year
Body: { current_year: 3, current_semester: 5 }
```

---

## 7. How the Four Features Connect

The four features in this spec are not independent — they form a learning loop when used together:

```
Student opens My Year view (F-14-D)
  ↓
Sees Year 3 / Semester 5 materials: Medicine, Surgery, OBG
  ↓
Opens Guyton Chapter 12 study workspace (F-13)
  ↓
Generates a Clinical Case (F-14-B)
  → 22-year-old with chest pain, ECG findings
  ↓
Answers correctly → "Add to Daily Review"
  → SRS card created, next review tomorrow (F-14-A)
  ↓
Searches "Myocardial Infarction" in Disease Search (F-14-C)
  → Sees Pathology + Pharmacology + Biochemistry results
  → Cross-connection: "Pathology necrosis → Biochemistry troponin → Pharmacology thrombolytics"
  ↓
Next day: SRS shows 23 cards due
  → Cardiac output question from Guyton Ch.12 appears
  → MI clinical case appears
  ↓
Student maintains 7-day streak
  → Notification: "🔥 7 days! You've reviewed 47 cards"
```

This loop creates **daily engagement** (SRS brings them back), **deep understanding** (Disease Query connects subjects), **clinical confidence** (Case scenarios build application skills), and **natural navigation** (Year view removes friction).

---

## 8. API Route Map

All routes require `role: student` JWT.

```
# Spaced Repetition (F-14-A)
GET    /api/v1/college/:cid/student/srs/due-today
       Response: { cards[], total_due, total_active, streak }

GET    /api/v1/college/:cid/student/srs/stats
       Response: { total_cards, graduated, streak, due_today, due_this_week,
                   avg_ease_factor, retention_rate_pct }

POST   /api/v1/college/:cid/student/srs/review
       Body: { card_id, quality: 0-5, student_answer, time_taken_seconds }
       Response: { interval_days, next_review_at, ease_factor, streak }

POST   /api/v1/college/:cid/student/srs/add-card
       Body: { question_text, question_type, correct_answer, explanation,
               source_page, doc_id, chapter_index, bloom_level }
       Response: { srs_card_id, next_review_at }

PATCH  /api/v1/college/:cid/student/srs/cards/:cardId/suspend
PATCH  /api/v1/college/:cid/student/srs/cards/:cardId/reactivate
DELETE /api/v1/college/:cid/student/srs/cards/:cardId

# Clinical Cases (F-14-B)
POST   /api/v1/college/:cid/student/library/:docId/chapters/:idx/cases/generate
       Body: { question_type, difficulty }
       Response: { case_text, question, options, correct_answer, explanation,
                   key_teaching_points, source_pages }

GET    /api/v1/college/:cid/student/library/:docId/chapters/:idx/cases
       Response: { cases[], total } — lists cached cases for this chapter

POST   /api/v1/college/:cid/student/cases/:caseId/add-to-srs
       Response: { srs_card_id }

# Disease Query (F-14-C)
POST   /api/v1/college/:cid/student/disease-search
       Body: { query: "myocardial infarction" }
       Response: { disease_name, subject_results[], compiled_answer, cross_connections }

POST   /api/v1/college/:cid/student/disease-chat
       Body: { disease, query, conversation_history }
       SSE: token stream from cross-subject disease mode chat

GET    /api/v1/college/:cid/student/disease-search/suggestions
       Response: { popular_diseases[], recent_searches[] }

# Year Navigation (F-14-D)
GET    /api/v1/college/:cid/student/my-year
       Response: { student_year, student_semester, subjects[], srs_due, streak }

PATCH  /api/v1/college/:cid/student/update-year
       Body: { current_year, current_semester }

GET    /api/v1/college/:cid/student/year/:year/subjects
       ?semester=N (optional)
       Response: { subjects[], docs[] }
```

---

## 9. Frontend Component Tree

```
apps/student/
├── app/
│   ├── dashboard/
│   │   └── page.tsx                     # Homepage — My Year view (replaces generic dashboard)
│   ├── srs/
│   │   ├── page.tsx                     # SRS overview (stats, due cards)
│   │   └── review/page.tsx              # Daily review session
│   └── disease/
│       ├── page.tsx                     # Disease search homepage
│       └── [disease]/page.tsx           # Disease result page

apps/student/components/
├── dashboard/
│   ├── MyYearView.tsx                   # Primary dashboard layout
│   ├── YearSubjectGroup.tsx             # Subject row with docs
│   ├── DashboardKPICards.tsx            # Review due / Streak / Materials
│   └── DiseaseSearchBar.tsx             # Disease search input (inline on dashboard)
├── srs/
│   ├── SRSReviewSession.tsx             # Main review session controller
│   ├── SRSCard.tsx                      # Single card display (MCQ, SAQ, or CASE)
│   ├── SRSSelfRating.tsx                # Self-rating for SAQ/CASE (0-5 buttons)
│   ├── SRSCardFeedback.tsx              # Post-answer: next review date + ease
│   ├── SRSStats.tsx                     # Progress stats card
│   ├── SRSStreakDisplay.tsx             # Flame streak counter
│   └── SRSDueTodayCard.tsx             # Dashboard widget showing due cards
├── cases/
│   ├── CaseSelectorPanel.tsx           # Type + difficulty selector
│   ├── CaseDisplay.tsx                  # Case text + question + options
│   ├── CaseFeedback.tsx                 # Answer feedback + teaching points
│   └── CaseChatButton.tsx              # Opens chapter chat with case context
└── disease/
    ├── DiseaseSearchInput.tsx           # Autocomplete with aliases
    ├── DiseaseResultPage.tsx            # Full disease result layout
    ├── SubjectResultCard.tsx            # Per-subject result section
    ├── CrossConnectionsPanel.tsx        # The cross-subject links section
    └── DiseaseChatButton.tsx            # Opens cross-subject chat mode

hooks/
├── useSRSDueCards.ts                   # tRPC query for due cards
├── useSRSReview.ts                     # Review session state + SM-2 computation
├── useDiseaseQuery.ts                  # Disease search with caching
└── useMyYear.ts                        # Year view data
```

---

## 10. Cost & LLM Impact Analysis

### SRS (F-14-A) — near-zero LLM cost

SRS cards are created from already-generated quiz questions. The review session shows the existing question — no LLM call required for display. The SM-2 algorithm is pure JavaScript. **LLM cost for SRS: $0.00 per review.**

The only LLM cost is the original quiz generation that created the card (already accounted for in F-13-D cost metering).

### Clinical Cases (F-14-B) — moderate cost, cached

Case generation uses Claude Sonnet (~$0.003/1K input + $0.015/1K output). A typical case generation call uses ~3,000 input tokens + ~600 output tokens = ~$0.018 per case.

With a 7-day cache serving up to 10 students per cached case: effective cost = $0.018 / 10 = **$0.0018 per student case view**.

For 100 students generating 5 cases/week: 500 unique case requests → 50 generation calls (90% cache hit) → $0.90/week per department. Very manageable within existing cost budgets.

### Disease Query (F-14-C) — moderate cost, cached aggressively

Disease query uses:
- 1× OpenAI embedding ($0.00002 per call)
- N × Pinecone queries (1 per subject, typically 3–5 subjects) → small cost
- 1× Claude Haiku for compilation (~2,000 input + 800 output = $0.0015)

With 24-hour cache: if 100 students search "MI" on the same day, only 1 query is run. **Effective cost: ~$0.0015 per unique disease per day.**

### Year Navigation (F-14-D) — zero LLM cost

Pure MongoDB query + aggregation. No LLM involved. **Zero additional AI cost.**

### Combined monthly cost estimate (100-student medical department)

```
SRS reviews (100 students × 20 cards/day × 25 days):   $0.00  (no LLM)
Clinical cases (100 students × 5 cases/week × 4 weeks): $0.72  (90% cache hit)
Disease queries (100 students × 3 unique/day × 25 days)
  → 300 queries/month, 30 unique (10% cache miss):      $0.05
Year navigation:                                         $0.00
──────────────────────────────────────────────────────
Total F-14 additional monthly cost per department:       $0.77
```

This is negligible against the college's ₹3,999/month plan (~$48). F-14 adds $0.77 of cost per department and significant competitive value.

---

## 11. Environment Variables

```bash
# Addition to services/api/.env

# Spaced Repetition
SRS_DEFAULT_EASE_FACTOR=2.5
SRS_MIN_EASE_FACTOR=1.3
SRS_MAX_EASE_FACTOR=3.0
SRS_INITIAL_INTERVAL_DAYS=1
SRS_GRADUATION_INTERVAL_DAYS=180        # cards with interval > this get "graduated" status
SRS_DEFAULT_DAILY_TARGET=20             # default cards to review per day
SRS_ADD_BLOOM_THRESHOLD=understand      # only add cards at "understand" level and above to SRS
                                        # "remember" level cards are NOT added (pure recall)

# Clinical Cases
CASE_GENERATION_MODEL=claude-sonnet-4-6
CASE_MAX_TOKENS=2048
CASE_CACHE_TTL_DAYS=7
CASE_CACHE_MAX_SERVES=10                # re-generate after serving 10 students

# Disease Query
DISEASE_QUERY_CACHE_TTL_HOURS=24
DISEASE_QUERY_MIN_SCORE=0.68            # minimum Pinecone similarity for disease match
DISEASE_QUERY_TOP_K_PER_SUBJECT=5      # chunks to retrieve per subject
DISEASE_COMPILE_MODEL=claude-haiku-4-5-20251001  # cheaper model for compilation
DISEASE_ALIAS_MAP_PATH=/app/data/disease_aliases.json

# Year Navigation
MBBS_YEAR_MAP_PATH=/app/data/mbbs_year_map.json
DEFAULT_ENGINEERING_SEMESTERS=8
DEFAULT_MBBS_SEMESTERS=8

# Nightly jobs
SRS_MAINTENANCE_CRON=0 0 * * *          # midnight IST
```

---

## 12. Build Order

Add as **Phase 12 — Learning Intelligence Layer** after Phase 11 in main architecture doc:

```
Phase 12 — Learning Intelligence Layer

Step 1 — Schema setup
  → Add fields to students collection: srs_cards_due_today, srs_streak_days,
    srs_last_review_date, srs_total_cards, current_year, current_semester,
    daily_srs_target, preferred_question_type
  → Add fields to subjects collection: mbbs_year, mbbs_semester, disease_tags
  → Create srs_cards collection + all indexes
  → Create srs_review_logs collection + indexes
  → Create clinical_cases collection + indexes
  → Create disease_queries collection + TTL index
  → Seed disease_aliases.json (200 most common MBBS diseases)
  → Seed mbbs_year_map.json (standard NMC year-subject mapping)

Step 2 — SRS backend (F-14-A)
  → calculateNextInterval() — SM-2 algorithm implementation
  → POST /srs/review — core review endpoint (SM-2 logic + log write)
  → GET /srs/due-today — query + limit to daily_srs_target
  → GET /srs/stats — student retention analytics
  → updateSRSStreak() — streak logic with milestone notifications
  → addCorrectAnswersToSRS() — hook into quiz session completion (F-13-D)
  → nightlySRSMaintenance() cron job
  → Test: answer a quiz question correctly → verify SRS card created
  → Test: review card correctly 3× → verify intervals 1d → 3d → 7d
  → Test: review card incorrectly → verify reset to 1d

Step 3 — Clinical Cases backend (F-14-B)
  → generateClinicalCase() — Sonnet-based generation + cache write
  → POST /cases/generate — with cache check first
  → GET /cases — list cached cases for a chapter
  → POST /cases/:id/add-to-srs — add case to SRS deck
  → Test: generate diagnosis case from Guyton Ch.12 → verify JSON parse succeeds
  → Test: generate same case twice → verify second call serves from cache
  → Test: all 5 question_type values generate valid cases

Step 4 — Disease Query backend (F-14-C)
  → normaliseDiseaseQuery() — alias resolution
  → diseaseQuery() — parallel multi-namespace Pinecone + Haiku compilation
  → chatDiseaseMode() — cross-subject SSE chat
  → diseaseSearchSuggestions() — popular + recent diseases
  → POST /disease-search + GET /disease-search/suggestions
  → POST /disease-chat (SSE)
  → Test: search "myocardial infarction" → verify results from Pathology + Pharmacology
  → Test: search same disease twice within 24h → verify cache hit (no new Pinecone queries)
  → Test: alias search ("heart attack") → verify maps to same result as "MI"

Step 5 — Year Navigation backend (F-14-D)
  → autoTagSubject() — auto-assign mbbs_year + mbbs_semester on subject creation
  → Migration: run auto-tagger on all existing subjects
  → getMyYearView() — year-filtered subject + doc aggregation
  → GET /my-year + PATCH /update-year
  → Update subject creation form in Admin UI: add Year + Semester fields
  → Test: student in Year 2, Semester 3 → verify only Pathology + Pharmacology + Micro + FMT docs shown

Step 6 — Frontend (F-14-A SRS)
  → SRSDueTodayCard.tsx (dashboard widget)
  → SRSReviewSession.tsx + SRSCard.tsx + SRSSelfRating.tsx
  → SRSStreakDisplay.tsx with milestone celebrations
  → SRSStats.tsx (retention rate, total cards, graduated)

Step 7 — Frontend (F-14-B Cases)
  → CaseSelectorPanel.tsx in Book Study Workspace tools panel
  → CaseDisplay.tsx + CaseFeedback.tsx
  → CaseChatButton.tsx — opens chapter chat with case pre-filled

Step 8 — Frontend (F-14-C Disease)
  → DiseaseSearchInput.tsx with autocomplete aliases
  → DiseaseResultPage.tsx with SubjectResultCard.tsx
  → CrossConnectionsPanel.tsx
  → DiseaseChatButton.tsx — opens cross-subject chat mode
  → Add DiseaseSearchBar.tsx to My Year view dashboard

Step 9 — Frontend (F-14-D Year Navigation)
  → Replace student dashboard homepage with MyYearView.tsx
  → YearSubjectGroup.tsx with inline doc cards
  → DashboardKPICards.tsx (SRS due, streak, total materials)
  → Year/semester selector in student profile settings

Step 10 — Integration testing
  → Full loop test: quiz correct answer → SRS card created → appears in tomorrow's review
  → Full loop test: generate case → add to SRS → appears in review → graduation after 6 reviews
  → Year navigation: update student from Year 2 to Year 3 → verify My Year view changes
  → Disease search: 3 subjects uploaded → search disease → verify cross-subject results
  → Cost validation: complete 100 SRS reviews → verify $0.00 cost events for SRS
  → Cost validation: generate 10 clinical cases (5 unique) → verify ~$0.09 cost events
  → Streak: complete reviews 7 consecutive days → verify streak = 7, milestone notification sent

Step 11 — Admin additions
  → Update subject creation/edit form: Year + Semester dropdowns
  → Run migration to auto-tag all existing subjects
  → Dept Admin: view of SRS cards across their students (analytics add-on)
  → Super Admin cost dashboard: add Clinical Case and Disease Query event types
```

---

*Document: F-14-learning-intelligence-layer.md · v1.0 · May 2026*  
*Extends: F-13-book-intelligence-system.md v1.0 · college-chatbot-architecture.md v2.0*  
*Competitive context: closes 4 feature gaps vs Medsy.ai while making each feature stronger by grounding it in college-owned content*  
*For Claude Code: Phase 12, 11 steps. Start with Step 1 (schema) then Step 2 (SRS backend — highest strategic priority). Steps are independent after Step 1.*
