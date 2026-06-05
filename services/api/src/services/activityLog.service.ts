import type { Connection } from "mongoose";
import { getAdminActivityLogModel } from "../models/college/admin-activity-log.model";
import type { AdminActivityAction, AdminActivityTargetType } from "@college-chatbot/shared";

interface LogAdminActionInput {
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
}

export async function logAdminAction(conn: Connection, input: LogAdminActionInput): Promise<void> {
  try {
    const Log = getAdminActivityLogModel(conn);
    await Log.create(input);
  } catch {
    // Activity logging must never crash the main operation
  }
}
