import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { ImageAsset, ImageType, ImageVisionStatus } from "@college-chatbot/shared";

const ImageAssetSchema = new Schema<ImageAsset>(
  {
    _id: { type: String, default: () => randomUUID() },
    doc_id: { type: String, required: true },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    subject_id: { type: String },

    file_path: { type: String, required: true },
    thumbnail_path: { type: String, required: true },
    file_size_bytes: { type: Number, required: true },
    width_px: { type: Number, required: true },
    height_px: { type: Number, required: true },
    format: { type: String, enum: ["jpg", "png", "gif", "webp"], required: true },

    source_page: { type: Number, required: true },
    image_index_on_page: { type: Number, required: true },
    global_image_index: { type: Number, required: true },
    content_hash: { type: String, required: true },

    vision_status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "skipped"] as ImageVisionStatus[],
      default: "pending",
    },
    vision_tokens_used: { type: Number },
    description: { type: String },
    labels_extracted: { type: [String], default: [] },
    caption: { type: String },
    image_type: {
      type: String,
      enum: [
        "anatomical_diagram", "histology", "pathology", "flowchart", "graph_chart",
        "circuit_diagram", "block_diagram", "chemical_structure", "clinical_image",
        "photograph", "table_image", "equation", "other",
      ] as ImageType[],
    },
    clinical_relevance: { type: String },
    searchable_terms: { type: [String], default: [] },
    alt_text: { type: String },

    pinecone_vector_id: { type: String },
    was_filtered: { type: Boolean, default: false },
    filter_reason: { type: String, enum: ["too_small", "logo_icon", "low_quality", "duplicate"] },
    hidden: { type: Boolean, default: false },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

ImageAssetSchema.index({ doc_id: 1, source_page: 1 });
ImageAssetSchema.index({ doc_id: 1, vision_status: 1 });
ImageAssetSchema.index({ dept_id: 1, image_type: 1 });
ImageAssetSchema.index({ doc_id: 1, content_hash: 1 });

export function getImageAssetModel(conn: Connection): Model<ImageAsset> {
  return (
    (conn.models["ImageAsset"] as Model<ImageAsset>) ??
    conn.model<ImageAsset>("ImageAsset", ImageAssetSchema)
  );
}
