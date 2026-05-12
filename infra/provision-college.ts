/**
 * CLI script: provision a college manually.
 * Usage:
 *   tsx infra/provision-college.ts \
 *     --name "MSRIT Bangalore" \
 *     --type engineering \
 *     --slug msrit \
 *     --owner-email owner@msrit.edu
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectPlatformDb } from "../services/api/src/db/platform.db";
import { provisionCollege } from "../services/api/src/services/provision.service";

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const name = get("--name");
  const type = get("--type") as "engineering" | "medical" | "other" | undefined;
  const slug = get("--slug");
  const ownerEmail = get("--owner-email");

  if (!name || !type || !slug || !ownerEmail) {
    console.error("Usage: tsx infra/provision-college.ts --name X --type engineering|medical|other --slug X --owner-email X");
    process.exit(1);
  }

  await connectPlatformDb();
  console.log("Connected to platform DB");

  const college = await provisionCollege({ name, type, slug, owner_email: ownerEmail });
  console.log("College provisioned:", JSON.stringify(college, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
