# F-20: Adaptive Teaching Engine
## "Teach Me" v2 — Concept Graph · Misconception Library · 10-Phase State Machine · Strategy Toolkit · Learner Model

> **Parent docs:** `F-13-book-intelligence-system.md` v1.0 (F-13-G Socratic Mode) · `college-chatbot-architecture.md` v2.0 · `F-14-learning-intelligence-layer.md` v1.0 · `F-17-visual-content-intelligence.md` v1.0 · `F-19-retrieval-architecture-overhaul.md` v1.0
>
> **Supersedes:** F-13-G entirely. The existing Socratic Mode is a single system-prompt toggle (~15 lines of spec) that makes the AI ask questions instead of answering. It has no model of the student, no sequencing, no strategy variation, no misconception handling, and no retention hook. This document replaces it with a structured pedagogical engine.
>
> **Core idea:** Model what an expert teacher actually does when explaining a concept — diagnose, anchor, build in steps with checks, show, fade the scaffolding, confront the classic error, connect to practice, have the student explain it back, and schedule review — and drive it adaptively from a per-student learner model, grounded entirely in the college's own textbook.
>
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [Why F-13-G Is Insufficient](#1-why-f-13-g-is-insufficient)
2. [Pedagogical Foundation](#2-pedagogical-foundation)
3. [System Overview](#3-system-overview)
4. [F-20-A: Concept Graph Extraction](#4-f-20-a-concept-graph-extraction)
5. [F-20-B: Misconception Library](#5-f-20-b-misconception-library)
6. [F-20-C: The Teaching State Machine](#6-f-20-c-the-teaching-state-machine)
7. [F-20-D: Explanation Strategy Engine](#7-f-20-d-explanation-strategy-engine)
8. [F-20-E: Adaptive Difficulty & Learner Model](#8-f-20-e-adaptive-difficulty--learner-model)
9. [F-20-F: Faculty Teaching Profile](#9-f-20-f-faculty-teaching-profile)
10. [F-20-G: Session Interface](#10-f-20-g-session-interface)
11. [Database Schema](#11-database-schema)
12. [API Route Map](#12-api-route-map)
13. [Frontend Component Tree](#13-frontend-component-tree)
14. [Cost Analysis](#14-cost-analysis)
15. [Environment Variables](#15-environment-variables)
16. [Build Order](#16-build-order)
17. [Evaluation Plan](#17-evaluation-plan)

---

## 1. Why F-13-G Is Insufficient

The current implementation, in full:

```
Toggle: [Chat mode: Answer ● | Teach me ○]
- Bot starts with: "What do you already know about cardiac output?"
- After student responds, bot guides with questions
- After 3 exchanges, bot can offer a "hint"
- "Reveal answer" button appears after 5 exchanges
```

### 1.1 What is missing

| Missing capability | Consequence in practice |
|---|---|
| No model of prior knowledge | Every student is taught identically regardless of what they already know |
| No concept sequencing | The engine cannot detect that the real gap is a missing prerequisite two concepts upstream |
| Single explanation strategy | When Socratic questioning fails, there is no second approach — only a hint, then surrender |
| No misconception handling | Wrong mental models are never surfaced or dismantled, only implicitly worked around |
| No worked examples | Cognitive Load Theory's strongest single finding — the worked-example effect — is unused |
| No scaffold fading | Support is binary (hint / no hint) rather than progressively withdrawn |
| No consolidation | Session ends with no summary, no student-articulated understanding, no retention mechanism |
| No SRS hand-off | Nothing learned in a teaching session enters spaced repetition |
| No visual channel | F-17 image intelligence is not used despite being available |
| "Reveal answer" as escape | Framed as giving up rather than as a legitimate instructional move |

### 1.2 The failure mode this creates

A student who does not understand the Frank-Starling law asks to be taught it. The engine asks what they know. They say "not much." The engine asks a guiding question. They guess wrong. It asks another. They guess wrong again. After three exchanges they take the hint; after five they press "reveal answer" and read a paragraph they could have read in the textbook.

Nothing about that sequence is teaching. It is a quiz with a surrender button.

---

## 2. Pedagogical Foundation

Every design decision in this document traces to an established instructional framework.

| Framework | Contribution to this design |
|---|---|
| **Rosenshine's Principles of Instruction (2012)** | The backbone of the phase sequence: begin with review, present in small steps, ask many questions, provide models, guide practice, check understanding, target ~80% success rate, scaffold difficult tasks, require independent practice, review periodically |
| **Sweller — Cognitive Load Theory** | The worked-example effect (novices learn more from studying a worked example than attempting a problem) and the expertise-reversal effect (worked examples lose value as competence grows) drive the MODEL → GUIDED PRACTICE fading sequence |
| **Vygotsky — Zone of Proximal Development** | Teaching must sit between what the student can do alone and what they can do with support. Drives the four-rung difficulty ladder and the success-rate targeting |
| **Paivio — Dual Coding Theory** | Material encoded through both verbal and visual channels is retained better than either alone. Drives the VISUALISE phase and its wiring into F-17 |
| **Conceptual Change theory** | Presenting correct information does not reliably dislodge an existing wrong model; the misconception must be surfaced and explicitly contradicted. Drives the MISCONCEPTION PROBE phase |
| **Roediger & Karpicke — retrieval practice** | Testing produces better long-term retention than re-studying. Drives the FEYNMAN CHECK phase and the automatic SRS hand-off |
| **Feynman technique** | Explaining a concept simply, as if to a novice, exposes gaps that recognition-based checks miss |
| **Knowledge encapsulation (medical education)** | Basic-science knowledge is retained better when bridged to clinical application. Drives the CLINICAL CONNECT phase |

---

## 3. System Overview

```
Student: "Teach me the Frank-Starling law"
        ↓
┌──────────────────────────────────────────────────────────────┐
│ SESSION INITIALISATION                                        │
│  1. Resolve concept from concept_graph (F-20-A)              │
│  2. Load learner_model for this student (F-20-E)             │
│  3. Load teaching_profile for the department (F-20-F)        │
│  4. Load misconceptions for this concept (F-20-B)            │
│  5. Retrieve grounding chunks via F-19 pipeline              │
│  6. Create teaching_session record, state = PHASE_0          │
└──────────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────────┐
│ STATE MACHINE LOOP (F-20-C)                                   │
│  For each phase:                                              │
│    → select strategy (F-20-D)                                 │
│    → select difficulty rung (F-20-E)                          │
│    → generate turn, grounded in retrieved chunks              │
│    → if phase has a check: evaluate response                  │
│    → update rolling success rate + learner model              │
│    → decide: advance / repeat at lower rung / back-track      │
└──────────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────────┐
│ SESSION CLOSE                                                 │
│  → structured summary with page citations                     │
│  → misconception explicitly restated                          │
│  → 2-4 SRS cards written to F-14-A, seeded from weakest checks│
│  → learner_model updated: mastery, misconceptions, strategy   │
│  → session transcript stored for faculty analytics            │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. F-20-A: Concept Graph Extraction

### 4.1 Why a concept graph is required

Prerequisite back-tracking — the single most important behavioural difference from F-13-G — is impossible without knowing which concepts depend on which. When a student repeatedly fails checks on Frank-Starling, the engine needs to know that sarcomere actin-myosin overlap is a prerequisite so it can pause and teach that first.

### 4.2 Automatic extraction from the uploaded textbook

Runs once per document, after F-13-A chapter extraction completes. Uses the chapter map to constrain dependencies to earlier chapters — a strong structural prior that prevents most spurious edges.

```python
# services/ingestion-worker/jobs/extract_concept_graph.py

CONCEPT_EXTRACTION_PROMPT = """You are building a concept dependency graph for a
{dept_name} textbook used in an Indian {college_type} college.

Chapter {chapter_index}: "{chapter_title}" (pages {start_page}-{end_page})

<chapter_content>
{chapter_text}
</chapter_content>

Concepts already extracted from EARLIER chapters (available as prerequisites):
{earlier_concepts}

Extract the teachable concepts introduced in THIS chapter. For each, return:

{{
  "canonical_name": "Frank-Starling law",
  "aliases": ["Starling's law of the heart", "length-tension relationship"],
  "concept_type": "law_relationship",
  "one_line_definition": "Force of cardiac contraction is proportional to initial fibre length",
  "source_pages": [218, 219, 220],
  "prerequisites": ["Sarcomere actin-myosin overlap", "Preload"],
  "bloom_ceiling": "analyse",
  "difficulty_rating": 0.72,
  "is_examinable": true
}}

Rules:
- concept_type must be one of: process_mechanism | structure_anatomy |
  law_relationship | classification | procedure_calculation | causal_chain | definition
- prerequisites MUST be drawn from the earlier-concepts list provided above,
  or from concepts introduced earlier in THIS chapter. Never forward-reference.
- difficulty_rating 0.0-1.0, your estimate of how hard students find this
- bloom_ceiling: the highest Bloom level this concept is typically examined at
- Extract 5-15 concepts per chapter. Prefer substantive teachable units over
  trivial definitions.

Return a JSON array only."""


async def extract_concept_graph(job_data: dict):
    doc_id      = job_data["doc_id"]
    college_id  = job_data["college_id"]
    dept_id     = job_data["dept_id"]

    chapter_map = await get_chapter_map(doc_id, college_id)
    all_concepts = []

    # Process chapters IN ORDER so earlier concepts are available as prerequisites
    for chapter in sorted(chapter_map["chapters"], key=lambda c: c["chapter_index"]):
        chapter_text = await get_chapter_text(chapter, doc_id, college_id)

        # Truncate to fit context; prefer the first N tokens which contain
        # the conceptual introduction rather than worked problems at the end
        chapter_text = chapter_text[:int(os.environ.get("CONCEPT_EXTRACT_MAX_CHARS", 60000))]

        earlier = [c["canonical_name"] for c in all_concepts]

        response = await call_claude(
            model=os.environ.get("CONCEPT_GRAPH_MODEL", "claude-sonnet-4-6"),
            max_tokens=4096,
            prompt=CONCEPT_EXTRACTION_PROMPT.format(
                dept_name=job_data["dept_name"],
                college_type=job_data["college_type"],
                chapter_index=chapter["chapter_index"],
                chapter_title=chapter["title"],
                start_page=chapter["start_page"],
                end_page=chapter["end_page"],
                chapter_text=chapter_text,
                earlier_concepts="\n".join(f"- {c}" for c in earlier[-120:]) or "(none — this is the first chapter)"
            )
        )

        chapter_concepts = json.loads(strip_fences(response))

        for c in chapter_concepts:
            c["_id"]            = generate_uuid()
            c["doc_id"]         = doc_id
            c["college_id"]     = college_id
            c["dept_id"]        = dept_id
            c["subject_id"]     = job_data.get("subject_id")
            c["chapter_index"]  = chapter["chapter_index"]
            c["extraction_method"] = "llm_chapter_pass"
            c["reviewed_by_faculty"] = False
            c["created_at"]     = datetime.utcnow()

        all_concepts.extend(chapter_concepts)

    # Resolve prerequisite names → concept_ids
    all_concepts = resolve_prerequisite_ids(all_concepts)

    # Validate the graph is acyclic before persisting
    cycles = detect_cycles(all_concepts)
    if cycles:
        # Break cycles by dropping the edge that points to the later chapter
        all_concepts = break_cycles(all_concepts, cycles)

    await mongo.college_db(college_id).concept_graph.insert_many(all_concepts)

    await mongo.college_db(college_id).documents.update_one(
        {"_id": doc_id},
        {"$set": {
            "concept_graph_extracted": True,
            "concept_count": len(all_concepts),
            "concept_graph_version": 1
        }}
    )
```

### 4.3 Cycle detection and repair

A dependency graph must be acyclic. The chapter-ordering constraint prevents most cycles, but LLM output can still produce them via aliases.

```python
def detect_cycles(concepts: list) -> list:
    """Standard DFS cycle detection over the prerequisite edges."""
    graph = {c["_id"]: c.get("prerequisite_ids", []) for c in concepts}
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {cid: WHITE for cid in graph}
    cycles = []

    def dfs(node, path):
        colour[node] = GREY
        for nxt in graph.get(node, []):
            if nxt not in colour:
                continue
            if colour[nxt] == GREY:
                cycles.append(path[path.index(nxt):] + [nxt])
            elif colour[nxt] == WHITE:
                dfs(nxt, path + [nxt])
        colour[node] = BLACK

    for cid in graph:
        if colour[cid] == WHITE:
            dfs(cid, [cid])
    return cycles


def break_cycles(concepts: list, cycles: list) -> list:
    """
    Break each cycle by removing the edge whose target appears in a LATER
    chapter than its source — that edge is almost certainly the erroneous one.
    """
    by_id = {c["_id"]: c for c in concepts}
    for cycle in cycles:
        worst_edge = max(
            zip(cycle, cycle[1:] + [cycle[0]]),
            key=lambda e: by_id[e[1]]["chapter_index"] - by_id[e[0]]["chapter_index"]
        )
        src, tgt = worst_edge
        by_id[src]["prerequisite_ids"] = [
            p for p in by_id[src].get("prerequisite_ids", []) if p != tgt
        ]
    return list(by_id.values())
```

### 4.4 Faculty review UI

Dept Admins can review and correct the extracted graph. Most will not, which is why the automatic extraction must be good enough to use unreviewed — but the option matters for departments with strong opinions about sequencing.

```
Concept Graph · Physiology · Guyton 13th Ed        [Auto-extracted · 412 concepts]

Chapter 9: Cardiac Muscle
  ● Sarcomere actin-myosin overlap        no prerequisites      [edit]
  ● Excitation-contraction coupling       ← Sarcomere overlap   [edit]
  ● Preload                               ← Sarcomere overlap   [edit]

Chapter 12: The Heart as a Pump
  ● Frank-Starling law                    ← Preload, Sarcomere overlap   [edit]
  ● Cardiac output                        ← Stroke volume, Heart rate    [edit]
  ⚠ Afterload                             no prerequisites  ← review suggested
```

---

## 5. F-20-B: Misconception Library

### 5.1 Two sources — seeded, then learned

**Seeded at ingestion** — an LLM pass generates the misconceptions students commonly hold for each extracted concept.

**Learned from your students** — every wrong quiz answer (F-13-D), failed SRS card (F-14-A), and failed teaching checkpoint is clustered by concept. Recurring wrong-answer patterns are promoted into the library with real frequency counts. After a semester, the library reflects what students *at this college, on this syllabus* actually get wrong.

### 5.2 Seeding

```python
MISCONCEPTION_SEED_PROMPT = """For the concept below, list the 3-5 misconceptions
that {dept_name} students most commonly hold.

Concept: {canonical_name}
Definition: {one_line_definition}
Type: {concept_type}
Source pages: {source_pages}

<source_material>
{concept_chunks}
</source_material>

For each misconception return:
{{
  "statement": "the wrong belief, phrased as a student would hold it",
  "correct_model": "the accurate model, stated plainly",
  "root_cause": "the underlying reasoning error that produces this belief",
  "diagnostic_probe": "a single question whose answer distinguishes the wrong model from the right one",
  "probe_correct_answer": "what a student holding the correct model would say",
  "probe_wrong_answer": "what a student holding the misconception would say"
}}

The diagnostic_probe is the most important field. It must be a question where
a student holding the misconception gives a confidently WRONG answer — not one
they could get right by guessing. Return a JSON array only."""
```

### 5.3 Learning from observed student errors

```typescript
// services/api/src/jobs/mine-misconceptions.ts
// Runs nightly

async function mineMisconceptionsFromErrors(collegeId: string, deptId: string) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // Gather all wrong answers from the last 30 days, grouped by concept
  const wrongAnswers = await gatherWrongAnswers(collegeId, deptId, since);
  // sources: quiz_sessions (F-13-D), srs_review_logs (F-14-A),
  //          teaching_sessions checkpoint failures (F-20)

  const byConcept = groupBy(wrongAnswers, "concept_id");

  for (const [conceptId, errors] of Object.entries(byConcept)) {
    if (errors.length < MIN_ERRORS_TO_MINE) continue;   // default 8

    // Cluster the wrong answers semantically — the same misconception
    // surfaces as many differently-worded wrong answers
    const clusters = await clusterWrongAnswers(errors);

    for (const cluster of clusters) {
      if (cluster.members.length < MIN_CLUSTER_SIZE) continue;   // default 4

      // Check whether this matches an existing seeded misconception
      const existing = await matchToExistingMisconception(conceptId, cluster, collegeId);

      if (existing) {
        // Reinforce: increment observed count, keep it prioritised
        await misconceptionsCollection(collegeId).updateOne(
          { _id: existing._id },
          {
            $inc: { observed_count: cluster.members.length },
            $set: { last_observed: new Date(), source: "seeded_and_observed" }
          }
        );
      } else {
        // Genuinely new misconception observed in this cohort — promote it
        const articulated = await articulateMisconception(cluster, conceptId, collegeId);
        await misconceptionsCollection(collegeId).insertOne({
          _id: generateUUID(),
          concept_id: conceptId,
          college_id: collegeId,
          dept_id: deptId,
          ...articulated,
          source: "observed_from_students",
          observed_count: cluster.members.length,
          first_observed: new Date(),
          last_observed: new Date(),
          correction_success_rate: null,   // populated as it is used in sessions
          reviewed_by_faculty: false
        });
      }
    }
  }
}
```

### 5.4 Measuring whether a correction actually works

Every time a misconception probe is used in a teaching session, the outcome is recorded. Misconceptions whose corrections rarely succeed are flagged for faculty review — the correction itself may be poorly worded.

```javascript
// After MISCONCEPTION PROBE phase completes
await misconceptionsCollection(collegeId).updateOne(
  { _id: misconceptionId },
  {
    $inc: {
      times_probed: 1,
      times_corrected: studentPassedPostCorrectionCheck ? 1 : 0
    }
  }
);
// correction_success_rate = times_corrected / times_probed, recomputed nightly
```

---

## 6. F-20-C: The Teaching State Machine

### 6.1 Phase definitions

```typescript
// services/api/src/services/teaching/phases.ts

export enum TeachingPhase {
  DIAGNOSE            = 0,
  ANCHOR              = 1,
  SEGMENT_BUILD       = 2,
  VISUALISE           = 3,
  MODEL               = 4,
  GUIDED_PRACTICE     = 5,
  MISCONCEPTION_PROBE = 6,
  CLINICAL_CONNECT    = 7,
  FEYNMAN_CHECK       = 8,
  CONSOLIDATE         = 9,
}

export interface PhaseDefinition {
  phase: TeachingPhase;
  name: string;
  hasCheck: boolean;
  skippable: boolean;
  skipCondition?: (ctx: SessionContext) => boolean;
  maxTurns: number;
}

export const PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    phase: TeachingPhase.DIAGNOSE, name: "Diagnose",
    hasCheck: true, skippable: false, maxTurns: 3
  },
  {
    phase: TeachingPhase.ANCHOR, name: "Anchor",
    hasCheck: false, skippable: false, maxTurns: 2
  },
  {
    phase: TeachingPhase.SEGMENT_BUILD, name: "Build",
    hasCheck: true, skippable: false, maxTurns: 14   // 3-6 steps × up to 2 attempts
  },
  {
    phase: TeachingPhase.VISUALISE, name: "Visualise",
    hasCheck: false, skippable: true, maxTurns: 2,
    skipCondition: (ctx) => !ctx.hasRelevantImage
  },
  {
    phase: TeachingPhase.MODEL, name: "Worked example",
    hasCheck: false, skippable: true, maxTurns: 2,
    skipCondition: (ctx) =>
      ["definition", "classification"].includes(ctx.concept.concept_type)
  },
  {
    phase: TeachingPhase.GUIDED_PRACTICE, name: "Guided practice",
    hasCheck: true, skippable: true, maxTurns: 8,
    skipCondition: (ctx) =>
      ["definition", "classification"].includes(ctx.concept.concept_type)
  },
  {
    phase: TeachingPhase.MISCONCEPTION_PROBE, name: "Common error",
    hasCheck: true, skippable: true, maxTurns: 4,
    skipCondition: (ctx) => ctx.misconceptions.length === 0
  },
  {
    phase: TeachingPhase.CLINICAL_CONNECT, name: "Why it matters",
    hasCheck: false, skippable: true, maxTurns: 2,
    skipCondition: (ctx) => !ctx.teachingProfile.always_include_clinical_connect
                            && ctx.concept.pyq_frequency === 0
  },
  {
    phase: TeachingPhase.FEYNMAN_CHECK, name: "Explain it back",
    hasCheck: true, skippable: true, maxTurns: 3,
    skipCondition: (ctx) => !ctx.teachingProfile.require_feynman_check
  },
  {
    phase: TeachingPhase.CONSOLIDATE, name: "Recap",
    hasCheck: false, skippable: false, maxTurns: 1
  },
];
```

### 6.2 The orchestrator

```typescript
// services/api/src/services/teaching/orchestrator.ts

export async function advanceTeachingSession(
  sessionId: string,
  studentResponse: string | null,
  collegeId: string
): Promise<TeachingTurn> {

  const session = await loadSession(sessionId, collegeId);
  const ctx     = await buildSessionContext(session, collegeId);

  // ── 1. Evaluate the student's response to the previous check, if any ──
  if (studentResponse && session.awaiting_check_response) {
    const evaluation = await evaluateCheckResponse(
      studentResponse,
      session.pending_check,
      ctx
    );

    session.check_history.push({
      phase: session.current_phase,
      step_index: session.current_step_index,
      question: session.pending_check.question,
      student_answer: studentResponse,
      passed: evaluation.passed,
      confidence: evaluation.confidence,
      difficulty_level: session.current_difficulty_level,
      strategy_used: session.current_strategy,
      diagnosed_gap: evaluation.diagnosed_gap,
      timestamp: new Date(),
    });

    // Record failed strategy so it is not reused this session
    if (!evaluation.passed && session.current_strategy) {
      if (!session.strategies_failed.includes(session.current_strategy)) {
        session.strategies_failed.push(session.current_strategy);
      }
    }

    await updateLearnerModelFromCheck(session, evaluation, collegeId);
  }

  // ── 2. Decide what happens next ──────────────────────────────────────
  const decision = decideNextAction(session, ctx);

  switch (decision.action) {
    case "BACKTRACK_PREREQUISITE":
      return await openNestedPrerequisiteSession(session, decision.prerequisiteId, ctx);

    case "RETRY_LOWER_RUNG":
      session.current_difficulty_level = decision.newLevel;
      session.current_strategy = selectStrategy(ctx, session);
      break;

    case "ADVANCE_STEP":
      session.current_step_index += 1;
      break;

    case "ADVANCE_PHASE":
      session.current_phase = decision.nextPhase;
      session.current_step_index = 0;
      session.strategies_failed = [];   // reset per phase
      break;

    case "COMPLETE_SESSION":
      return await closeSession(session, ctx, collegeId);
  }

  // ── 3. Generate the turn for the (possibly new) phase ────────────────
  const turn = await generatePhaseTurn(session, ctx);

  session.awaiting_check_response = turn.check !== null;
  session.pending_check = turn.check;
  session.turn_count += 1;

  await saveSession(session, collegeId);
  return turn;
}
```

### 6.3 The decision function

```typescript
function decideNextAction(session: TeachingSession, ctx: SessionContext): Decision {
  const recentChecks   = session.check_history.slice(-4);
  const rollingSuccess = recentChecks.length
    ? recentChecks.filter(c => c.passed).length / recentChecks.length
    : 1.0;

  const lastCheck  = session.check_history.at(-1);
  const phaseDef   = PHASE_DEFINITIONS[session.current_phase];

  // ── Back-track: persistent failure means a missing prerequisite ──────
  const last3 = session.check_history.slice(-3);
  if (last3.length === 3 && last3.every(c => !c.passed)
      && !session.backtrack_active) {
    const missingPrereq = inferMissingPrerequisite(session, ctx);
    if (missingPrereq) {
      return { action: "BACKTRACK_PREREQUISITE", prerequisiteId: missingPrereq };
    }
  }

  // ── Failed check → drop a rung and retry, if rungs remain ────────────
  if (lastCheck && !lastCheck.passed) {
    if (session.current_difficulty_level > 0) {
      return {
        action: "RETRY_LOWER_RUNG",
        newLevel: session.current_difficulty_level - 1
      };
    }
    // Already at L0 — accept and move on rather than looping
    return nextStepOrPhase(session, ctx);
  }

  // ── Strong performance → compress ────────────────────────────────────
  if (rollingSuccess >= COMPRESS_THRESHOLD && session.current_phase === TeachingPhase.SEGMENT_BUILD) {
    // Skip ahead by merging remaining build steps
    session.build_steps_remaining = Math.max(1, Math.floor(session.build_steps_remaining / 2));
    if (session.current_difficulty_level < 3) session.current_difficulty_level += 1;
  }

  // ── Guard against runaway phases ─────────────────────────────────────
  if (session.phase_turn_count >= phaseDef.maxTurns) {
    return { action: "ADVANCE_PHASE", nextPhase: nextNonSkippedPhase(session, ctx) };
  }

  return nextStepOrPhase(session, ctx);
}
```

### 6.4 Prerequisite back-tracking

This is the single most important behavioural addition over F-13-G.

```typescript
async function openNestedPrerequisiteSession(
  parentSession: TeachingSession,
  prerequisiteId: string,
  ctx: SessionContext
): Promise<TeachingTurn> {

  const prereq = await getConcept(prerequisiteId, ctx.collegeId);

  parentSession.backtrack_active = true;
  parentSession.backtrack_stack.push({
    prerequisite_concept_id: prerequisiteId,
    parent_phase: parentSession.current_phase,
    parent_step_index: parentSession.current_step_index,
    opened_at: new Date(),
  });

  // A nested session is deliberately compressed — it teaches only enough
  // to unblock the parent concept, not the full 10 phases.
  const nestedSession = await createTeachingSession({
    student_id: parentSession.student_id,
    concept_id: prerequisiteId,
    college_id: parentSession.college_id,
    dept_id: parentSession.dept_id,
    doc_id: parentSession.doc_id,
    parent_session_id: parentSession._id,
    is_nested: true,
    enabled_phases: [
      TeachingPhase.ANCHOR,
      TeachingPhase.SEGMENT_BUILD,
      TeachingPhase.VISUALISE,
    ],
    // Start low — the student demonstrably struggled with the dependent concept
    initial_difficulty_level: 1,
  });

  return {
    role: "assistant",
    phase: TeachingPhase.ANCHOR,
    is_backtrack_notice: true,
    content:
      `Let's pause here. I think the gap is one step earlier — **${prereq.canonical_name}**. ` +
      `Once that clicks, ${ctx.concept.canonical_name} follows naturally. ` +
      `Give me two minutes on it.\n\n` +
      (await generatePhaseTurn(nestedSession, await buildSessionContext(nestedSession, ctx.collegeId))).content,
    check: null,
    nested_session_id: nestedSession._id,
  };
}


function inferMissingPrerequisite(session: TeachingSession, ctx: SessionContext): string | null {
  const unconfirmed = ctx.concept.prerequisite_ids.filter(pid => {
    const mastery = ctx.learnerModel.concept_mastery[pid];
    return !mastery || mastery.confidence < PREREQ_CONFIRMED_THRESHOLD;
  });
  if (unconfirmed.length === 0) return null;

  // Prefer the prerequisite most semantically related to the gaps the
  // evaluator diagnosed in the failed checks
  const diagnosedGaps = session.check_history
    .slice(-3)
    .map(c => c.diagnosed_gap)
    .filter(Boolean);

  return rankPrerequisitesByGapMatch(unconfirmed, diagnosedGaps, ctx)[0] ?? unconfirmed[0];
}
```

### 6.5 Phase turn generation — grounded throughout

Every phase generates its turn from the same retrieved, cited source chunks. The engine never invents content; it re-presents the textbook pedagogically.

```typescript
async function generatePhaseTurn(
  session: TeachingSession,
  ctx: SessionContext
): Promise<TeachingTurn> {

  const strategy = session.current_strategy ?? selectStrategy(ctx, session);
  const level    = session.current_difficulty_level;

  const systemPrompt = buildTeachingSystemPrompt({
    phase:            session.current_phase,
    strategy,
    difficultyLevel:  level,
    concept:          ctx.concept,
    teachingProfile:  ctx.teachingProfile,
    learnerModel:     ctx.learnerModel,
    misconception:    ctx.currentMisconception,
    sourceChunks:     ctx.groundingChunks,
    deptName:         ctx.deptName,
  });

  const response = await anthropic.messages.create({
    model: process.env.TEACHING_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: systemPrompt,
    messages: buildTurnMessages(session, ctx),
  });

  return parseTeachingTurn(response, session.current_phase);
}
```

### 6.6 Phase-specific prompt fragments

```typescript
const PHASE_INSTRUCTIONS: Record<TeachingPhase, string> = {

  [TeachingPhase.DIAGNOSE]: `
Your goal is to find out what this student already knows, WITHOUT making them
feel tested. Ask ONE question that probes a prerequisite concept, phrased in
everyday language rather than technical terminology. It should feel like
curiosity, not an exam. Do not teach anything yet.`,

  [TeachingPhase.ANCHOR]: `
Connect this concept to something the student has already demonstrated they
understand — ideally something from their answer in the previous turn. State
the core idea in ONE sentence, then signal that you will now build it up.
Do not go into mechanism yet.`,

  [TeachingPhase.SEGMENT_BUILD]: `
Teach step {step_index} of {total_steps} only. Keep it to 2-4 sentences.
Then ask ONE comprehension check question about THIS step only.
The check must be answerable from what you just said — do not test ahead.
Aim for a question the student has roughly an 80% chance of answering correctly.`,

  [TeachingPhase.VISUALISE]: `
A figure from the student's own textbook is being shown alongside your message.
Do not describe the whole image — the student can see it. Instead, direct their
attention: tell them exactly what to look at and what it demonstrates about the
concept. Reference the specific labels visible in the figure.`,

  [TeachingPhase.MODEL]: `
Work through ONE complete example from start to finish, thinking aloud.
Show your reasoning at each decision point, including why you rejected
alternatives. Explicitly tell the student to just follow along — they are not
solving this one. End by naming the pattern they should carry forward.`,

  [TeachingPhase.GUIDED_PRACTICE]: `
Give the student a similar problem to attempt, with scaffolding level {fade_level}:
  fade_level 2 → provide the full structure, they supply only the final step
  fade_level 1 → provide the first step, they complete the rest
  fade_level 0 → they attempt it unaided
Do not solve it for them. Wait for their attempt.`,

  [TeachingPhase.MISCONCEPTION_PROBE]: `
Students commonly believe: "{misconception_statement}"
Ask the diagnostic question: "{diagnostic_probe}"
If they answer consistent with the misconception, do NOT simply correct them.
First make the contradiction visible — show them a case their model cannot
explain. Then state the correct model plainly and re-check.`,

  [TeachingPhase.CLINICAL_CONNECT]: `
In 3-4 sentences, connect this concept to why it matters in practice.
{clinical_context}
If PYQ data is available, mention the exam relevance concretely.
Do not introduce new mechanism here.`,

  [TeachingPhase.FEYNMAN_CHECK]: `
Ask the student to explain this concept back to you in their own words, as if
teaching a junior student who has never encountered it. Emphasise that you want
their phrasing, not textbook phrasing. Wait for their explanation.`,

  [TeachingPhase.CONSOLIDATE]: `
Produce a structured recap:
  1. The concept in one sentence
  2. The 3 key points, each with its page citation
  3. The misconception that was addressed, restated as a warning
  4. What to review and when
Keep it scannable. This is what the student will screenshot.`,
};
```

### 6.7 Check evaluation

```typescript
async function evaluateCheckResponse(
  studentResponse: string,
  check: PendingCheck,
  ctx: SessionContext
): Promise<CheckEvaluation> {

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Evaluate a student's answer to a comprehension check during a
teaching session. Be generous about phrasing and terminology — judge whether
the student grasped the IDEA, not whether they used textbook wording.

Concept being taught: ${ctx.concept.canonical_name}
Check question: "${check.question}"
Expected understanding: "${check.expected_answer}"
Student's answer: "${studentResponse}"

Known misconceptions for this concept:
${ctx.misconceptions.map(m => `- ${m.statement}`).join("\n") || "(none recorded)"}

Return JSON only:
{
  "passed": true/false,
  "confidence": 0.0-1.0,
  "diagnosed_gap": "the specific thing they misunderstood, or null if passed",
  "matched_misconception_id": "id if their answer matches a known misconception, else null",
  "partial_credit": true/false,
  "encouragement_note": "one short phrase acknowledging what they DID get right"
}`
    }]
  });

  return JSON.parse(stripFences(response.content[0].text));
}
```

---

## 7. F-20-D: Explanation Strategy Engine

### 7.1 The ten strategies

```typescript
export enum Strategy {
  ANALOGY            = "analogy",
  FIRST_PRINCIPLES   = "first_principles",
  WORKED_EXAMPLE     = "worked_example",
  CONTRAST_PAIR      = "contrast_pair",
  CONCRETE_INSTANCE  = "concrete_instance",
  VISUAL_SPATIAL     = "visual_spatial",
  EXTREME_CASE       = "extreme_case",
  ERROR_ANALYSIS     = "error_analysis",
  NARRATIVE_HISTORY  = "narrative_history",
  MNEMONIC           = "mnemonic",
}
```

### 7.2 Concept type → strategy mapping

```typescript
export const STRATEGY_MAP: Record<ConceptType, Strategy[]> = {
  process_mechanism: [
    Strategy.VISUAL_SPATIAL, Strategy.FIRST_PRINCIPLES,
    Strategy.EXTREME_CASE, Strategy.NARRATIVE_HISTORY, Strategy.ANALOGY
  ],
  structure_anatomy: [
    Strategy.VISUAL_SPATIAL, Strategy.ANALOGY,
    Strategy.MNEMONIC, Strategy.CONTRAST_PAIR, Strategy.CONCRETE_INSTANCE
  ],
  law_relationship: [
    Strategy.FIRST_PRINCIPLES, Strategy.EXTREME_CASE,
    Strategy.WORKED_EXAMPLE, Strategy.ANALOGY, Strategy.VISUAL_SPATIAL
  ],
  classification: [
    Strategy.CONTRAST_PAIR, Strategy.MNEMONIC,
    Strategy.CONCRETE_INSTANCE, Strategy.VISUAL_SPATIAL
  ],
  procedure_calculation: [
    Strategy.WORKED_EXAMPLE, Strategy.ERROR_ANALYSIS,
    Strategy.CONCRETE_INSTANCE, Strategy.FIRST_PRINCIPLES
  ],
  causal_chain: [
    Strategy.NARRATIVE_HISTORY, Strategy.VISUAL_SPATIAL,
    Strategy.CONCRETE_INSTANCE, Strategy.EXTREME_CASE
  ],
  definition: [
    Strategy.CONTRAST_PAIR, Strategy.CONCRETE_INSTANCE, Strategy.MNEMONIC
  ],
};

// Strategies that are actively unhelpful for certain concept types
export const STRATEGY_ANTIPATTERNS: Record<ConceptType, Strategy[]> = {
  process_mechanism:     [Strategy.MNEMONIC],       // hides the logic
  structure_anatomy:     [Strategy.FIRST_PRINCIPLES],
  law_relationship:      [Strategy.NARRATIVE_HISTORY],  // as sole strategy
  classification:        [Strategy.EXTREME_CASE],
  procedure_calculation: [Strategy.ANALOGY],        // as sole strategy
  causal_chain:          [Strategy.MNEMONIC],
  definition:            [Strategy.EXTREME_CASE],
};
```

### 7.3 Selection

```typescript
export function selectStrategy(
  ctx: SessionContext,
  session: TeachingSession
): Strategy {

  const conceptType = ctx.concept.concept_type as ConceptType;

  let candidates = STRATEGY_MAP[conceptType]
    .filter(s => !STRATEGY_ANTIPATTERNS[conceptType].includes(s))
    .filter(s => !session.strategies_failed.includes(s))
    .filter(s => !session.strategies_attempted.includes(s));

  // Exhausted — allow attempted-but-not-failed strategies back in
  if (candidates.length === 0) {
    candidates = STRATEGY_MAP[conceptType]
      .filter(s => !session.strategies_failed.includes(s));
  }
  if (candidates.length === 0) candidates = [Strategy.CONCRETE_INSTANCE];

  // VISUAL_SPATIAL only if an image is actually available
  if (!ctx.hasRelevantImage) {
    candidates = candidates.filter(s => s !== Strategy.VISUAL_SPATIAL);
  }

  // Faculty profile policies
  const profile = ctx.teachingProfile;
  if (profile.analogy_policy === "avoid") {
    candidates = candidates.filter(s => s !== Strategy.ANALOGY);
  }
  if (profile.mnemonic_policy === "only_for_lists" && conceptType !== "classification") {
    candidates = candidates.filter(s => s !== Strategy.MNEMONIC);
  }

  // Learner preference: strategies that historically worked for this student
  const learnerPrefs = ctx.learnerModel.strategy_success_rates ?? {};
  candidates.sort((a, b) => (learnerPrefs[b] ?? 0.5) - (learnerPrefs[a] ?? 0.5));

  // Faculty ordering as a tiebreaker
  const facultyOrder = profile.strategy_preference_order ?? [];
  candidates.sort((a, b) => {
    const ai = facultyOrder.indexOf(a), bi = facultyOrder.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return candidates[0];
}
```

### 7.4 Strategy prompt fragments

```typescript
export const STRATEGY_INSTRUCTIONS: Record<Strategy, string> = {
  analogy: `Explain by mapping this onto a familiar everyday domain the student
already understands. Make the mapping explicit — state which part of the analogy
corresponds to which part of the concept. Then state where the analogy BREAKS
DOWN, so they do not over-extend it.`,

  first_principles: `Build this up from something the student already accepts as
true. Start from the foundational relationship and derive forward, one logical
step at a time. Do not assert the conclusion — arrive at it.`,

  worked_example: `Demonstrate with one complete concrete instance. Narrate your
reasoning at each step, including why you chose this approach over alternatives.
Use real numbers or a real case, not placeholders.`,

  contrast_pair: `Define this by explicit contrast with the concept students most
often confuse it with. Structure it as: "X is ___. Y is ___. The difference is
___." Make the distinguishing feature unmistakable.`,

  concrete_instance: `Move from the abstract statement to one specific, vivid,
concrete case. Use actual values, an actual patient presentation, or an actual
circuit. Specificity is what makes this work.`,

  visual_spatial: `A figure from the student's textbook accompanies this message.
Direct their attention to specific parts of it. Use spatial language — above,
below, flowing into, branching from. Reference the visible labels by name.`,

  extreme_case: `Push a variable to its limit and ask what happens. Extremes make
mechanisms visible in a way that normal ranges do not. Then bring it back to the
physiological or operational range.`,

  error_analysis: `Present a plausible but incorrect line of reasoning and ask the
student to identify where it goes wrong. This works only if they already partly
grasp the concept — use it to consolidate, not to introduce.`,

  narrative_history: `Tell the story of how this was discovered or figured out.
Who, when, what problem they were trying to solve, what surprised them. Keep it
to 3-4 sentences and land on the insight itself.`,

  mnemonic: `Provide a memory device for the arbitrary, order-dependent, or
list-based part of this concept. Be explicit that the mnemonic aids RECALL only —
it is not a substitute for understanding the underlying logic.`,
};
```

---

## 8. F-20-E: Adaptive Difficulty & Learner Model

### 8.1 The four-rung difficulty ladder

```typescript
export enum DifficultyLevel {
  L0_DIRECT_TELL      = 0,  // state plainly, twice, in two phrasings
  L1_EVERYDAY_ANALOGY = 1,  // mapped entirely outside the domain
  L2_CONCRETE_CASE    = 2,  // specific instance with real values
  L3_ABSTRACT_FORMAL  = 3,  // the textbook statement in textbook terms
}

export const LEVEL_INSTRUCTIONS: Record<DifficultyLevel, string> = {
  [DifficultyLevel.L3_ABSTRACT_FORMAL]: `Use the formal, technical statement of
this concept, in the terminology the textbook uses. Assume the student can handle
precise language.`,

  [DifficultyLevel.L2_CONCRETE_CASE]: `Ground every claim in a specific concrete
case with real values. Introduce technical terms only after the concrete case has
made the idea clear.`,

  [DifficultyLevel.L1_EVERYDAY_ANALOGY]: `Explain using only everyday language and
an analogy from outside the subject entirely. Introduce at most ONE technical term,
and define it in the same sentence.`,

  [DifficultyLevel.L0_DIRECT_TELL]: `Do not question, do not build up. State the
key fact plainly. Then immediately restate it a second time in completely different
words. Then ask the student to repeat it back in their own words.`,
};
```

### 8.2 Level transitions

```typescript
const COMPRESS_THRESHOLD = 0.90;   // rolling success above this → climb / compress
const HOLD_FLOOR         = 0.65;   // between floor and compress → hold
const BACKTRACK_FLOOR    = 0.40;   // below this across 3 checks → back-track

function adjustDifficulty(session: TeachingSession): DifficultyLevel {
  const recent = session.check_history.slice(-4);
  if (recent.length === 0) return session.current_difficulty_level;

  const rate = recent.filter(c => c.passed).length / recent.length;
  const lvl  = session.current_difficulty_level;

  // Two consecutive passes → climb one rung
  const last2 = session.check_history.slice(-2);
  if (last2.length === 2 && last2.every(c => c.passed) && lvl < 3) {
    return (lvl + 1) as DifficultyLevel;
  }

  // Any failure → drop one rung
  if (!recent.at(-1)!.passed && lvl > 0) {
    return (lvl - 1) as DifficultyLevel;
  }

  return lvl;
}
```

### 8.3 The learner model

```js
// learner_models collection — one document per student
{
  _id: UUID,
  student_id: UUID,
  college_id: UUID,
  dept_id: UUID,

  // Per-concept mastery, keyed by concept_id
  concept_mastery: {
    "<concept_id>": {
      confidence: 0.78,              // 0-1, EWMA over check outcomes
      checks_passed: 12,
      checks_failed: 3,
      last_taught_at: Date,
      last_confirmed_at: Date,
      highest_level_passed: 3,       // deepest difficulty rung they succeeded at
      sessions_count: 2,
    }
  },

  // Misconceptions this student has demonstrably held
  held_misconceptions: [
    {
      misconception_id: UUID,
      concept_id: UUID,
      first_observed: Date,
      last_observed: Date,
      times_observed: 3,
      corrected: Boolean,            // true once they pass the post-correction check
      corrected_at: Date,
    }
  ],

  // Which explanation strategies work for this student
  strategy_success_rates: {
    "analogy": 0.86,                 // passed 86% of checks following an analogy
    "first_principles": 0.41,
    "worked_example": 0.72,
    "visual_spatial": 0.91,
  },
  strategy_sample_counts: { "analogy": 14, "first_principles": 17, ... },

  // Pace
  avg_checks_to_mastery: 4.2,
  avg_session_duration_minutes: 14,
  preferred_difficulty_entry_level: 2,   // where sessions should start for them

  // Aggregate
  total_teaching_sessions: 23,
  total_concepts_taught: 19,
  total_backtracks_triggered: 6,

  updated_at: Date,
}
```

### 8.4 Updating the model

```typescript
async function updateLearnerModelFromCheck(
  session: TeachingSession,
  evaluation: CheckEvaluation,
  collegeId: string
) {
  const conceptId = session.concept_id;
  const strategy  = session.current_strategy;
  const model     = await getLearnerModel(session.student_id, collegeId);

  // ── Concept mastery: exponentially weighted moving average ───────────
  const prior = model.concept_mastery[conceptId] ?? {
    confidence: 0.3, checks_passed: 0, checks_failed: 0,
    highest_level_passed: 0, sessions_count: 0
  };

  const alpha  = 0.35;   // EWMA weight for the newest observation
  const signal = evaluation.passed ? evaluation.confidence : (1 - evaluation.confidence) * 0.3;

  prior.confidence = alpha * signal + (1 - alpha) * prior.confidence;
  evaluation.passed ? prior.checks_passed++ : prior.checks_failed++;
  if (evaluation.passed) {
    prior.highest_level_passed = Math.max(
      prior.highest_level_passed, session.current_difficulty_level
    );
    prior.last_confirmed_at = new Date();
  }
  prior.last_taught_at = new Date();
  model.concept_mastery[conceptId] = prior;

  // ── Strategy effectiveness for this student ──────────────────────────
  if (strategy) {
    const n    = (model.strategy_sample_counts[strategy] ?? 0) + 1;
    const rate = model.strategy_success_rates[strategy] ?? 0.5;
    model.strategy_success_rates[strategy] =
      rate + (Number(evaluation.passed) - rate) / n;   // running mean
    model.strategy_sample_counts[strategy] = n;
  }

  // ── Misconception tracking ───────────────────────────────────────────
  if (evaluation.matched_misconception_id) {
    const existing = model.held_misconceptions.find(
      m => m.misconception_id === evaluation.matched_misconception_id
    );
    if (existing) {
      existing.times_observed++;
      existing.last_observed = new Date();
      existing.corrected = false;
    } else {
      model.held_misconceptions.push({
        misconception_id: evaluation.matched_misconception_id,
        concept_id: conceptId,
        first_observed: new Date(),
        last_observed: new Date(),
        times_observed: 1,
        corrected: false,
      });
    }
  }

  await saveLearnerModel(model, collegeId);
}
```

### 8.5 Student override controls

```typescript
export type StudentControl =
  | "i_dont_get_it"    // force rung down + strategy switch
  | "simpler"          // force rung down, keep strategy
  | "go_deeper"        // force rung up
  | "show_picture"     // jump to VISUALISE phase
  | "just_tell_me"     // drop to L0, but still run MISCONCEPTION + FEYNMAN
  | "skip_ahead"       // advance phase
  | "end_session";     // jump to CONSOLIDATE

// "just_tell_me" deliberately does NOT end the session — it drops to a direct
// explanation and then still routes through misconception correction and the
// Feynman check, because those are where retention actually comes from.
```

---

## 9. F-20-F: Faculty Teaching Profile

### 9.1 Why this matters commercially

A generic consumer study app cannot encode a specific department's pedagogical philosophy. MediMind can, because it has the institutional relationship. This turns "AI tutor" into "your department's AI tutor."

### 9.2 Schema

```js
// teaching_profiles collection — one per department
{
  _id: UUID,
  college_id: UUID,
  dept_id: UUID,

  strategy_preference_order: [
    "first_principles", "visual_spatial", "worked_example",
    "extreme_case", "analogy", "contrast_pair"
  ],

  analogy_policy: "sparing",          // sparing | liberal | avoid
  mnemonic_policy: "only_for_lists",  // freely | only_for_lists | avoid
  rigour_level: "high",               // high | balanced | accessible
                                       // affects how closely L3 tracks textbook wording

  always_include_clinical_connect: true,
  require_feynman_check: true,
  require_misconception_probe: true,

  default_bloom_target: "apply",      // remember | understand | apply | analyse
  default_entry_difficulty: 2,
  max_session_minutes: 20,
  max_backtrack_depth: 2,

  custom_instruction: "Always relate mechanisms back to the underlying physiology before discussing pharmacological intervention. Avoid clinical shortcuts until the mechanism is secure.",

  configured_by: UUID,                // dept_admin_id
  updated_at: Date,
}
```

### 9.3 Where the profile is injected

```typescript
function buildTeachingSystemPrompt(params: PromptParams): string {
  const { phase, strategy, difficultyLevel, concept, teachingProfile,
          learnerModel, misconception, sourceChunks, deptName } = params;

  return `You are teaching a ${deptName} student one concept, one step at a time.
You are NOT answering a question — you are running a structured teaching session.

CONCEPT: ${concept.canonical_name}
Definition: ${concept.one_line_definition}
Type: ${concept.concept_type}

SOURCE MATERIAL — everything you say must be grounded in this:
${sourceChunks.map(c => `[Page ${c.page}] ${c.text}`).join("\n\n")}

CURRENT PHASE: ${PHASE_DEFINITIONS[phase].name}
${PHASE_INSTRUCTIONS[phase]}

EXPLANATION STRATEGY: ${strategy}
${STRATEGY_INSTRUCTIONS[strategy]}

DIFFICULTY LEVEL: L${difficultyLevel}
${LEVEL_INSTRUCTIONS[difficultyLevel]}

${misconception ? `MISCONCEPTION IN PLAY:
Students commonly believe: "${misconception.statement}"
Correct model: "${misconception.correct_model}"` : ""}

DEPARTMENT TEACHING PROFILE:
- Rigour: ${teachingProfile.rigour_level}
- Analogies: ${teachingProfile.analogy_policy}
- Mnemonics: ${teachingProfile.mnemonic_policy}
${teachingProfile.custom_instruction ? `- Faculty instruction: ${teachingProfile.custom_instruction}` : ""}

WHAT YOU KNOW ABOUT THIS STUDENT:
- Strategies that work well for them: ${topStrategies(learnerModel)}
- Prerequisite concepts confirmed: ${confirmedPrereqs(learnerModel, concept)}
${heldMisconceptionsNote(learnerModel, concept)}

HARD RULES:
- Never exceed 5 sentences before pausing for the student.
- Every factual claim must cite its page: "— Page X".
- Never invent content not present in the source material above.
- If the student's answer is partly right, say what was right BEFORE correcting.
- Never say "as I mentioned" or "as we discussed" — students find it condescending.
- Do not move to the next step until the current check is answered.`;
}
```

---

## 10. F-20-G: Session Interface

### 10.1 Entry points

```
1. Chapter Navigator → concept list → "Teach me this"
2. Chat → student types "teach me X" → intent detected → session opens
3. Quiz results → weak concept → "Teach me this properly"
4. SRS card failed twice → "Want me to teach this again?"
5. Faculty assignment → "Your HOD suggested you work through these 4 concepts"
```

### 10.2 Session UI

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Exit    Teaching: Frank-Starling law         Guyton Ch.12 · Pg 218-220│
├─────────────────────────────────────────────────────────────────────────┤
│ ●━━●━━●━━○━━○━━○━━○━━○━━○━━○     Phase 3 of 10 · Build                │
│ Diagnose Anchor Build Visual Model Practice Error Clinical Feynman Recap│
├──────────────────────────────────────────┬──────────────────────────────┤
│                                          │  CONCEPT MAP                 │
│  AI · BUILD · step 2 of 4                │  ─────────────               │
│  More blood returning stretches the      │  ✓ Sarcomere overlap         │
│  ventricle further. That stretch pulls   │  ✓ Preload                   │
│  actin and myosin into more favourable   │  ▶ Frank-Starling law        │
│  overlap — so the next contraction is    │  ○ Cardiac output            │
│  stronger. — Page 218                    │                              │
│                                          │  SESSION                     │
│  What do you think happens if you        │  ─────────────               │
│  stretch it TOO far?                     │  Checks passed  4 / 6        │
│                                          │  Level          L2 ▲         │
│  ┌────────────────────────────────────┐ │  Strategy       analogy      │
│  │ Type your answer...                │ │  Backtracks     1            │
│  └────────────────────────────────────┘ │  Elapsed        7 min        │
│                                          │                              │
│  [I don't get it] [Simpler] [Go deeper]  │  Session will create 3 SRS   │
│  [Show me a picture] [Just tell me]      │  cards when you finish.      │
└──────────────────────────────────────────┴──────────────────────────────┘
```

### 10.3 The consolidation card — what students screenshot

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✓ Session complete · Frank-Starling law · 16 minutes                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ IN ONE SENTENCE                                                          │
│ The more the heart muscle is stretched before contracting, the more      │
│ forcefully it contracts — up to an optimal point.                        │
│                                                                          │
│ THE THREE KEY POINTS                                                     │
│ 1. Increased venous return → increased end-diastolic volume → greater    │
│    sarcomere stretch                          — Guyton Ch.12, Pg 218     │
│ 2. Greater stretch → more favourable actin-myosin overlap → stronger     │
│    contraction                                — Guyton Ch.12, Pg 218     │
│ 3. Beyond optimal length, overlap decreases and force FALLS — this is    │
│    the descending limb                        — Guyton Ch.12, Pg 220     │
│                                                                          │
│ ⚠ THE ERROR YOU ALMOST MADE                                              │
│ You initially thought more stretch always means more force. It does not  │
│ — past optimal sarcomere length, force decreases. This is exactly what   │
│ the descending limb of the curve shows.                                  │
│                                                                          │
│ 📋 EXAM RELEVANCE                                                        │
│ This concept appeared in 6 questions across your university's last 3     │
│ papers, including a 10-mark question in VTU June 2024.                   │
│                                                                          │
│ 🔄 REVIEW SCHEDULE                                                       │
│ 3 cards added to your daily review. First review: tomorrow.              │
│                                                                          │
│ [Teach me Cardiac output next →]  [Quiz me on this]  [Save notes]       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.4 SRS hand-off

```typescript
async function createSRSCardsFromSession(
  session: TeachingSession,
  ctx: SessionContext,
  collegeId: string
): Promise<string[]> {

  // Seed cards from the checks the student found HARDEST — not generic content
  const hardestChecks = session.check_history
    .filter(c => !c.passed || c.confidence < 0.7)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, 3);

  const cards: SRSCardInput[] = hardestChecks.map(check => ({
    student_id: session.student_id,
    college_id: collegeId,
    dept_id: session.dept_id,
    doc_id: session.doc_id,
    chapter_index: ctx.concept.chapter_index,
    subject_id: session.subject_id,
    question_text: check.question,
    question_type: "SAQ",
    correct_answer: check.expected_answer,
    explanation: `${check.expected_answer}\n\n— ${ctx.docFilename}, Page ${ctx.concept.source_pages[0]}`,
    source_page: ctx.concept.source_pages[0],
    bloom_level: ctx.concept.bloom_ceiling,
    origin: "teaching_session",
    origin_session_id: session._id,
  }));

  // Always add one card for the misconception that was corrected
  if (session.misconception_addressed_id) {
    const m = ctx.misconceptions.find(x => x._id === session.misconception_addressed_id);
    if (m) {
      cards.push({
        student_id: session.student_id,
        college_id: collegeId,
        dept_id: session.dept_id,
        doc_id: session.doc_id,
        chapter_index: ctx.concept.chapter_index,
        subject_id: session.subject_id,
        question_text: m.diagnostic_probe,
        question_type: "SAQ",
        correct_answer: m.probe_correct_answer,
        explanation: `Correct model: ${m.correct_model}\n\nCommon error: ${m.statement}`,
        source_page: ctx.concept.source_pages[0],
        bloom_level: "understand",
        origin: "teaching_session_misconception",
        origin_session_id: session._id,
      });
    }
  }

  return await bulkCreateSRSCards(cards, collegeId);   // F-14-A
}
```

### 10.5 Faculty analytics view

Teaching sessions produce data no other feature can: exactly where students get stuck.

```
Teaching Analytics · Physiology · Last 30 days

MOST-TAUGHT CONCEPTS               SESSIONS   AVG CHECKS   BACKTRACK RATE
Frank-Starling law                      84         6.2          38% ⚠
Cardiac output                          71         4.1          12%
Countercurrent multiplier               63         7.8          51% ⚠⚠
Action potential phases                 58         5.0          19%

⚠ 51% of students teaching themselves the countercurrent multiplier required
  a prerequisite back-track — most commonly to "osmolarity gradients".
  Consider covering that explicitly in lecture before this topic.

TOP MISCONCEPTIONS OBSERVED                          STUDENTS   CORRECTED
"More stretch always means more force"                     47        81%
"Afterload increase raises stroke volume"                  39        74%
"Loop of Henle actively pumps water"                       31        58% ⚠

⚠ The Loop of Henle misconception is only corrected 58% of the time.
  The current correction may need rewording.  [Review correction text]
```

---

## 11. Database Schema

### 11.1 `concept_graph`

```js
{
  _id: UUID,
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,
  doc_id: UUID,

  canonical_name: String,
  aliases: [String],
  concept_type: Enum["process_mechanism","structure_anatomy","law_relationship",
                     "classification","procedure_calculation","causal_chain","definition"],
  one_line_definition: String,

  chapter_index: Number,
  source_pages: [Number],

  prerequisite_ids: [UUID],
  prerequisite_names: [String],       // denormalised for display

  bloom_ceiling: Enum["remember","understand","apply","analyse"],
  difficulty_rating: Number,          // 0-1
  is_examinable: Boolean,
  pyq_frequency: Number,              // populated from F-13-E

  extraction_method: Enum["llm_chapter_pass","faculty_authored","faculty_edited"],
  reviewed_by_faculty: Boolean,
  concept_graph_version: Number,

  created_at: Date,
  updated_at: Date,
}

db.concept_graph.createIndex({ dept_id: 1, canonical_name: 1 });
db.concept_graph.createIndex({ doc_id: 1, chapter_index: 1 });
db.concept_graph.createIndex({ prerequisite_ids: 1 });
db.concept_graph.createIndex({ dept_id: 1, aliases: 1 });
```

### 11.2 `misconceptions`

```js
{
  _id: UUID,
  concept_id: UUID,
  college_id: UUID,
  dept_id: UUID,

  statement: String,
  correct_model: String,
  root_cause: String,
  diagnostic_probe: String,
  probe_correct_answer: String,
  probe_wrong_answer: String,

  source: Enum["llm_seeded","observed_from_students","seeded_and_observed","faculty_authored"],
  observed_count: Number,
  first_observed: Date,
  last_observed: Date,

  times_probed: Number,
  times_corrected: Number,
  correction_success_rate: Number,     // recomputed nightly

  reviewed_by_faculty: Boolean,
  priority_rank: Number,               // which to probe first if several exist

  created_at: Date,
  updated_at: Date,
}

db.misconceptions.createIndex({ concept_id: 1, priority_rank: 1 });
db.misconceptions.createIndex({ dept_id: 1, observed_count: -1 });
db.misconceptions.createIndex({ dept_id: 1, correction_success_rate: 1 });
```

### 11.3 `teaching_sessions`

```js
{
  _id: UUID,
  student_id: UUID,
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,
  doc_id: UUID,
  concept_id: UUID,

  // Nesting
  parent_session_id: UUID,             // null unless this is a back-track session
  is_nested: Boolean,
  backtrack_stack: [{
    prerequisite_concept_id: UUID,
    parent_phase: Number,
    parent_step_index: Number,
    opened_at: Date,
    closed_at: Date,
  }],
  backtrack_active: Boolean,

  // State machine
  current_phase: Number,
  current_step_index: Number,
  build_steps_total: Number,
  build_steps_remaining: Number,
  current_difficulty_level: Number,
  current_strategy: String,
  strategies_attempted: [String],
  strategies_failed: [String],
  enabled_phases: [Number],            // subset for nested/compressed sessions
  phase_turn_count: Number,
  turn_count: Number,

  awaiting_check_response: Boolean,
  pending_check: {
    question: String,
    expected_answer: String,
    bloom_level: String,
  },

  // History
  turns: [{
    role: Enum["assistant","student"],
    phase: Number,
    content: String,
    strategy: String,
    difficulty_level: Number,
    image_asset_id: UUID,              // if VISUALISE served an image
    created_at: Date,
  }],

  check_history: [{
    phase: Number,
    step_index: Number,
    question: String,
    expected_answer: String,
    student_answer: String,
    passed: Boolean,
    confidence: Number,
    partial_credit: Boolean,
    difficulty_level: Number,
    strategy_used: String,
    diagnosed_gap: String,
    matched_misconception_id: UUID,
    timestamp: Date,
  }],

  // Outcomes
  status: Enum["in_progress","completed","abandoned"],
  misconception_addressed_id: UUID,
  misconception_corrected: Boolean,
  feynman_score: Number,               // 0-1
  final_mastery_estimate: Number,      // 0-1
  srs_cards_created: [UUID],
  consolidation_summary: String,

  // Metrics
  total_checks: Number,
  checks_passed: Number,
  rungs_dropped: Number,
  backtracks_triggered: Number,
  duration_seconds: Number,
  tokens_used: Number,
  cost_usd: Number,

  started_at: Date,
  completed_at: Date,
}

db.teaching_sessions.createIndex({ student_id: 1, started_at: -1 });
db.teaching_sessions.createIndex({ concept_id: 1, status: 1 });
db.teaching_sessions.createIndex({ dept_id: 1, started_at: -1 });
db.teaching_sessions.createIndex({ parent_session_id: 1 });
```

### 11.4 `learner_models` and `teaching_profiles`

Full schemas in Sections 8.3 and 9.2 respectively.

```js
db.learner_models.createIndex({ student_id: 1 }, { unique: true });
db.learner_models.createIndex({ dept_id: 1 });
db.teaching_profiles.createIndex({ dept_id: 1 }, { unique: true });
```

### 11.5 Additions to `documents`

```js
{
  // existing fields unchanged...
  concept_graph_extracted: Boolean,
  concept_count: Number,
  concept_graph_version: Number,
  misconceptions_seeded: Boolean,
  misconception_count: Number,
}
```

---

## 12. API Route Map

```
# ── Teaching sessions (student) ──────────────────────────────────────
POST   /api/v1/college/:cid/student/teaching/sessions
       Body: { concept_id } OR { concept_query, doc_id, chapter_index }
       Response: { session_id, first_turn, concept, phase_plan }

POST   /api/v1/college/:cid/student/teaching/sessions/:sid/respond
       Body: { response: String }
       Response: TeachingTurn (SSE streamed)

POST   /api/v1/college/:cid/student/teaching/sessions/:sid/control
       Body: { control: "i_dont_get_it" | "simpler" | "go_deeper" |
                        "show_picture" | "just_tell_me" | "skip_ahead" | "end_session" }
       Response: TeachingTurn

GET    /api/v1/college/:cid/student/teaching/sessions/:sid
       Response: full session state (for resume)

GET    /api/v1/college/:cid/student/teaching/sessions
       ?status=&concept_id=&limit=
       Response: { sessions[], total }

POST   /api/v1/college/:cid/student/teaching/sessions/:sid/abandon

# ── Concept discovery (student) ──────────────────────────────────────
GET    /api/v1/college/:cid/student/concepts
       ?doc_id=&chapter_index=&q=
       Response: { concepts[], mastery_per_concept }

GET    /api/v1/college/:cid/student/concepts/:conceptId
       Response: { concept, prerequisites[], mastery, sessions_history }

GET    /api/v1/college/:cid/student/concepts/:conceptId/readiness
       Response: { ready: Boolean, missing_prerequisites[], recommended_order[] }

# ── Learner model (student) ──────────────────────────────────────────
GET    /api/v1/college/:cid/student/learner-model
       Response: { concept_mastery, strategy_preferences, held_misconceptions }

# ── Concept graph management (dept admin) ────────────────────────────
GET    /api/v1/college/:cid/dept-admin/concept-graph
       ?doc_id=&chapter_index=
POST   /api/v1/college/:cid/dept-admin/concept-graph/extract
       Body: { doc_id }   (trigger or re-trigger extraction)
PATCH  /api/v1/college/:cid/dept-admin/concept-graph/:conceptId
       Body: { canonical_name?, prerequisite_ids?, concept_type?, difficulty_rating? }
DELETE /api/v1/college/:cid/dept-admin/concept-graph/:conceptId
POST   /api/v1/college/:cid/dept-admin/concept-graph/validate
       Response: { cycles[], orphans[], suspicious_edges[] }

# ── Misconception management (dept admin) ────────────────────────────
GET    /api/v1/college/:cid/dept-admin/misconceptions
       ?concept_id=&source=&sort=observed_count|correction_success_rate
POST   /api/v1/college/:cid/dept-admin/misconceptions
PATCH  /api/v1/college/:cid/dept-admin/misconceptions/:mid
DELETE /api/v1/college/:cid/dept-admin/misconceptions/:mid
POST   /api/v1/college/:cid/dept-admin/misconceptions/mine
       (manually trigger the nightly mining job)

# ── Teaching profile (dept admin) ────────────────────────────────────
GET    /api/v1/college/:cid/dept-admin/teaching-profile
PUT    /api/v1/college/:cid/dept-admin/teaching-profile

# ── Teaching analytics (dept admin / college admin) ──────────────────
GET    /api/v1/college/:cid/dept-admin/teaching/analytics
       ?days=30
       Response: { most_taught_concepts[], backtrack_hotspots[],
                   misconception_frequency[], avg_checks_to_mastery }

GET    /api/v1/college/:cid/dept-admin/teaching/struggle-report
       Response: { concepts_with_high_backtrack[], low_correction_misconceptions[] }

GET    /api/v1/college/:cid/college-admin/teaching/cross-dept
       Response: cross-department teaching analytics
```

---

## 13. Frontend Component Tree

```
apps/student/app/teaching/
├── page.tsx                                # Concept browser / session launcher
└── [sessionId]/page.tsx                    # Active teaching session

apps/student/components/teaching/
├── TeachingSession.tsx                     # Root session container + SSE consumer
├── PhaseProgressBar.tsx                    # 10-phase stepper with current highlight
├── TeachingTurn.tsx                        # Single AI turn with strategy/level badge
├── CheckInput.tsx                          # Student response input for checks
├── CheckFeedback.tsx                       # Pass/fail with encouragement note
├── StudentControls.tsx                     # I don't get it / Simpler / Deeper / etc.
├── ConceptMapSidebar.tsx                   # Prerequisite chain with mastery ticks
├── SessionMetricsSidebar.tsx               # Checks passed, level, strategy, elapsed
├── BacktrackNotice.tsx                     # "Let's pause — the gap is one step earlier"
├── NestedSessionBanner.tsx                 # Indicates a prerequisite mini-session
├── VisualisePhaseImage.tsx                 # F-17 image inline with narration
├── ConsolidationCard.tsx                   # The end-of-session summary card
├── SRSHandoffNotice.tsx                    # "3 cards added to your review"
└── ConceptReadinessCheck.tsx               # "You should learn X first" gate

apps/student/components/concepts/
├── ConceptBrowser.tsx                      # Browse concepts by chapter
├── ConceptCard.tsx                         # With mastery ring + "Teach me" CTA
└── PrerequisiteChain.tsx                   # Visual dependency chain

apps/admin/components/dept-admin/teaching/
├── ConceptGraphEditor.tsx                  # Review/edit extracted concepts
├── ConceptGraphValidator.tsx               # Cycle/orphan warnings
├── MisconceptionLibrary.tsx                # Browse, edit, add misconceptions
├── MisconceptionEffectiveness.tsx          # Correction success rates, flagged items
├── TeachingProfileEditor.tsx               # Faculty pedagogical configuration
├── TeachingAnalyticsDashboard.tsx          # Most-taught, backtrack hotspots
└── StruggleReport.tsx                      # Actionable "cover this in lecture" report
```

---

## 14. Cost Analysis

### 14.1 Per teaching session

| Component | Calls | Model | Est. cost |
|---|---|---|---|
| Phase turn generation | 12–18 | Haiku | $0.0040 |
| Check evaluation | 6–10 | Haiku | $0.0018 |
| Feynman explanation scoring | 1 | Haiku | $0.0003 |
| Retrieval (embed + rerank per phase) | ~5 | — | $0.0004 |
| Image retrieval (VISUALISE) | 1 | — | $0.0001 |
| **Total per completed session** | | | **≈ $0.0066** |

At 300 active students × 4 sessions/month = 1,200 sessions ≈ **$7.92/month per department**.

### 14.2 One-time ingestion additions

| Component | Model | Cost per textbook |
|---|---|---|
| Concept graph extraction (per chapter) | Sonnet | ~$0.02 × 48 chapters = **$0.96** |
| Misconception seeding (per concept) | Haiku | ~$0.0008 × 412 concepts = **$0.33** |
| **Total added ingestion cost** | | **≈ $1.29 per textbook** |

Against existing per-textbook costs (F-19 contextualisation ~$3.93, F-17 Vision ~$0.57), this is a modest addition.

### 14.3 Nightly jobs

| Job | Frequency | Cost |
|---|---|---|
| Misconception mining (clustering + articulation) | Nightly per dept | ~$0.05/dept/night |
| Correction success rate recomputation | Nightly | ~$0 (aggregation only) |

### 14.4 Total monthly impact per department

```
Teaching sessions:        $7.92
Misconception mining:     $1.50
──────────────────────────────
Total:                    $9.42/month per department
```

Against ₹3,999/month (~$48) department revenue, this consumes roughly 20% of a department's LLM budget — the single most expensive feature in the platform, and justifiably so, since it is the one students will describe as "it actually taught me."

---

## 15. Environment Variables

```bash
# ── Concept graph (F-20-A) ────────────────────────────────────────
CONCEPT_GRAPH_MODEL=claude-sonnet-4-6
CONCEPT_GRAPH_MAX_TOKENS=4096
CONCEPT_EXTRACT_MAX_CHARS=60000
CONCEPT_MIN_PER_CHAPTER=5
CONCEPT_MAX_PER_CHAPTER=15
CONCEPT_GRAPH_AUTO_EXTRACT=true

# ── Misconceptions (F-20-B) ───────────────────────────────────────
MISCONCEPTION_SEED_MODEL=claude-haiku-4-5-20251001
MISCONCEPTION_SEED_COUNT=4
MISCONCEPTION_MIN_ERRORS_TO_MINE=8
MISCONCEPTION_MIN_CLUSTER_SIZE=4
MISCONCEPTION_MINING_CRON=0 3 * * *
MISCONCEPTION_LOW_SUCCESS_ALERT=0.60

# ── Teaching engine (F-20-C, F-20-D, F-20-E) ─────────────────────
TEACHING_MODEL=claude-haiku-4-5-20251001
TEACHING_MAX_TOKENS_PER_TURN=1200
TEACHING_CHECK_EVAL_MODEL=claude-haiku-4-5-20251001

TEACHING_COMPRESS_THRESHOLD=0.90
TEACHING_HOLD_FLOOR=0.65
TEACHING_BACKTRACK_FLOOR=0.40
TEACHING_PREREQ_CONFIRMED_THRESHOLD=0.65

TEACHING_MAX_BACKTRACK_DEPTH=2
TEACHING_MAX_SESSION_TURNS=45
TEACHING_MAX_SESSION_MINUTES=25
TEACHING_DEFAULT_ENTRY_LEVEL=2
TEACHING_BUILD_STEPS_DEFAULT=4

TEACHING_SRS_CARDS_PER_SESSION=3
TEACHING_SRS_HANDOFF_ENABLED=true

# ── Session persistence ───────────────────────────────────────────
TEACHING_SESSION_RESUME_WINDOW_HOURS=48
TEACHING_ABANDON_AFTER_IDLE_MINUTES=45
```

---

## 16. Build Order

Add as **Phase 18 — Adaptive Teaching Engine**, after Phase 17 (F-19).

```
Phase 18 — Adaptive Teaching Engine

Step 1 — Concept graph extraction (F-20-A)
  → Create concept_graph collection + indexes
  → Implement extract_concept_graph.py with chapter-ordered prerequisite constraint
  → Implement detect_cycles() + break_cycles()
  → Implement resolve_prerequisite_ids() (name → id, alias-aware)
  → Wire into ingestion pipeline after F-13-A chapter extraction
  → Add concept_graph_extracted flags to documents
  → Test: extract from Guyton → verify ~400 concepts, zero cycles
  → Test: verify no concept in Ch.9 depends on a concept from Ch.30
  → Build ConceptGraphEditor.tsx + ConceptGraphValidator.tsx for faculty review

Step 2 — Misconception seeding (F-20-B, part 1)
  → Create misconceptions collection + indexes
  → Implement seeding pass over extracted concepts
  → Verify diagnostic_probe quality on 20 sampled concepts manually
  → Build MisconceptionLibrary.tsx browse/edit UI
  → Test: verify each seeded misconception has a probe that actually
    discriminates (a student with the correct model answers differently)

Step 3 — Learner model + teaching profile (F-20-E, F-20-F)
  → Create learner_models + teaching_profiles collections
  → Implement getLearnerModel / saveLearnerModel with EWMA mastery update
  → Implement default teaching profile per department on dept creation
  → Build TeachingProfileEditor.tsx
  → Test: verify strategy_success_rates update correctly as running mean

Step 4 — Strategy engine (F-20-D)
  → Implement STRATEGY_MAP, STRATEGY_ANTIPATTERNS, STRATEGY_INSTRUCTIONS
  → Implement selectStrategy() with failure exclusion + profile ordering
  → Unit test: verify a failed strategy is never reselected in the same session
  → Unit test: verify VISUAL_SPATIAL excluded when no image available

Step 5 — State machine core (F-20-C)
  → Create teaching_sessions collection + indexes
  → Implement PHASE_DEFINITIONS with skip conditions
  → Implement advanceTeachingSession() orchestrator
  → Implement decideNextAction() with all transition rules
  → Implement generatePhaseTurn() + buildTeachingSystemPrompt()
  → Implement evaluateCheckResponse()
  → Test: run a full 10-phase session end to end on a known concept
  → Test: force check failures → verify rung drops L3→L2→L1→L0
  → Test: verify phase maxTurns guard prevents infinite loops

Step 6 — Prerequisite back-tracking (F-20-C)
  → Implement inferMissingPrerequisite()
  → Implement openNestedPrerequisiteSession()
  → Implement nested session resume into parent
  → Enforce TEACHING_MAX_BACKTRACK_DEPTH
  → Test: teach Frank-Starling to a student with no sarcomere mastery →
    verify back-track triggers and resumes correctly
  → Test: verify depth limit prevents recursive back-track chains

Step 7 — Phase integrations
  → VISUALISE → F-17 image retrieval + inline display
  → CLINICAL_CONNECT → F-14-B clinical case pool + F-13-E PYQ frequency
  → Checks → F-13-D quiz generator, scoped to one step
  → CONSOLIDATE → F-14-A SRS card creation from hardest checks
  → Test: verify SRS cards created carry origin="teaching_session"

Step 8 — Student UI (F-20-G)
  → TeachingSession.tsx with SSE streaming
  → PhaseProgressBar.tsx, ConceptMapSidebar.tsx, SessionMetricsSidebar.tsx
  → StudentControls.tsx (all 7 controls)
  → BacktrackNotice.tsx, NestedSessionBanner.tsx
  → ConsolidationCard.tsx
  → ConceptBrowser.tsx + ConceptReadinessCheck.tsx
  → Test: session resume after 24h → verify state restored correctly

Step 9 — Misconception mining (F-20-B, part 2)
  → Implement mine-misconceptions.ts nightly job
  → Implement clusterWrongAnswers() + articulateMisconception()
  → Implement correction_success_rate tracking
  → Build MisconceptionEffectiveness.tsx with low-success flagging
  → Test: seed 20 synthetic wrong answers on one concept →
    verify a new observed misconception is promoted

Step 10 — Faculty analytics
  → TeachingAnalyticsDashboard.tsx (most-taught, backtrack hotspots)
  → StruggleReport.tsx with actionable recommendations
  → Cross-department view for College Admin (F-16)
  → Test: verify backtrack_rate correctly identifies prerequisite gaps

Step 11 — Cost metering
  → Wire teaching session token usage into F-12 cost_events
  → Add action_type "teaching_session" and "concept_graph_extraction"
  → Verify per-session cost lands near the $0.0066 estimate

Step 12 — Deprecate F-13-G
  → Remove the Socratic toggle from chapter chat
  → Redirect "Teach me" intent to the new session endpoint
  → Migrate any existing socratic-mode session logs
```

---

## 17. Evaluation Plan

### 17.1 Metrics

| Metric | Definition | Target |
|---|---|---|
| **Session completion rate** | Sessions reaching CONSOLIDATE / sessions started | > 70% |
| **Post-session mastery gain** | Δ concept_mastery.confidence before vs after | > +0.30 |
| **7-day retention** | SRS card pass rate at first review for teaching-origin cards | > 75% |
| **vs. read-only baseline** | Mastery gain vs students who only read the chapter | > 2× |
| **Back-track precision** | % of back-tracks where the nested concept check then passes | > 80% |
| **Misconception correction rate** | times_corrected / times_probed | > 70% |
| **Median session duration** | Start to CONSOLIDATE | 12–18 min |
| **Rung-drop frequency** | Avg rungs dropped per session | 1–2 (indicates correct calibration) |

A rung-drop frequency near zero means the engine is starting too easy; above three means it is starting too hard.

### 17.2 A/B design

```
Cohort A (control):  Chapter chat + quiz only, existing F-13-G Socratic toggle
Cohort B (treatment): Full F-20 teaching engine

Same concepts, same chapter, same department, randomised by student.

Measure at day 0 (immediately post-session) and day 7 (SRS first review):
  - Concept mastery estimate
  - Quiz score on that concept
  - Self-reported confidence (1-5)

Ship if: day-7 retention in Cohort B exceeds Cohort A by > 15 percentage points.
```

### 17.3 Qualitative check

Have three faculty members review 10 full session transcripts each, scoring:
- Was the sequencing pedagogically sound?
- Were the explanations accurate to the source textbook?
- Would you be comfortable with a student learning this way?
- Did the misconception correction actually address the error?

Any transcript scoring below 3/5 on accuracy triggers a prompt revision before rollout.

---

*Document: F-20-adaptive-teaching-engine.md · v1.0 · May 2026*
*Supersedes: F-13-G Socratic Learning Mode (in F-13-book-intelligence-system.md)*
*Extends: F-13-A (chapter maps) · F-13-D (quiz engine) · F-13-E (PYQ radar) · F-14-A (SRS) · F-14-B (clinical cases) · F-16 (roles) · F-17 (images) · F-19 (retrieval)*
*Companion analysis: `teach-me-engine-analysis.html`*
*For Claude Code: Phase 18, 12 steps. Steps 1-2 are ingestion-side and must complete before any teaching session can run. Steps 3-6 are the engine core and must be built in order. Steps 7-11 are integrations and can be parallelised. Step 12 removes the old implementation only after the new one is verified.*
