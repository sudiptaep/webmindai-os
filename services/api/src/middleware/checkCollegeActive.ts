import type { FastifyRequest, FastifyReply } from "fastify";
import { isSuperAdmin, isDeptAdmin, isStudent } from "@college-chatbot/shared";
import { getCollegeModel } from "../models/platform/college.model";

export async function checkCollegeActive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.user;
  if (!user || isSuperAdmin(user)) return;

  const college_id = isDeptAdmin(user) || isStudent(user) ? user.college_id : null;
  if (!college_id) return;

  const College = getCollegeModel();
  const college = await College.findById(college_id).select("status").lean();
  if (!college || college.status === "suspended" || college.status === "deleted") {
    reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "College is not active" });
  }
}
