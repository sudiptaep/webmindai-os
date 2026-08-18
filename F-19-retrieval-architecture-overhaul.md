# F-19: Retrieval Architecture Overhaul
## Contextual Retrieval · Small-to-Big · Conversational Rewriting · Metadata Pre-filtering · True Hybrid Search

> **Parent docs:** `college-chatbot-architecture.md` v2.0 (F-09 RAG pipeline) · `F-18-rag-quality-and-response-reliability.md` v1.0  
> **Why this document exists:** F-18-B proposed incremental retrieval fixes. On review, several of those were solving the wrong problem, and one (MMR) is likely a regression for textbook QA. This document supersedes F-18-B Section 3 with a redesigned retrieval architecture built around Anthropic's Contextual Retrieval technique plus small-to-big expansion.  
> **Expected outcome:** <cite index="5-1">Anthropic's published benchmarks show contextual embeddings alone reduce top-20 retrieval failure rate by 35%, contextual embeddings combined with contextual BM25 reduce it by 49%, and adding reranking on top brings the total reduction to 67%</cite>.  
> **Supersedes:** F-18-B (Sections 3.1, 3.2, 3.4). F-18-B Sections 3.3 and 3.5 are retained and extended here.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [Why F-18-B Was Not Enough](#1-why-f-18-b-was-not-enough)
2. [The Seven Changes — Priority Order](#2-the-seven-changes--priority-order)
3. [F-19-A: Contextual Chunk Enrichment](#3-f-19-a-contextual-chunk-enrichment)
4. [F-19-B: Small-to-Big Retrieval](#4-f-19-b-small-to-big-retrieval)
5. [F-19-C: Conversational Query Rewriting](#5-f-19-c-conversational-query-rewriting)
6. [F-19-D: Metadata Pre-filtering](#6-f-19-d-metadata-pre-filtering)
7. [F-19-E: Rerank-Score Thresholding](#7-f-19-e-rerank-score-thresholding)
8. [F-19-F: True Hybrid Search with RRF](#8-f-19-f-true-hybrid-search-with-rrf)
9. [F-19-G: Conditional MMR (Regression Fix)](#9-f-19-g-conditional-mmr-regression-fix)
10. [The Complete Redesigned Pipeline](#10-the-complete-redesigned-pipeline)
11. [Database Schema Changes](#11-database-schema-changes)
12. [Cost Analysis](#12-cost-analysis)
13. [Environment Variables](#13-environment-variables)
14. [Build Order](#14-build-order)
15. [Evaluation Plan](#15-evaluation-plan)

---

## 1. Why F-18-B Was Not Enough

F-18-B proposed five retrieval improvements. On closer review of the actual failure mode — students getting shallow or contextually wrong answers from textbook content — three of those five were addressing secondary problems, and one was actively counterproductive.

| F-18-B proposal | Verdict | Reason |
|---|---|---|
| Semantic/heading-aware chunking | **Keep** | Still correct — better chunk boundaries help |
| Query rewriting (formalisation) | **Redirect** | Formalising language is a minor win. The real gap is multi-turn context resolution — see F-19-C |
| Adaptive top-K by complexity | **Keep** | Still correct — retained and extended |
| MMR diversity re-selection | **Remove/make conditional** | Actively harmful for textbook QA — see F-19-G |
| Retrieval telemetry | **Keep** | Still correct — extended with new signals |

**The fundamental gap F-18-B missed:** a 512-token chunk extracted from Guyton loses all surrounding context. A chunk reading *"This mechanism is amplified in renal impairment, leading to accumulation"* is nearly useless as an embedding — which mechanism? which drug? The chunk before it said "metformin inhibits hepatic gluconeogenesis," but that chunk was split away during preprocessing. <cite index="9-1">The embedding for this chunk carries none of that information, so it barely resembles the query, and it gets buried under chunks that are only superficially related</cite>.

This is exactly the problem Contextual Retrieval solves, and it is the single highest-leverage change available.

---

## 2. The Seven Changes — Priority Order

| # | Change | Effort | Expected impact | Where it runs |
|---|---|---|---|---|
| **F-19-A** | Contextual chunk enrichment before embedding | Medium | **Very high** | Ingestion (write path) |
| **F-19-B** | Small-to-big retrieval (retrieve small, expand to parent) | Low | **High** | Query (read path) |
| **F-19-C** | Conversational query rewriting (pronoun/context resolution) | Low | **High** | Query (read path) |
| **F-19-D** | Metadata pre-filtering (subject/semester/year) | Low | Medium-high | Query (read path) |
| **F-19-E** | Threshold on rerank score, not cosine | Trivial | Medium | Query (read path) |
| **F-19-F** | True sparse-dense hybrid + Reciprocal Rank Fusion | Medium | Medium | Both |
| **F-19-G** | Make MMR conditional (remove default-on) | Trivial | Removes a regression | Query (read path) |

---

## 3. F-19-A: Contextual Chunk Enrichment

### 3.1 The technique

Before embedding each chunk, an LLM generates a short 50–100 token explanatory prefix situating that chunk within its parent document. That prefix is prepended to the chunk text, and the **combined** text is what gets embedded and BM25-indexed. <cite index="9-1">Keep the generated context short — 50 to 100 tokens is usually enough; long context defeats the purpose of keeping chunks small</cite>.

**Before (what you index today):**
```
"This mechanism is amplified in renal impairment, leading to accumulation
and a corresponding rise in circulating lactate."
```

**After (what you index with F-19-A):**
```
This chunk is from Katzung's Basic & Clinical Pharmacology, Chapter 16
(Pancreatic Hormones & Antidiabetic Drugs), page 298, in the section on
metformin pharmacokinetics and contraindications.

This mechanism is amplified in renal impairment, leading to accumulation
and a corresponding rise in circulating lactate.
```

The second version will match a student query about "metformin lactic acidosis renal" with dramatically higher similarity — because the drug name, the chapter, and the topic are now *inside* the embedded text rather than two chunks away.

### 3.2 The contextualiser prompt

<cite index="7-1">Anthropic's published prompt for this</cite>, adapted for academic textbooks:

```python
# services/ingestion-worker/chunking/contextualiser.py

CONTEXTUALISER_PROMPT = """<document>
{whole_document_text}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_content}
</chunk>

This document is a {doc_type} used in {dept_name} at an Indian {college_type} college.

Give a short, succinct context (50-100 tokens) to situate this chunk within the
overall document, for the purpose of improving search retrieval of the chunk.
Include: the book/document name, the chapter or section it belongs to, the page,
and the specific topic or entity being discussed (drug name, anatomical structure,
disease, algorithm, circuit type, etc.).

Answer only with the succinct context and nothing else."""
```

### 3.3 Implementation with prompt caching

The critical cost optimisation: the full document is cached once, then reused across every chunk from that document. <cite index="12-1">The parent document is cached for the duration of the indexing pass, so each chunk only pays the marginal cost of the chunk plus completion — roughly $1.02 per million document tokens with Claude</cite>.

```python
# services/ingestion-worker/chunking/contextualiser.py

import anthropic
from typing import List, Dict

client = anthropic.Anthropic()

async def contextualise_chunks(
    chunks: List[Dict],
    whole_document_text: str,
    doc_metadata: Dict
) -> List[Dict]:
    """
    Generate a contextual prefix for every chunk in a document.
    Uses prompt caching: the whole document is written to cache once,
    then read from cache for every subsequent chunk.
    """
    contextualised = []

    # Truncate whole document if it exceeds the caching sweet spot.
    # For very large textbooks, use the containing CHAPTER as the
    # "document" context rather than the entire 1000-page book.
    doc_context = _select_context_window(whole_document_text, doc_metadata)

    for i, chunk in enumerate(chunks):
        response = await client.messages.create(
            model=os.environ.get("CONTEXTUALISER_MODEL", "claude-haiku-4-5-20251001"),
            max_tokens=150,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"<document>\n{doc_context}\n</document>",
                        # ── This is the cache breakpoint ──────────────────
                        # First chunk writes to cache; chunks 2..N read from it
                        "cache_control": {"type": "ephemeral"}
                    },
                    {
                        "type": "text",
                        "text": _build_chunk_prompt(chunk, doc_metadata)
                    }
                ]
            }]
        )

        context_prefix = response.content[0].text.strip()

        contextualised.append({
            **chunk,
            "context_prefix": context_prefix,
            # This combined text is what gets embedded AND BM25-indexed
            "embedding_text": f"{context_prefix}\n\n{chunk['text']}",
            # Original text preserved separately — this is what the LLM sees
            # at generation time, so the prefix doesn't pollute the answer
            "original_text": chunk["text"],
            "contextualiser_tokens_used": response.usage.input_tokens + response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0),
        })

    return contextualised


def _select_context_window(whole_document_text: str, doc_metadata: Dict) -> str:
    """
    For a 1000-page textbook, sending the ENTIRE book as context for every
    chunk is wasteful even with caching. Instead:
      - If document < 100k tokens: use the whole document
      - If document >= 100k tokens: use the containing chapter only
        (chapter boundaries come from F-13-A chapter_maps)
    """
    token_estimate = len(whole_document_text) // 4
    max_context = int(os.environ.get("CONTEXTUALISER_MAX_DOC_TOKENS", 100_000))

    if token_estimate <= max_context:
        return whole_document_text

    # Fall back to chapter-scoped context
    return doc_metadata.get("chapter_text", whole_document_text[:max_context * 4])
```

### 3.4 Critical detail — what gets embedded vs. what the LLM sees

This distinction matters and is easy to get wrong:

| Field | Contains | Used for |
|---|---|---|
| `embedding_text` | `context_prefix` + `\n\n` + `original_text` | Embedding into Pinecone · BM25 indexing |
| `original_text` | The raw chunk text only | Assembled into the LLM prompt at generation time |

If you send `embedding_text` to the LLM at generation, every retrieved chunk arrives with a redundant "This chunk is from Katzung Chapter 16..." preamble, wasting context budget and making answers repetitive. **Embed the enriched version; generate from the original.**

### 3.5 Pinecone metadata addition

```json
{
  "doc_id": "uuid",
  "dept_id": "uuid",
  "college_id": "uuid",
  "subject_id": "uuid",
  "filename": "Katzung_BPT_15e.pdf",
  "page": 298,
  "chunk_index": 412,
  "chunk_type": "text",

  "context_prefix": "This chunk is from Katzung's Basic & Clinical Pharmacology, Chapter 16...",
  "contextualised": true,
  "contextualiser_version": 1,

  "parent_chunk_id": "uuid",
  "chapter_index": 16,
  "mbbs_year": 2,
  "mbbs_semester": 3
}
```

---

## 4. F-19-B: Small-to-Big Retrieval

### 4.1 The problem with retrieve-and-generate-from-the-same-chunk

Today the pipeline embeds 512-token chunks and sends those exact chunks to the LLM. For textbook QA this is the wrong trade-off:

- **Small chunks are better for matching** — a tight 300-token chunk about "cardiac output equation" matches a query about cardiac output very precisely
- **Large chunks are better for answering** — but the actual explanation of *why* CO = SV × HR matters clinically continues into the next two chunks

The result: precise retrieval, incomplete generation. The student gets the definition but not the mechanism.

### 4.2 The fix — two-tier chunk hierarchy

At ingestion, produce **both** a small (child) chunk for matching and a larger (parent) chunk for generation:

```python
# services/ingestion-worker/chunking/hierarchical_chunker.py

CHILD_CHUNK_TOKENS = 350       # small, precise — this is what gets embedded
PARENT_CHUNK_TOKENS = 1400     # large, complete — this is what the LLM sees
CHILD_OVERLAP = 40

def build_hierarchical_chunks(page_text: str, doc_metadata: dict) -> dict:
    """
    Produces two linked layers:
      parents: large, semantically complete sections (NOT embedded)
      children: small precise chunks (embedded), each linked to its parent
    """
    # Step 1: build parent chunks at natural section boundaries
    parents = semantic_split(
        page_text,
        target_tokens=PARENT_CHUNK_TOKENS,
        respect_boundaries=["heading", "section", "table"]
    )

    children = []
    parent_records = []

    for parent in parents:
        parent_id = generate_uuid()
        parent_records.append({
            "_id": parent_id,
            "text": parent["text"],
            "page_start": parent["page_start"],
            "page_end": parent["page_end"],
            "chapter_index": parent.get("chapter_index"),
            "token_count": parent["token_count"],
        })

        # Step 2: split each parent into small child chunks
        child_splits = sentence_aware_split(
            parent["text"],
            target_tokens=CHILD_CHUNK_TOKENS,
            overlap_tokens=CHILD_OVERLAP
        )

        for idx, child_text in enumerate(child_splits):
            children.append({
                "text": child_text,
                "parent_chunk_id": parent_id,      # ← the critical link
                "child_index": idx,
                "page": parent["page_start"],
                "chapter_index": parent.get("chapter_index"),
            })

    return {"parents": parent_records, "children": children}
```

**Only children are embedded and upserted to Pinecone.** Parents are stored in MongoDB in a new `parent_chunks` collection, keyed by `parent_chunk_id`.

### 4.3 Retrieval-time expansion

```typescript
// services/api/src/services/rag.service.ts

async function expandToParents(
  rerankedChildren: RerankedChunk[],
  collegeId: string,
  maxParents: number
): Promise<ParentChunk[]> {
  // 1. Collect unique parent IDs from the reranked child chunks,
  //    preserving rerank order (best child first)
  const seenParents = new Set<string>();
  const orderedParentIds: string[] = [];

  for (const child of rerankedChildren) {
    const pid = child.metadata.parent_chunk_id;
    if (!seenParents.has(pid)) {
      seenParents.add(pid);
      orderedParentIds.push(pid);
    }
    if (orderedParentIds.length >= maxParents) break;
  }

  // 2. Fetch full parent text from MongoDB
  const parents = await parentChunksCollection(collegeId)
    .find({ _id: { $in: orderedParentIds } })
    .toArray();

  // 3. Restore rerank ordering (MongoDB $in does not preserve order)
  const parentMap = new Map(parents.map(p => [p._id, p]));
  return orderedParentIds
    .map(pid => parentMap.get(pid))
    .filter(Boolean) as ParentChunk[];
}
```

### 4.4 Deduplication benefit — a free bonus

Small-to-big solves the near-duplicate problem that MMR was originally introduced to fix. If three reranked child chunks all belong to the same parent, they collapse into **one** parent chunk. Redundancy is eliminated structurally, without needing a diversity penalty that would harm contiguous textbook prose. This is a large part of why F-19-G removes default-on MMR.

---

## 5. F-19-C: Conversational Query Rewriting

### 5.1 What F-18-B got wrong

F-18-B proposed rewriting colloquial queries into formal academic phrasing. That is a modest win. The far larger problem is **multi-turn context loss**:

```
Turn 1 — Student: "Explain the mechanism of action of metformin"
         → embeds fine, retrieves correctly ✓

Turn 2 — Student: "what about its side effects?"
         → embedded literally as "what about its side effects?"
         → matches nothing useful in the Pharmacology namespace ✗
```

The second query has no drug name, no topic, no anchor. Embedding it verbatim is close to embedding noise.

### 5.2 The fix — contextual query rewriting using conversation history

```typescript
// services/api/src/services/query-rewrite.service.ts

interface RewriteResult {
  rewritten_query: string;
  original_query: string;
  rewrite_applied: boolean;
  resolved_entities: string[];
}

async function rewriteQueryWithContext(
  rawQuery: string,
  conversationHistory: Message[],
  deptName: string,
  subjectName: string | null
): Promise<RewriteResult> {

  // Fast path: no history, and the query is already self-contained
  if (conversationHistory.length === 0 && isSelfContained(rawQuery)) {
    return {
      rewritten_query: rawQuery,
      original_query: rawQuery,
      rewrite_applied: false,
      resolved_entities: []
    };
  }

  const recentTurns = conversationHistory.slice(-4);   // last 2 exchanges

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages: [{
      role: "user",
      content: `You are rewriting a student's follow-up question so it can be
understood standalone by a search system.

Department: ${deptName}${subjectName ? ` · Subject: ${subjectName}` : ""}

Recent conversation:
${recentTurns.map(t => `${t.role}: ${t.content.slice(0, 300)}`).join("\n")}

Student's new question: "${rawQuery}"

Rewrite this question to be fully self-contained:
- Resolve all pronouns ("it", "its", "that", "this") to the actual entity
- Carry forward the topic being discussed if the question is a follow-up
- Use precise academic terminology suited to textbook prose
- Do NOT answer the question, only rewrite it
- If the question is already fully self-contained, return it unchanged

Return JSON only:
{"rewritten": "...", "resolved_entities": ["..."]}`
    }]
  });

  const parsed = JSON.parse(response.content[0].text.trim());

  return {
    rewritten_query: parsed.rewritten,
    original_query: rawQuery,
    rewrite_applied: parsed.rewritten !== rawQuery,
    resolved_entities: parsed.resolved_entities || []
  };
}

function isSelfContained(query: string): boolean {
  // Cheap heuristic — skips the LLM call for clearly standalone queries
  const pronounPattern = /\b(it|its|that|this|these|those|them|they|the same|above)\b/i;
  const followUpPattern = /^(what about|and |also |how about|why|then )/i;
  return !pronounPattern.test(query) && !followUpPattern.test(query);
}
```

### 5.3 Worked examples

| Turn | Raw query | Rewritten for retrieval |
|---|---|---|
| 1 | "Explain the mechanism of action of metformin" | *(unchanged — self-contained)* |
| 2 | "what about its side effects?" | "What are the adverse effects and side effects of metformin?" |
| 3 | "why does that happen in kidney disease?" | "Why does metformin cause lactic acidosis in renal impairment?" |
| 4 | "show me the diagram" | "Diagram illustrating metformin mechanism of action and renal clearance" |

### 5.4 Critical rule — rewrite for retrieval only

The rewritten query is used **only** for embedding and BM25 matching. The **original** query goes into the LLM generation prompt, so the answer responds naturally to how the student actually phrased it. Both are logged to `query_logs` for telemetry.

---

## 6. F-19-D: Metadata Pre-filtering

### 6.1 The unused signal

Every student JWT already carries `dept_id`, and the `students` collection carries `current_year` and `current_semester` (added in F-14-D). Every subject carries `mbbs_year` and `mbbs_semester`. None of this is being used to narrow retrieval.

A Year 2 Semester 3 student asking a Pharmacology question is currently searching **the entire Pharmacology department namespace** — including Year 4 clinical pharmacology content they have not been taught and will not be examined on.

### 6.2 Tiered filter strategy

Filtering too aggressively risks retrieving nothing. Use a **cascading fallback**:

```typescript
// services/api/src/services/rag.service.ts

async function retrieveWithMetadataFallback(
  queryVector: number[],
  namespace: string,
  student: StudentContext,
  topK: number
): Promise<PineconeMatch[]> {

  // Tier 1 — tightest: student's exact subject + semester
  if (student.active_subject_id) {
    const tier1 = await pinecone.query({
      vector: queryVector, namespace, topK,
      filter: {
        subject_id: { $eq: student.active_subject_id },
        mbbs_semester: { $lte: student.current_semester }
      },
      includeMetadata: true
    });
    if (tier1.matches.length >= Math.ceil(topK * 0.6)) return tier1.matches;
  }

  // Tier 2 — year-scoped: anything at or below the student's current year
  const tier2 = await pinecone.query({
    vector: queryVector, namespace, topK,
    filter: { mbbs_year: { $lte: student.current_year } },
    includeMetadata: true
  });
  if (tier2.matches.length >= Math.ceil(topK * 0.6)) return tier2.matches;

  // Tier 3 — unfiltered department-wide (current behaviour)
  const tier3 = await pinecone.query({
    vector: queryVector, namespace, topK, includeMetadata: true
  });
  return tier3.matches;
}
```

Log which tier served the results (`retrieval_tier: 1 | 2 | 3`) so you can measure how often the tight filter is sufficient.

### 6.3 Chapter-scoped retrieval already uses this pattern

F-13-C's chapter-scoped chat already applies a `page_num` range filter. F-19-D generalises the same idea to subject, semester, and year — and the two compose cleanly (chapter filter AND semester filter can both apply).

---

## 7. F-19-E: Rerank-Score Thresholding

### 7.1 The problem with the current 0.60 cosine cutoff

F-09 Step 4 refuses to answer when `max cosine similarity < 0.60`. Cosine similarity from a bi-encoder is **not calibrated across queries** — a score of 0.62 on a short factual query and 0.62 on a long multi-part query mean entirely different things about actual relevance.

Cohere's rerank scores are cross-encoder outputs trained specifically as relevance judgments, and are substantially more comparable across queries.

### 7.2 The fix

```typescript
// BEFORE (F-09 Step 4)
if (maxCosineScore < 0.60) return refuseToAnswer();

// AFTER (F-19-E)
const RERANK_ANSWER_THRESHOLD = parseFloat(process.env.RAG_RERANK_ANSWER_THRESHOLD || "0.35");
const RERANK_CONFIDENT_THRESHOLD = parseFloat(process.env.RAG_RERANK_CONFIDENT_THRESHOLD || "0.60");

const topRerankScore = rerankedChunks[0]?.relevance_score ?? 0;

if (topRerankScore < RERANK_ANSWER_THRESHOLD) {
  // Genuinely nothing relevant — refuse and log as content gap (F-10)
  return refuseToAnswer({ reason: "no_relevant_content", top_rerank_score: topRerankScore });
}

if (topRerankScore < RERANK_CONFIDENT_THRESHOLD) {
  // Weak match — answer, but hedge in the system prompt and flag for review
  systemPromptAdditions.push(
    "The retrieved material is only partially relevant to this question. " +
    "Answer what you can from it, and explicitly state which parts of the " +
    "question are not covered in the provided materials."
  );
  await flagLowConfidenceQuery(queryId, topRerankScore);
}
```

This introduces a middle band — *answer with a hedge* — instead of the current binary answer-or-refuse. Students get partial help rather than a flat refusal, and faculty still get the content-gap signal.

### 7.3 Per-department threshold calibration

Store thresholds per department, tunable by Super Admin, because content density varies:

```js
// Addition to departments collection
{
  rerank_answer_threshold: Number,      // default 0.35
  rerank_confident_threshold: Number,   // default 0.60
  threshold_calibrated_at: Date,
  threshold_calibration_sample_size: Number
}
```

---

## 8. F-19-F: True Hybrid Search with RRF

### 8.1 What "hybrid" means today vs. what it should mean

F-09 Step 3b says *"BM25 keyword search: query text → keyword match on stored metadata."* That is not BM25 — it is a metadata substring match, and Pinecone does not provide BM25 natively unless you use sparse-dense hybrid vectors.

<cite index="10-1">BM25 integration is ideal for exact matches like error codes or product numbers, and hybrid search combines BM25's precision with semantic search's broader understanding</cite>. For medical and engineering content this matters enormously — drug names, enzyme names, anatomical terms, and IC part numbers are exactly the tokens where lexical matching beats semantic matching.

### 8.2 Implementation — Pinecone sparse-dense vectors

```python
# services/ingestion-worker/embedding/sparse_encoder.py

from pinecone_text.sparse import BM25Encoder

# Fit the BM25 encoder on the department's full corpus once, then persist it.
# Each department gets its own fitted encoder — vocabulary differs sharply
# between Pharmacology and Circuit Theory.

def fit_bm25_for_department(college_id: str, dept_id: str, all_chunk_texts: list[str]):
    bm25 = BM25Encoder()
    bm25.fit(all_chunk_texts)
    encoder_path = f"{STORAGE_ROOT}/colleges/{college_id}/bm25/{dept_id}.json"
    bm25.dump(encoder_path)
    return encoder_path


def encode_chunk_sparse(bm25: BM25Encoder, embedding_text: str) -> dict:
    # NOTE: encode the CONTEXTUALISED text (F-19-A), not the raw chunk.
    # This is Anthropic's "Contextual BM25" — the context prefix is indexed too.
    return bm25.encode_documents(embedding_text)
```

```python
# Upsert with BOTH dense and sparse vectors
pinecone_index.upsert(
    vectors=[{
        "id": f"{doc_id}_{chunk_index}",
        "values": dense_embedding,              # text-embedding-3-small, 1536-dim
        "sparse_values": sparse_embedding,       # BM25 sparse vector
        "metadata": {...}
    }],
    namespace=f"c_{college_id}_d_{dept_id}"
)
```

### 8.3 Reciprocal Rank Fusion — replacing naive merge

```typescript
// services/api/src/services/hybrid-fusion.ts

/**
 * Reciprocal Rank Fusion. Combines multiple ranked lists without needing
 * score normalisation — it uses only RANK position, which sidesteps the
 * problem that cosine scores and BM25 scores live on incomparable scales.
 *
 * RRF score for a document d = Σ over lists L of  1 / (k + rank_L(d))
 * k=60 is the standard constant from the original RRF paper.
 */
function reciprocalRankFusion(
  rankedLists: Array<Array<{ id: string; [key: string]: any }>>,
  k = 60
): Array<{ id: string; rrf_score: number }> {

  const scores = new Map<string, number>();
  const docs = new Map<string, any>();

  for (const list of rankedLists) {
    list.forEach((doc, rank) => {
      const contribution = 1 / (k + rank + 1);   // rank is 0-indexed
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + contribution);
      if (!docs.has(doc.id)) docs.set(doc.id, doc);
    });
  }

  return Array.from(scores.entries())
    .map(([id, rrf_score]) => ({ ...docs.get(id), id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}
```

### 8.4 Where RRF sits in the pipeline

```
Dense search  (Pinecone, dense vector)   → ranked list A (top 30)
Sparse search (Pinecone, sparse vector)  → ranked list B (top 30)
                    ↓
            RRF fusion (k=60)
                    ↓
          top 25 fused candidates
                    ↓
        Cohere rerank-english-v3
                    ↓
             top 3-8 children
                    ↓
        expand to parent chunks (F-19-B)
```

---

## 9. F-19-G: Conditional MMR (Regression Fix)

### 9.1 Why default-on MMR is wrong for textbook QA

MMR penalises a candidate chunk for being similar to already-selected chunks. That is correct for **web search**, where three near-identical news articles add nothing.

It is wrong for **contiguous textbook prose**. Consider a query about the Frank-Starling mechanism where the answer spans pages 218–220 across three consecutive chunks:

- Chunk A: states the law
- Chunk B: explains the physiological basis
- Chunk C: gives the clinical significance

All three are highly similar to each other — that is precisely *because* they are all about the same mechanism. MMR would select A, then heavily penalise B and C for redundancy, and pull in a less relevant chunk about a different topic instead. **The student loses the explanation and the clinical relevance.**

### 9.2 The fix — off by default, on only where diversity is genuinely wanted

```typescript
const MMR_ENABLED_MODES = new Set([
  "disease_cross_subject",   // F-14-C — deliberately wants breadth across subjects
  "general_dept_search",     // broad exploratory search across a whole department
]);

const MMR_DISABLED_MODES = new Set([
  "chapter_scoped_chat",     // F-13-C — wants depth within one chapter
  "standard_chat",           // default student chat
  "quiz_generation",         // F-13-D — wants comprehensive chapter coverage
  "clinical_case",           // F-14-B
]);

function shouldApplyMMR(queryMode: string): boolean {
  return MMR_ENABLED_MODES.has(queryMode);
}
```

Additionally, small-to-big (F-19-B) already collapses same-parent duplicates structurally, so the redundancy MMR was meant to address is largely handled without a relevance penalty.

---

## 10. The Complete Redesigned Pipeline

### 10.1 Ingestion (write path) — with F-19-A and F-19-B

```
Faculty uploads document
        ↓
Text extraction (F-18-A layout-aware parsing)
        ↓
HIERARCHICAL CHUNKING  ← F-19-B
   parents: ~1400 tokens, section-aligned  → MongoDB parent_chunks
   children: ~350 tokens, sentence-aligned → to be embedded
        ↓
CONTEXTUAL ENRICHMENT  ← F-19-A
   For each child chunk:
     LLM (Haiku, prompt-cached document) generates 50-100 token context prefix
     embedding_text = context_prefix + "\n\n" + original_text
        ↓
DUAL EMBEDDING  ← F-19-F
   dense:  text-embedding-3-small(embedding_text)   → 1536-dim
   sparse: BM25Encoder(embedding_text)               → sparse vector
        ↓
PINECONE UPSERT
   namespace: c_{college}_d_{dept}
   values: dense · sparse_values: sparse
   metadata: { parent_chunk_id, subject_id, mbbs_year, mbbs_semester,
               chapter_index, page, chunk_type, contextualised: true }
```

### 10.2 Query (read path) — full redesigned flow

```
Student message
        ↓
CONVERSATIONAL REWRITE  ← F-19-C
   Resolve pronouns + carry forward topic from last 4 turns
   → rewritten_query (used for retrieval only)
        ↓
QUERY COMPLEXITY CLASSIFICATION  (retained from F-18-B 3.3)
   simple → 3 parents · multi_part → 5 parents · case_based → 8 parents
        ↓
DUAL ENCODE
   dense_vec  = embed(rewritten_query)
   sparse_vec = bm25_encode(rewritten_query)
        ↓
METADATA-FILTERED RETRIEVAL  ← F-19-D
   Tier 1: subject + semester filter    → if ≥60% of topK, use it
   Tier 2: year filter                  → if ≥60% of topK, use it
   Tier 3: dept-wide unfiltered         → fallback
   Runs twice: once dense, once sparse (top 30 each)
        ↓
RECIPROCAL RANK FUSION  ← F-19-F
   Fuse dense + sparse ranked lists (k=60) → top 25 candidates
        ↓
COHERE RERANK  (retained, widened pool from F-18-C)
   25 candidates → cross-encoder relevance scores → ordered
        ↓
RERANK-SCORE THRESHOLD  ← F-19-E
   < 0.35 → refuse + log content gap
   0.35-0.60 → answer with hedge + flag
   ≥ 0.60 → answer normally
        ↓
CONDITIONAL MMR  ← F-19-G
   Applied only in disease_cross_subject / general_dept_search modes
        ↓
EXPAND TO PARENTS  ← F-19-B
   Reranked children → unique parent_chunk_ids → fetch full parent text
   (also collapses same-parent duplicates)
        ↓
SPLIT text vs image chunks (F-17)
        ↓
PROMPT ASSEMBLY
   System: dept scope + citation format + hedge instruction if applicable
   User: original_query (NOT rewritten) + parent chunk texts + last 6 turns
        ↓
GENERATE (Claude Haiku, max_tokens 2048, auto-continuation per F-18-D)
        ↓
Stream via SSE + resolve image tokens + citations
```

---

## 11. Database Schema Changes

### 11.1 New collection: `parent_chunks` (per-college DB)

```js
{
  _id: UUID,                          // parent_chunk_id — referenced by child metadata
  doc_id: UUID,
  college_id: UUID,
  dept_id: UUID,
  subject_id: UUID,

  text: String,                       // full parent text (~1400 tokens)
  token_count: Number,

  page_start: Number,
  page_end: Number,
  chapter_index: Number,
  section_title: String,

  child_chunk_count: Number,
  child_chunk_ids: [String],          // Pinecone vector IDs of children

  created_at: Date
}

// Indexes
db.parent_chunks.createIndex({ doc_id: 1, page_start: 1 });
db.parent_chunks.createIndex({ dept_id: 1, chapter_index: 1 });
```

### 11.2 Additions to `documents` collection

```js
{
  // existing fields unchanged...
  contextualised: Boolean,                  // has F-19-A enrichment been applied
  contextualiser_version: Number,
  contextualiser_cost_usd: Number,
  parent_chunk_count: Number,
  child_chunk_count: Number,
  bm25_encoder_version: Number,
  sparse_indexed: Boolean,
}
```

### 11.3 Additions to `departments` collection

```js
{
  // existing fields unchanged...
  bm25_encoder_path: String,                // local path to fitted BM25 encoder
  bm25_fitted_at: Date,
  bm25_corpus_size: Number,
  rerank_answer_threshold: Number,          // default 0.35
  rerank_confident_threshold: Number,       // default 0.60
}
```

### 11.4 Additions to `query_logs` collection

```js
{
  // existing + F-18 fields unchanged...
  original_query: String,
  rewritten_query: String,
  rewrite_applied: Boolean,
  resolved_entities: [String],

  retrieval_tier: Number,                   // 1 = subject-filtered, 2 = year, 3 = unfiltered
  dense_candidate_count: Number,
  sparse_candidate_count: Number,
  rrf_fused_count: Number,

  rerank_top_score: Number,
  answer_confidence_band: String,           // "confident" | "hedged" | "refused"

  mmr_applied: Boolean,
  child_chunks_retrieved: Number,
  parent_chunks_used: Number,
  parent_expansion_ratio: Number,           // parents / children — dedup effectiveness
}
```

---

## 12. Cost Analysis

### 12.1 Ingestion cost (one-time per document)

Contextual enrichment is the only meaningful new ingestion cost. <cite index="3-1">With prompt caching, contextual retrieval indexing costs roughly $12 per 1000 documents versus $94 without caching — an 87% reduction</cite>.

**Worked example — Guyton & Hall, 1046 pages:**

```
Child chunks produced:            ~4,200
Context window per chunk:         chapter-scoped (~25k tokens, cached)

Without prompt caching:
  4,200 chunks × 25,000 input tokens × $0.25/1M (Haiku)  = $26.25

With prompt caching (cache write once per chapter, ~48 chapters):
  Cache writes:  48 × 25,000 tokens × $0.30/1M          = $0.36
  Cache reads:   4,200 × 25,000 tokens × $0.03/1M       = $3.15
  Output:        4,200 × 80 tokens × $1.25/1M           = $0.42
  ─────────────────────────────────────────────────────────────
  Total contextualisation cost per textbook:              ~$3.93
```

Compare against existing per-textbook costs: F-17 image Vision analysis ≈ $0.57, embeddings ≈ $0.05. Contextualisation is the largest single ingestion cost but remains a **one-time** ~₹330 per textbook.

### 12.2 Query cost delta

| Component | Cost per query | Note |
|---|---|---|
| Conversational rewrite (F-19-C) | +$0.00004 | Skipped entirely for self-contained queries via heuristic |
| Sparse encoding | $0 | Local BM25 computation |
| Second Pinecone query (sparse) | +~$0.000005 | Negligible |
| RRF fusion | $0 | Pure computation |
| Widened rerank pool (25 candidates) | +$0.000025 | Already accounted in F-18-C |
| Parent chunk MongoDB fetch | ~$0 | Indexed lookup |
| **Larger generation context (parents vs children)** | **+$0.0002** | ~1400 vs ~350 tokens per chunk sent to LLM |
| **Net query cost delta** | **≈ +$0.00027** | Against existing ~$0.0006/query baseline |

Roughly a 45% increase in per-query cost, against an expected retrieval failure reduction in the range of 49–67%. At ₹3,999/department/month with ~$1.30/month actual LLM cost per department, this remains far inside margin.

### 12.3 Storage impact

```
Pinecone vectors: unchanged count (only children embedded), but each now
                  carries a sparse vector alongside dense → ~1.4× index size

MongoDB:          new parent_chunks collection
                  ≈ 25% of original document text stored again
                  Guyton: ~1,050 parents × ~1400 tokens ≈ 6 MB per textbook

Local disk:       BM25 encoder per department ≈ 2-15 MB depending on corpus
```

---

## 13. Environment Variables

```bash
# ── F-19-A: Contextual enrichment ────────────────────────────────
CONTEXTUALISER_ENABLED=true
CONTEXTUALISER_MODEL=claude-haiku-4-5-20251001
CONTEXTUALISER_MAX_TOKENS=150
CONTEXTUALISER_MAX_DOC_TOKENS=100000        # above this, use chapter-scoped context
CONTEXTUALISER_PROMPT_CACHING=true
CONTEXTUALISER_BATCH_SIZE=10                # chunks processed in parallel
CONTEXTUALISER_VERSION=1

# ── F-19-B: Small-to-big ─────────────────────────────────────────
CHUNK_CHILD_TOKENS=350
CHUNK_CHILD_OVERLAP=40
CHUNK_PARENT_TOKENS=1400
PARENT_EXPANSION_MAX_SIMPLE=3
PARENT_EXPANSION_MAX_MULTIPART=5
PARENT_EXPANSION_MAX_CASE=8

# ── F-19-C: Conversational rewriting ─────────────────────────────
QUERY_REWRITE_ENABLED=true
QUERY_REWRITE_MODEL=claude-haiku-4-5-20251001
QUERY_REWRITE_HISTORY_TURNS=4
QUERY_REWRITE_SKIP_HEURISTIC=true           # skip LLM for self-contained queries

# ── F-19-D: Metadata pre-filtering ───────────────────────────────
METADATA_PREFILTER_ENABLED=true
METADATA_TIER_MIN_RESULTS_RATIO=0.6         # fall to next tier below this fill rate

# ── F-19-E: Rerank thresholding ──────────────────────────────────
RAG_RERANK_ANSWER_THRESHOLD=0.35            # below this → refuse
RAG_RERANK_CONFIDENT_THRESHOLD=0.60         # below this → answer with hedge
RAG_LEGACY_COSINE_THRESHOLD_ENABLED=false   # disable old 0.60 cosine gate

# ── F-19-F: Hybrid search ────────────────────────────────────────
HYBRID_SEARCH_ENABLED=true
HYBRID_DENSE_TOP_K=30
HYBRID_SPARSE_TOP_K=30
RRF_K_CONSTANT=60
RERANK_CANDIDATE_MAX=25
BM25_ENCODER_REFIT_THRESHOLD=50             # refit after N new docs in a dept

# ── F-19-G: Conditional MMR ──────────────────────────────────────
MMR_DEFAULT_ENABLED=false                   # OFF by default — regression fix
MMR_LAMBDA=0.7
MMR_ENABLED_MODES=disease_cross_subject,general_dept_search
```

---

## 14. Build Order

Add as **Phase 17 — Retrieval Architecture Overhaul**, after Phase 16 (F-18).

```
Phase 17 — Retrieval Architecture Overhaul

Step 1 — Hierarchical chunking (F-19-B, write path)
  → Create parent_chunks collection + indexes
  → Implement hierarchical_chunker.py (parent 1400 / child 350 split)
  → Update ingestion pipeline: store parents in MongoDB, embed children only
  → Add parent_chunk_id to Pinecone child metadata
  → Test: ingest one chapter → verify every child has a resolvable parent_chunk_id
  → Test: verify parent text is semantically complete (no mid-sentence starts)

Step 2 — Contextual enrichment (F-19-A, write path)
  → Implement contextualiser.py with prompt caching
  → Implement _select_context_window (whole-doc vs chapter-scoped decision)
  → Wire into ingestion: contextualise children BEFORE embedding
  → Store context_prefix separately from original_text
  → Add contextualiser cost tracking to cost_events (F-12)
  → Test: verify embedding_text contains prefix, original_text does not
  → Test: verify prompt cache hit rate > 90% on a multi-chunk document
  → Test: measure cost per textbook — expect ~$4, not ~$26

Step 3 — Small-to-big retrieval (F-19-B, read path)
  → Implement expandToParents() in rag.service.ts
  → Wire parent expansion after rerank, before prompt assembly
  → Log parent_expansion_ratio to query_logs
  → Test: query where 3 children share a parent → verify 1 parent returned
  → Test: verify LLM receives parent text, not child text

Step 4 — Conversational query rewriting (F-19-C)
  → Implement rewriteQueryWithContext() with isSelfContained() heuristic
  → Wire before embedding; pass ORIGINAL query to generation prompt
  → Log original_query + rewritten_query + resolved_entities
  → Test: 3-turn conversation with pronouns → verify turn 2 and 3 resolve correctly
  → Test: self-contained query → verify LLM rewrite call is skipped

Step 5 — Metadata pre-filtering (F-19-D)
  → Implement retrieveWithMetadataFallback() with 3-tier cascade
  → Ensure mbbs_year / mbbs_semester / subject_id are in Pinecone metadata
    (backfill existing vectors via metadata update if missing)
  → Log retrieval_tier per query
  → Test: Year 2 student query → verify tier 1 or 2 used, not tier 3
  → Test: obscure query with no subject match → verify graceful fall to tier 3

Step 6 — Rerank-score thresholding (F-19-E)
  → Replace cosine gate with rerank-score gate
  → Implement three-band logic (refuse / hedge / confident)
  → Add per-department threshold fields with defaults
  → Log answer_confidence_band
  → Test: irrelevant query → refuse + content gap logged (F-10)
  → Test: partially relevant query → hedged answer explicitly states gaps

Step 7 — True hybrid search + RRF (F-19-F)
  → Add pinecone-text dependency; implement BM25 fit per department
  → Fit BM25 encoder on existing dept corpus; persist to local storage
  → Update ingestion: generate sparse vectors alongside dense
  → Backfill sparse vectors for existing documents (re-upsert pass)
  → Implement reciprocalRankFusion()
  → Wire dual retrieval + RRF before rerank
  → Test: query with a specific drug name → verify sparse list surfaces exact matches
  → Test: verify RRF output ordering differs meaningfully from dense-only

Step 8 — Conditional MMR (F-19-G)
  → Set MMR_DEFAULT_ENABLED=false
  → Implement shouldApplyMMR(queryMode) gate
  → Pass queryMode through from chat context
  → Test: chapter-scoped query → verify MMR NOT applied, contiguous chunks preserved
  → Test: disease cross-subject query → verify MMR IS applied, subjects diversified

Step 9 — Re-ingestion of existing content
  → Build admin-triggered re-ingestion flow (contextualisation + hierarchical
    chunking + sparse vectors require a full re-index of existing documents)
  → Priority order: highest-traffic departments first (use query_logs volume)
  → Show progress + cost estimate per document before admin confirms
  → Old vectors deleted only after new ones are confirmed upserted

Step 10 — Evaluation (see Section 15)
  → Run the golden question set (F-18-E) against old and new pipelines
  → Compare: retrieval failure rate, faithfulness score, answer completeness
  → Publish before/after report to Super Admin dashboard
```

---

## 15. Evaluation Plan

The Frontier Comparison Lab (F-18-E) is the measurement instrument for this overhaul. Before deploying F-19 to production, run a controlled A/B evaluation.

### 15.1 Metrics

| Metric | Definition | Baseline (current) | Target |
|---|---|---|---|
| **Retrieval failure rate** | % of golden questions where the correct source chunk is absent from the final context | Measure first | −50% or better |
| **Faithfulness score** | LLM-judge score (F-18-E) that the answer is grounded in the cited source | Measure first | +0.10 absolute |
| **Answer completeness** | LLM-judge score that the answer fully addresses the question | Measure first | +0.15 absolute |
| **Citation accuracy** | % of answers where the cited page actually contains the claim | Measure first | > 95% |
| **Parent expansion ratio** | parents used / children retrieved (lower = more dedup) | N/A (new) | ~0.5 |
| **Tier-1 filter hit rate** | % of queries served by the tightest metadata filter | N/A (new) | > 60% |
| **Hedge rate** | % of answers in the 0.35–0.60 rerank band | N/A (new) | < 15% |
| **p95 query latency** | 95th percentile end-to-end response time | Measure first | < +500ms |

### 15.2 A/B methodology

```
1. Freeze a golden question set of 200 questions per department (F-18-E)
2. Snapshot current pipeline results for all 200 → baseline
3. Deploy F-19 behind a feature flag: RETRIEVAL_PIPELINE_VERSION = 1 | 2
4. Run the same 200 questions through pipeline v2
5. Blind human review: dept faculty rate answer pairs without knowing which
   pipeline produced which (SideBySideCard.tsx from F-18-E, labels hidden)
6. Ship v2 only if: faithfulness improves AND p95 latency stays under +500ms
```

### 15.3 Rollout sequencing

```
Week 1  → One pilot department, feature flag on, staff-only access
Week 2  → Same department, students included, monitor query_logs telemetry
Week 3  → All departments at one college
Week 4  → Platform-wide, keeping v1 available as instant rollback
```

The feature flag must remain in place for at least 30 days post-rollout so any regression can be reverted without a re-ingestion.

---

*Document: F-19-retrieval-architecture-overhaul.md · v1.0 · May 2026*  
*Supersedes: F-18-B Sections 3.1, 3.2, 3.4*  
*Extends: college-chatbot-architecture.md v2.0 (F-09) · F-13-A (chapter maps) · F-14-D (year/semester metadata) · F-17 (image chunks) · F-18-E (evaluation harness)*  
*Technique reference: Anthropic Contextual Retrieval — https://www.anthropic.com/engineering/contextual-retrieval*  
*For Claude Code: Phase 17, 10 steps. Steps 1 and 2 must be built in order (hierarchical chunking before contextualisation). Steps 3–8 are read-path changes and can be built in parallel once Steps 1–2 are live. Step 9 (re-ingestion) is mandatory before Step 10 evaluation — F-19 improvements are invisible on content indexed under the old pipeline.*
