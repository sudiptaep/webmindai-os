import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import { verifySuperAdminJWT } from "../middleware/verifySuperAdminJWT";
import { getServiceSnapshotModel, type SnapshotService } from "../models/platform/service-snapshot.model";
import { getObservatoryAlertModel } from "../models/platform/observatory-alert.model";
import { getDailyUsageRollupModel } from "../models/platform/daily-usage-rollup.model";
import { getCostEventModel } from "../models/platform/cost-event.model";
import { getCollegeModel } from "../models/platform/college.model";
import { getCollegeDb } from "../db/college.db";
import { getStudentModel } from "../models/college/student.model";
import { getBillingMonth, getBillingDay } from "../services/metering.service";
import { runMongoProbe } from "../jobs/probes/mongo.probe";
import { runAnthropicProbe } from "../jobs/probes/anthropic.probe";
import { runOpenAIProbe } from "../jobs/probes/openai.probe";
import { runPineconeProbe } from "../jobs/probes/pinecone.probe";
import { runDiskProbe } from "../jobs/probes/disk.probe";
import { runRedisProbe } from "../jobs/probes/redis.probe";

const ALL_SERVICES: SnapshotService[] = ["mongodb", "anthropic", "openai_embeddings", "pinecone", "local_disk", "redis"];

function computeOverallStatus(statuses: string[]) {
  if (statuses.includes("critical")) return { status: "DEGRADED", color: "red" };
  if (statuses.includes("warning")) return { status: "SOME SYSTEMS DEGRADED", color: "amber" };
  return { status: "ALL SYSTEMS OPERATIONAL", color: "green" };
}

async function getLatestSnapshots() {
  const Snapshot = getServiceSnapshotModel();
  const results = await Promise.all(
    ALL_SERVICES.map((service) =>
      Snapshot.findOne({ service, snapshot_type: "platform" })
        .sort({ captured_at: -1 })
        .lean(),
    ),
  );
  return results.filter(Boolean);
}

async function getActiveAlerts(limit = 20) {
  const Alert = getObservatoryAlertModel();
  return Alert.find({ status: "active" })
    .sort({ severity: -1, last_fired_at: -1 })
    .limit(limit)
    .lean();
}

async function getLiveCollegeMatrix() {
  const CostEvent = getCostEventModel();
  const today = getBillingDay();
  const billingMonth = getBillingMonth();

  const [tokensByCollege, embeddingsByCollege] = await Promise.all([
    CostEvent.aggregate([
      { $match: { billing_day: today, service: "anthropic" } },
      { $group: { _id: "$college_id", tokens: { $sum: "$total_tokens" }, requests: { $sum: 1 } } },
    ]),
    CostEvent.aggregate([
      { $match: { billing_day: today, service: "openai_embeddings" } },
      { $group: { _id: "$college_id", tokens: { $sum: "$embedding_tokens" } } },
    ]),
  ]);

  const tokenMap = Object.fromEntries(tokensByCollege.map((r) => [r._id as string, r]));
  const embedMap = Object.fromEntries(embeddingsByCollege.map((r) => [r._id as string, r]));

  const College = getCollegeModel();
  const colleges = await College.find({ status: "active" }).lean();

  return colleges.map((c) => {
    const cid = c._id as string;
    return {
      college_id: cid,
      college_name: c.name,
      claude_rpm_today: (tokenMap[cid]?.requests as number) ?? 0,
      embed_tokens_today: (embedMap[cid]?.tokens as number) ?? 0,
    };
  });
}

export const observatoryRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ── Main observatory snapshot ──────────────────────────────────
  fastify.get(
    "/observatory",
    { preHandler: [verifySuperAdminJWT] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const [snapshots, activeAlerts, collegeMatrix] = await Promise.all([
        getLatestSnapshots(),
        getActiveAlerts(),
        getLiveCollegeMatrix(),
      ]);

      const statuses = snapshots.map((s) => s!.health_status);
      const overall = computeOverallStatus(statuses);

      return reply.send({
        overall_status: overall,
        snapshots,
        active_alerts: activeAlerts,
        college_matrix: collegeMatrix,
        updated_at: new Date().toISOString(),
      });
    },
  );

  // ── SSE — live updates every 60s ──────────────────────────────
  fastify.get(
    "/observatory/stream",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendUpdate = async () => {
        try {
          const [snapshots, activeAlerts, collegeMatrix] = await Promise.all([
            getLatestSnapshots(),
            getActiveAlerts(),
            getLiveCollegeMatrix(),
          ]);
          const overall = computeOverallStatus(snapshots.map((s) => s!.health_status));
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "observatory_update",
              snapshots,
              overall_status: overall,
              active_alerts: activeAlerts,
              college_matrix: collegeMatrix,
              updated_at: new Date().toISOString(),
            })}\n\n`,
          );
        } catch { /* ignore mid-stream errors */ }
      };

      await sendUpdate();
      const interval = setInterval(sendUpdate, 60000);
      req.raw.on("close", () => clearInterval(interval));
    },
  );

  // ── 30-day history ───────────────────────────────────────────
  fastify.get(
    "/observatory/history",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { days = "30", college_id } = req.query as { days?: string; college_id?: string };
      const Rollup = getDailyUsageRollupModel();
      const filter: Record<string, unknown> = {
        college_id: college_id ?? null,
        dept_id: null,
      };

      const d = new Date();
      const dateStrs: string[] = [];
      for (let i = parseInt(days) - 1; i >= 0; i--) {
        const day = new Date(d);
        day.setUTCDate(day.getUTCDate() - i);
        dateStrs.push(day.toISOString().slice(0, 10));
      }
      filter.date = { $in: dateStrs };

      const rollups = await Rollup.find(filter).sort({ date: 1 }).lean();
      return reply.send({ rollups, dates: dateStrs });
    },
  );

  // ── Per-service detail ───────────────────────────────────────
  for (const service of ALL_SERVICES) {
    fastify.get(
      `/observatory/${service.replace("_", "-")}`,
      { preHandler: [verifySuperAdminJWT] },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { hours = "24" } = req.query as { hours?: string };
        const Snapshot = getServiceSnapshotModel();
        const since = new Date(Date.now() - parseInt(hours) * 3600 * 1000);
        const snapshots = await Snapshot.find({
          service,
          snapshot_type: "platform",
          captured_at: { $gte: since },
        })
          .sort({ captured_at: -1 })
          .limit(1440)
          .lean();
        return reply.send({ service, snapshots });
      },
    );
  }

  // ── College drilldown ────────────────────────────────────────
  fastify.get(
    "/observatory/college/:collegeId",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const Snapshot = getServiceSnapshotModel();
      const CostEvent = getCostEventModel();
      const billingMonth = getBillingMonth();
      const today = getBillingDay();

      const [mongoSnap, diskSnap, tokensByDept, embeddingsByDept] = await Promise.all([
        Snapshot.findOne({ service: "mongodb", snapshot_type: "college", college_id: collegeId })
          .sort({ captured_at: -1 })
          .lean(),
        Snapshot.findOne({ service: "local_disk", snapshot_type: "platform" })
          .sort({ captured_at: -1 })
          .lean(),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, billing_month: billingMonth, service: "anthropic" } },
          {
            $group: {
              _id: "$dept_id",
              tokens_month: { $sum: "$total_tokens" },
              requests_month: { $sum: 1 },
              tokens_today: {
                $sum: { $cond: [{ $eq: ["$billing_day", today] }, "$total_tokens", 0] },
              },
            },
          },
        ]),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, billing_month: billingMonth, service: "openai_embeddings" } },
          {
            $group: {
              _id: "$dept_id",
              tokens_month: { $sum: "$embedding_tokens" },
            },
          },
        ]),
      ]);

      const embedMap = Object.fromEntries(embeddingsByDept.map((r) => [r._id as string, r]));

      return reply.send({
        college_id: collegeId,
        mongodb: mongoSnap?.metrics ?? null,
        disk_college: (() => {
          const breakdown = (diskSnap?.metrics as Record<string, unknown>)?.college_breakdown as Array<{ college_id: string; used_gb: number }> | undefined;
          return breakdown?.find((b) => b.college_id === collegeId) ?? null;
        })(),
        dept_breakdown: tokensByDept.map((row) => ({
          dept_id: row._id as string,
          claude_tokens_month: row.tokens_month as number,
          claude_tokens_today: row.tokens_today as number,
          claude_requests_month: row.requests_month as number,
          embed_tokens_month: (embedMap[row._id as string]?.tokens_month as number) ?? 0,
        })),
      });
    },
  );

  // ── Department drilldown ──────────────────────────────────────
  fastify.get(
    "/observatory/college/:collegeId/dept/:deptId",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, deptId } = req.params as { collegeId: string; deptId: string };
      const CostEvent = getCostEventModel();
      const billingMonth = getBillingMonth();

      const [tokensByAction, embeddingsByAction, pineconeSnap] = await Promise.all([
        CostEvent.aggregate([
          { $match: { college_id: collegeId, dept_id: deptId, billing_month: billingMonth, service: "anthropic" } },
          { $group: { _id: "$action_type", tokens: { $sum: "$total_tokens" }, count: { $sum: 1 } } },
        ]),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, dept_id: deptId, billing_month: billingMonth, service: "openai_embeddings" } },
          { $group: { _id: "$action_type", tokens: { $sum: "$embedding_tokens" }, count: { $sum: 1 } } },
        ]),
        getServiceSnapshotModel()
          .findOne({ service: "pinecone", snapshot_type: "platform" })
          .sort({ captured_at: -1 })
          .lean(),
      ]);

      const namespaceBreakdown = pineconeSnap
        ? ((pineconeSnap.metrics as Record<string, unknown>).namespace_breakdown as Array<{
            dept_id: string;
            vector_count: number;
            storage_mb: number;
          }> | undefined)?.filter((ns) => ns.dept_id === deptId) ?? []
        : [];

      return reply.send({
        college_id: collegeId,
        dept_id: deptId,
        billing_month: billingMonth,
        anthropic_breakdown: tokensByAction,
        openai_breakdown: embeddingsByAction,
        pinecone_namespaces: namespaceBreakdown,
      });
    },
  );

  // ── Alerts ──────────────────────────────────────────────────
  fastify.get(
    "/observatory/alerts",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { status = "active", service, severity, page = "1", limit = "50" } = req.query as {
        status?: string;
        service?: string;
        severity?: string;
        page?: string;
        limit?: string;
      };

      const Alert = getObservatoryAlertModel();
      const filter: Record<string, unknown> = { status };
      if (service) filter.service = service;
      if (severity) filter.severity = severity;

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [alerts, total] = await Promise.all([
        Alert.find(filter).sort({ first_fired_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
        Alert.countDocuments(filter),
      ]);

      return reply.send({ alerts, total, page: parseInt(page), limit: parseInt(limit) });
    },
  );

  fastify.put(
    "/observatory/alerts/:alertId/acknowledge",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { alertId } = req.params as { alertId: string };
      const user = (req as FastifyRequest & { user: { _id: string } }).user;

      const Alert = getObservatoryAlertModel();
      const updated = await Alert.findByIdAndUpdate(
        alertId,
        { $set: { status: "acknowledged", acknowledged_by: user._id, acknowledged_at: new Date() } },
        { new: true },
      ).lean();

      if (!updated) return reply.status(404).send({ error: "Alert not found" });
      return reply.send({ alert: updated });
    },
  );

  fastify.put(
    "/observatory/alerts/:alertId/resolve",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { alertId } = req.params as { alertId: string };
      const Alert = getObservatoryAlertModel();
      const updated = await Alert.findByIdAndUpdate(
        alertId,
        { $set: { status: "resolved", resolved_at: new Date(), auto_resolved: false } },
        { new: true },
      ).lean();

      if (!updated) return reply.status(404).send({ error: "Alert not found" });
      return reply.send({ alert: updated });
    },
  );

  // ── Manual probe trigger ──────────────────────────────────────
  fastify.post(
    "/observatory/probe/:service",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { service } = req.params as { service: string };

      const probeMap: Record<string, () => Promise<void>> = {
        mongodb: runMongoProbe,
        anthropic: runAnthropicProbe,
        openai: runOpenAIProbe,
        "openai-embeddings": runOpenAIProbe,
        pinecone: runPineconeProbe,
        disk: runDiskProbe,
        "local-disk": runDiskProbe,
        redis: runRedisProbe,
      };

      const probe = probeMap[service];
      if (!probe) return reply.status(400).send({ error: `Unknown service: ${service}` });

      // Run async — don't await so the response returns immediately
      setImmediate(() => probe().catch((err) => console.error(`[manual probe ${service}]:`, err)));

      return reply.send({ message: `Probe for ${service} triggered`, triggered_at: new Date().toISOString() });
    },
  );

  // ── CSV export ───────────────────────────────────────────────
  fastify.get(
    "/observatory/export",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { days = "30", college_id } = req.query as { days?: string; college_id?: string };
      const Rollup = getDailyUsageRollupModel();

      const d = new Date();
      const dateStrs: string[] = [];
      for (let i = parseInt(days) - 1; i >= 0; i--) {
        const day = new Date(d);
        day.setUTCDate(day.getUTCDate() - i);
        dateStrs.push(day.toISOString().slice(0, 10));
      }

      const rollups = await Rollup.find({
        date: { $in: dateStrs },
        college_id: college_id ?? null,
        dept_id: null,
      })
        .sort({ date: 1 })
        .lean();

      const headers = [
        "date", "mongo_storage_gb", "mongo_document_count", "mongo_avg_latency_ms",
        "anthropic_total_tokens", "anthropic_requests", "anthropic_haiku_tokens", "anthropic_sonnet_tokens",
        "openai_total_tokens", "openai_requests",
        "pinecone_vector_count", "pinecone_storage_gb", "pinecone_read_units", "pinecone_write_units",
        "disk_used_gb", "disk_free_gb", "disk_used_pct",
        "redis_memory_mb", "redis_peak_clients", "redis_queue_peak_depth",
      ].join(",");

      const rows = rollups.map((r) =>
        [
          r.date, r.mongo_storage_gb.toFixed(4), r.mongo_document_count, r.mongo_avg_query_latency_ms.toFixed(2),
          r.anthropic_total_tokens, r.anthropic_requests, r.anthropic_haiku_tokens, r.anthropic_sonnet_tokens,
          r.openai_total_tokens, r.openai_requests,
          r.pinecone_vector_count, r.pinecone_storage_gb.toFixed(4), r.pinecone_read_units, r.pinecone_write_units,
          r.disk_used_gb.toFixed(4), r.disk_free_gb.toFixed(4), r.disk_used_pct.toFixed(2),
          r.redis_memory_mb.toFixed(2), r.redis_peak_clients, r.redis_queue_peak_depth,
        ].join(","),
      );

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", `attachment; filename="observatory-${days}d.csv"`)
        .send([headers, ...rows].join("\n"));
    },
  );

  // ════════════════════════════════════════════════════════════════
  // F-15-K: Individual Student Usage Observatory
  // ════════════════════════════════════════════════════════════════

  // GET /observatory/college/:collegeId/students
  // Top students by usage — with breakdown by action, active days, vs-avg comparison
  fastify.get(
    "/observatory/college/:collegeId/students",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const { dept_id, billing_month, sort = "tokens_desc", page = "1", limit = "50" } = req.query as {
        dept_id?: string;
        billing_month?: string;
        sort?: string;
        page?: string;
        limit?: string;
      };

      const month = billing_month ?? getBillingMonth();
      const CostEvent = getCostEventModel();

      const match: Record<string, unknown> = { college_id: collegeId, billing_month: month };
      if (dept_id) match.dept_id = dept_id;

      // Aggregate per student
      const studentStats = await CostEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$student_id",
            dept_id: { $first: "$dept_id" },
            total_tokens: { $sum: "$total_tokens" },
            total_embedding_tokens: { $sum: "$embedding_tokens" },
            total_cost_usd: { $sum: "$cost_usd" },
            chat_count: {
              $sum: { $cond: [{ $eq: ["$action_type", "chat_message"] }, 1, 0] },
            },
            ai_summary_count: {
              $sum: { $cond: [{ $eq: ["$action_type", "ai_summary"] }, 1, 0] },
            },
            exam_gen_count: {
              $sum: { $cond: [{ $eq: ["$action_type", "exam_generation"] }, 1, 0] },
            },
            active_days: { $addToSet: "$billing_day" },
            last_active_at: { $max: "$created_at" },
          },
        },
        {
          $addFields: {
            active_day_count: { $size: "$active_days" },
          },
        },
        { $match: { _id: { $ne: null } } },
      ]);

      // Compute dept averages for relative comparison
      const deptTotals = await CostEvent.aggregate([
        { $match: { college_id: collegeId, billing_month: month } },
        {
          $group: {
            _id: "$dept_id",
            total_tokens: { $sum: "$total_tokens" },
            student_count: { $addToSet: "$student_id" },
          },
        },
        {
          $addFields: {
            avg_tokens_per_student: {
              $cond: [
                { $gt: [{ $size: "$student_count" }, 0] },
                { $divide: ["$total_tokens", { $size: "$student_count" }] },
                0,
              ],
            },
          },
        },
      ]);
      const deptAvgMap = Object.fromEntries(
        deptTotals.map((d) => [d._id as string, d.avg_tokens_per_student as number]),
      );

      // Enrich with student names from college DB
      const studentIds = studentStats.map((s) => s._id as string).filter(Boolean);
      let studentNameMap: Record<string, { name: string; email: string; semester: number }> = {};

      try {
        const collegeConn = await getCollegeDb(collegeId);
        const StudentModel = getStudentModel(collegeConn);
        const students = await StudentModel.find({ _id: { $in: studentIds } })
          .select("name email semester dept_id")
          .lean();
        studentNameMap = Object.fromEntries(
          students.map((s) => [
            s._id as string,
            { name: s.name, email: s.email, semester: s.semester },
          ]),
        );
      } catch (err) {
        console.warn(`[observatory] Could not fetch student names for college ${collegeId}:`, err);
      }

      // Merge and sort
      let enriched = studentStats.map((s) => {
        const sid = s._id as string;
        const studentInfo = studentNameMap[sid] ?? { name: "Unknown", email: "", semester: 0 };
        const deptAvg = deptAvgMap[s.dept_id as string] ?? 0;
        return {
          student_id: sid,
          dept_id: s.dept_id as string,
          name: studentInfo.name,
          email: studentInfo.email,
          semester: studentInfo.semester,
          total_tokens: s.total_tokens as number,
          total_cost_usd: s.total_cost_usd as number,
          chat_count: s.chat_count as number,
          ai_summary_count: s.ai_summary_count as number,
          exam_gen_count: s.exam_gen_count as number,
          active_day_count: s.active_day_count as number,
          last_active_at: s.last_active_at as Date,
          tokens_vs_dept_avg: deptAvg > 0 ? (s.total_tokens as number) / deptAvg : 0,
        };
      });

      if (sort === "tokens_desc") enriched.sort((a, b) => b.total_tokens - a.total_tokens);
      else if (sort === "tokens_asc") enriched.sort((a, b) => a.total_tokens - b.total_tokens);
      else if (sort === "cost_desc") enriched.sort((a, b) => b.total_cost_usd - a.total_cost_usd);
      else if (sort === "active_days_desc") enriched.sort((a, b) => b.active_day_count - a.active_day_count);
      else if (sort === "last_active") enriched.sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime());

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const total = enriched.length;
      enriched = enriched.slice((pageNum - 1) * limitNum, pageNum * limitNum);

      return reply.send({
        college_id: collegeId,
        billing_month: month,
        students: enriched,
        total,
        page: pageNum,
        limit: limitNum,
      });
    },
  );

  // GET /observatory/college/:collegeId/students/:studentId
  // Individual student detailed profile — tokens over time, action breakdown, activity heatmap
  fastify.get(
    "/observatory/college/:collegeId/students/:studentId",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, studentId } = req.params as { collegeId: string; studentId: string };
      const { billing_month } = req.query as { billing_month?: string };

      const month = billing_month ?? getBillingMonth();
      const CostEvent = getCostEventModel();

      const [monthlyRollup, dailyTrend, actionBreakdown, hourlyActivity] = await Promise.all([
        // Monthly totals for this student
        CostEvent.aggregate([
          { $match: { college_id: collegeId, student_id: studentId, billing_month: month } },
          {
            $group: {
              _id: null,
              dept_id: { $first: "$dept_id" },
              total_tokens: { $sum: "$total_tokens" },
              total_embedding_tokens: { $sum: "$embedding_tokens" },
              total_cost_usd: { $sum: "$cost_usd" },
              total_requests: { $sum: 1 },
              active_days: { $addToSet: "$billing_day" },
              last_active_at: { $max: "$created_at" },
            },
          },
        ]),

        // Daily token usage for the last 30 days
        CostEvent.aggregate([
          {
            $match: {
              college_id: collegeId,
              student_id: studentId,
              created_at: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
            },
          },
          {
            $group: {
              _id: "$billing_day",
              tokens: { $sum: "$total_tokens" },
              requests: { $sum: 1 },
              cost_usd: { $sum: "$cost_usd" },
            },
          },
          { $sort: { _id: 1 } },
        ]),

        // Action type breakdown for this month
        CostEvent.aggregate([
          { $match: { college_id: collegeId, student_id: studentId, billing_month: month } },
          {
            $group: {
              _id: "$action_type",
              tokens: { $sum: "$total_tokens" },
              count: { $sum: 1 },
              cost_usd: { $sum: "$cost_usd" },
            },
          },
        ]),

        // Hourly activity distribution (0-23h) over last 30 days
        CostEvent.aggregate([
          {
            $match: {
              college_id: collegeId,
              student_id: studentId,
              created_at: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
            },
          },
          {
            $group: {
              _id: { $hour: "$created_at" },
              requests: { $sum: 1 },
              tokens: { $sum: "$total_tokens" },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

      // Build full 24-hour distribution array (fill missing hours with 0)
      const hourlyDistribution = Array.from({ length: 24 }, (_, h) => {
        const found = hourlyActivity.find((a) => a._id === h);
        return {
          hour: h,
          requests: (found?.requests as number) ?? 0,
          tokens: (found?.tokens as number) ?? 0,
        };
      });

      // Dept average for comparison
      const roll = monthlyRollup[0];
      const deptAvgData = roll
        ? await CostEvent.aggregate([
            {
              $match: {
                college_id: collegeId,
                dept_id: roll.dept_id as string,
                billing_month: month,
                student_id: { $ne: null },
              },
            },
            {
              $group: {
                _id: "$student_id",
                tokens: { $sum: "$total_tokens" },
              },
            },
            { $group: { _id: null, avg: { $avg: "$tokens" }, count: { $sum: 1 } } },
          ])
        : [];

      const deptAvg = (deptAvgData[0]?.avg as number) ?? 0;
      const totalStudentsInDept = (deptAvgData[0]?.count as number) ?? 0;

      // Student profile from college DB
      let profile: { name: string; email: string; semester: number; roll_number?: string } | null = null;
      try {
        const collegeConn = await getCollegeDb(collegeId);
        const StudentModel = getStudentModel(collegeConn);
        const student = await StudentModel.findById(studentId).select("name email semester roll_number").lean();
        if (student) {
          profile = {
            name: student.name,
            email: student.email,
            semester: student.semester,
            roll_number: student.roll_number,
          };
        }
      } catch (err) {
        console.warn("[observatory] student profile fetch failed:", err);
      }

      // Percentile ranking within dept
      let percentileRank: number | null = null;
      if (totalStudentsInDept > 0 && roll) {
        const betterCount = await CostEvent.aggregate([
          {
            $match: {
              college_id: collegeId,
              dept_id: roll.dept_id as string,
              billing_month: month,
              student_id: { $ne: null },
            },
          },
          { $group: { _id: "$student_id", tokens: { $sum: "$total_tokens" } } },
          { $match: { tokens: { $gt: roll.total_tokens as number } } },
          { $count: "count" },
        ]);
        const above = (betterCount[0]?.count as number) ?? 0;
        percentileRank = Math.round(((totalStudentsInDept - above) / totalStudentsInDept) * 100);
      }

      return reply.send({
        student_id: studentId,
        college_id: collegeId,
        billing_month: month,
        profile,
        monthly_summary: roll
          ? {
              dept_id: roll.dept_id as string,
              total_tokens: roll.total_tokens as number,
              total_embedding_tokens: roll.total_embedding_tokens as number,
              total_cost_usd: roll.total_cost_usd as number,
              total_requests: roll.total_requests as number,
              active_day_count: (roll.active_days as string[]).length,
              last_active_at: roll.last_active_at as Date,
              tokens_vs_dept_avg: deptAvg > 0 ? (roll.total_tokens as number) / deptAvg : 0,
              dept_avg_tokens: Math.round(deptAvg),
              percentile_rank_in_dept: percentileRank,
              total_students_in_dept: totalStudentsInDept,
            }
          : null,
        daily_trend: dailyTrend.map((d) => ({
          date: d._id as string,
          tokens: d.tokens as number,
          requests: d.requests as number,
          cost_usd: d.cost_usd as number,
        })),
        action_breakdown: actionBreakdown.map((a) => ({
          action_type: a._id as string,
          tokens: a.tokens as number,
          count: a.count as number,
          cost_usd: a.cost_usd as number,
        })),
        hourly_distribution: hourlyDistribution,
      });
    },
  );

  // GET /observatory/college/:collegeId/dept/:deptId/students
  // Students in a specific dept — sorted by usage
  fastify.get(
    "/observatory/college/:collegeId/dept/:deptId/students",
    { preHandler: [verifySuperAdminJWT] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, deptId } = req.params as { collegeId: string; deptId: string };
      const { billing_month, sort = "tokens_desc", page = "1", limit = "50" } = req.query as {
        billing_month?: string;
        sort?: string;
        page?: string;
        limit?: string;
      };

      // Delegate to the college students handler with dept_id filter
      const month = billing_month ?? getBillingMonth();
      const CostEvent = getCostEventModel();

      const studentStats = await CostEvent.aggregate([
        { $match: { college_id: collegeId, dept_id: deptId, billing_month: month } },
        {
          $group: {
            _id: "$student_id",
            total_tokens: { $sum: "$total_tokens" },
            total_cost_usd: { $sum: "$cost_usd" },
            chat_count: { $sum: { $cond: [{ $eq: ["$action_type", "chat_message"] }, 1, 0] } },
            ai_summary_count: { $sum: { $cond: [{ $eq: ["$action_type", "ai_summary"] }, 1, 0] } },
            exam_gen_count: { $sum: { $cond: [{ $eq: ["$action_type", "exam_generation"] }, 1, 0] } },
            active_days: { $addToSet: "$billing_day" },
            last_active_at: { $max: "$created_at" },
          },
        },
        { $addFields: { active_day_count: { $size: "$active_days" } } },
        { $match: { _id: { $ne: null } } },
      ]);

      // Dept average
      const [deptAvgResult] = await CostEvent.aggregate([
        { $match: { college_id: collegeId, dept_id: deptId, billing_month: month, student_id: { $ne: null } } },
        { $group: { _id: "$student_id", tokens: { $sum: "$total_tokens" } } },
        { $group: { _id: null, avg: { $avg: "$tokens" } } },
      ]);
      const deptAvg = (deptAvgResult?.avg as number) ?? 0;

      // Enrich with names
      const studentIds = studentStats.map((s) => s._id as string).filter(Boolean);
      let nameMap: Record<string, { name: string; email: string }> = {};
      try {
        const conn = await getCollegeDb(collegeId);
        const StudentModel = getStudentModel(conn);
        const students = await StudentModel.find({ _id: { $in: studentIds } }).select("name email").lean();
        nameMap = Object.fromEntries(students.map((s) => [s._id as string, { name: s.name, email: s.email }]));
      } catch { /* ignore */ }

      let enriched = studentStats.map((s) => ({
        student_id: s._id as string,
        name: nameMap[s._id as string]?.name ?? "Unknown",
        email: nameMap[s._id as string]?.email ?? "",
        total_tokens: s.total_tokens as number,
        total_cost_usd: s.total_cost_usd as number,
        chat_count: s.chat_count as number,
        ai_summary_count: s.ai_summary_count as number,
        exam_gen_count: s.exam_gen_count as number,
        active_day_count: s.active_day_count as number,
        last_active_at: s.last_active_at as Date,
        tokens_vs_dept_avg: deptAvg > 0 ? (s.total_tokens as number) / deptAvg : 0,
      }));

      if (sort === "tokens_desc") enriched.sort((a, b) => b.total_tokens - a.total_tokens);
      else if (sort === "cost_desc") enriched.sort((a, b) => b.total_cost_usd - a.total_cost_usd);
      else if (sort === "active_days_desc") enriched.sort((a, b) => b.active_day_count - a.active_day_count);

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const total = enriched.length;
      enriched = enriched.slice((pageNum - 1) * limitNum, pageNum * limitNum);

      return reply.send({
        college_id: collegeId,
        dept_id: deptId,
        billing_month: month,
        dept_avg_tokens: Math.round(deptAvg),
        students: enriched,
        total,
        page: pageNum,
        limit: limitNum,
      });
    },
  );
};
