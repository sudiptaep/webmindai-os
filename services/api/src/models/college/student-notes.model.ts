import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { StudentNotes, StudentNote } from "@college-chatbot/shared";

const NoteSchema = new Schema<StudentNote>(
  {
    note_id:            { type: String, default: () => randomUUID() },
    content:            { type: String, required: true },
    source_page:        { type: Number },
    pinned_ai_response: { type: String },
    created_at:         { type: Date, default: () => new Date() },
    updated_at:         { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const StudentNotesSchema = new Schema<StudentNotes>(
  {
    _id:           { type: String, default: () => randomUUID() },
    student_id:    { type: String, required: true },
    doc_id:        { type: String, required: true },
    chapter_index: { type: Number, required: true },
    college_id:    { type: String, required: true },
    notes:         { type: [NoteSchema], default: [] },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

StudentNotesSchema.index({ student_id: 1, doc_id: 1, chapter_index: 1 }, { unique: true });

export function getStudentNotesModel(conn: Connection): Model<StudentNotes> {
  return (
    (conn.models["StudentNotes"] as Model<StudentNotes>) ??
    conn.model<StudentNotes>("StudentNotes", StudentNotesSchema)
  );
}
