export type CollegeType = "engineering" | "medical" | "other";
export type CollegeStatus = "active" | "suspended" | "deleted";

export interface College {
  _id: string;
  name: string;
  type: CollegeType;
  slug: string;
  status: CollegeStatus;
  owner_admin_id: string;
  pinecone_prefix: string;
  r2_prefix: string;
  mongo_db_name: string;
  token_limit_per_month: number;
  tokens_used_this_month: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCollegeInput {
  name: string;
  type: CollegeType;
  slug: string;
  owner_email: string;
  token_limit_per_month?: number;
}
