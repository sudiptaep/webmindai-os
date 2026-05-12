import fs from "fs";
import path from "path";
import { getCollegeModel } from "../models/platform/college.model";
import { getCollegeDb } from "../db/college.db";
import { getExtractionJobModel } from "../models/college/extraction-job.model";
import { getTempDir } from "../services/storage.service";

const TEMP_TTL_MS = Number(process.env.TEMP_FILE_TTL_HOURS ?? 1) * 3600_000;

export async function runTempFileCleanup(): Promise<void> {
  const College = getCollegeModel();
  const colleges = await College.find({ status: "active" }).lean();

  for (const college of colleges) {
    const collegeId = college._id as string;

    try {
      await cleanExpiredJobs(collegeId);
      await sweepTempDir(collegeId);
    } catch (err) {
      // Log but continue — one college failing shouldn't block the rest
      console.error(`[cleanup] college ${collegeId} failed:`, err);
    }
  }
}

async function cleanExpiredJobs(collegeId: string): Promise<void> {
  const conn = await getCollegeDb(collegeId);
  const ExtractionJob = getExtractionJobModel(conn);

  const expiredJobs = await ExtractionJob.find({
    status:     "completed",
    expires_at: { $lt: new Date() },
  }).lean();

  for (const job of expiredJobs) {
    if (job.output_file_path && fs.existsSync(job.output_file_path)) {
      try {
        fs.unlinkSync(job.output_file_path);
      } catch {
        // File already gone — still mark cleaned
      }
    }
    await ExtractionJob.findByIdAndUpdate(job._id, { $set: { status: "cleaned" } });
  }

  if (expiredJobs.length > 0) {
    console.info(`[cleanup] college ${collegeId}: cleaned ${expiredJobs.length} expired extraction job(s)`);
  }
}

async function sweepTempDir(collegeId: string): Promise<void> {
  const tempDir   = getTempDir(collegeId);
  const threshold = Date.now() - TEMP_TTL_MS;

  if (!fs.existsSync(tempDir)) return;

  const files   = fs.readdirSync(tempDir);
  let   deleted = 0;

  for (const file of files) {
    const filePath = path.join(tempDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < threshold) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch {
      // Race condition — file deleted between readdir and stat; ignore
    }
  }

  if (deleted > 0) {
    console.info(`[cleanup] college ${collegeId}: swept ${deleted} orphaned temp file(s)`);
  }
}
