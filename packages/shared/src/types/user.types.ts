export type UserRole = "super_admin" | "dept_admin" | "student";
export type AdminStatus = "active" | "invited" | "disabled";
export type StudentStatus = "active" | "disabled" | "pending_approval";

export interface PlatformAdmin {
  _id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "super_admin";
  created_at: Date;
}

export interface DeptAdmin {
  _id: string;
  college_id: string;
  dept_ids: string[];
  name: string;
  email: string;
  password_hash: string;
  role: "dept_admin";
  is_college_owner: boolean;
  status: AdminStatus;
  last_login?: Date;
  created_at: Date;
}

export interface Student {
  _id: string;
  college_id: string;
  dept_id: string;
  effective_dept_id: string;
  using_generic_fallback: boolean;
  name: string;
  email: string;
  password_hash: string;
  roll_number?: string;
  semester: number;
  status: StudentStatus;
  email_verified: boolean;
  last_login?: Date;
  created_at: Date;

  // F-14-A: Spaced Repetition
  srs_cards_due_today: number;
  srs_streak_days: number;
  srs_last_review_date?: string;   // "YYYY-MM-DD"
  srs_total_cards: number;
  daily_srs_target: number;
  preferred_question_type?: string;

  // F-14-D: Year Navigation
  current_year: number;            // 1–4 (MBBS) or 1–4 (engineering)
  current_semester: number;        // 1–8
}
