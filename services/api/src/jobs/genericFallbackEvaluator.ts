import { getCollegeDb } from "../db/college.db";
import { getCollegeModel } from "../models/platform/college.model";
import { getStudentModel } from "../models/college/student.model";
import { getDocumentModel } from "../models/college/document.model";

/**
 * Nightly job: for each student using the generic fallback, check whether
 * their home department now has at least one completed document.
 * If so, clear the fallback flag so queries hit their real department.
 */
export async function runGenericFallbackEvaluator(): Promise<void> {
  const College = getCollegeModel();

  const colleges = await College.find({ status: "active" }).lean();

  for (const college of colleges) {
    const collegeId = String(college._id);
    try {
      const conn = await getCollegeDb(collegeId);
      const Student = getStudentModel(conn);
      const Document = getDocumentModel(conn);

      // Find all students currently using generic fallback
      const fallbackStudents = await Student.find({
        using_generic_fallback: true,
      })
        .select("_id dept_id")
        .lean();

      if (fallbackStudents.length === 0) continue;

      // Group by dept_id to batch document checks
      const deptIds = [...new Set(fallbackStudents.map((s) => s.dept_id))];

      const deptsWithDocs = new Set<string>();
      for (const deptId of deptIds) {
        const hasDoc = await Document.exists({
          dept_id: deptId,
          ingestion_status: "completed",
        });
        if (hasDoc) deptsWithDocs.add(deptId);
      }

      if (deptsWithDocs.size === 0) continue;

      const studentIdsToUpdate = fallbackStudents
        .filter((s) => deptsWithDocs.has(s.dept_id))
        .map((s) => s._id);

      await Student.updateMany(
        { _id: { $in: studentIdsToUpdate } },
        { $set: { using_generic_fallback: false } }
      );
    } catch (err) {
      console.error(`[genericFallbackEvaluator] college ${collegeId} error:`, err);
    }
  }
}
