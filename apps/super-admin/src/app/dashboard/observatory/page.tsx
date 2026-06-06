'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

// ── Types ────────────────────────────────────────────────────────────────────

interface ServiceSnapshot {
  service: string;
  health_status: 'healthy' | 'warning' | 'critical' | 'unknown';
  health_reasons: string[];
  captured_at: string;
  probe_duration_ms: number;
  metrics: Record<string, unknown>;
}

interface ObservatoryAlert {
  _id: string;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  service: string;
  title: string;
  message: string;
  first_fired_at: string;
  last_fired_at: string;
  status: string;
}

interface CollegeRow {
  college_id: string;
  college_name: string;
  claude_rpm_today: number;
  embed_tokens_today: number;
}

interface ObservatoryData {
  overall_status: { status: string; color: string };
  snapshots: ServiceSnapshot[];
  active_alerts: ObservatoryAlert[];
  college_matrix: CollegeRow[];
  updated_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function fmtGb(n: number): string {
  return `${(n as number ?? 0).toFixed(2)} GB`;
}

function secAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function HealthDot({ status }: { status: string }) {
  const color =
    status === 'healthy' ? 'bg-green-500' :
    status === 'warning' ? 'bg-yellow-500' :
    status === 'critical' ? 'bg-red-500' :
    'bg-gray-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

function HealthBadge({ status }: { status: string }) {
  const cls =
    status === 'healthy' ? 'text-green-400 bg-green-950/50 border-green-800' :
    status === 'warning' ? 'text-yellow-400 bg-yellow-950/50 border-yellow-800' :
    status === 'critical' ? 'text-red-400 bg-red-950/50 border-red-800' :
    'text-gray-400 bg-gray-800 border-gray-700';
  const label =
    status === 'healthy' ? '● HEALTHY' :
    status === 'warning' ? '⚠ WARNING' :
    status === 'critical' ? '🔴 CRITICAL' : '? UNKNOWN';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

function UsageBar({ value, max, pct }: { value?: number; max?: number; pct?: number }) {
  const p = pct ?? (max && max > 0 ? ((value ?? 0) / max) * 100 : 0);
  const color = p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(p, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-10 text-right">{p.toFixed(1)}%</span>
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex justify-between items-baseline text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 font-mono">{value}{sub ? <span className="text-gray-500 font-sans"> {sub}</span> : ''}</span>
    </div>
  );
}

// ── Service Panels ────────────────────────────────────────────────────────────

function MongoPanel({ snap }: { snap?: ServiceSnapshot }) {
  const m = snap?.metrics as Record<string, number> | undefined;
  return (
    <PanelShell title="MongoDB" icon="🍃" snap={snap} service="mongodb">
      {m ? (
        <div className="space-y-2">
          <MetricRow label="Storage" value={`${fmtGb(m.storage_gb ?? 0)} / ${(m.storage_pct != null ? (m.storage_gb / (m.storage_pct / 100)).toFixed(0) + ' GB' : '—')}`} />
          <UsageBar pct={m.storage_pct} />
          <MetricRow label="Documents" value={fmtK(m.document_count ?? 0)} />
          <MetricRow label="Connections" value={`${m.active_connections ?? 0} / ${(m.active_connections ?? 0) + (m.available_connections ?? 0)}`} />
          <UsageBar pct={m.connections_pct} />
        </div>
      ) : <EmptyMetrics />}
    </PanelShell>
  );
}

function AnthropicPanel({ snap }: { snap?: ServiceSnapshot }) {
  const m = snap?.metrics as Record<string, number> | undefined;
  return (
    <PanelShell title="Claude API" icon="🤖" snap={snap} service="anthropic">
      {m ? (
        <div className="space-y-2">
          <MetricRow label="RPM" value={`${m.rpm ?? 0} / ${m.rpm_limit ?? 60}`} />
          <UsageBar pct={m.rpm_vs_limit_pct} />
          <MetricRow label="TPM in/out" value={`${fmtK(m.tpm_input ?? 0)} / ${fmtK(m.tpm_output ?? 0)}`} />
          <MetricRow label="Error rate" value={`${(m.error_rate_pct ?? 0).toFixed(2)}%`} />
          <MetricRow label="P50 latency" value={`${m.latency_p50_ms ?? 0}ms`} />
          <div className="pt-1 border-t border-gray-800">
            <MetricRow label="Monthly quota" value={`${fmtK(m.monthly_tokens_used ?? 0)} / ${fmtK(m.monthly_token_limit ?? 0)}`} />
            <UsageBar pct={100 - (m.quota_remaining_pct ?? 100)} />
          </div>
        </div>
      ) : <EmptyMetrics />}
    </PanelShell>
  );
}

function OpenAIPanel({ snap }: { snap?: ServiceSnapshot }) {
  const m = snap?.metrics as Record<string, number> | undefined;
  return (
    <PanelShell title="OpenAI Embeddings" icon="🧠" snap={snap} service="openai-embeddings">
      {m ? (
        <div className="space-y-2">
          <MetricRow label="RPM" value={`${m.rpm ?? 0} / ${m.rpm_limit ?? 3000}`} />
          <UsageBar pct={m.rpm_vs_limit_pct} />
          <MetricRow label="TPM" value={fmtK(m.tpm ?? 0)} />
          <MetricRow label="Error rate" value={`${(m.error_rate_pct ?? 0).toFixed(2)}%`} />
          <MetricRow label="P50 latency" value={`${m.latency_p50_ms ?? 0}ms`} />
          <div className="pt-1 border-t border-gray-800">
            <MetricRow label="Monthly" value={`${fmtK(m.monthly_tokens_used ?? 0)} / ${fmtK(m.monthly_token_limit ?? 0)}`} />
            <UsageBar pct={100 - (m.quota_remaining_pct ?? 100)} />
          </div>
        </div>
      ) : <EmptyMetrics />}
    </PanelShell>
  );
}

function PineconePanel({ snap }: { snap?: ServiceSnapshot }) {
  const m = snap?.metrics as Record<string, number & { is_ready?: boolean; pod_status?: string }> | undefined;
  return (
    <PanelShell title="Pinecone VectorDB" icon="🌲" snap={snap} service="pinecone">
      {m ? (
        <div className="space-y-2">
          <MetricRow label="Pod status" value={(m as Record<string, unknown>).pod_status as string ?? '—'} />
          <MetricRow label="Total vectors" value={fmtK(m.total_vectors ?? 0)} />
          <MetricRow label="Storage" value={`${fmtGb(m.storage_gb ?? 0)} / ${m.storage_limit_gb ?? 10} GB`} />
          <UsageBar pct={m.storage_pct} />
          <MetricRow label="Namespaces" value={m.namespace_count ?? 0} />
          <MetricRow label="Query P50" value={`${m.query_latency_ms ?? 0}ms`} />
          <MetricRow label="RU Read today" value={fmtK(m.ru_read_today ?? 0)} />
        </div>
      ) : <EmptyMetrics />}
    </PanelShell>
  );
}

function DiskPanel({ snap }: { snap?: ServiceSnapshot }) {
  const m = snap?.metrics as Record<string, number> | undefined;
  return (
    <PanelShell title="Local Disk" icon="💾" snap={snap} service="local-disk">
      {m ? (
        <div className="space-y-2">
          <MetricRow label="Used" value={`${fmtGb(m.disk_used_gb ?? 0)} / ${fmtGb(m.disk_total_gb ?? 0)}`} />
          <UsageBar pct={m.disk_used_pct} />
          <MetricRow label="Free" value={fmtGb(m.disk_free_gb ?? 0)} />
          <MetricRow label="Inodes" value={`${(m.inode_used_pct ?? 0).toFixed(1)}%`} />
        </div>
      ) : <EmptyMetrics />}
    </PanelShell>
  );
}

function RedisPanel({ snap }: { snap?: ServiceSnapshot }) {
  const m = snap?.metrics as Record<string, number> | undefined;
  return (
    <PanelShell title="Redis Cache" icon="🔴" snap={snap} service="redis">
      {m ? (
        <div className="space-y-2">
          <MetricRow label="Memory" value={`${(m.memory_used_mb ?? 0).toFixed(0)} / ${(m.memory_max_mb ?? 0).toFixed(0)} MB`} />
          <UsageBar pct={m.memory_used_pct} />
          <MetricRow label="Clients" value={`${m.connected_clients ?? 0} / ${Math.round((m.connected_clients ?? 0) / Math.max((m.connected_clients_pct ?? 1) / 100, 0.01))}`} />
          <MetricRow label="Keys" value={fmtK(m.total_keys ?? 0)} />
          <MetricRow label="Hit rate" value={`${(m.keyspace_hit_rate_pct ?? 0).toFixed(1)}%`} />
          <MetricRow label="Queue depth" value={m.total_queue_depth ?? 0} sub="jobs" />
          <MetricRow label="Ops/sec" value={fmtK(m.ops_per_sec ?? 0)} />
        </div>
      ) : <EmptyMetrics />}
    </PanelShell>
  );
}

function EmptyMetrics() {
  return <p className="text-gray-600 text-xs italic">No snapshot yet — probe pending</p>;
}

function PanelShell({
  title, icon, snap, service, children,
}: {
  title: string;
  icon: string;
  snap?: ServiceSnapshot;
  service: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{icon} {title}</p>
          {snap && (
            <p className="text-xs text-gray-600 mt-0.5">probe {secAgo(snap.captured_at)}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <HealthBadge status={snap?.health_status ?? 'unknown'} />
          <Link href={`/dashboard/observatory/${service}`} className="text-xs text-blue-400 hover:text-blue-300">
            Detail →
          </Link>
        </div>
      </div>

      {snap?.health_reasons && snap.health_reasons.length > 0 && (
        <div className="text-xs text-yellow-400/80 bg-yellow-950/20 border border-yellow-900/30 rounded p-2 space-y-0.5">
          {snap.health_reasons.map((r, i) => <p key={i}>⚠ {r}</p>)}
        </div>
      )}

      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ObservatoryPage() {
  const { token } = useAuthStore();
  const [data, setData] = useState<ObservatoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/v1/super-admin/observatory`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as ObservatoryData;
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  async function acknowledgeAlert(alertId: string) {
    if (!token) return;
    await fetch(`${API}/api/v1/super-admin/observatory/alerts/${alertId}/acknowledge`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchData();
  }

  // Snapshot lookup helper
  function snap(service: string): ServiceSnapshot | undefined {
    return data?.snapshots.find((s) => s.service === service);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading Observatory…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-400 text-sm">Failed: {error}</p>
        <button onClick={fetchData} className="text-xs text-blue-400 hover:text-blue-300">
          Retry
        </button>
      </div>
    );
  }

  const overall = data?.overall_status;
  const overallBg =
    overall?.color === 'red' ? 'bg-red-950/50 border-red-800 text-red-300' :
    overall?.color === 'amber' ? 'bg-yellow-950/50 border-yellow-800 text-yellow-300' :
    'bg-green-950/50 border-green-800 text-green-300';

  const activeAlerts = data?.active_alerts ?? [];
  const criticalAlerts = activeAlerts.filter((a) => a.severity === 'critical');
  const warningAlerts = activeAlerts.filter((a) => a.severity === 'warning');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Unified Usage Observatory</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Infrastructure health · real-time telemetry · 6 services
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${autoRefresh ? 'bg-green-950/50 border-green-800 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
          >
            {autoRefresh ? '⟳ Auto-refresh ON' : '⟳ Auto-refresh OFF'}
          </button>
          <button
            onClick={fetchData}
            className="text-xs px-3 py-1.5 rounded border bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Refresh now
          </button>
          {lastRefresh && (
            <span className="text-xs text-gray-600">Updated {secAgo(lastRefresh.toISOString())}</span>
          )}
        </div>
      </div>

      {/* Overall status banner */}
      <div className={`border rounded-xl px-5 py-3 font-semibold text-sm flex items-center gap-3 ${overallBg}`}>
        <span className="text-lg">
          {overall?.color === 'red' ? '🔴' : overall?.color === 'amber' ? '⚠️' : '✅'}
        </span>
        <span>{overall?.status ?? 'UNKNOWN'}</span>
        {criticalAlerts.length > 0 && (
          <span className="ml-auto text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded border border-red-800">
            {criticalAlerts.length} critical
          </span>
        )}
        {warningAlerts.length > 0 && (
          <span className={`${criticalAlerts.length === 0 ? 'ml-auto' : ''} text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded border border-yellow-800`}>
            {warningAlerts.length} warning
          </span>
        )}
      </div>

      {/* 2×3 service panel grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <MongoPanel snap={snap('mongodb')} />
        <AnthropicPanel snap={snap('anthropic')} />
        <OpenAIPanel snap={snap('openai_embeddings')} />
        <PineconePanel snap={snap('pinecone')} />
        <DiskPanel snap={snap('local_disk')} />
        <RedisPanel snap={snap('redis')} />
      </div>

      {/* Active alerts strip */}
      {activeAlerts.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Active Alerts ({activeAlerts.length})
          </h2>
          <div className="space-y-2">
            {activeAlerts.map((alert) => (
              <div
                key={alert._id}
                className={`flex items-start justify-between gap-4 p-3 rounded-lg border text-sm ${
                  alert.severity === 'critical'
                    ? 'bg-red-950/30 border-red-900/50'
                    : alert.severity === 'warning'
                    ? 'bg-yellow-950/30 border-yellow-900/50'
                    : 'bg-gray-800/50 border-gray-700'
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span>{alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'}</span>
                  <div className="min-w-0">
                    <p className="text-gray-200 font-medium truncate">{alert.title}</p>
                    <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{alert.message}</p>
                    <p className="text-gray-600 text-xs mt-1">
                      {alert.service} · first fired {secAgo(alert.first_fired_at)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => acknowledgeAlert(alert._id)}
                  className="shrink-0 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded px-2 py-1 transition-colors"
                >
                  Ack
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* College usage matrix */}
      {(data?.college_matrix ?? []).length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Usage by College — Today
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                  <th className="pb-2 text-left">College</th>
                  <th className="pb-2 text-right">Claude Req/Today</th>
                  <th className="pb-2 text-right">Embed Tokens/Today</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {(data?.college_matrix ?? []).map((row) => (
                  <tr key={row.college_id} className="hover:bg-gray-800/40">
                    <td className="py-2 text-white font-medium">{row.college_name}</td>
                    <td className="py-2 text-right text-gray-300 font-mono text-xs">
                      {fmtK(row.claude_rpm_today)}
                    </td>
                    <td className="py-2 text-right text-gray-300 font-mono text-xs">
                      {fmtK(row.embed_tokens_today)}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/dashboard/observatory/college/${row.college_id}`}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        Drilldown →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Student usage quick-link */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">Individual Student Observatory</h2>
            <p className="text-xs text-gray-500 mt-1">
              Per-student token usage, activity heatmap, dept percentile ranking
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Select a college → Drilldown → Students tab
          </p>
        </div>
        {(data?.college_matrix ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(data?.college_matrix ?? []).map((row) => (
              <Link
                key={row.college_id}
                href={`/dashboard/observatory/college/${row.college_id}/students`}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
              >
                {row.college_name} students →
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
