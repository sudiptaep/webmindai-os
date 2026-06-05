import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  isDeptAdmin,
  isCollegeAdmin,
  isStudent,
  type AnyJWTPayload,
} from "@college-chatbot/shared";
import { getCollegeDb as _getCollegeDb } from "../db/college.db";
import type { Connection } from "mongoose";

export function createContext({ req }: { req: FastifyRequest; res: FastifyReply }) {
  const authHeader = req.headers.authorization;
  let user: AnyJWTPayload | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const secrets = [
      process.env.JWT_SECRET!,
      process.env.COLLEGE_ADMIN_JWT_SECRET,
      process.env.SUPER_ADMIN_JWT_SECRET,
    ].filter(Boolean) as string[];

    for (const secret of secrets) {
      try {
        user = jwt.verify(token, secret) as AnyJWTPayload;
        break;
      } catch {
        // try next secret
      }
    }
  }

  const collegeId =
    user && (isDeptAdmin(user) || isCollegeAdmin(user) || isStudent(user))
      ? user.college_id
      : null;

  return {
    user,
    collegeId,
    getCollegeDb: (id?: string): Promise<Connection> => {
      const target = id ?? collegeId;
      if (!target) throw new Error("No college ID in context");
      return _getCollegeDb(target);
    },
  };
}

export type Context = ReturnType<typeof createContext>;
