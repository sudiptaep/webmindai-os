export type UserRole = "super_admin" | "college_admin" | "dept_admin" | "student";
export type AdminStatus = "active" | "invited" | "disabled";
export type StudentStatus = "active" | "disabled" | "pending_approval";

export type CollegeAdminTitle =
  | "Principal"
  | "HOD"
  | "Dean"
  | "Registrar"
  | "Academic Director"
  | "Custom";

export type FacultyTitle =
  | "Professor"
  | "Associate Prof"
  | "Assistant Prof"
  | "Lab In-Charge"
  | "Coordinator";

export type AdminActivityAction =
  | "create_college_admin"
  | "create_dept_admin"
  | "deactivate_college_admin"
  | "deactivate_dept_admin"
  | "reactivate_college_admin"
  | "reactivate_dept_admin"
  | "reset_admin_password"
  | "upload_document"
  | "delete_document"
  | "reingest_document"
  | "create_subject"
  | "delete_subject"
  | "create_department"
  | "disable_student"
  | "reset_student_password"
  | "update_college_admin_permissions"
  | "update_dept_admin_permissions"
  | "impersonate_admin";

export type AdminActivityTargetType =
  | "college_admin"
  | "dept_admin"
  | "student"
  | "document"
  | "subject"
  | "department";

export interface PlatformAdmin {
  _id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "super_admin";
  avatar_initials?: string;
  last_login?: Date;
  mfa_enabled: boolean;
  mfa_secret?: string;
  failed_login_attempts: number;
  locked_until?: Date;
  created_at: Date;
  updated_at?: Date;
}

export interface CollegeAdminPermissions {
  can_create_dept_admins: boolean;
  can_deactivate_dept_admins: boolean;
  can_view_student_list: boolean;
  can_export_reports: boolean;
  can_view_cost_usage: boolean;
}

export interface CollegeAdmin {
  _id: string;
  college_id: string;
  name: string;
  email: string;
  password_hash: string;
  phone?: string;
  role: "college_admin";
  admin_title: CollegeAdminTitle;
  custom_title?: string;
  permissions: CollegeAdminPermissions;
  status: AdminStatus;
  invite_token?: string;
  invite_token_expires_at?: Date;
  invited_by?: string;
  invite_accepted_at?: Date;
  last_login?: Date;
  last_login_ip?: string;
  login_count: number;
  password_reset_token?: string;
  password_reset_expires_at?: Date;
  must_change_password: boolean;
  created_at: Date;
  updated_at?: Date;
}

export interface DeptAdminPermissions {
  can_upload_documents: boolean;
  can_delete_documents: boolean;
  can_manage_subjects: boolean;
  can_view_student_list: boolean;
  can_reset_student_passwords: boolean;
}

export interface DeptAdmin {
  _id: string;
  college_id: string;
  dept_id: string;
  name: string;
  email: string;
  password_hash: string;
  phone?: string;
  role: "dept_admin";
  faculty_title?: FacultyTitle;
  permissions: DeptAdminPermissions;
  status: AdminStatus;
  invite_token?: string;
  invite_token_expires_at?: Date;
  invited_by?: string;
  invited_by_role?: "super_admin" | "college_admin";
  invite_accepted_at?: Date;
  last_login?: Date;
  last_login_ip?: string;
  login_count: number;
  password_reset_token?: string;
  password_reset_expires_at?: Date;
  must_change_password: boolean;
  created_at: Date;
  updated_at?: Date;
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
  srs_last_review_date?: string;
  srs_total_cards: number;
  daily_srs_target: number;
  preferred_question_type?: string;

  // F-14-D: Year Navigation
  current_year: number;
  current_semester: number;
}

export interface AdminActivityLog {
  _id: string;
  college_id: string;
  actor_id: string;
  actor_role: "super_admin" | "college_admin" | "dept_admin";
  actor_name: string;
  action: AdminActivityAction;
  target_type: AdminActivityTargetType;
  target_id: string;
  target_name: string;
  dept_id?: string;
  dept_name?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}
