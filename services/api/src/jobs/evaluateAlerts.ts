import { getCollegeModel } from "../models/platform/college.model";
import { getMonthlyCostSummaryModel } from "../models/platform/monthly-cost-summary.model";
import { getAlertModel, type AlertType } from "../models/platform/alert.model";
import { resolvePolicy } from "../services/cost-policy.service";
import { getBillingMonth, getDailyCostUsd, get7DayRollingAvgCost, getBillingDay } from "../services/metering.service";

async function upsertAlert(params: {
  collegeId: string;
  deptId?: string;
  alertType: AlertType;
  severity: "critical" | "warning";
  message: string;
  value: number;
}): Promise<void> {
  const Alert = getAlertModel();
  await Alert.updateOne(
    { college_id: params.collegeId, alert_type: params.alertType, status: "active" },
    {
      $set: {
        college_id: params.collegeId,
        dept_id:    params.deptId,
        alert_type: params.alertType,
        severity:   params.severity,
        message:    params.message,
        value:      params.value,
        status:     "active",
      },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true },
  );
}

export async function runEvaluateAlerts(): Promise<void> {
  const currentMonth = getBillingMonth();
  const College = getCollegeModel();
  const Summary = getMonthlyCostSummaryModel();

  const colleges = await College.find({ status: "active" }).select("_id name").lean();

  for (const college of colleges) {
    const cid = String(college._id);
    const name = college.name;

    const summary = await Summary.findOne({
      billing_month: currentMonth,
      college_id: cid,
      dept_id: "ALL",
    }).lean();

    if (!summary) continue;

    const policy = await resolvePolicy(cid, null);

    // Token alerts
    const tokenUtil = summary.token_utilisation_pct ?? 0;
    if (tokenUtil >= 100 && policy.llm_token_hard_stop) {
      await upsertAlert({
        collegeId: cid,
        alertType: "COLLEGE_TOKEN_HARD_STOP",
        severity:  "critical",
        message:   `${name} has exhausted its monthly token limit. LLM calls are blocked.`,
        value:     tokenUtil,
      });
    } else if (tokenUtil >= policy.llm_token_soft_warn_pct) {
      await upsertAlert({
        collegeId: cid,
        alertType: "COLLEGE_TOKEN_SOFT_WARN",
        severity:  "warning",
        message:   `${name} is at ${tokenUtil.toFixed(1)}% of its token limit.`,
        value:     tokenUtil,
      });
    }

    // Budget alerts
    const costUtil = summary.cost_utilisation_pct ?? 0;
    if (costUtil >= 100) {
      await upsertAlert({
        collegeId: cid,
        alertType: "COLLEGE_BUDGET_EXCEEDED",
        severity:  "critical",
        message:   `${name} has exceeded its monthly cost budget.`,
        value:     costUtil,
      });
    } else if (costUtil >= policy.cost_soft_warn_pct) {
      await upsertAlert({
        collegeId: cid,
        alertType: "COLLEGE_BUDGET_WARN",
        severity:  "warning",
        message:   `${name} cost budget at ${costUtil.toFixed(1)}%.`,
        value:     costUtil,
      });
    }

    // Anomaly detection
    const todayCost = await getDailyCostUsd(cid, getBillingDay());
    const avg7Day = await get7DayRollingAvgCost(cid);
    if (todayCost > avg7Day * 3 && avg7Day > 0) {
      const ratio = todayCost / avg7Day;
      await upsertAlert({
        collegeId: cid,
        alertType: "COST_ANOMALY",
        severity:  "warning",
        message:   `${name} today's cost ($${todayCost.toFixed(2)}) is ${ratio.toFixed(1)}× the 7-day average.`,
        value:     todayCost,
      });
    }
  }

  console.info("[evaluateAlerts] evaluation complete");
}
