export interface SuperAdminJWTPayload {
  sub: string;
  role: "super_admin";
  iat: number;
  exp: number;
}

export interface CollegeAdminPermissionsJWT {
  can_create_dept_admins: boolean;
  can_deactivate_dept_admins: boolean;
  can_view_student_list: boolean;
  can_export_reports: boolean;
  can_view_cost_usage: boolean;
}

export interface CollegeAdminJWTPayload {
  sub: string;
  role: "college_admin";
  college_id: string;
  college_slug: string;
  college_name: string;
  admin_name: string;
  admin_title: string;
  permissions: CollegeAdminPermissionsJWT;
  iat: number;
  exp: number;
}

export interface DeptAdminPermissionsJWT {
  can_upload_documents: boolean;
  can_delete_documents: boolean;
  can_manage_subjects: boolean;
  can_view_student_list: boolean;
  can_reset_student_passwords: boolean;
}

export interface DeptAdminJWTPayload {
  sub: string;
  role: "dept_admin";
  college_id: string;
  college_slug: string;
  dept_id: string;
  dept_name: string;
  admin_name: string;
  faculty_title?: string;
  permissions: DeptAdminPermissionsJWT;
  iat: number;
  exp: number;
}

export interface StudentJWTPayload {
  sub: string;
  role: "student";
  college_id: string;
  college_type: "engineering" | "medical" | "other";
  dept_id: string;
  effective_dept_id: string;
  using_generic_fallback: boolean;
  semester: number;
  iat: number;
  exp: number;
}

export type AnyJWTPayload =
  | SuperAdminJWTPayload
  | CollegeAdminJWTPayload
  | DeptAdminJWTPayload
  | StudentJWTPayload;

export function isSuperAdmin(payload: AnyJWTPayload): payload is SuperAdminJWTPayload {
  return payload.role === "super_admin";
}

export function isCollegeAdmin(payload: AnyJWTPayload): payload is CollegeAdminJWTPayload {
  return payload.role === "college_admin";
}

export function isDeptAdmin(payload: AnyJWTPayload): payload is DeptAdminJWTPayload {
  return payload.role === "dept_admin";
}

export function isStudent(payload: AnyJWTPayload): payload is StudentJWTPayload {
  return payload.role === "student";
}

export function isAdminRole(
  payload: AnyJWTPayload,
): payload is SuperAdminJWTPayload | CollegeAdminJWTPayload | DeptAdminJWTPayload {
  return payload.role === "super_admin" || payload.role === "college_admin" || payload.role === "dept_admin";
}
