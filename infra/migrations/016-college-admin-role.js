/**
 * Migration 016: College Admin Role System
 *
 * Moves all dept_admins with is_college_owner=true → new college_admins collection.
 * Converts dept_ids[] → single dept_id on all dept_admins.
 * Sets Redis flag to force token refresh for affected dept_admins.
 *
 * Run: node infra/migrations/016-college-admin-role.js
 */

const { MongoClient } = require("mongodb");
const Redis = require("ioredis");
const { randomUUID } = require("crypto");

const MONGO_PLATFORM_URI = process.env.MONGO_PLATFORM_URI;
const MONGO_BASE_URI = process.env.MONGO_BASE_URI;
const REDIS_URL = process.env.REDIS_URL;

if (!MONGO_PLATFORM_URI || !MONGO_BASE_URI) {
  console.error("MONGO_PLATFORM_URI and MONGO_BASE_URI must be set");
  process.exit(1);
}

function getCollegeDbName(collegeId) {
  return `cc_${collegeId.replace(/-/g, "").slice(0, 24)}`;
}

async function migrate() {
  const platformClient = new MongoClient(MONGO_PLATFORM_URI);
  await platformClient.connect();

  const platformDb = platformClient.db("platform");
  const colleges = await platformDb.collection("colleges").find({ status: "active" }).toArray();

  console.log(`Found ${colleges.length} active colleges to migrate`);
  let totalCollegeAdminsCreated = 0;
  let totalDeptAdminsConverted = 0;

  for (const college of colleges) {
    const collegeId = String(college._id);
    const dbName = getCollegeDbName(collegeId);

    const client = new MongoClient(`${MONGO_BASE_URI}/${dbName}`);
    await client.connect();
    const db = client.db(dbName);

    const deptAdmins = await db.collection("deptadmins").find({}).toArray();

    // Step 1: Migrate college owners to college_admins collection
    const collegeOwners = deptAdmins.filter((a) => a.is_college_owner === true);
    for (const owner of collegeOwners) {
      const alreadyMigrated = await db.collection("collegeadmins").findOne({ email: owner.email });
      if (alreadyMigrated) {
        console.log(`  [SKIP] College admin already exists: ${owner.email}`);
        continue;
      }

      await db.collection("collegeadmins").insertOne({
        _id: randomUUID(),
        college_id: collegeId,
        name: owner.name,
        email: owner.email,
        password_hash: owner.password_hash,
        phone: null,
        role: "college_admin",
        admin_title: "Principal",
        custom_title: null,
        permissions: {
          can_create_dept_admins: true,
          can_deactivate_dept_admins: true,
          can_view_student_list: true,
          can_export_reports: true,
          can_view_cost_usage: false,
        },
        status: owner.status,
        invite_token: null,
        invite_token_expires_at: null,
        invited_by: null,
        invite_accepted_at: owner.created_at,
        last_login: owner.last_login ?? null,
        last_login_ip: null,
        login_count: 0,
        password_reset_token: null,
        password_reset_expires_at: null,
        must_change_password: false,
        created_at: owner.created_at,
        updated_at: new Date(),
      });
      totalCollegeAdminsCreated++;
      console.log(`  [MIGRATED] College admin: ${owner.email} (${college.name})`);

      // Step 2: Handle the original dept_admin record
      const deptIds = owner.dept_ids ?? [];
      if (deptIds.length > 0) {
        // Convert to single-dept admin using first dept_id
        await db.collection("deptadmins").updateOne(
          { _id: owner._id },
          {
            $set: {
              dept_id: deptIds[0],
              permissions: {
                can_upload_documents: true, can_delete_documents: true,
                can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
              },
              updated_at: new Date(),
            },
            $unset: { is_college_owner: "", dept_ids: "" },
          },
        );
        console.log(`    [CONVERTED] Dept admin retained for dept: ${deptIds[0]}`);

        // If had multiple depts, create separate records for extras
        for (let i = 1; i < deptIds.length; i++) {
          const { _id: _ignored, ...rest } = owner;
          await db.collection("deptadmins").insertOne({
            ...rest,
            _id: randomUUID(),
            dept_id: deptIds[i],
            permissions: {
              can_upload_documents: true, can_delete_documents: true,
              can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
            },
            is_college_owner: undefined,
            dept_ids: undefined,
            created_at: new Date(),
            updated_at: new Date(),
          });
          console.log(`    [CREATED] Additional dept admin for dept: ${deptIds[i]}`);
        }
      } else {
        // Pure college owner — disable the dept_admin record
        await db.collection("deptadmins").updateOne(
          { _id: owner._id },
          { $set: { status: "disabled", updated_at: new Date() }, $unset: { is_college_owner: "", dept_ids: "" } },
        );
        console.log(`    [DISABLED] Pure college owner dept_admin record disabled`);
      }
    }

    // Step 3: Convert all remaining dept_admins from dept_ids[] to single dept_id
    const regularAdmins = deptAdmins.filter((a) => !a.is_college_owner && Array.isArray(a.dept_ids));
    for (const admin of regularAdmins) {
      const deptIds = admin.dept_ids ?? [];

      if (deptIds.length === 0) {
        // No dept assigned — add a flag but don't break
        await db.collection("deptadmins").updateOne(
          { _id: admin._id },
          {
            $set: {
              permissions: {
                can_upload_documents: true, can_delete_documents: true,
                can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
              },
              updated_at: new Date(),
            },
            $unset: { is_college_owner: "", dept_ids: "" },
          },
        );
        continue;
      }

      // Create extra records for dept_ids[1..n]
      if (deptIds.length > 1) {
        for (let i = 1; i < deptIds.length; i++) {
          const { _id: _ignored, ...rest } = admin;
          await db.collection("deptadmins").insertOne({
            ...rest,
            _id: randomUUID(),
            dept_id: deptIds[i],
            permissions: {
              can_upload_documents: true, can_delete_documents: true,
              can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
            },
            dept_ids: undefined,
            is_college_owner: undefined,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      // Update original to use dept_ids[0]
      await db.collection("deptadmins").updateOne(
        { _id: admin._id },
        {
          $set: {
            dept_id: deptIds[0],
            permissions: {
              can_upload_documents: true, can_delete_documents: true,
              can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
            },
            updated_at: new Date(),
          },
          $unset: { dept_ids: "", is_college_owner: "" },
        },
      );
      totalDeptAdminsConverted++;
    }

    // Update college counts
    const collegeAdminCount = await db.collection("collegeadmins").countDocuments();
    const deptAdminCount = await db.collection("deptadmins").countDocuments({ status: { $ne: "disabled" } });
    await platformDb.collection("colleges").updateOne(
      { _id: college._id },
      { $set: { college_admin_count: collegeAdminCount, dept_admin_count: deptAdminCount } },
    );

    console.log(`✓ Migrated college: ${college.name} (${collegeAdminCount} college_admins, ${deptAdminCount} dept_admins)`);
    await client.close();
  }

  // Force token refresh for all dept_admins that had is_college_owner
  if (REDIS_URL && totalCollegeAdminsCreated > 0) {
    const redis = new Redis(REDIS_URL);
    await redis.setex("force_token_refresh:all_dept_admins", 86400, "1");
    redis.disconnect();
    console.log("✓ Redis force_token_refresh flag set (24h TTL)");
  }

  await platformClient.close();

  console.log("\nMigration complete.");
  console.log(`  College admins created: ${totalCollegeAdminsCreated}`);
  console.log(`  Dept admins converted:  ${totalDeptAdminsConverted}`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
