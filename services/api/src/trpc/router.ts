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
import { superAdminUsersRouter } from "./routers/superAdminUsers.router";
import { superAdminObservatoryRouter } from "./routers/superAdminObservatory.router";
import { comparisonLabRouter } from "./routers/comparisonLab.router";
import { collegeAdminRouter } from "./routers/collegeAdmin.router";
import { conceptGraphRouter } from "./routers/conceptGraph.router";
import { misconceptionRouter } from "./routers/misconception.router";
import { teachingProfileRouter } from "./routers/teachingProfile.router";
import { teachingRouter } from "./routers/teaching.router";
import { teachingAnalyticsRouter } from "./routers/teachingAnalytics.router";

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
  superAdminUsers: superAdminUsersRouter,
  superAdminObservatory: superAdminObservatoryRouter,
  comparisonLab: comparisonLabRouter,
  collegeAdmin: collegeAdminRouter,
  conceptGraph: conceptGraphRouter,
  misconception: misconceptionRouter,
  teachingProfile: teachingProfileRouter,
  teaching: teachingRouter,
  teachingAnalytics: teachingAnalyticsRouter,
});

export type AppRouter = typeof appRouter;
