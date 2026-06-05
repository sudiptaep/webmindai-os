import nodemailer from "nodemailer";

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const FROM = `"College Chatbot Platform" <${process.env.SMTP_USER}>`;
const PLATFORM_URL = process.env.PLATFORM_URL ?? "http://localhost:3001";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3002";

export async function sendInviteEmail(
  toEmail: string,
  inviteToken: string,
  collegeSlug: string,
): Promise<void> {
  const setupUrl = `${ADMIN_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: "You have been invited as a College Admin",
    html: `
      <h2>Welcome to College Chatbot Platform</h2>
      <p>You have been invited to manage <strong>${collegeSlug}</strong>.</p>
      <p>Click the link below to set up your account:</p>
      <p><a href="${setupUrl}" style="color:#4f46e5;font-weight:bold;">Accept Invitation</a></p>
      <p>This link expires in 7 days.</p>
      <p style="color:#6b7280;font-size:12px;">If you did not expect this email, you can ignore it.</p>
    `,
  });
}

export async function sendDeptReadyEmail(toEmail: string, deptName: string): Promise<void> {
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: `Your department content is now ready — ${deptName}`,
    html: `
      <h2>Good news!</h2>
      <p>Your department <strong>${deptName}</strong> now has course materials available.</p>
      <p>Log in to start chatting with your department's AI assistant.</p>
    `,
  });
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string,
  appUrl: string,
): Promise<void> {
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: "Reset your password",
    html: `
      <h2>Password Reset Request</h2>
      <p>We received a request to reset your password.</p>
      <p><a href="${resetUrl}" style="color:#4f46e5;font-weight:bold;">Reset Password</a></p>
      <p>This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
    `,
  });
}

export async function sendVerificationEmail(
  toEmail: string,
  verifyToken: string,
  appUrl: string,
): Promise<void> {
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(verifyToken)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: "Verify your email address",
    html: `
      <h2>Verify your email</h2>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${verifyUrl}" style="color:#4f46e5;font-weight:bold;">Verify Email</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  });
}

export async function sendCollegeAdminInvite(
  toEmail: string,
  inviteToken: string,
  collegeSlug: string,
  adminName: string,
  adminTitle: string,
  collegeName: string,
): Promise<void> {
  const inviteUrl = `${ADMIN_URL}/college-admin/accept-invite?token=${encodeURIComponent(inviteToken)}&college_slug=${encodeURIComponent(collegeSlug)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: `You've been added as College Administrator — EduMind AI`,
    html: `
      <h2>Welcome to EduMind AI</h2>
      <p>Dear ${adminName},</p>
      <p>You have been set up as the <strong>College Administrator</strong> for <strong>${collegeName}</strong> on EduMind AI.</p>
      <p><strong>Your role:</strong> ${adminTitle}</p>
      <p><strong>Access:</strong> All departments in ${collegeName}</p>
      <br/>
      <p><a href="${inviteUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Accept Invitation &amp; Set Password</a></p>
      <br/>
      <p style="color:#6b7280;font-size:13px;">This link expires in 7 days.</p>
      <p style="color:#6b7280;font-size:13px;">Once logged in, you'll be able to view all departments and their AI usage, monitor student confusion topics, add and manage faculty, and export college usage reports.</p>
      <p style="color:#6b7280;font-size:13px;">Need help? Contact support@edumindai.com</p>
    `,
  });
}

export async function sendDeptAdminInvite(
  toEmail: string,
  inviteToken: string,
  collegeSlug: string,
  adminName: string,
  deptName: string,
  collegeName: string,
): Promise<void> {
  const inviteUrl = `${ADMIN_URL}/dept-admin/accept-invite?token=${encodeURIComponent(inviteToken)}&college_slug=${encodeURIComponent(collegeSlug)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: `You've been added as Dept Admin — ${deptName} · EduMind AI`,
    html: `
      <h2>Welcome to EduMind AI</h2>
      <p>Dear ${adminName},</p>
      <p>You have been set up as the <strong>Department Administrator</strong> for:</p>
      <p><strong>Department:</strong> ${deptName}<br/><strong>College:</strong> ${collegeName}</p>
      <br/>
      <p><a href="${inviteUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Accept Invitation &amp; Set Password</a></p>
      <br/>
      <p style="color:#6b7280;font-size:13px;">This link expires in 7 days.</p>
      <p style="color:#6b7280;font-size:13px;">Once logged in, you'll be able to upload textbooks and notes, monitor what your students ask the AI, and see which topics confuse them most.</p>
      <p style="color:#6b7280;font-size:13px;">Need help? Contact support@edumindai.com</p>
    `,
  });
}

export async function sendCollegeAdminPasswordReset(
  toEmail: string,
  resetToken: string,
  collegeSlug: string,
): Promise<void> {
  const resetUrl = `${ADMIN_URL}/college-admin/reset-password?token=${encodeURIComponent(resetToken)}&college_slug=${encodeURIComponent(collegeSlug)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: "Reset your College Admin password — EduMind AI",
    html: `
      <h2>Password Reset Request</h2>
      <p>We received a request to reset your College Administrator password.</p>
      <p><a href="${resetUrl}" style="color:#4f46e5;font-weight:bold;">Reset Password</a></p>
      <p style="color:#6b7280;font-size:13px;">This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
    `,
  });
}

export async function sendDeptAdminPasswordReset(
  toEmail: string,
  resetToken: string,
  collegeSlug: string,
): Promise<void> {
  const resetUrl = `${ADMIN_URL}/dept-admin/reset-password?token=${encodeURIComponent(resetToken)}&college_slug=${encodeURIComponent(collegeSlug)}`;
  await getTransporter().sendMail({
    from: FROM,
    to: toEmail,
    subject: "Reset your Faculty Admin password — EduMind AI",
    html: `
      <h2>Password Reset Request</h2>
      <p>We received a request to reset your Department Administrator password.</p>
      <p><a href="${resetUrl}" style="color:#4f46e5;font-weight:bold;">Reset Password</a></p>
      <p style="color:#6b7280;font-size:13px;">This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
    `,
  });
}
