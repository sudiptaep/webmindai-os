import { router } from "./trpc";
import { collegeRouter } from "./routers/college.router";
import { departmentRouter } from "./routers/department.router";
import { documentRouter } from "./routers/document.router";
import { subjectRouter } from "./routers/subject.router";
import { analyticsRouter } from "./routers/analytics.router";
import { studentRouter } from "./routers/student.router";
import { settingsRouter } from "./routers/settings.router";
import { costPolicyRouter } from "./routers/costPolicy.router";
import { superAdminDashboardRouter } from "./routers/superAdminDashboard.router";

export const appRouter = router({
  college: collegeRouter,
  department: departmentRouter,
  document: documentRouter,
  subject: subjectRouter,
  analytics: analyticsRouter,
  student: studentRouter,
  settings: settingsRouter,
  costPolicy: costPolicyRouter,
  superAdminDashboard: superAdminDashboardRouter,
});

export type AppRouter = typeof appRouter;
