import { getCollegeModel } from "../models/platform/college.model";

/**
 * Monthly job (runs on the 1st of each month): resets tokens_used_this_month
 * to 0 for all colleges so the monthly quota window starts fresh.
 */
export async function runTokenUsageResetter(): Promise<void> {
  const College = getCollegeModel();

  const result = await College.updateMany(
    {},
    { $set: { tokens_used_this_month: 0 } }
  );

  console.info(
    `[tokenUsageResetter] reset tokens_used_this_month for ${result.modifiedCount} colleges`
  );
}
