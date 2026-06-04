/**
 * One-time script: creates the first super admin, seeds the rate table, and seeds the global cost policy.
 * Usage:
 *   tsx infra/seed-super-admin.ts --email admin@example.com --password s3cr3t
 *
 * All values can also be set via env vars:
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *   DEFAULT_TOKEN_LIMIT_PER_MONTH, DEFAULT_COST_BUDGET_USD, etc.
 */
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const email = get("--email") ?? process.env.SEED_ADMIN_EMAIL;
  const password = get("--password") ?? process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: tsx infra/seed-super-admin.ts --email <email> --password <password>");
    process.exit(1);
  }

  const uri = process.env.MONGO_PLATFORM_URI;
  if (!uri) throw new Error("MONGO_PLATFORM_URI not set");

  await mongoose.connect(uri, { dbName: "platform" });
  console.log("Connected to platform DB");

  // --- 1. Platform admin ---
  const { getPlatformAdminModel } = await import("../services/api/src/models/platform/platform-admin.model");
  const PlatformAdmin = getPlatformAdminModel();

  const existing = await PlatformAdmin.findOne({ email }).lean();
  if (existing) {
    console.log(`Super admin ${email} already exists — skipping admin creation`);
  } else {
    const password_hash = await bcrypt.hash(password, 12);
    const initials = email.slice(0, 2).toUpperCase();
    await PlatformAdmin.create({ email, password_hash, role: "super_admin", avatar_initials: initials });
    console.log(`✓ Super admin created: ${email}`);
  }

  // --- 2. Rate table ---
  const { getRateTableModel } = await import("../services/api/src/models/platform/rate-table.model");
  const RateTable = getRateTableModel();

  const rateRows = [
    {
      service: "anthropic",
      model: "claude-haiku-4-5-20251001",
      input_token_cost_per_1k:  Number(process.env.ANTHROPIC_HAIKU_INPUT_COST_PER_1K  ?? 0.00025),
      output_token_cost_per_1k: Number(process.env.ANTHROPIC_HAIKU_OUTPUT_COST_PER_1K ?? 0.00125),
      per_unit_cost: 0,
      storage_cost_per_gb_per_month: 0,
      notes: "Claude Haiku 4.5 (2025)",
    },
    {
      service: "anthropic",
      model: "claude-sonnet-4-6",
      input_token_cost_per_1k:  Number(process.env.ANTHROPIC_SONNET_INPUT_COST_PER_1K  ?? 0.003),
      output_token_cost_per_1k: Number(process.env.ANTHROPIC_SONNET_OUTPUT_COST_PER_1K ?? 0.015),
      per_unit_cost: 0,
      storage_cost_per_gb_per_month: 0,
      notes: "Claude Sonnet 4.6",
    },
    {
      service: "openai_embeddings",
      model: "text-embedding-3-small",
      input_token_cost_per_1k:  Number(process.env.OPENAI_EMBEDDING_COST_PER_1K ?? 0.00002),
      output_token_cost_per_1k: 0,
      per_unit_cost: 0,
      storage_cost_per_gb_per_month: 0,
      notes: "OpenAI text-embedding-3-small",
    },
    {
      service: "pinecone",
      model: "serverless",
      input_token_cost_per_1k: 0,
      output_token_cost_per_1k: 0,
      per_unit_cost: Number(process.env.PINECONE_READ_UNIT_COST_PER_1M ?? 0.096) / 1_000_000,
      storage_cost_per_gb_per_month: Number(process.env.PINECONE_STORAGE_COST_PER_GB ?? 0.025),
      notes: "Pinecone serverless — per read unit",
    },
    {
      service: "pinecone",
      model: "serverless_write",
      input_token_cost_per_1k: 0,
      output_token_cost_per_1k: 0,
      per_unit_cost: Number(process.env.PINECONE_WRITE_UNIT_COST_PER_1M ?? 0.05) / 1_000_000,
      storage_cost_per_gb_per_month: 0,
      notes: "Pinecone serverless — per write unit",
    },
    {
      service: "cohere",
      model: "rerank-english-v3.0",
      input_token_cost_per_1k: 0,
      output_token_cost_per_1k: 0,
      per_unit_cost: Number(process.env.COHERE_RERANK_COST_PER_1K_SEARCHES ?? 0.002) / 1000,
      storage_cost_per_gb_per_month: 0,
      notes: "Cohere rerank — per search",
    },
  ];

  let rateUpserted = 0;
  for (const row of rateRows) {
    await RateTable.updateOne(
      { service: row.service, model: row.model },
      { $setOnInsert: { ...row, effective_from: new Date() } },
      { upsert: true },
    );
    rateUpserted++;
  }
  console.log(`✓ Rate table: ${rateUpserted} rows seeded (upsert — existing rates not overwritten)`);

  // --- 3. Global cost policy ---
  const { getCostPolicyModel } = await import("../services/api/src/models/platform/cost-policy.model");
  const CostPolicy = getCostPolicyModel();

  const existingGlobal = await CostPolicy.findOne({ target_type: "global", target_id: "global" }).lean();
  if (existingGlobal) {
    console.log("Global cost policy already exists — skipping (use the admin UI to edit)");
  } else {
    await CostPolicy.create({
      target_type: "global",
      target_id: "global",
      llm_token_limit_per_month:             Number(process.env.DEFAULT_TOKEN_LIMIT_PER_MONTH       ?? 5_000_000),
      llm_token_soft_warn_pct:               Number(process.env.DEFAULT_TOKEN_SOFT_WARN_PCT          ?? 80),
      llm_token_hard_stop:                   true,
      max_chat_queries_per_student_per_day:  Number(process.env.DEFAULT_MAX_CHAT_PER_STUDENT_PER_DAY ?? 50),
      max_ai_summaries_per_student_per_day:  Number(process.env.DEFAULT_MAX_SUMMARIES_PER_DAY        ?? 10),
      max_exam_gen_per_student_per_day:      Number(process.env.DEFAULT_MAX_EXAMS_PER_DAY            ?? 5),
      allowed_llm_models:                    (process.env.DEFAULT_ALLOWED_LLM_MODELS ?? "claude-haiku-4-5-20251001").split(","),
      cost_budget_usd_per_month:             Number(process.env.DEFAULT_COST_BUDGET_USD              ?? 20),
      cost_soft_warn_pct:                    Number(process.env.DEFAULT_COST_SOFT_WARN_PCT            ?? 80),
      storage_limit_gb:                      Number(process.env.DEFAULT_STORAGE_LIMIT_GB             ?? 10),
      notes: "Auto-seeded global default policy",
    });
    console.log("✓ Global cost policy created with defaults");
  }

  await mongoose.disconnect();
  console.log("\nDone. Run the API server and log in at /login.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
