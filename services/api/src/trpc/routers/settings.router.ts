import bcrypt from "bcrypt";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "../trpc";
import { getPlatformAdminModel } from "../../models/platform/platform-admin.model";

export const settingsRouter = router({
  getProfile: superAdminProcedure.query(async ({ ctx }) => {
    const PlatformAdmin = getPlatformAdminModel();
    const admin = await PlatformAdmin.findById(ctx.user.sub, { password_hash: 0 }).lean();
    if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
    return admin;
  }),

  updateProfile: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        current_password: z.string().optional(),
        new_password: z.string().min(8).optional(),
      }).refine(
        (d) => !d.new_password || !!d.current_password,
        { message: "current_password required to change password" }
      )
    )
    .mutation(async ({ ctx, input }) => {
      const PlatformAdmin = getPlatformAdminModel();
      const admin = await PlatformAdmin.findById(ctx.user.sub).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const update: Record<string, unknown> = {};
      if (input.name) update.name = input.name;

      if (input.new_password) {
        const valid = await bcrypt.compare(input.current_password!, admin.password_hash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });
        update.password_hash = await bcrypt.hash(input.new_password, 12);
      }

      if (Object.keys(update).length === 0) return { ok: true };
      await PlatformAdmin.updateOne({ _id: ctx.user.sub }, { $set: update });
      return { ok: true };
    }),
});
