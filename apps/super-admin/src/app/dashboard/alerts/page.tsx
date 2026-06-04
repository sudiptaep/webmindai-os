'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

type Alert = {
  _id: string;
  college_id: string;
  alert_type: string;
  severity: 'critical' | 'warning';
  message: string;
  value?: number;
  status: 'active' | 'resolved';
  resolved_at?: string;
  created_at: string;
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  token_limit_warning:   'Token Limit Warning',
  token_limit_critical:  'Token Limit Critical',
  budget_warning:        'Budget Warning',
  budget_critical:       'Budget Critical',
  cost_anomaly:          'Cost Anomaly',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
}

export default function AlertsPage() {
  const [statusFilter, setStatusFilter] = useState<'active' | 'resolved' | undefined>(undefined);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.superAdminDashboard.getAlerts.useQuery({ status: statusFilter });
  const resolveAlert = trpc.superAdminDashboard.resolveAlert.useMutation({
    onSuccess: () => utils.superAdminDashboard.getAlerts.invalidate(),
  });

  const alerts = (data ?? []) as Alert[];
  const activeCount = alerts.filter(a => a.status === 'active').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-500 hover:text-white text-sm transition-colors">← Platform Overview</Link>
            <span className="text-gray-700">/</span>
            <h1 className="text-xl font-bold text-white">Alerts</h1>
          </div>
          {activeCount > 0 && (
            <p className="text-sm text-red-400 mt-0.5">{activeCount} active alert{activeCount > 1 ? 's' : ''} require attention</p>
          )}
        </div>
        <div className="flex gap-2">
          {(['all', 'active', 'resolved'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s === 'all' ? undefined : s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${(s === 'all' && !statusFilter) || statusFilter === s ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="flex items-center justify-center h-40 text-gray-400">Loading…</div>}

      {!isLoading && alerts.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <p className="text-4xl mb-3">✓</p>
          <p className="text-gray-400 text-sm">No alerts{statusFilter ? ` (${statusFilter})` : ''}</p>
        </div>
      )}

      {!isLoading && alerts.length > 0 && (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert._id}
              alert={alert}
              onResolve={() => resolveAlert.mutate({ alertId: alert._id })}
              resolving={resolveAlert.isPending && resolveAlert.variables?.alertId === alert._id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert, onResolve, resolving }: { alert: Alert; onResolve: () => void; resolving: boolean }) {
  const isCritical = alert.severity === 'critical';
  const isResolved = alert.status === 'resolved';

  return (
    <div className={`rounded-xl border p-4 transition-opacity ${isResolved ? 'opacity-50' : ''} ${isCritical && !isResolved ? 'bg-red-950/20 border-red-800/60' : isResolved ? 'bg-gray-900 border-gray-800' : 'bg-yellow-950/20 border-yellow-800/60'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="mt-0.5 text-base shrink-0">{isCritical && !isResolved ? '🔴' : isResolved ? '✓' : '⚠️'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold uppercase tracking-wide ${isCritical && !isResolved ? 'text-red-400' : isResolved ? 'text-gray-500' : 'text-yellow-400'}`}>
                {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
              </span>
              <span className="text-xs text-gray-600">·</span>
              <Link
                href={`/dashboard/colleges/${alert.college_id}/costs`}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors truncate"
              >
                {alert.college_id}
              </Link>
            </div>
            <p className={`text-sm mt-1 ${isResolved ? 'text-gray-500' : 'text-gray-300'}`}>{alert.message}</p>
            <p className="text-xs text-gray-600 mt-1">
              {timeAgo(alert.created_at)}
              {isResolved && alert.resolved_at && ` · resolved ${timeAgo(alert.resolved_at)}`}
            </p>
          </div>
        </div>
        {!isResolved && (
          <button
            onClick={onResolve}
            disabled={resolving}
            className="shrink-0 text-xs text-gray-500 hover:text-white disabled:opacity-50 border border-gray-700 hover:border-gray-500 rounded-lg px-2.5 py-1 transition-colors"
          >
            {resolving ? '…' : 'Resolve'}
          </button>
        )}
      </div>
    </div>
  );
}
