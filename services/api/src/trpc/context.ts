import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";
import { isDeptAdmin, isStudent, type AnyJWTPayload } from "@college-chatbot/shared";
import { getCollegeDb as _getCollegeDb } from "../db/college.db";
import type { Connection } from "mongoose";

export function createContext({ req }: { req: FastifyRequest; res: FastifyReply }) {
  const authHeader = req.headers.authorization;
  let user: AnyJWTPayload | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    try {
      user = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as AnyJWTPayload;
    } catch {
      // expired or invalid — user stays null, procedures enforce auth
    }
  }

  const collegeId =
    user && (isDeptAdmin(user) || isStudent(user)) ? user.college_id : null;

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
