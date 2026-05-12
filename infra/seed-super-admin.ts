/**
 * One-time script: creates the first super admin account.
 * Usage: tsx infra/seed-super-admin.ts --email admin@example.com --password s3cr3t
 */
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const email = get("--email") ?? process.env.SEED_ADMIN_EMAIL;
  const password = get("--password") ?? process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: tsx infra/seed-super-admin.ts --email <email> --password <password>");
    process.exit(1);
  }

  const uri = process.env.MONGO_PLATFORM_URI;
  if (!uri) throw new Error("MONGO_PLATFORM_URI not set");

  await mongoose.connect(uri, { dbName: "platform" });
  console.log("Connected to platform DB");

  // Lazy import after connection
  const { getPlatformAdminModel } = await import("../services/api/src/models/platform/platform-admin.model");
  const PlatformAdmin = getPlatformAdminModel();

  const existing = await PlatformAdmin.findOne({ email }).lean();
  if (existing) {
    console.log(`Super admin with email ${email} already exists.`);
    await mongoose.disconnect();
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  await PlatformAdmin.create({ email, password_hash, role: "super_admin" });
  console.log(`Super admin created: ${email}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
