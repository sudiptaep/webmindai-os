import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Connection } from "mongoose";
import type { DiseaseSubjectResult } from "@college-chatbot/shared";
import { getDiseaseQueryModel } from "../models/college/disease-query.model";
import { getSubjectModel } from "../models/college/subject.model";
import { getDocumentModel } from "../models/college/document.model";
import { queryNamespace, type PineconeChunk } from "./pinecone.service";
import { embedQuery } from "./embedding.service";
import { streamChatResponse } from "./llm.service";
import type { FastifyReply } from "fastify";
import aliasMap from "../data/disease_aliases.json";

const COMPILE_MODEL     = process.env.DISEASE_COMPILE_MODEL ?? "claude-haiku-4-5-20251001";
const MIN_SCORE         = Number(process.env.DISEASE_QUERY_MIN_SCORE ?? 0.68);
const CHAT_MIN_SCORE    = 0.65;
const TOP_K_PER_SUBJECT = Number(process.env.DISEASE_QUERY_TOP_K_PER_SUBJECT ?? 5);
const CACHE_TTL_HOURS   = Number(process.env.DISEASE_QUERY_CACHE_TTL_HOURS ?? 24);

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubjectWithDocs {
  subjectId: string;
  subjectName: string;
  deptId: string;
  docIds: string[];
}

export interface DiseaseQueryResult {
  disease_name: string;
  subject_results: DiseaseSubjectResult[];
  compiled_answer: string;
  cross_connections: string[];
  from_cache: boolean;
}

// ─── Disease normalisation ────────────────────────────────────────────────────

export function normaliseDiseaseQuery(userInput: string): string {
  const lower = userInput.toLowerCase().trim();
  const map = aliasMap as Record<string, string[]>;

  for (const [canonical, aliases] of Object.entries(map)) {
    if (aliases.some(alias => lower.includes(alias.toLowerCase()))) {
      return canonical;
    }
  }
  // Not in alias map — normalise the raw input to snake_case
  return lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ─── Subject + doc loader ─────────────────────────────────────────────────────

async function getSubjectsWithDocs(
  collegeId: string,
  conn: Connection,
): Promise<SubjectWithDocs[]> {
  const Subject  = getSubjectModel(conn);
  const Document = getDocumentModel(conn);

  const [subjects, docs] = await Promise.all([
    Subject.find({}).select("_id name dept_id").lean(),
    Document.find(
      { ingestion_status: "completed", is_visible_to_students: { $ne: false } },
      { _id: 1, subject_id: 1 },
    ).lean(),
  ]);

  // Group doc_ids by subject_id
  const docsBySubject = new Map<string, string[]>();
  for (const d of docs) {
    const sid = String(d.subject_id ?? "");
    if (!sid) continue;
    if (!docsBySubject.has(sid)) docsBySubject.set(sid, []);
    docsBySubject.get(sid)!.push(String(d._id));
  }

  return subjects
    .map(s => ({
      subjectId:   String(s._id),
      subjectName: s.name,
      deptId:      s.dept_id,
      docIds:      docsBySubject.get(String(s._id)) ?? [],
    }))
    .filter(s => s.docIds.length > 0);
}

// ─── Main disease query ───────────────────────────────────────────────────────

export async function diseaseQuery(
  userInput: string,
  collegeId: string,
  conn: Connection,
): Promise<DiseaseQueryResult> {
  const diseaseCanonical = normaliseDiseaseQuery(userInput);
  const cacheKey = `${collegeId}_${diseaseCanonical}`;

  // 1. Cache check
  const DiseaseQueryModel = getDiseaseQueryModel(conn);
  const now = new Date();
  const cached = await DiseaseQueryModel.findOne({
    cache_key:  cacheKey,
    expires_at: { $gt: now },
  }).lean();

  if (cached) {
    return {
      disease_name:      cached.disease_name,
      subject_results:   cached.subject_results,
      compiled_answer:   cached.compiled_answer,
      cross_connections: cached.cross_connections,
      from_cache:        true,
    };
  }

  // 2. Load subjects with docs
  const subjects = await getSubjectsWithDocs(collegeId, conn);
  if (subjects.length === 0) {
    return {
      disease_name:      userInput,
      subject_results:   [],
      compiled_answer:   `No uploaded materials found for this college.`,
      cross_connections: [],
      from_cache:        false,
    };
  }

  // 3. Embed query once
  const queryText = `${userInput}: pathology pharmacology clinical features management mechanisms complications`;
  const queryVector = await embedQuery(queryText);

  // 4. Query each subject's namespace in parallel (allSettled — partial results OK)
  const subjectQueryResults = await Promise.allSettled(
    subjects.map(async (subject): Promise<DiseaseSubjectResult | null> => {
      const matches = await queryNamespace(
        collegeId,
        subject.deptId,
        queryVector,
        TOP_K_PER_SUBJECT,
        subject.docIds,
      );

      const relevant = matches.filter(m => m.score >= MIN_SCORE);
      if (relevant.length === 0) return null;

      // Per-subject summary (Haiku — cheap, parallel)
      const chunkTexts = relevant.map(m => m.text).join("\n\n");
      const summary = await quickSummary(chunkTexts, subject.subjectName, userInput);

      const firstMeta = relevant[0].metadata;
      return {
        subject_id:      subject.subjectId,
        subject_name:    subject.subjectName,
        doc_id:          String(firstMeta.doc_id ?? ""),
        doc_filename:    String(firstMeta.filename ?? firstMeta.original_filename ?? ""),
        relevant_chunks: relevant.map(m => ({
          chunk_id:        m.id,
          text:            m.text,
          page_num:        Number(m.metadata.page_num ?? 0),
          chapter_title:   String(m.metadata.chapter_title ?? ""),
          relevance_score: m.score,
        })),
        summary,
      };
    }),
  );

  const filledResults: DiseaseSubjectResult[] = subjectQueryResults
    .filter((r): r is PromiseFulfilledResult<DiseaseSubjectResult> =>
      r.status === "fulfilled" && r.value !== null)
    .map(r => r.value as DiseaseSubjectResult);

  if (filledResults.length === 0) {
    return {
      disease_name:      userInput,
      subject_results:   [],
      compiled_answer:   `No content about "${userInput}" found in uploaded materials. Ask faculty to upload relevant textbooks.`,
      cross_connections: [],
      from_cache:        false,
    };
  }

  // 5. Compile cross-subject answer (Haiku)
  const [compiledAnswer, crossConnections] = await Promise.all([
    compileDiseaseCrossSubject(userInput, filledResults),
    Promise.resolve(identifyCrossConnections(filledResults)),
  ]);

  // 6. Cache result (24h TTL)
  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 3600 * 1000);
  await DiseaseQueryModel.findOneAndUpdate(
    { cache_key: cacheKey },
    {
      $set: {
        _id:               randomUUID(),
        college_id:        collegeId,
        dept_id_scope:     "all",
        disease_name:      diseaseCanonical,
        disease_aliases:   [userInput],
        subject_results:   filledResults,
        compiled_answer:   compiledAnswer,
        cross_connections: crossConnections,
        cache_key:         cacheKey,
        expires_at:        expiresAt,
      },
    },
    { upsert: true, new: true },
  );

  return {
    disease_name:      userInput,
    subject_results:   filledResults,
    compiled_answer:   compiledAnswer,
    cross_connections: crossConnections,
    from_cache:        false,
  };
}

// ─── SSE disease chat ─────────────────────────────────────────────────────────

export async function streamDiseaseChat(
  userInput: string,
  disease: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  collegeId: string,
  conn: Connection,
  reply: FastifyReply,
): Promise<void> {
  const subjects = await getSubjectsWithDocs(collegeId, conn);
  if (subjects.length === 0) {
    sendSSE(reply, { type: "error", message: "No uploaded materials found." });
    return;
  }

  const queryVector = await embedQuery(userInput);

  // Parallel Pinecone — top 3 per subject
  const allMatches = await Promise.allSettled(
    subjects.map(s =>
      queryNamespace(collegeId, s.deptId, queryVector, 3, s.docIds),
    ),
  );

  // Flatten, filter, sort, take top 8
  const combined = allMatches
    .filter((r): r is PromiseFulfilledResult<PineconeChunk[]> => r.status === "fulfilled")
    .flatMap(r => r.value)
    .filter(m => m.score >= CHAT_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (combined.length === 0) {
    sendSSE(reply, { type: "token", content: `No relevant content about "${disease}" found in uploaded materials.` });
    sendSSE(reply, { type: "done" });
    return;
  }

  // Build context with subject attribution
  const subjectNameById = Object.fromEntries(subjects.map(s => [s.subjectId, s.subjectName]));
  const contextParts = combined.map(chunk => {
    const subjectId = String(chunk.metadata.subject_id ?? "");
    const subjectName = subjectNameById[subjectId] ?? "Unknown Subject";
    const pageNum = chunk.metadata.page_num ?? "";
    return `[${subjectName}, Page ${pageNum}]\n${chunk.text}`;
  });
  const context = contextParts.join("\n\n---\n\n");

  const subjectNames = [...new Set(combined.map(c => {
    const sid = String(c.metadata.subject_id ?? "");
    return subjectNameById[sid] ?? "";
  }).filter(Boolean))];

  const systemPrompt = `You are answering a question about "${disease}" drawing from multiple subjects: ${subjectNames.join(", ")}.
Use ONLY the provided content. Clearly attribute each point to its source subject and page number.
Format your answer with subject headings where different subjects contribute different perspectives.
Always cite: "— [Subject Name, Page X]"
Do not invent information not present in the provided content.`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...conversationHistory.slice(-6),
    { role: "user", content: `Context:\n${context}\n\nQuestion: ${userInput}` },
  ];

  try {
    const { tokenStream } = await streamChatResponse(systemPrompt, messages);
    for await (const token of tokenStream) {
      sendSSE(reply, { type: "token", content: token });
    }
    sendSSE(reply, { type: "done" });
  } catch (err) {
    sendSSE(reply, { type: "error", message: (err as Error).message });
  }
}

// ─── Disease search suggestions ───────────────────────────────────────────────

export async function getDiseaseSuggestions(
  collegeId: string,
  conn: Connection,
): Promise<{ popular_diseases: string[]; recent_canonical: string[] }> {
  const DiseaseQueryModel = getDiseaseQueryModel(conn);

  // Most recently searched canonical disease names for this college
  const recent = await DiseaseQueryModel.find({ college_id: collegeId })
    .sort({ created_at: -1 })
    .limit(10)
    .select("disease_name")
    .lean();

  const popular_diseases = [
    "Myocardial Infarction", "Diabetes Mellitus", "Hypertension",
    "Tuberculosis", "Pneumonia", "Stroke", "Anaemia",
    "Typhoid", "Dengue", "Sepsis",
  ];

  return {
    popular_diseases,
    recent_canonical: recent.map(r => r.disease_name.replace(/_/g, " ")),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function quickSummary(
  chunkTexts: string,
  subjectName: string,
  disease: string,
): Promise<string> {
  try {
    const msg = await getClient().messages.create({
      model:      COMPILE_MODEL,
      max_tokens: 200,
      messages: [{
        role:    "user",
        content: `Summarise what this ${subjectName} content says about "${disease}" in 2–3 sentences. Cite page numbers where visible.\n\n${chunkTexts.slice(0, 3000)}`,
      }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text : "";
  } catch {
    return "";
  }
}

async function compileDiseaseCrossSubject(
  disease: string,
  results: DiseaseSubjectResult[],
): Promise<string> {
  const context = results.map(r =>
    `${r.subject_name}:\n${r.relevant_chunks.map(c => `[Page ${c.page_num}] ${c.text}`).join("\n")}`
  ).join("\n\n---\n\n");

  const subjectNames = results.map(r => r.subject_name).join(", ");

  const msg = await getClient().messages.create({
    model:      COMPILE_MODEL,
    max_tokens: 1200,
    messages: [{
      role:    "user",
      content: `Compile a structured medical summary of "${disease}" from these subject perspectives: ${subjectNames}.
Create one section per subject (3–5 sentences each). Then write a "Cross-subject connections" section showing how the subjects link (e.g. "Pathology mechanism → Pharmacology drug target").
Cite page numbers where visible. Use only the provided content.

${context.slice(0, 8000)}`,
    }],
  });

  return msg.content[0].type === "text" ? msg.content[0].text : "";
}

function identifyCrossConnections(results: DiseaseSubjectResult[]): string[] {
  const names = results.map(r => r.subject_name.toLowerCase());
  const connections: string[] = [];

  if (names.some(n => n.includes("pathology")) && names.some(n => n.includes("pharmacology"))) {
    connections.push("Pathology (disease mechanism) → Pharmacology (drug targets the mechanism)");
  }
  if (names.some(n => n.includes("biochemistry")) && names.some(n => n.includes("medicine"))) {
    connections.push("Biochemistry (diagnostic markers) → Medicine (clinical interpretation)");
  }
  if (names.some(n => n.includes("physiology")) && names.some(n => n.includes("pathology"))) {
    connections.push("Physiology (normal function) → Pathology (what goes wrong)");
  }
  if (names.some(n => n.includes("microbiology")) && names.some(n => n.includes("pharmacology"))) {
    connections.push("Microbiology (causative organism) → Pharmacology (antibiotic/antiviral choice)");
  }
  if (names.some(n => n.includes("anatomy")) && names.some(n => n.includes("surgery"))) {
    connections.push("Anatomy (structural relationships) → Surgery (operative approach)");
  }
  return connections;
}

function sendSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
