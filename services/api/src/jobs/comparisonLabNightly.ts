import { getCollegeModel } from "../models/platform/college.model";
import { getCollegeDb } from "../db/college.db";
import { getGoldenQuestionModel } from "../models/college/golden-question.model";
import { getComparisonRunModel } from "../models/college/comparison-run.model";
import { runComparison } from "../services/comparison-lab.service";

const FAITHFULNESS_ALERT_THRESHOLD = Number(process.env.COMPARISON_LAB_FAITHFULNESS_ALERT_THRESHOLD ?? 0.70);
const ROLLING_WINDOW_DAYS = 7;

/**
 * F-18-E nightly regression run — re-runs every active golden question through
 * the comparison lab. If a question's faithfulness drops below its own 7-day
 * rolling average AND below the absolute alert threshold, it's logged as a
 * regression candidate for Dept Admin review (surfaced via the regression
 * dashboard, not a separate notification channel).
 */
export async function runComparisonLabNightly(): Promise<void> {
  const College = getCollegeModel();
  const colleges = await College.find({ status: "active" }).lean();

  for (const college of colleges) {
    const collegeId = String(college._id);
    try {
      const conn = await getCollegeDb(collegeId);
      const GoldenQuestion = getGoldenQuestionModel(conn);
      const ComparisonRun = getComparisonRunModel(conn);

      const activeQuestions = await GoldenQuestion.find({ active: true }).lean();

      for (const gq of activeQuestions) {
        try {
          const since = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
          const [priorAgg] = await ComparisonRun.aggregate([
            { $match: { golden_question_id: gq._id, created_at: { $gte: since } } },
            { $group: { _id: null, avg_faithfulness: { $avg: "$faithfulness_score" } } },
          ]);
          const rollingAvg = priorAgg?.avg_faithfulness ?? null;

          const run = await runComparison({
            questionText: gq.question_text,
            collegeId,
            deptId: gq.dept_id,
            subjectId: gq.subject_id,
            goldenQuestionId: gq._id,
          });

          if (
            run.faithfulness_score < FAITHFULNESS_ALERT_THRESHOLD &&
            rollingAvg !== null &&
            run.faithfulness_score < rollingAvg - 0.1
          ) {
            console.warn(
              `[comparisonLabNightly] REGRESSION college=${collegeId} dept=${gq.dept_id} question="${gq.question_text.slice(0, 60)}" faithfulness=${run.faithfulness_score} (7d avg=${rollingAvg.toFixed(2)})`,
            );
          }
        } catch (err) {
          console.error(`[comparisonLabNightly] golden question ${gq._id} failed:`, err);
        }
      }
    } catch (err) {
      console.error(`[comparisonLabNightly] college ${collegeId} error:`, err);
    }
  }
}
