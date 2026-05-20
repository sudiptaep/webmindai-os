import { getCollegeDb } from "../db/college.db";
import { getCollegeModel } from "../models/platform/college.model";
import { getStudentModel } from "../models/college/student.model";
import { getSrsCardModel } from "../models/college/srs-card.model";

const GRADUATION_INTERVAL = Number(process.env.SRS_GRADUATION_INTERVAL_DAYS ?? 180);

/**
 * Nightly job (midnight IST = 18:30 UTC):
 *  1. Bulk-update srs_cards_due_today on every active student.
 *  2. Graduate SRS cards whose interval has exceeded the threshold.
 */
export async function runSRSMaintenance(): Promise<void> {
  const College = getCollegeModel();
  const colleges = await College.find({ status: "active" }).select("_id").lean();

  for (const college of colleges) {
    const collegeId = String(college._id);
    try {
      const conn  = await getCollegeDb(collegeId);
      const SrsCard = getSrsCardModel(conn);
      const Student = getStudentModel(conn);

      // End of today (UTC midnight tomorrow) — cards due by this time count as "due today"
      const endOfToday = new Date();
      endOfToday.setUTCHours(23, 59, 59, 999);

      // ── 1. Compute per-student due counts in one aggregation ────────────────
      const dueCounts: Array<{ _id: string; count: number }> = await SrsCard.aggregate([
        {
          $match: {
            status: "active",
            next_review_at: { $lte: endOfToday },
          },
        },
        {
          $group: {
            _id:   "$student_id",
            count: { $sum: 1 },
          },
        },
      ]);

      if (dueCounts.length > 0) {
        // Bulk-write: one update per student with non-zero due count
        const bulkOps = dueCounts.map(({ _id, count }) => ({
          updateOne: {
            filter: { _id },
            update: { $set: { srs_cards_due_today: count } },
          },
        }));

        await Student.bulkWrite(bulkOps, { ordered: false });
      }

      // Zero out students who have nothing due (their count may be stale)
      const studentIdsWithDue = new Set(dueCounts.map(d => d._id));
      await Student.updateMany(
        {
          _id: { $nin: [...studentIdsWithDue] },
          srs_cards_due_today: { $gt: 0 },
        },
        { $set: { srs_cards_due_today: 0 } },
      );

      // ── 2. Graduate cards that have exceeded the interval threshold ─────────
      const graduated = await SrsCard.updateMany(
        { status: "active", interval_days: { $gte: GRADUATION_INTERVAL } },
        { $set: { status: "graduated" } },
      );

      if (graduated.modifiedCount > 0) {
        // Decrement srs_total_cards is NOT done here — graduated cards still count
        // toward total (they represent long-term memory, not deleted cards).
        console.info(
          `[srsMaintenance] college ${collegeId}: graduated ${graduated.modifiedCount} cards`,
        );
      }

      console.info(
        `[srsMaintenance] college ${collegeId}: updated due counts for ${dueCounts.length} students`,
      );
    } catch (err) {
      console.error(`[srsMaintenance] college ${collegeId} error:`, err);
    }
  }
}
