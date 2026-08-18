import { Schema, type Connection, type Model } from "mongoose";
import type { ParentChunk } from "@college-chatbot/shared";

const ParentChunkSchema = new Schema<ParentChunk>(
  {
    _id: { type: String, required: true },  // set by ingestion worker — {doc_id}_p{index}
    doc_id: { type: String, required: true },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    subject_id: { type: String },

    text: { type: String, required: true },
    token_count: { type: Number, required: true },

    page_start: { type: Number, required: true },
    page_end: { type: Number, required: true },
    child_chunk_count: { type: Number, default: 0 },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: false }, versionKey: false },
);

ParentChunkSchema.index({ doc_id: 1, page_start: 1 });
ParentChunkSchema.index({ dept_id: 1 });

export function getParentChunkModel(conn: Connection): Model<ParentChunk> {
  return (
    (conn.models["ParentChunk"] as Model<ParentChunk>) ??
    conn.model<ParentChunk>("ParentChunk", ParentChunkSchema)
  );
}
