import { redirect } from 'next/navigation';

// Redirect to new role-specific login pages
export default function LegacyLoginPage() {
  redirect('/dept-admin/login');
}
