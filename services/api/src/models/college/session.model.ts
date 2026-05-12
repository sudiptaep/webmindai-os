import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Session, Message, SourceCitation } from "@college-chatbot/shared";

const SourceCitationSchema = new Schema<SourceCitation>(
  {
    doc_id: String,
    filename: String,
    page: Number,
    slide: Number,
    timestamp: Number,
    subject: String,
    chunk_preview: String,
  },
  { _id: false },
);

const MessageSchema = new Schema<Message>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    sources: { type: [SourceCitationSchema], default: [] },
    confidence_score: Number,
    answered: { type: Boolean, default: true },
    timestamp: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const SessionSchema = new Schema<Session>(
  {
    _id: { type: String, default: () => randomUUID() },
    student_id: { type: String, required: true },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    messages: { type: [MessageSchema], default: [] },
    started_at: { type: Date, default: () => new Date() },
    last_active: { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

SessionSchema.index({ student_id: 1, last_active: -1 });

export function getSessionModel(conn: Connection): Model<Session> {
  return (conn.models["Session"] as Model<Session>) ?? conn.model<Session>("Session", SessionSchema);
}
