import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export interface DailyUsageRollup {
  _id: string;
  date: string;           // "2026-05-20"
  college_id: string | null;
  dept_id: string | null;

  mongo_storage_gb: number;
  mongo_document_count: number;
  mongo_avg_query_latency_ms: number;
  mongo_peak_connections: number;

  anthropic_total_tokens: number;
  anthropic_requests: number;
  anthropic_errors: number;
  anthropic_avg_latency_ms: number;
  anthropic_haiku_tokens: number;
  anthropic_sonnet_tokens: number;

  openai_total_tokens: number;
  openai_requests: number;
  openai_errors: number;
  openai_avg_latency_ms: number;

  pinecone_vector_count: number;
  pinecone_storage_gb: number;
  pinecone_read_units: number;
  pinecone_write_units: number;
  pinecone_avg_query_latency_ms: number;

  disk_used_gb: number;
  disk_free_gb: number;
  disk_used_pct: number;

  redis_memory_mb: number;
  redis_peak_clients: number;
  redis_queue_peak_depth: number;

  computed_at: Date;
}

const DailyUsageRollupSchema = new Schema<DailyUsageRollup>(
  {
    _id: { type: String, default: () => randomUUID() },
    date: { type: String, required: true },
    college_id: { type: String, default: null },
    dept_id: { type: String, default: null },

    mongo_storage_gb: { type: Number, default: 0 },
    mongo_document_count: { type: Number, default: 0 },
    mongo_avg_query_latency_ms: { type: Number, default: 0 },
    mongo_peak_connections: { type: Number, default: 0 },

    anthropic_total_tokens: { type: Number, default: 0 },
    anthropic_requests: { type: Number, default: 0 },
    anthropic_errors: { type: Number, default: 0 },
    anthropic_avg_latency_ms: { type: Number, default: 0 },
    anthropic_haiku_tokens: { type: Number, default: 0 },
    anthropic_sonnet_tokens: { type: Number, default: 0 },

    openai_total_tokens: { type: Number, default: 0 },
    openai_requests: { type: Number, default: 0 },
    openai_errors: { type: Number, default: 0 },
    openai_avg_latency_ms: { type: Number, default: 0 },

    pinecone_vector_count: { type: Number, default: 0 },
    pinecone_storage_gb: { type: Number, default: 0 },
    pinecone_read_units: { type: Number, default: 0 },
    pinecone_write_units: { type: Number, default: 0 },
    pinecone_avg_query_latency_ms: { type: Number, default: 0 },

    disk_used_gb: { type: Number, default: 0 },
    disk_free_gb: { type: Number, default: 0 },
    disk_used_pct: { type: Number, default: 0 },

    redis_memory_mb: { type: Number, default: 0 },
    redis_peak_clients: { type: Number, default: 0 },
    redis_queue_peak_depth: { type: Number, default: 0 },

    computed_at: { type: Date, default: () => new Date() },
  },
  { _id: false, timestamps: false, versionKey: false },
);

DailyUsageRollupSchema.index({ date: 1, college_id: 1 }, { unique: true });
DailyUsageRollupSchema.index({ date: -1 });

export function getDailyUsageRollupModel(): Model<DailyUsageRollup> {
  return (
    (mongoose.models["DailyUsageRollup"] as Model<DailyUsageRollup>) ??
    mongoose.model<DailyUsageRollup>("DailyUsageRollup", DailyUsageRollupSchema)
  );
}
