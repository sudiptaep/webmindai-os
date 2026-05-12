/**
 * CLI script: hard-deprovision a college (irreversible).
 * Soft-deletes the college record, drops the MongoDB DB, and lists
 * Pinecone namespaces + R2 prefix for manual cleanup.
 *
 * Usage: tsx infra/deprovision-college.ts --college-id <uuid>
 *
 * WARNING: This drops the college MongoDB database permanently.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectPlatformDb } from "../services/api/src/db/platform.db";
import { getCollegeModel } from "../services/api/src/models/platform/college.model";
import { getCollegeDb, closeCollegeDb } from "../services/api/src/db/college.db";
import { getDepartmentModel } from "../services/api/src/models/college/department.model";

async function main() {
  const args = process.argv.slice(2);
  const collegeId = args[args.indexOf("--college-id") + 1];
  if (!collegeId) {
    console.error("Usage: tsx infra/deprovision-college.ts --college-id <uuid>");
    process.exit(1);
  }

  await connectPlatformDb();

  const College = getCollegeModel();
  const college = await College.findById(collegeId).lean();
  if (!college) {
    console.error("College not found:", collegeId);
    process.exit(1);
  }

  console.log(`\nDeprovisioning: ${college.name} (${college.slug})`);
  console.log("This will PERMANENTLY drop:", college.mongo_db_name);
  console.log("Pinecone prefix to clean up manually:", college.pinecone_prefix);
  console.log("R2 prefix to clean up manually:", college.r2_prefix);

  // Collect namespaces for reference
  try {
    const conn = await getCollegeDb(collegeId);
    const Department = getDepartmentModel(conn);
    const depts = await Department.find({ college_id: collegeId }).select("pinecone_namespace name").lean();
    console.log("\nPinecone namespaces to delete:");
    depts.forEach((d) => console.log(`  ${d.pinecone_namespace}  (${d.name})`));

    // Drop the college MongoDB database
    await conn.dropDatabase();
    console.log(`\nDropped MongoDB database: ${college.mongo_db_name}`);
    await closeCollegeDb(collegeId);
  } catch (err) {
    console.warn("Could not drop college DB (may not exist):", (err as Error).message);
  }

  // Soft-delete college record in platform DB
  await College.findByIdAndUpdate(collegeId, { status: "deleted" });
  console.log("College record soft-deleted in platform DB");

  await mongoose.disconnect();
  console.log("\nDeprovision complete. Clean up Pinecone namespaces and R2 files manually.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
