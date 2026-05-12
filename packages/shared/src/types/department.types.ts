export type DepartmentType = "engineering" | "medical" | "generic" | "other";

export interface Department {
  _id: string;
  college_id: string;
  name: string;
  code: string;
  type: DepartmentType;
  is_generic: boolean;
  cannot_delete: boolean;
  pinecone_namespace: string;
  subject_count: number;
  doc_count: number;
  chunk_count: number;
  deleted?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDepartmentInput {
  name: string;
  code: string;
  type: DepartmentType;
  college_id: string;
}
