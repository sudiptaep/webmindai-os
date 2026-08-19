import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Concept, ConceptType, BloomLevel, ConceptExtractionMethod } from "@college-chatbot/shared";

const ConceptSchema = new Schema<Concept>(
  {
    _id:                  { type: String, default: () => randomUUID() },
    college_id:           { type: String, required: true },
    dept_id:              { type: String, required: true },
    subject_id:           { type: String },
    doc_id:               { type: String, required: true },

    canonical_name:       { type: String, required: true },
    aliases:              { type: [String], default: [] },
    concept_type: {
      type: String,
      enum: [
        "process_mechanism", "structure_anatomy", "law_relationship",
        "classification", "procedure_calculation", "causal_chain", "definition",
      ] as ConceptType[],
      required: true,
    },
    one_line_definition:  { type: String, required: true },

    chapter_index:        { type: Number, required: true },
    source_pages:         { type: [Number], default: [] },

    prerequisite_ids:     { type: [String], default: [] },
    prerequisite_names:   { type: [String], default: [] },

    bloom_ceiling: {
      type: String,
      enum: ["remember", "understand", "apply", "analyse"] as BloomLevel[],
      default: "understand",
    },
    difficulty_rating:    { type: Number, default: 0.5 },
    is_examinable:        { type: Boolean, default: true },
    pyq_frequency:        { type: Number, default: 0 },

    extraction_method: {
      type: String,
      enum: ["llm_chapter_pass", "faculty_authored", "faculty_edited"] as ConceptExtractionMethod[],
      default: "llm_chapter_pass",
    },
    reviewed_by_faculty:  { type: Boolean, default: false },
    concept_graph_version: { type: Number, default: 1 },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

ConceptSchema.index({ dept_id: 1, canonical_name: 1 });
ConceptSchema.index({ doc_id: 1, chapter_index: 1 });
ConceptSchema.index({ prerequisite_ids: 1 });
ConceptSchema.index({ dept_id: 1, aliases: 1 });

export function getConceptModel(conn: Connection): Model<Concept> {
  return (
    (conn.models["Concept"] as Model<Concept>) ??
    conn.model<Concept>("Concept", ConceptSchema, "concept_graph")
  );
}
