import { getCollegeDb } from "../db/college.db";
import { getCollegeModel } from "../models/platform/college.model";
import { getQueryLogModel } from "../models/college/query-log.model";

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Nightly safety-net: any QueryLog where answered=false but flagged_to_admin
 * was somehow not set (e.g. race condition at write time) gets flagged here.
 */
export async function runUnansweredQueryFlagger(): Promise<void> {
  const College = getCollegeModel();

  const colleges = await College.find({ status: "active" }).lean();
  const since = new Date(Date.now() - WINDOW_MS);

  for (const college of colleges) {
    const collegeId = String(college._id);
    try {
      const conn = await getCollegeDb(collegeId);
      const QueryLog = getQueryLogModel(conn);

      const result = await QueryLog.updateMany(
        {
          answered: false,
          flagged_to_admin: false,
          created_at: { $gte: since },
        },
        { $set: { flagged_to_admin: true } }
      );

      if (result.modifiedCount > 0) {
        console.info(
          `[unansweredQueryFlagger] college ${collegeId}: flagged ${result.modifiedCount} missed query logs`
        );
      }
    } catch (err) {
      console.error(`[unansweredQueryFlagger] college ${collegeId} error:`, err);
    }
  }
}
