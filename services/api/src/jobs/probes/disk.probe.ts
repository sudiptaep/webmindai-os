import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { computeHealth } from "./health";
import { saveSnapshot } from "./snapshot.helper";
import { fireAlert, checkAlertResolution } from "./alert.helper";

export async function runDiskProbe(): Promise<void> {
  const probeStart = Date.now();
  const storageRoot = process.env.STORAGE_ROOT || "/app/storage";

  try {
    // 1. Overall disk stats
    const dfOutput = execSync(
      `df -B1 "${storageRoot}" 2>/dev/null || df -B1 /`,
    ).toString();
    const dfLine = dfOutput.trim().split("\n").slice(-1)[0]!.split(/\s+/);
    const diskTotalBytes = parseInt(dfLine[1]!);
    const diskUsedBytes = parseInt(dfLine[2]!);
    const diskFreeBytes = parseInt(dfLine[3]!);
    const diskUsedPct = (diskUsedBytes / diskTotalBytes) * 100;

    // 2. Inode stats
    let inodeUsedPct = 0;
    try {
      const inodeOutput = execSync(
        `df -i "${storageRoot}" 2>/dev/null || df -i /`,
      ).toString();
      const inodeLine = inodeOutput.trim().split("\n").slice(-1)[0]!.split(/\s+/);
      inodeUsedPct = parseFloat((inodeLine[4] ?? "0%").replace("%", ""));
    } catch { /* inode stats unavailable on some filesystems */ }

    // 3. Per-college storage via du
    const collegesDir = path.join(storageRoot, "colleges");
    const collegeBreakdown: Array<{ college_id: string; used_bytes: number; used_gb: number }> = [];

    if (fs.existsSync(collegesDir)) {
      const entries = fs.readdirSync(collegesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const collegePath = path.join(collegesDir, entry.name);
        try {
          const duOut = execSync(`du -sb "${collegePath}" 2>/dev/null`).toString().split("\t")[0];
          const usedBytes = parseInt(duOut!);
          collegeBreakdown.push({
            college_id: entry.name,
            used_bytes: usedBytes,
            used_gb: usedBytes / 1024 ** 3,
          });
        } catch { /* skip inaccessible dirs */ }
      }
      collegeBreakdown.sort((a, b) => b.used_bytes - a.used_bytes);
    }

    // 4. Sub-dir breakdown for top college
    const subDirBreakdown: Record<string, number> = {};
    if (collegeBreakdown.length > 0) {
      const topDir = path.join(collegesDir, collegeBreakdown[0]!.college_id);
      for (const subDir of ["uploads", "thumbnails", "text_cache", "transcripts", "temp"]) {
        const subPath = path.join(topDir, subDir);
        if (fs.existsSync(subPath)) {
          try {
            const duOut = execSync(`du -sb "${subPath}" 2>/dev/null`).toString().split("\t")[0];
            subDirBreakdown[subDir] = parseInt(duOut!);
          } catch { /* skip */ }
        }
      }
    }

    const metrics = {
      disk_total_gb: diskTotalBytes / 1024 ** 3,
      disk_used_gb: diskUsedBytes / 1024 ** 3,
      disk_free_gb: diskFreeBytes / 1024 ** 3,
      disk_used_pct: diskUsedPct,
      inode_used_pct: inodeUsedPct,
      college_breakdown: collegeBreakdown,
      top_college_subdir_breakdown: subDirBreakdown,
      storage_root: storageRoot,
    };

    const { status, reasons } = computeHealth("disk", {
      used_pct: diskUsedPct,
      inode_used_pct: inodeUsedPct,
    });

    await saveSnapshot({
      service: "local_disk",
      snapshot_type: "platform",
      college_id: null,
      dept_id: null,
      metrics,
      health_status: status,
      health_reasons: reasons,
      probe_duration_ms: Date.now() - probeStart,
    });

    await checkAlertResolution("local_disk", status);

    if (diskUsedPct >= 90) {
      await fireAlert({
        alert_type: "disk_storage_critical",
        severity: "critical",
        service: "local_disk",
        title: "Disk storage critically full",
        message: `${storageRoot} at ${diskUsedPct.toFixed(1)}% — only ${(diskFreeBytes / 1024 ** 3).toFixed(1)} GB free.`,
        metric_name: "disk_used_pct",
        metric_value: diskUsedPct,
        threshold_value: 90,
        unit: "%",
      });
    } else if (diskUsedPct >= 75) {
      await fireAlert({
        alert_type: "disk_storage_high",
        severity: "warning",
        service: "local_disk",
        title: "Disk storage high",
        message: `${storageRoot} at ${diskUsedPct.toFixed(1)}% usage.`,
        metric_name: "disk_used_pct",
        metric_value: diskUsedPct,
        threshold_value: 75,
        unit: "%",
      });
    }

    if (inodeUsedPct >= 95) {
      await fireAlert({
        alert_type: "disk_inode_high",
        severity: "critical",
        service: "local_disk",
        title: "Disk inode usage critical",
        message: `Inode usage at ${inodeUsedPct.toFixed(1)}%. New file creation will fail soon.`,
        metric_name: "inode_used_pct",
        metric_value: inodeUsedPct,
        threshold_value: 95,
        unit: "%",
      });
    }
  } catch (err) {
    console.error("[disk.probe] failed:", err);
  }
}
