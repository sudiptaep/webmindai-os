import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "../services/queue.service";
import { runGenericFallbackEvaluator } from "./genericFallbackEvaluator";
import { runUnansweredQueryFlagger } from "./unansweredQueryFlagger";
import { runTokenUsageResetter } from "./tokenUsageResetter";
import { runTempFileCleanup } from "./tempFileCleanup";
import { runSRSMaintenance } from "./srsMaintenance";
import { runRebuildCostSummaries } from "./rebuildCostSummaries";
import { runEvaluateAlerts } from "./evaluateAlerts";
import { runRebuildPlatformAverages } from "./rebuildPlatformAverages";

const PLATFORM_JOBS_QUEUE = "platform_jobs";

let _scheduler: { queue: Queue; worker: Worker } | null = null;

export async function startScheduler(): Promise<void> {
  if (_scheduler) return;

  const connection = getRedisConnection();
  const queue = new Queue(PLATFORM_JOBS_QUEUE, { connection });

  // Register repeatable jobs (idempotent — BullMQ deduplicates by name+cron)
  await queue.add(
    "generic-fallback-eval",
    {},
    { repeat: { pattern: "0 0 * * *" }, removeOnComplete: { count: 10 }, removeOnFail: { count: 5 } }
  );

  await queue.add(
    "unanswered-query-flagger",
    {},
    { repeat: { pattern: "0 1 * * *" }, removeOnComplete: { count: 10 }, removeOnFail: { count: 5 } }
  );

  await queue.add(
    "token-usage-reset",
    {},
    { repeat: { pattern: "0 2 1 * *" }, removeOnComplete: { count: 5 }, removeOnFail: { count: 5 } }
  );

  await queue.add(
    "cleanup-temp-files",
    {},
    { repeat: { pattern: "0 2 * * *" }, removeOnComplete: { count: 10 }, removeOnFail: { count: 5 } }
  );

  // F-14-A: SRS maintenance — midnight IST (18:30 UTC)
  await queue.add(
    "srs-maintenance",
    {},
    { repeat: { pattern: "30 18 * * *" }, removeOnComplete: { count: 10 }, removeOnFail: { count: 5 } }
  );

  // F-12: Cost summary rebuild — 1 AM UTC daily
  await queue.add(
    "rebuild-cost-summaries",
    {},
    { repeat: { pattern: "0 1 * * *" }, removeOnComplete: { count: 7 }, removeOnFail: { count: 5 } }
  );

  // F-12: Alert evaluation — every 15 minutes
  await queue.add(
    "evaluate-alerts",
    {},
    { repeat: { pattern: "*/15 * * * *" }, removeOnComplete: { count: 20 }, removeOnFail: { count: 10 } }
  );

  // F-12: Platform averages rebuild — 3 AM UTC daily
  await queue.add(
    "rebuild-platform-averages",
    {},
    { repeat: { pattern: "0 3 * * *" }, removeOnComplete: { count: 7 }, removeOnFail: { count: 5 } }
  );

  const worker = new Worker(
    PLATFORM_JOBS_QUEUE,
    async (job) => {
      switch (job.name) {
        case "generic-fallback-eval":
          await runGenericFallbackEvaluator();
          break;
        case "unanswered-query-flagger":
          await runUnansweredQueryFlagger();
          break;
        case "token-usage-reset":
          await runTokenUsageResetter();
          break;
        case "cleanup-temp-files":
          await runTempFileCleanup();
          break;
        case "srs-maintenance":
          await runSRSMaintenance();
          break;
        case "rebuild-cost-summaries":
          await runRebuildCostSummaries();
          break;
        case "evaluate-alerts":
          await runEvaluateAlerts();
          break;
        case "rebuild-platform-averages":
          await runRebuildPlatformAverages();
          break;
        default:
          throw new Error(`Unknown job: ${job.name}`);
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.info(`[scheduler] job "${job.name}" completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[scheduler] job "${job?.name}" failed:`, err);
  });

  _scheduler = { queue, worker };
}

export async function stopScheduler(): Promise<void> {
  if (!_scheduler) return;
  await _scheduler.worker.close();
  await _scheduler.queue.close();
  _scheduler = null;
}
