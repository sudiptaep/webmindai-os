import { initTRPC, TRPCError } from "@trpc/server";
import {
  isSuperAdmin,
  isDeptAdmin,
  isStudent,
  type DeptAdminJWTPayload,
  type StudentJWTPayload,
} from "@college-chatbot/shared";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isSuperAdmin(ctx.user))
    throw new TRPCError({ code: "FORBIDDEN", message: "Super admin access required" });
  return next({ ctx });
});

export const deptAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isDeptAdmin(ctx.user))
    throw new TRPCError({ code: "FORBIDDEN", message: "Dept admin access required" });
  return next({ ctx: { ...ctx, user: ctx.user as DeptAdminJWTPayload } });
});

export const studentProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isStudent(ctx.user))
    throw new TRPCError({ code: "FORBIDDEN", message: "Student access required" });
  return next({ ctx: { ...ctx, user: ctx.user as StudentJWTPayload } });
});
