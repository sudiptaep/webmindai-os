import { redirect } from 'next/navigation';

// Legacy URL — new invite pages at /dept-admin/accept-invite and /college-admin/accept-invite
export default function LegacyAcceptInvitePage() {
  redirect('/dept-admin/login');
}
