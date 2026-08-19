import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Connection } from "mongoose";
import type { Concept } from "@college-chatbot/shared";
import { LLM_MODEL_CHAT } from "@college-chatbot/shared";
import { getConceptModel } from "../models/college/concept-graph.model";
import { getMisconceptionModel } from "../models/college/misconception.model";
import { getDocumentModel } from "../models/college/document.model";
import { fetchDocChunks } from "./pinecone.service";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";

const SEED_MODEL       = process.env.MISCONCEPTION_SEED_MODEL ?? LLM_MODEL_CHAT;
const SEED_COUNT        = Number(process.env.MISCONCEPTION_SEED_COUNT ?? 4);
const SEED_CONCURRENCY  = Number(process.env.MISCONCEPTION_SEED_CONCURRENCY ?? 4);
const SEED_MAX_CONTEXT  = 12_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

const SEED_SYSTEM_PROMPT = `You identify the misconceptions students most commonly hold about a
concept, grounded in the provided source material. Respond ONLY with a valid JSON array, no
markdown, no preamble. Each element:
{
  "statement": "the wrong belief, phrased as a student would hold it",
  "correct_model": "the accurate model, stated plainly",
  "root_cause": "the underlying reasoning error that produces this belief",
  "diagnostic_probe": "a single question whose answer distinguishes the wrong model from the right one",
  "probe_correct_answer": "what a student holding the correct model would say",
  "probe_wrong_answer": "what a student holding the misconception would say"
}
The diagnostic_probe is the most important field: it must be a question where a student holding
the misconception gives a confidently WRONG answer, not one they could get right by guessing.`;

async function seedOneConcept(
  concept: Concept,
  contextText: string,
  dept_name: string,
  conn: Connection,
): Promise<number> {
  const Misconception = getMisconceptionModel(conn);

  const userPrompt = `For the concept below, list the ${SEED_COUNT} misconceptions that
${dept_name || "students"} most commonly hold.

Concept: ${concept.canonical_name}
Definition: ${concept.one_line_definition}
Type: ${concept.concept_type}

Source material:
${contextText}`;

  try {
    const response = await getClient().messages.create({
      model: SEED_MODEL,
      max_tokens: 1600,
      system: SEED_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const rate = await getRateTable("anthropic", SEED_MODEL);
    const costUsd =
      (response.usage.input_tokens / 1000) * rate.input_token_cost_per_1k +
      (response.usage.output_tokens / 1000) * rate.output_token_cost_per_1k;
    recordCostEvent({
      college_id: concept.college_id,
      dept_id: concept.dept_id,
      action_type: "misconception_seeding",
      service: "anthropic",
      model: SEED_MODEL,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      cost_usd: costUsd,
      billing_month: getBillingMonth(),
      billing_day: getBillingDay(),
      created_at: new Date(),
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(stripFences(rawText));
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;

    const now = new Date();
    const docs = parsed
      .filter((m) => m && m.statement && m.diagnostic_probe)
      .map((m) => ({
        _id: randomUUID(),
        concept_id: concept._id,
        college_id: concept.college_id,
        dept_id: concept.dept_id,
        statement: String(m.statement),
        correct_model: String(m.correct_model ?? ""),
        root_cause: String(m.root_cause ?? ""),
        diagnostic_probe: String(m.diagnostic_probe),
        probe_correct_answer: String(m.probe_correct_answer ?? ""),
        probe_wrong_answer: String(m.probe_wrong_answer ?? ""),
        source: "llm_seeded" as const,
        observed_count: 0,
        first_observed: now,
        last_observed: now,
        times_probed: 0,
        times_corrected: 0,
        correction_success_rate: null,
        reviewed_by_faculty: false,
        priority_rank: 0,
      }));

    if (docs.length === 0) return 0;
    await Misconception.insertMany(docs, { ordered: false });
    return docs.length;
  } catch (err) {
    console.error(`[misconceptionSeed] concept ${concept._id} failed:`, err);
    return 0;
  }
}

/**
 * Seeds misconceptions for every concept freshly extracted for a document.
 * Fire-and-forget from the concept-graph webhook — a 400-concept textbook
 * would otherwise hold that request open for many minutes.
 */
export async function seedMisconceptionsForDocument(docId: string, collegeId: string, conn: Connection): Promise<void> {
  const Concept = getConceptModel(conn);
  const Misconception = getMisconceptionModel(conn);
  const Document = getDocumentModel(conn);

  const concepts = await Concept.find({ doc_id: docId }).lean();
  if (concepts.length === 0) return;

  // Re-extraction replaces the prior seeded set for this doc (observed
  // misconceptions live independently, keyed by concept_id, and are untouched
  // as long as their concept still exists).
  await Misconception.deleteMany({
    concept_id: { $in: concepts.map((c) => c._id) },
    source: "llm_seeded",
  });

  const dept_name = "";
  const allChunks = await fetchDocChunks(collegeId, concepts[0].dept_id, docId, 300);

  let seededTotal = 0;
  for (let i = 0; i < concepts.length; i += SEED_CONCURRENCY) {
    const batch = concepts.slice(i, i + SEED_CONCURRENCY);
    const results = await Promise.all(
      batch.map((concept) => {
        const pageSet = new Set(concept.source_pages);
        const chunks = allChunks.filter((c) => pageSet.has(c.page_num));
        const contextText = chunks.length > 0
          ? chunks.map((c) => `[Page ${c.page_num}] ${c.text}`).join("\n\n").slice(0, SEED_MAX_CONTEXT)
          : concept.one_line_definition;
        return seedOneConcept(concept, contextText, dept_name, conn);
      }),
    );
    seededTotal += results.reduce((a, b) => a + b, 0);
  }

  await Document.findByIdAndUpdate(docId, {
    $set: { misconceptions_seeded: true, misconception_count: seededTotal },
  });
}
