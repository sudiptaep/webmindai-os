# F-18: RAG Quality & Response Reliability Engine
## Extraction Quality · Retrieval Precision · Reranking · Truncation Fix · Frontier Comparison Lab

> **Parent doc:** `college-chatbot-architecture.md` v2.0 (F-03 ingestion, F-09 RAG pipeline)  
> **Trigger:** Student feedback reports response quality is poor and responses are getting cut off mid-answer. Investigation traced this to five concrete, fixable root causes in the existing pipeline.  
> **Scope:** (A) Fix the extraction quality scoring formula and the underlying extraction pipeline. (B) Improve retrieval precision in the RAG query pipeline. (C) Formalise and tune the reranking stage already specified in F-09. (D) Fix the response truncation bug. (E) Build a Frontier Model Comparison Lab for ongoing quality regression testing.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [Executive Summary of Findings](#1-executive-summary-of-findings)
2. [F-18-A: Extraction Quality Improvement](#2-f-18-a-extraction-quality-improvement)
3. [F-18-B: Retrieval Precision Improvement](#3-f-18-b-retrieval-precision-improvement)
4. [F-18-C: Reranking — Formalisation & Tuning](#4-f-18-c-reranking--formalisation--tuning)
5. [F-18-D: Response Truncation Fix](#5-f-18-d-response-truncation-fix)
6. [F-18-E: Frontier Model Comparison Lab](#6-f-18-e-frontier-model-comparison-lab)
7. [Database Schema — All Changes](#7-database-schema--all-changes)
8. [API Route Map](#8-api-route-map)
9. [Frontend Component Tree](#9-frontend-component-tree)
10. [Cost Impact Analysis](#10-cost-impact-analysis)
11. [Environment Variables](#11-environment-variables)
12. [Build Order](#12-build-order)

---

## 1. Executive Summary of Findings

Five root causes were identified, each traced to an exact line in the existing specification:

| # | Symptom reported | Root cause | Where it lives today |
|---|---|---|---|
| 1 | Extraction quality averages 0.85 | `quality_score` formula measures character density, not correctness, and applies a flat `× 0.85` penalty to every OCR'd document regardless of actual OCR accuracy | `college-chatbot-architecture.md`, ingestion pipeline, line ~1094-1096 |
| 2 | Responses feel shallow / miss context | Retrieval is a fixed top-5 after rerank, chunk size is uniform 512 tokens regardless of content type, no query rewriting, no diversity control | F-09 Step 3 |
| 3 | Reranking "advantage" unclear | Reranking is already specified (Cohere rerank-english-v3) but appears under-tuned — likely too narrow a pre-rerank candidate pool and no monitoring of rerank scores | F-09 Step 3d |
| 4 | Responses get cut off mid-answer | `max_tokens: 1024` is hardcoded with zero truncation detection or continuation logic | F-09 Step 6, line 818 |
| 5 | No way to independently verify answer quality | No comparison mechanism exists between MediMind's grounded response and what a frontier model would say from general knowledge | Does not exist in current spec |

This document fixes all five, in five sub-features (F-18-A through F-18-E), each independently shippable.

---

## 2. F-18-A: Extraction Quality Improvement

### 2.1 The current formula and why it's misleading

```python
# CURRENT (to be replaced)
quality_score = min(avg_chars_per_page / 500, 1.0)
if ocr_used: quality_score *= 0.85
if avg_chars_per_page < 50: quality_score = 0.1
```

This formula answers "is there a lot of text on this page?" — not "was this page extracted correctly?" A garbled OCR page with high character count scores well. A correctly-parsed but symbol-sparse formula page scores poorly. The flat `0.85` OCR multiplier means any document requiring OCR fallback drags the average down by a fixed 15% regardless of whether that OCR was 99% accurate or 60% accurate.

### 2.2 New multi-signal quality score

```python
# services/ingestion-worker/quality/compute_quality_score.py

def compute_quality_score(page_data: dict) -> dict:
    """
    Multi-signal quality score. Returns score + a breakdown so admins
    can see WHY a document scored the way it did, not just a single number.
    """
    signals = {}

    # Signal 1: text density (kept, but now only 25% of final weight — was 100%)
    signals["density"] = min(page_data["avg_chars_per_page"] / 500, 1.0)

    # Signal 2: real OCR confidence (Tesseract returns per-word confidence 0-100)
    if page_data["ocr_used"]:
        # Average of Tesseract's actual per-word confidence scores, not a flat guess
        signals["ocr_confidence"] = page_data["tesseract_avg_word_confidence"] / 100.0
    else:
        signals["ocr_confidence"] = 1.0   # no OCR needed = full marks on this signal

    # Signal 3: structural integrity — did column/table detection succeed cleanly?
    signals["structural_integrity"] = page_data["structural_integrity_score"]
    # computed by the layout parser (Section 2.3): 1.0 if single-pass clean extraction,
    # penalised for: broken hyphenation left unrepaired, table cells detected but
    # not reconstructable, reading-order confidence below threshold

    # Signal 4: dictionary/vocabulary validity — % of extracted "words" that are
    # real dictionary words or recognised medical/technical terms (catches OCR garbage)
    signals["vocab_validity"] = page_data["valid_word_ratio"]

    # Signal 5: header/footer pollution — inverse of % of chunk text that is
    # repeated boilerplate (running headers, page numbers, chapter titles repeated)
    signals["boilerplate_penalty"] = 1.0 - page_data["boilerplate_ratio"]

    # Weighted combination
    weights = {
        "density": 0.15,
        "ocr_confidence": 0.30,
        "structural_integrity": 0.25,
        "vocab_validity": 0.20,
        "boilerplate_penalty": 0.10,
    }
    final_score = sum(signals[k] * weights[k] for k in weights)

    return {
        "quality_score": round(final_score, 3),
        "signal_breakdown": signals,   # stored for admin diagnostics
        "weights_used": weights
    }
```

### 2.3 Layout-aware extraction — fixing the pipeline that feeds the score

Four concrete parser upgrades, each targeting one of the failure modes identified in the analysis:

```python
# services/ingestion-worker/extraction/layout_aware_parser.py

def extract_page_layout_aware(page: fitz.Page) -> dict:
    """
    Replaces flat page.get_text() calls with layout-aware extraction.
    """
    blocks = page.get_text("dict")["blocks"]

    # ── Fix 1: Multi-column detection ──────────────────────────────────────
    # Group text blocks by x-position clusters. If two distinct x-clusters
    # exist with a gap between them, treat as 2-column layout and read
    # top-to-bottom within each column before moving to the next column.
    columns = detect_column_clusters(blocks)
    ordered_blocks = read_in_column_order(blocks, columns)

    # ── Fix 2: Header/footer stripping ─────────────────────────────────────
    # A line is flagged as boilerplate if near-identical text (Levenshtein
    # distance < 5) appears in the same y-position band on 3+ consecutive pages.
    # Tracked across the whole document during a first extraction pass.
    boilerplate_lines = detect_repeated_boilerplate(ordered_blocks, page.number)
    clean_blocks = [b for b in ordered_blocks if b not in boilerplate_lines]

    # ── Fix 3: Hyphenation repair ───────────────────────────────────────────
    # If a line ends with a hyphen and the next line starts with a lowercase
    # letter, rejoin: "glomer-" + "ulus" → "glomerulus"
    repaired_text = repair_hyphenation(clean_blocks)

    # ── Fix 4: Table detection (pdfplumber, run alongside PyMuPDF) ──────────
    tables = detect_tables_pdfplumber(page)
    if tables:
        # Tables are extracted separately and stored as structured markdown
        # tables within the chunk, not flattened into prose
        table_markdown = [table_to_markdown(t) for t in tables]
        repaired_text = merge_table_markdown_into_text(repaired_text, table_markdown)

    # ── Vocabulary validity check ────────────────────────────────────────────
    valid_word_ratio = compute_valid_word_ratio(repaired_text)

    # ── Structural integrity score ──────────────────────────────────────────
    structural_integrity_score = compute_structural_score(
        column_detection_confidence=columns["confidence"],
        hyphenation_repairs_made=repaired_text["repair_count"],
        table_extraction_success=len(tables) > 0 and all(t["confidence"] > 0.8 for t in tables)
    )

    return {
        "text": repaired_text["text"],
        "boilerplate_ratio": len(boilerplate_lines) / max(len(ordered_blocks), 1),
        "valid_word_ratio": valid_word_ratio,
        "structural_integrity_score": structural_integrity_score,
        "tables_found": len(tables)
    }
```

**New Python dependency:** `pdfplumber==0.11.0` (table detection, runs alongside PyMuPDF — PyMuPDF remains primary text extractor)

### 2.4 Real OCR confidence (replacing the flat 0.85 multiplier)

```python
# services/ingestion-worker/extraction/ocr_with_confidence.py

import pytesseract
from pytesseract import Output

def ocr_page_with_confidence(image) -> dict:
    """
    Tesseract returns per-word confidence (0-100) via image_to_data.
    We use the ACTUAL average confidence instead of a flat penalty.
    """
    data = pytesseract.image_to_data(image, output_type=Output.DICT)

    # Filter out empty/whitespace detections
    word_confidences = [
        int(conf) for conf, text in zip(data["conf"], data["text"])
        if text.strip() and int(conf) > -1
    ]

    avg_confidence = sum(word_confidences) / len(word_confidences) if word_confidences else 0
    low_confidence_word_count = sum(1 for c in word_confidences if c < 60)

    return {
        "text": " ".join(t for t in data["text"] if t.strip()),
        "tesseract_avg_word_confidence": avg_confidence,
        "low_confidence_word_ratio": low_confidence_word_count / max(len(word_confidences), 1)
    }
```

This directly replaces the flat `× 0.85`. A well-scanned, clean page might score `tesseract_avg_word_confidence: 91` (→ 0.91 on that signal). A faded, poorly-lit photocopy might score `58` (→ 0.58). The score now reflects the actual scan, not a blanket assumption.

### 2.5 Admin-facing diagnostics — quality breakdown UI

Dept Admin document list gets a new expandable row showing the signal breakdown, not just one number:

```
Guyton 13th Ed.pdf                    Quality: 0.94  ✓
  ├─ Text density:          0.98  ████████████████████
  ├─ OCR confidence:        N/A (no OCR needed)
  ├─ Structural integrity:  0.91  ██████████████████
  ├─ Vocabulary validity:   0.96  ███████████████████
  └─ Boilerplate penalty:   0.89  █████████████████

Faculty Notes Ch.4 (scanned).pdf      Quality: 0.61  ⚠
  ├─ Text density:          0.88  ████████████████
  ├─ OCR confidence:        0.52  ██████████         ← flagged: re-scan recommended
  ├─ Structural integrity:  0.71  ██████████████
  ├─ Vocabulary validity:   0.58  ███████████        ← flagged: high garbage-word ratio
  └─ Boilerplate penalty:   0.95  ███████████████████

  ⚠️ This document may produce degraded answers. Consider re-scanning
     at higher resolution or requesting a cleaner copy from the publisher.
```

### 2.6 Re-scoring existing documents

A one-time migration re-runs the new quality formula against already-ingested documents without re-embedding (the extraction artifacts — raw text, OCR confidence data — are already cached from original ingestion where available; documents ingested before this fix are flagged for optional re-ingestion):

```javascript
// infra/migrations/018-rescore-quality.js
async function rescoreExistingDocuments() {
  const docs = await documentsCollection.find({ ingestion_status: "completed" }).toArray();
  for (const doc of docs) {
    if (doc.extraction_artifacts_cached) {
      const newScore = computeQualityScore(doc.extraction_artifacts);
      await documentsCollection.updateOne({ _id: doc._id }, {
        $set: { quality_score: newScore.quality_score, signal_breakdown: newScore.signal_breakdown, quality_formula_version: 2 }
      });
    } else {
      // No cached artifacts — flag for admin to consider re-ingestion
      await documentsCollection.updateOne({ _id: doc._id }, {
        $set: { quality_rescoring_needed: true }
      });
    }
  }
}
```

---

## 3. F-18-B: Retrieval Precision Improvement

### 3.1 Semantic / structure-aware chunking

Replace uniform 512-token chunking with heading-boundary-aware splitting:

```python
# services/ingestion-worker/chunking/semantic_chunker.py

def semantic_chunk(page_text: str, structural_metadata: dict, target_size=512, overlap=50) -> list[dict]:
    """
    Prefers splitting at heading/paragraph boundaries over raw token count.
    Falls back to token-count splitting only when no natural boundary exists
    within a reasonable range of the target size.
    """
    natural_boundaries = detect_natural_boundaries(page_text, structural_metadata)
    # natural_boundaries: paragraph breaks, detected sub-headings, table starts/ends

    chunks = []
    current_chunk = ""
    for segment in split_at_boundaries(page_text, natural_boundaries):
        if count_tokens(current_chunk + segment) <= target_size * 1.3:  # allow 30% flex
            current_chunk += segment
        else:
            if current_chunk:
                chunks.append({"text": current_chunk, "boundary_aligned": True})
            current_chunk = segment

    if current_chunk:
        chunks.append({"text": current_chunk, "boundary_aligned": True})

    # Apply overlap between adjacent chunks (sentence-aware, not token-count-blind)
    chunks = apply_sentence_aware_overlap(chunks, overlap_tokens=overlap)
    return chunks
```

### 3.2 Query rewriting before embedding

```typescript
// services/api/src/services/query-rewrite.service.ts

async function rewriteQueryForRetrieval(rawQuery: string, deptContext: string): Promise<string> {
  // Cheap, fast Haiku call — adds ~200-400ms but meaningfully improves embed match quality
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: `Rewrite this student question into precise, formal academic phrasing
suitable for matching against textbook prose. Keep the same meaning and intent.
Return ONLY the rewritten question, nothing else.

Department context: ${deptContext}
Student question: "${rawQuery}"`
    }]
  });
  return response.content[0].text.trim();
}

// Example transformations:
// "what happens if u give too much metformin"
//   → "What are the adverse effects of metformin overdose?"
// "y does the heart beat faster when scared"
//   → "What is the physiological mechanism of increased heart rate during the fight-or-flight response?"
```

The rewritten query is used ONLY for embedding/retrieval — the original student query is still shown in the UI and used in the final LLM prompt, so the answer still responds naturally to how the student actually asked.

### 3.3 Adaptive top-K by query complexity

```typescript
async function classifyQueryComplexity(query: string): Promise<"simple" | "multi_part" | "case_based"> {
  // Lightweight heuristic first (no LLM call needed for the common case)
  const wordCount = query.split(/\s+/).length;
  const hasMultipleQuestionMarks = (query.match(/\?/g) || []).length > 1;
  const hasCaseKeywords = /patient|presents|case|scenario|year-old/i.test(query);

  if (hasCaseKeywords) return "case_based";
  if (hasMultipleQuestionMarks || wordCount > 25) return "multi_part";
  return "simple";
}

const TOP_K_BY_COMPLEXITY = {
  simple: 3,
  multi_part: 6,
  case_based: 8,
};
```

### 3.4 MMR diversity re-selection (applied after Cohere rerank, before final chunk selection)

```typescript
function selectWithMMR(rerankedChunks: RerankedChunk[], k: number, lambda = 0.7): RerankedChunk[] {
  // lambda balances relevance (1.0) vs diversity (0.0). 0.7 favours relevance
  // but actively avoids near-duplicate chunks.
  const selected: RerankedChunk[] = [];
  const remaining = [...rerankedChunks];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].rerank_score;
      const maxSimToSelected = selected.length === 0
        ? 0
        : Math.max(...selected.map(s => cosineSimilarity(remaining[i].embedding, s.embedding)));
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}
```

### 3.5 Retrieval telemetry — the measurement loop that didn't exist before

```javascript
// Every query now logs which chunks were retrieved AND which were actually
// referenced in the final generated answer (detected via citation matching)
{
  query_log_id: UUID,
  retrieved_chunk_ids: [String],       // all chunks that made it to the LLM prompt
  cited_chunk_ids: [String],           // chunks whose page number appeared in the final citation
  retrieval_precision: Number,         // cited_chunk_ids.length / retrieved_chunk_ids.length
  rerank_scores: [Number],             // score per retrieved chunk, for drift monitoring
  query_complexity: String,            // simple | multi_part | case_based
  top_k_used: Number,
  mmr_applied: Boolean
}
```

This feeds a weekly Dept Admin report: "Your department's retrieval precision this week: 68% (chunks retrieved but not used in answers may indicate over-broad topK or chunking issues)."

---

## 4. F-18-C: Reranking — Formalisation & Tuning

### 4.1 Confirming what's already specified vs. what needs tuning

Reranking (Cohere `rerank-english-v3`) is **already present** in F-09 Step 3d. The investigation found it is likely under-delivering because of two configuration gaps, not because it's missing:

```
GAP 1: Pre-rerank candidate pool is too narrow
  Current: Pinecone top-10 → merge with BM25 → rerank
  Problem: If the correct chunk isn't in that initial top-10, reranking
           can't recover it — reranking can only reorder what it's given.

GAP 2: No monitoring of rerank scores over time
  Current: rerank happens, top-5 selected, no score ever logged or reviewed
  Problem: Silent quality degradation (e.g. after a bad document upload)
           goes completely undetected.
```

### 4.2 Fix — widen the candidate pool

```typescript
// services/api/src/services/rag.service.ts — updated retrieval width

const RETRIEVAL_CONFIG = {
  pinecone_top_k: 20,          // was 10 — widened to give reranker more to work with
  bm25_top_k: 10,              // keyword-match candidates merged in
  post_merge_dedup: true,      // remove near-duplicate chunks (same page, >90% text overlap)
  rerank_candidate_max: 25,    // cap on total candidates sent to Cohere (cost control)
  final_top_k: "adaptive",     // see F-18-B Section 3.3 — 3/6/8 depending on query complexity
};
```

### 4.3 Rerank score monitoring

```javascript
// Logged on every query — enables a Super Admin / Dept Admin dashboard panel
{
  query_id: UUID,
  dept_id: UUID,
  rerank_top_score: Number,      // score of the #1 reranked chunk
  rerank_score_spread: Number,   // top_score - 5th_score (low spread = ambiguous retrieval)
  rerank_candidate_count: Number,
  created_at: Date
}
```

**Alert condition:** if a department's rolling 7-day average `rerank_top_score` drops below 0.55, flag for review — likely signals either a content gap or a newly uploaded document with poor extraction quality dragging down retrieval for that topic area.

### 4.4 Quantified expected improvement

| Metric | Before (bi-encoder only, top-10, no MMR) | After (widened pool + rerank + MMR) |
|---|---|---|
| Correct chunk in candidate set | ~78% (est., top-10 recall) | ~91% (est., top-20 recall) |
| Correct chunk ranked #1 after selection | ~55% (cosine order) | ~80–85% (reranked + MMR) |
| Near-duplicate chunks in final top-5 | Common (no diversity control) | Rare (MMR penalises redundancy) |
| Rerank cost per query | ~$0.00001 (10 candidates) | ~$0.000025 (25 candidates) — still negligible |

---

## 5. F-18-D: Response Truncation Fix

### 5.1 The four fixes, in priority order

```typescript
// services/api/src/services/llm.service.ts — updated generation call

async function generateGroundedResponse(params: GenerationParams) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,                          // FIX 1: raised from 1024
    messages: buildMessages(params),
    system: buildSystemPrompt(params, { conciseness_mode: true })  // FIX 4, see 5.3
  });

  // FIX 2: log stop_reason on every response
  const wasTruncated = response.stop_reason === "max_tokens";
  await logCostEvent({
    ...params.costEventBase,
    stop_reason: response.stop_reason,
    was_truncated: wasTruncated
  });

  // FIX 3: auto-continuation if truncated
  if (wasTruncated) {
    const continuation = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        ...buildMessages(params),
        { role: "assistant", content: response.content[0].text },
        { role: "user", content: "Please continue your previous answer from exactly where you left off. Do not repeat anything already said." }
      ]
    });
    return {
      text: response.content[0].text + continuation.content[0].text,
      was_truncated_and_continued: true,
      total_tokens: response.usage.output_tokens + continuation.usage.output_tokens
    };
  }

  return { text: response.content[0].text, was_truncated_and_continued: false };
}
```

### 5.2 Truncation monitoring dashboard (Super Admin)

New panel on the F-12 Cost Intelligence dashboard:

```
Response Truncation Rate — Last 7 Days
──────────────────────────────────────────────────
Platform-wide:        4.2%  (target: < 2%)
By college:
  MSRIT Medical         6.8%  ⚠ above target
  Dayananda Eng         2.1%
  KLE Medical           3.4%

By question type:
  Clinical case questions    11.2%  ← highest truncation rate
  Multi-part questions        8.7%
  Simple factual questions    0.9%
```

This directly validates whether the `max_tokens` raise + auto-continuation fix is working, and identifies which question types still need attention.

### 5.3 Prompt restructuring — reducing token pressure at the source

```
System prompt addition:

"Structure your answer as: (1) a direct, complete answer to the core question
in 3-5 sentences, (2) supporting mechanism/detail if space allows, (3) always
end with your source citation even if it means being slightly more concise
in section 2. Never end mid-sentence or mid-explanation — if you are running
long, prioritise finishing your current thought and citing your source over
adding additional detail."
```

This instructs the model to self-manage its token budget rather than relying entirely on hard limits + continuation as a safety net.

---

## 6. F-18-E: Frontier Model Comparison Lab

### 6.1 Purpose

A dedicated tool — accessible to Dept Admin and Super Admin — that runs the same student-style question through two paths simultaneously and displays them side by side:

1. **MediMind grounded path:** the normal F-09 RAG pipeline against the department's uploaded textbooks
2. **Frontier path:** a frontier model (Claude Opus or GPT-4o) answering from general training knowledge, with explicitly NO book context provided

This is the mechanism that catches extraction and retrieval regressions before students report them, and gives faculty a concrete way to audit whether the grounded answer is actually better (more specific, correctly cited) rather than just different.

### 6.2 Database schema

```js
// golden_questions collection (per-college DB)
{
  _id: UUID,
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,
  question_text: String,
  expected_source_doc_id: UUID,
  expected_source_page: Number,
  expected_answer_summary: String,        // human-written reference answer
  difficulty: Enum["recall","application","analysis"],
  added_by: UUID,                          // dept_admin_id
  active: Boolean,
  created_at: Date
}

// comparison_runs collection (per-college DB)
{
  _id: UUID,
  golden_question_id: UUID,               // null if ad-hoc (not from golden set)
  question_text: String,
  dept_id: UUID,
  college_id: UUID,

  // Grounded path results
  grounded_response_text: String,
  grounded_sources: [{ doc_id, page, chunk_text }],
  grounded_retrieval_score: Number,        // top rerank score
  grounded_latency_ms: Number,
  grounded_tokens_used: Number,

  // Frontier path results
  frontier_model: String,                  // "claude-opus-4-8" | "gpt-4o"
  frontier_response_text: String,
  frontier_latency_ms: Number,
  frontier_tokens_used: Number,

  // Automated faithfulness scoring (LLM-judge)
  faithfulness_score: Number,              // 0-1: does grounded answer match cited source
  completeness_score: Number,              // 0-1: does it cover what the question asks
  citation_accuracy: Boolean,              // does the cited page actually contain this info
  judge_reasoning: String,                 // LLM-judge's explanation

  // Human review (optional, added later)
  human_verdict: Enum["grounded_better","frontier_better","equivalent","both_wrong", null],
  human_notes: String,
  reviewed_by: UUID,
  reviewed_at: Date,

  // Failure classification (auto-tagged based on scores)
  failure_signature: Enum[
    "none",                    // grounded response is good
    "extraction_failure",      // frontier correct, grounded vague/wrong — points to source doc quality
    "retrieval_failure",       // right content exists but wrong page/chunk cited
    "expected_divergence"      // book legitimately says something different/more specific — not a bug
  ],

  created_at: Date
}
```

### 6.3 The dual-path query runner

```typescript
// services/api/src/services/comparison-lab.service.ts

async function runComparison(params: {
  questionText: string;
  deptId: string;
  collegeId: string;
  goldenQuestionId?: string;
}) {
  const [groundedResult, frontierResult] = await Promise.all([
    runGroundedPath(params),
    runFrontierPath(params)
  ]);

  const judgeResult = await runFaithfulnessJudge(groundedResult, params.questionText);

  const failureSignature = classifyFailure(groundedResult, frontierResult, judgeResult);

  const comparisonRun = {
    _id: generateUUID(),
    golden_question_id: params.goldenQuestionId || null,
    question_text: params.questionText,
    dept_id: params.deptId,
    college_id: params.collegeId,
    grounded_response_text: groundedResult.text,
    grounded_sources: groundedResult.sources,
    grounded_retrieval_score: groundedResult.topRerankScore,
    grounded_latency_ms: groundedResult.latencyMs,
    grounded_tokens_used: groundedResult.tokensUsed,
    frontier_model: "claude-opus-4-8",
    frontier_response_text: frontierResult.text,
    frontier_latency_ms: frontierResult.latencyMs,
    frontier_tokens_used: frontierResult.tokensUsed,
    faithfulness_score: judgeResult.faithfulness,
    completeness_score: judgeResult.completeness,
    citation_accuracy: judgeResult.citationAccurate,
    judge_reasoning: judgeResult.reasoning,
    failure_signature: failureSignature,
    created_at: new Date()
  };

  await comparisonRunsCollection(params.collegeId).insertOne(comparisonRun);
  return comparisonRun;
}

async function runFrontierPath(params: { questionText: string }) {
  // CRITICAL: no book context provided — pure general knowledge test
  const start = Date.now();
  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [{ role: "user", content: params.questionText }],
    system: "Answer this academic question using your general knowledge. Do not mention that you lack access to any specific textbook."
  });
  return {
    text: response.content[0].text,
    latencyMs: Date.now() - start,
    tokensUsed: response.usage.output_tokens
  };
}

async function runFaithfulnessJudge(groundedResult: GroundedResult, question: string) {
  // A third model call, acting as an impartial judge
  const judgePrompt = `You are evaluating whether an AI's answer is faithfully grounded in its cited source.

Question: "${question}"
AI's answer: "${groundedResult.text}"
Cited source text: "${groundedResult.sources.map(s => s.chunk_text).join("\n---\n")}"

Score on three dimensions (JSON only):
{
  "faithfulness": 0.0-1.0,       // does every claim in the answer trace back to the cited source?
  "completeness": 0.0-1.0,       // does the answer fully address the question?
  "citation_accurate": true/false, // does the cited page/source actually contain this information?
  "reasoning": "1-2 sentence explanation"
}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: judgePrompt }]
  });
  return JSON.parse(response.content[0].text.trim());
}

function classifyFailure(grounded, frontier, judge): string {
  if (judge.faithfulness >= 0.8 && judge.citation_accurate) return "none";
  if (judge.faithfulness < 0.5 && frontier.text.length > 100) return "extraction_failure";
  if (judge.faithfulness >= 0.5 && !judge.citation_accurate) return "retrieval_failure";
  return "expected_divergence";
}
```

### 6.4 Reviewer UI — side-by-side comparison card

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Comparison Run · Pharmacology · "Why does metformin cause lactic acidosis  │
│ in renal impairment?"                              Faithfulness: 0.91 ✓  │
├──────────────────────────────┬───────────────────────────────────────────┤
│ 🌐 FRONTIER (Claude Opus)     │ 📖 MEDIMIND GROUNDED                      │
│ No book context               │ Retrieved: Katzung BPT, Ch.16, Pg.298     │
│                                │                                          │
│ Metformin causes lactic       │ Metformin is contraindicated in renal     │
│ acidosis primarily through     │ impairment because reduced clearance      │
│ inhibition of mitochondrial    │ leads to accumulation, which inhibits    │
│ respiratory chain complex I... │ hepatic gluconeogenesis and causes       │
│                                │ lactate build-up...                      │
│                                │ — Katzung BPT, Ch.16, Page 298           │
├──────────────────────────────┴───────────────────────────────────────────┤
│ Judge reasoning: "Grounded answer's mechanism claim is directly           │
│ supported by the cited passage. Citation accurately reflects source."    │
│                                                                            │
│ Failure signature: ✓ none — working as intended                          │
│                                                                            │
│ Your verdict: [Grounded better] [Frontier better] [Equivalent] [Both wrong]│
│ Notes: [                                                              ]  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 6.5 Regression dashboard — tracking faithfulness over time

```
Faithfulness Score Trend — Pharmacology Department
────────────────────────────────────────────────────────────────
May 1   ████████████████████░  0.89
May 8   ████████████████████░  0.91
May 15  ███████████████░░░░░░  0.74   ⚠ Drop detected
May 22  ████████████████░░░░░  0.81

Alert: Faithfulness dropped 17 points after "Faculty Notes Ch.4.pdf"
was uploaded on May 14. That document's quality_score is 0.61 (OCR
confidence 0.52). Recommend re-scanning or reviewing extracted content.
```

This directly closes the loop back to F-18-A — a faithfulness regression automatically points to the specific low-quality document that likely caused it.

### 6.6 Golden question set management

Dept Admin can build a golden question bank incrementally:

```
POST /college/:cid/dept-admin/golden-questions
Body: { question_text, expected_source_doc_id, expected_source_page,
        expected_answer_summary, difficulty }
```

Recommended starting size: 20–30 questions per subject, weighted toward topics that previously appeared in the F-10 unanswered query log — those are exactly the areas most likely to reveal extraction/retrieval problems.

**Automated nightly regression run:** every golden question is re-run through the comparison lab nightly. If any question's faithfulness score drops below 0.7 compared to its 7-day rolling average, an alert fires to the Dept Admin.

---

## 7. Database Schema — All Changes

### 7.1 Additions to `documents` collection

```js
{
  // existing fields unchanged...
  quality_score: Number,                    // now computed via new multi-signal formula
  signal_breakdown: {
    density: Number,
    ocr_confidence: Number,
    structural_integrity: Number,
    vocab_validity: Number,
    boilerplate_penalty: Number
  },
  quality_formula_version: Number,          // 2 = new formula; 1 = legacy (flags for admin review)
  quality_rescoring_needed: Boolean,        // true if legacy doc lacks cached artifacts for re-scoring
  extraction_artifacts_cached: Boolean,     // whether raw extraction data is retained for re-scoring
}
```

### 7.2 Additions to `query_logs` collection

```js
{
  // existing fields unchanged...
  stop_reason: String,                      // "end_turn" | "max_tokens" | "stop_sequence"
  was_truncated: Boolean,
  was_truncated_and_continued: Boolean,
  retrieved_chunk_ids: [String],
  cited_chunk_ids: [String],
  retrieval_precision: Number,
  rerank_top_score: Number,
  rerank_score_spread: Number,
  query_complexity: String,                 // "simple" | "multi_part" | "case_based"
  top_k_used: Number,
  mmr_applied: Boolean,
  query_rewritten_text: String,             // the rewritten version used for embedding
}
```

### 7.3 New collections

`golden_questions` and `comparison_runs` — full schemas in Section 6.2.

---

## 8. API Route Map

```
# Extraction quality (F-18-A)
GET    /api/v1/college/:cid/admin/documents/:docId/quality-breakdown
       Response: { quality_score, signal_breakdown, recommendations[] }
POST   /api/v1/college/:cid/admin/documents/:docId/rescore
       (re-run new quality formula against cached extraction artifacts)

# Retrieval telemetry (F-18-B)
GET    /api/v1/college/:cid/admin/analytics/retrieval-precision
       Response: { weekly_precision_pct, by_subject[], trend[] }

# Reranking monitoring (F-18-C)
GET    /api/v1/super-admin/analytics/rerank-scores?college_id=&dept_id=
       Response: { avg_top_score, score_spread_trend, alerts[] }

# Truncation monitoring (F-18-D)
GET    /api/v1/super-admin/analytics/truncation-rate?days=7
       Response: { platform_wide_pct, by_college[], by_question_type[] }

# Frontier Comparison Lab (F-18-E)
POST   /api/v1/college/:cid/admin/comparison-lab/run
       Body: { question_text, golden_question_id? }
       Response: comparison_run object (full side-by-side data)

GET    /api/v1/college/:cid/admin/comparison-lab/runs
       ?dept_id=&failure_signature=&date_from=&date_to=
       Response: { runs[], total }

POST   /api/v1/college/:cid/admin/comparison-lab/runs/:runId/review
       Body: { human_verdict, human_notes }

GET    /api/v1/college/:cid/admin/golden-questions
POST   /api/v1/college/:cid/admin/golden-questions
DELETE /api/v1/college/:cid/admin/golden-questions/:qId

GET    /api/v1/college/:cid/admin/comparison-lab/regression-dashboard
       ?dept_id=&days=30
       Response: { faithfulness_trend[], alerts[], flagged_documents[] }

POST   /api/v1/internal/comparison-lab/nightly-regression-run
       (triggered by cron — runs all active golden questions)
```

---

## 9. Frontend Component Tree

```
apps/admin/components/dept-admin/
├── quality/
│   ├── DocumentQualityBreakdown.tsx      # Expandable signal breakdown per document
│   ├── QualityRecommendationBanner.tsx   # "Consider re-scanning" style alerts
│   └── RescoreButton.tsx
├── retrieval/
│   ├── RetrievalPrecisionPanel.tsx       # Weekly precision % widget
│   └── TruncationRateWidget.tsx
└── comparison-lab/
    ├── ComparisonRunner.tsx              # Ad-hoc question input + run button
    ├── SideBySideCard.tsx                # The frontier vs grounded display
    ├── FailureSignatureBadge.tsx         # Colour-coded failure classification
    ├── GoldenQuestionManager.tsx         # CRUD for golden question set
    ├── RegressionDashboard.tsx           # Faithfulness trend chart + alerts
    └── HumanReviewControls.tsx           # Verdict buttons + notes field

apps/super-admin/components/observatory/
├── TruncationRatePanel.tsx               # Platform-wide truncation monitoring
└── RerankScoreMonitor.tsx                # Rerank score trend across colleges
```

---

## 10. Cost Impact Analysis

| Change | Cost delta | Justification |
|---|---|---|
| Widened rerank pool (10→25 candidates) | +~$0.000015/query (negligible) | Meaningfully improves recall of correct chunk into final selection |
| Query rewriting (extra Haiku call) | +~$0.00004/query | ~200-400ms latency add, improves embed match quality |
| max_tokens 1024→2048 | +0 to +$0.0006/query (only if response actually uses more tokens) | Only costs more when genuinely needed; most simple answers unaffected |
| Auto-continuation (only fires on truncation) | +~$0.0004 per truncated response only | Estimated 4% of queries currently truncate — cost applies only to those |
| Faithfulness judge call (comparison lab only) | +~$0.0002 per comparison run | Only runs in the lab, not on live student queries |
| Frontier path (comparison lab only) | +~$0.002 per comparison run (Opus pricing) | Only runs in the lab, not on live student queries — cost is bounded by golden question set size × nightly runs |

**Estimated total added cost for live student queries:** ~$0.00045/query average — negligible against existing per-query cost of ~$0.0006.

**Comparison Lab nightly cost (300 golden questions across a college):** 300 × ($0.002 frontier + $0.0002 judge) ≈ $0.66/night ≈ $20/month per college — well within existing cost budgets and provides continuous quality assurance.

---

## 11. Environment Variables

```bash
# Addition to services/ingestion-worker/.env
QUALITY_SCORE_FORMULA_VERSION=2
QUALITY_WEIGHT_DENSITY=0.15
QUALITY_WEIGHT_OCR_CONFIDENCE=0.30
QUALITY_WEIGHT_STRUCTURAL_INTEGRITY=0.25
QUALITY_WEIGHT_VOCAB_VALIDITY=0.20
QUALITY_WEIGHT_BOILERPLATE_PENALTY=0.10
OCR_LOW_CONFIDENCE_ALERT_THRESHOLD=60

# Addition to services/api/.env
RAG_PINECONE_TOP_K=20
RAG_BM25_TOP_K=10
RAG_RERANK_CANDIDATE_MAX=25
RAG_MMR_LAMBDA=0.7
RAG_QUERY_REWRITE_ENABLED=true
RAG_ADAPTIVE_TOPK_SIMPLE=3
RAG_ADAPTIVE_TOPK_MULTIPART=6
RAG_ADAPTIVE_TOPK_CASE=8

# Truncation fix
LLM_MAX_TOKENS_DEFAULT=2048
LLM_AUTO_CONTINUATION_ENABLED=true
LLM_TRUNCATION_ALERT_THRESHOLD_PCT=5

# Comparison Lab
COMPARISON_LAB_FRONTIER_MODEL=claude-opus-4-8
COMPARISON_LAB_JUDGE_MODEL=claude-haiku-4-5-20251001
COMPARISON_LAB_NIGHTLY_CRON=0 2 * * *
COMPARISON_LAB_FAITHFULNESS_ALERT_THRESHOLD=0.70
```

---

## 12. Build Order

Add as **Phase 16 — RAG Quality & Response Reliability** after Phase 15 in main architecture doc:

```
Phase 16 — RAG Quality & Response Reliability

Step 1 — Extraction quality overhaul (F-18-A)
  → Add pdfplumber dependency for table detection
  → Implement layout_aware_parser.py (column detection, header/footer strip, hyphenation repair)
  → Implement ocr_with_confidence.py (real Tesseract per-word confidence)
  → Implement compute_quality_score.py (new multi-signal formula)
  → Migration: rescore existing documents where extraction artifacts are cached
  → Admin UI: DocumentQualityBreakdown.tsx expandable signal view
  → Test: ingest a known 2-column textbook page → verify correct reading order
  → Test: ingest a scanned faculty note → verify OCR confidence reflects actual scan quality

Step 2 — Retrieval precision improvements (F-18-B)
  → Implement semantic_chunker.py (heading-boundary-aware chunking)
  → Implement query-rewrite.service.ts
  → Implement adaptive top-K classification
  → Implement MMR re-selection
  → Add retrieval telemetry logging to query_logs
  → Test: submit a colloquial query → verify rewritten version improves retrieval score
  → Test: submit a case-based question → verify top_k_used = 8, not fixed 5

Step 3 — Reranking tuning (F-18-C)
  → Widen pre-rerank candidate pool (10→20 from Pinecone)
  → Add rerank score logging + rolling average monitoring
  → Build RerankScoreMonitor.tsx in Super Admin observatory
  → Test: verify rerank_top_score logged on every query
  → Test: manually degrade a document → verify alert fires when rolling average drops

Step 4 — Truncation fix (F-18-D)
  → Raise max_tokens: 1024 → 2048 in llm.service.ts
  → Add stop_reason logging on every generation call
  → Implement auto-continuation logic
  → Add conciseness-first prompt restructuring
  → Build TruncationRatePanel.tsx in F-12 cost dashboard
  → Test: force a long clinical case answer → verify no mid-sentence cutoff
  → Test: verify truncation rate metric populates correctly

Step 5 — Frontier Comparison Lab (F-18-E)
  → Create golden_questions + comparison_runs collections
  → Implement comparison-lab.service.ts (dual-path runner + judge)
  → Build API routes: run comparison, list runs, golden question CRUD
  → Build ComparisonRunner.tsx + SideBySideCard.tsx + FailureSignatureBadge.tsx
  → Build GoldenQuestionManager.tsx + RegressionDashboard.tsx
  → Set up nightly cron for golden question regression runs
  → Test: run comparison on a known-good question → verify failure_signature = "none"
  → Test: run comparison against a deliberately poor-quality document → verify
    failure_signature = "extraction_failure"
  → Test: nightly regression run → verify alert fires on faithfulness drop

Step 6 — Integration testing
  → End-to-end: upload a 2-column scanned textbook → verify quality_score reflects
    real OCR confidence, not flat 0.85
  → End-to-end: ask a clinical case question → verify no truncation, correct citation
  → End-to-end: run 20 golden questions through comparison lab → review side-by-side
    results → confirm failure signatures are correctly classified
  → Verify cost events show query rewrite + widened rerank pool costs are within
    projected ~$0.00045/query average increase
```

---

*Document: F-18-rag-quality-and-response-reliability.md · v1.0 · May 2026*  
*Extends: college-chatbot-architecture.md v2.0 (F-03 ingestion, F-09 RAG pipeline)*  
*Companion analysis: `rag-quality-analysis.html` — interactive walkthrough of all five root causes with worked examples*  
*For Claude Code: Phase 16, 6 steps. Steps 1-4 are independent and can be built in parallel. Step 5 (Comparison Lab) depends on nothing else in this doc but is most valuable once Steps 1-4 are live, since it will then measure the improvement.*
