export interface SuperAdminJWTPayload {
  sub: string;
  role: "super_admin";
  iat: number;
  exp: number;
}

export interface DeptAdminJWTPayload {
  sub: string;
  role: "dept_admin";
  college_id: string;
  dept_ids: string[];
  is_college_owner: boolean;
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

export type AnyJWTPayload = SuperAdminJWTPayload | DeptAdminJWTPayload | StudentJWTPayload;

export function isSuperAdmin(payload: AnyJWTPayload): payload is SuperAdminJWTPayload {
  return payload.role === "super_admin";
}

export function isDeptAdmin(payload: AnyJWTPayload): payload is DeptAdminJWTPayload {
  return payload.role === "dept_admin";
}

export function isStudent(payload: AnyJWTPayload): payload is StudentJWTPayload {
  return payload.role === "student";
}
