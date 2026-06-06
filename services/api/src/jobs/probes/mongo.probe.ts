import mongoose from "mongoose";
import { getCollegeDb } from "../../db/college.db";
import { getCollegeModel } from "../../models/platform/college.model";
import { computeHealth } from "./health";
import { saveSnapshot } from "./snapshot.helper";
import { fireAlert, checkAlertResolution } from "./alert.helper";

export async function runMongoProbe(): Promise<void> {
  const probeStart = Date.now();

  try {
    const db = mongoose.connection.db;
    if (!db) {
      console.warn("[mongo.probe] platform DB not connected");
      return;
    }

    // ── Platform DB stats ─────────────────────────────────────────
    const platformStats = await db.command({ dbStats: 1, scale: 1048576 }); // MB
    const serverStatus = await db.command({ serverStatus: 1 });

    const storageLimitGb = parseFloat(process.env.MONGO_PLATFORM_STORAGE_LIMIT_GB || "5");
    const storageGb = (platformStats.storageSize as number) / 1024;

    const platformMetrics = {
      storage_gb: storageGb,
      index_size_gb: (platformStats.indexSize as number) / 1024,
      document_count: platformStats.objects as number,
      collections: platformStats.collections as number,
      active_connections: (serverStatus.connections?.current ?? 0) as number,
      available_connections: (serverStatus.connections?.available ?? 0) as number,
      connections_pct: serverStatus.connections?.current
        ? ((serverStatus.connections.current as number) /
            ((serverStatus.connections.current as number) + (serverStatus.connections.available as number))) *
          100
        : 0,
      storage_pct: (storageGb / storageLimitGb) * 100,
    };

    const { status: platformHealth, reasons: platformReasons } = computeHealth("mongodb", {
      storage_pct: platformMetrics.storage_pct,
      connections_pct: platformMetrics.connections_pct,
    });

    await saveSnapshot({
      service: "mongodb",
      snapshot_type: "platform",
      college_id: null,
      dept_id: null,
      metrics: platformMetrics,
      health_status: platformHealth,
      health_reasons: platformReasons,
      probe_duration_ms: Date.now() - probeStart,
    });

    await checkAlertResolution("mongodb", platformHealth);

    // ── Per-college DB stats ──────────────────────────────────────
    const College = getCollegeModel();
    const colleges = await College.find({ status: "active" }).lean();
    const collegeLimitGb = parseFloat(process.env.MONGO_COLLEGE_STORAGE_LIMIT_GB || "10");
    const collectionNames = [
      "documents", "students", "sessions", "querylogs",
      "srscards", "quizsessions", "chaptermaps", "pyqquestions",
    ];

    for (const college of colleges) {
      try {
        const collegeConn = await getCollegeDb(college._id as string);
        const collegeDb = collegeConn.db;
        if (!collegeDb) continue;

        const stats = await collegeDb.command({ dbStats: 1, scale: 1048576 });
        const collStats: Record<string, unknown> = {};

        for (const name of collectionNames) {
          try {
            const cs = await collegeDb.command({ collStats: name });
            collStats[name] = {
              count: cs.count,
              storage_mb: (cs.storageSize as number) / 1048576,
              index_size_mb: (cs.totalIndexSize as number) / 1048576,
            };
          } catch {
            // collection may not exist yet
          }
        }

        const collegeStorageGb = (stats.storageSize as number) / 1024;
        const collegeMetrics = {
          storage_gb: collegeStorageGb,
          index_size_gb: (stats.indexSize as number) / 1024,
          document_count: stats.objects as number,
          storage_pct: (collegeStorageGb / collegeLimitGb) * 100,
          collection_breakdown: collStats,
        };

        const { status, reasons } = computeHealth("mongodb", { storage_pct: collegeMetrics.storage_pct });

        if (collegeMetrics.storage_pct >= 70) {
          await fireAlert({
            alert_type: "mongodb_storage_high",
            severity: collegeMetrics.storage_pct >= 85 ? "critical" : "warning",
            service: "mongodb",
            college_id: college._id as string,
            title: `MongoDB storage high for ${college.name}`,
            message: `${college.name} DB is at ${collegeMetrics.storage_pct.toFixed(1)}% of ${collegeLimitGb} GB limit.`,
            metric_name: "storage_pct",
            metric_value: collegeMetrics.storage_pct,
            threshold_value: 70,
            unit: "%",
          });
        }

        await saveSnapshot({
          service: "mongodb",
          snapshot_type: "college",
          college_id: college._id as string,
          dept_id: null,
          metrics: collegeMetrics,
          health_status: status,
          health_reasons: reasons,
          probe_duration_ms: Date.now() - probeStart,
        });
      } catch (err) {
        console.error(`[mongo.probe] probe failed for college ${college._id}:`, err);
      }
    }
  } catch (err) {
    console.error("[mongo.probe] probe failed:", err);
  }
}
