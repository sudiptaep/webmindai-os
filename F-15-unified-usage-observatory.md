# F-15: Unified Usage Observatory
## Single-Screen Infrastructure & API Usage Tracking for Super Admin

> **Parent docs:** `college-chatbot-architecture.md` v2.0 · `F-12-super-admin-cost-intelligence.md` v1.0  
> **Extends:** F-12 added cost tracking per college/dept. F-15 adds raw infrastructure telemetry — MongoDB health, Claude API quota, OpenAI usage, Pinecone index health, and local disk — on a single live screen that an ops team can leave open permanently.  
> **The distinction from F-12:** F-12 answers "how much are we spending?" — F-15 answers "how is everything running right now, and will it break?" F-12 is finance. F-15 is operations.  
> **Audience:** Super Admin / Platform Ops only.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [Why This Feature Exists — The Operations Problem](#1-why-this-feature-exists--the-operations-problem)
2. [The Six Infrastructure Layers to Observe](#2-the-six-infrastructure-layers-to-observe)
3. [What F-12 Already Has vs What F-15 Adds](#3-what-f-12-already-has-vs-what-f-15-adds)
4. [Database Schema — New Collections](#4-database-schema--new-collections)
5. [F-15-A: Telemetry Collection Architecture](#5-f-15-a-telemetry-collection-architecture)
6. [F-15-B: MongoDB Usage Panel](#6-f-15-b-mongodb-usage-panel)
7. [F-15-C: Claude API (Anthropic) Usage Panel](#7-f-15-c-claude-api-anthropic-usage-panel)
8. [F-15-D: OpenAI Embeddings Usage Panel](#8-f-15-d-openai-embeddings-usage-panel)
9. [F-15-E: Pinecone Vector DB Usage Panel](#9-f-15-e-pinecone-vector-db-usage-panel)
10. [F-15-F: Local Disk & File Storage Panel](#10-f-15-f-local-disk--file-storage-panel)
11. [F-15-G: Redis Usage Panel](#11-f-15-g-redis-usage-panel)
12. [F-15-H: The Unified Observatory Screen](#12-f-15-h-the-unified-observatory-screen)
13. [F-15-I: Real-Time Alerts & Anomaly Detection](#13-f-15-i-real-time-alerts--anomaly-detection)
14. [F-15-J: Usage Drill-Down — College & Department](#14-f-15-j-usage-drill-down--college--department)
15. [Telemetry Collection Jobs](#15-telemetry-collection-jobs)
16. [API Route Map](#16-api-route-map)
17. [Frontend Component Tree](#17-frontend-component-tree)
18. [Environment Variables](#18-environment-variables)
19. [Build Order](#19-build-order)

---

## 1. Why This Feature Exists — The Operations Problem

### The scenario that keeps you up at night

It is 11 PM on a Thursday — peak exam season study time. 800 students across 6 colleges are using the platform simultaneously. Three things break silently:

- Pinecone's pod is at 95% capacity — new vector writes are starting to fail
- MongoDB Atlas has promoted itself to a new primary replica — connection pool is thrashing
- The OpenAI embedding API is returning HTTP 429 (rate limit) — students get "service unavailable"

None of these fire an email. You find out at 6 AM when the support inbox has 200 messages.

F-15 is the answer: a single screen, always open on an ops monitor, showing the real-time health of every infrastructure layer, with proactive alerts before anything breaks. Think of it as your platform's Mission Control.

### What "single screen" means precisely

The Observatory is a single `/super-admin/observatory` page in the Super Admin portal. It is designed to be left open permanently — auto-refreshes every 60 seconds, shows live status without page reload, and has a visual layout that lets you read overall system health in under 3 seconds from across the room.

Six service panels arranged in a 2×3 grid. Each panel has:
- A health indicator (GREEN / YELLOW / RED) visible from 5 metres
- Current real-time numbers
- A 24-hour mini sparkline trend
- One-click drilldown to full detail

Below the grid: a scrollable alert log showing every threshold breach in the last 48 hours, grouped by service and college.

---

## 2. The Six Infrastructure Layers to Observe

| Layer | Service | What to measure | Refresh |
|---|---|---|---|
| Application DB | MongoDB Atlas | Collections, document counts, storage per college-DB, query latency, connection pool | 5 min |
| LLM | Anthropic Claude API | Tokens per min, requests per min, error rate, quota remaining, per-model split | 1 min |
| Embeddings | OpenAI API | Tokens embedded per min, requests/min, error rate, quota remaining | 1 min |
| Vector DB | Pinecone | Index storage %, vector count, RU usage, pod health, namespace breakdown | 5 min |
| File Storage | Local disk | GB used, GB free, usage by college, largest files, inode usage | 15 min |
| Cache / Queue | Redis | Memory usage, connected clients, queue depths (BullMQ jobs), slowlog | 5 min |

---

## 3. What F-12 Already Has vs What F-15 Adds

It is critical to understand what F-12 built and what F-15 extends — to avoid duplication.

| Dimension | F-12 (Cost Intelligence) | F-15 (Usage Observatory) |
|---|---|---|
| **Data source** | Internal `cost_events` MongoDB collection | External API probes + OS metrics |
| **Data granularity** | Per-request event logged at time of API call | Periodic snapshots every 1–15 minutes |
| **Primary question** | "How much did we spend?" | "How is the system running right now?" |
| **Time horizon** | Monthly billing periods, historical trends | Last 24 hours, last 60 minutes, right now |
| **MongoDB** | Not measured — only used as the event store | **Measured** — collection sizes, query latency |
| **Anthropic usage** | Token counts from response.usage | Real-time quota remaining, error rate, RPM |
| **OpenAI usage** | Token counts from response.usage | Real-time quota, error rate, embedding latency |
| **Pinecone** | RU write/read counts from SDK response | Index health, storage %, pod status |
| **Local disk** | Not measured | **Measured** — bytes used per college, free space |
| **Redis** | Not measured | **Measured** — memory, queue depth |
| **Alert focus** | Budget thresholds (80% of $5 budget) | Operational thresholds (95% disk, API 429s) |
| **Audience** | Business / Finance decisions | Ops / Engineering decisions |

F-15 **reads from F-12's** `cost_events` data for historical trend lines (no duplication), but its primary data comes from probing external APIs and the operating system directly.

---

## 4. Database Schema — New Collections

All new collections live in the **platform DB** (shared infrastructure, not per-college).

### 4.1 `service_snapshots` collection

The core time-series store. Every telemetry probe writes a document here.

```js
{
  _id: UUID,
  service: Enum[
    "mongodb",
    "anthropic",
    "openai_embeddings",
    "pinecone",
    "local_disk",
    "redis"
  ],
  snapshot_type: Enum[
    "platform",      // platform-wide snapshot (Redis, Anthropic quota)
    "college",       // per-college snapshot (MongoDB per-college DB, disk per college)
    "dept",          // per-department snapshot (Pinecone namespace)
  ],

  // Scope (null for platform-wide)
  college_id: String,
  dept_id: String,

  // Timing
  captured_at: Date,
  probe_duration_ms: Number,            // how long the probe took to run

  // Payload — generic JSON, shape varies by service (see per-service sections below)
  metrics: Object,

  // Health computation
  health_status: Enum["healthy", "warning", "critical", "unknown"],
  health_reasons: [String],             // e.g. ["storage at 87%", "error rate 3.2%"]

  // TTL — old snapshots auto-deleted
  // 1-minute snapshots: keep 24h
  // 5-minute snapshots: keep 7 days
  // 15-minute snapshots: keep 30 days
  // Daily rollups: keep 365 days
  expires_at: Date
}

// Indexes
db.service_snapshots.createIndex({ service: 1, snapshot_type: 1, captured_at: -1 });
db.service_snapshots.createIndex({ college_id: 1, service: 1, captured_at: -1 });
db.service_snapshots.createIndex({ dept_id: 1, service: 1, captured_at: -1 });
db.service_snapshots.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL index
db.service_snapshots.createIndex({ health_status: 1, captured_at: -1 });       // alert queries
```

### 4.2 `observatory_alerts` collection

Operational alerts — distinct from F-12's cost/budget alerts.

```js
{
  _id: UUID,
  alert_type: Enum[
    // MongoDB
    "mongodb_connection_pool_exhausted",
    "mongodb_storage_high",
    "mongodb_query_latency_spike",
    "mongodb_replication_lag",

    // Anthropic
    "anthropic_rate_limit_hit",
    "anthropic_error_rate_high",
    "anthropic_quota_low",
    "anthropic_latency_spike",

    // OpenAI
    "openai_rate_limit_hit",
    "openai_error_rate_high",
    "openai_quota_low",

    // Pinecone
    "pinecone_storage_critical",
    "pinecone_pod_unhealthy",
    "pinecone_query_latency_spike",
    "pinecone_namespace_not_found",

    // Disk
    "disk_storage_high",
    "disk_storage_critical",
    "disk_inode_high",

    // Redis
    "redis_memory_high",
    "redis_queue_depth_high",
    "redis_connection_refused",

    // Composite
    "platform_wide_degradation"        // 3+ services showing warning simultaneously
  ],

  severity: Enum["info", "warning", "critical"],
  service: String,

  // Scope
  college_id: String,                  // null for platform-wide alerts
  dept_id: String,

  // Alert content
  title: String,
  message: String,
  metric_name: String,                 // e.g. "storage_pct"
  metric_value: Number,                // e.g. 94.3
  threshold_value: Number,             // e.g. 90.0
  unit: String,                        // "%" or "ms" or "GB"

  // Lifecycle
  status: Enum["active", "acknowledged", "resolved", "auto_resolved"],
  first_fired_at: Date,
  last_fired_at: Date,                 // updated if alert condition persists
  acknowledged_by: UUID,               // platform_admin_id
  acknowledged_at: Date,
  resolved_at: Date,
  auto_resolved: Boolean,

  // Email sent?
  notification_sent: Boolean,
  notification_sent_at: Date
}

// Indexes
db.observatory_alerts.createIndex({ status: 1, severity: 1, first_fired_at: -1 });
db.observatory_alerts.createIndex({ service: 1, status: 1, first_fired_at: -1 });
db.observatory_alerts.createIndex({ college_id: 1, status: 1 });
```

### 4.3 `daily_usage_rollups` collection

Pre-aggregated daily summaries for the 30-day trend charts. Rebuilt nightly.

```js
{
  _id: UUID,
  date: String,                        // "2026-05-20"
  college_id: String,                  // null for platform-wide
  dept_id: String,                     // null for college or platform-wide

  // MongoDB
  mongo_storage_gb: Number,
  mongo_document_count: Number,
  mongo_avg_query_latency_ms: Number,
  mongo_peak_connections: Number,

  // Anthropic
  anthropic_total_tokens: Number,
  anthropic_requests: Number,
  anthropic_errors: Number,
  anthropic_avg_latency_ms: Number,
  anthropic_haiku_tokens: Number,
  anthropic_sonnet_tokens: Number,

  // OpenAI
  openai_total_tokens: Number,
  openai_requests: Number,
  openai_errors: Number,
  openai_avg_latency_ms: Number,

  // Pinecone
  pinecone_vector_count: Number,
  pinecone_storage_gb: Number,
  pinecone_read_units: Number,
  pinecone_write_units: Number,
  pinecone_avg_query_latency_ms: Number,

  // Local disk
  disk_used_gb: Number,
  disk_free_gb: Number,
  disk_used_pct: Number,

  // Redis
  redis_memory_mb: Number,
  redis_peak_clients: Number,
  redis_queue_peak_depth: Number,

  computed_at: Date
}

db.daily_usage_rollups.createIndex({ date: 1, college_id: 1 }, { unique: true });
db.daily_usage_rollups.createIndex({ date: -1 });
```

---

## 5. F-15-A: Telemetry Collection Architecture

### 5.1 The probe runner

A dedicated background service (`services/api/src/jobs/telemetry-runner.ts`) that fires probes on configurable schedules. Each probe is an independent async function that:
1. Calls an external API or OS command
2. Transforms the response into a `service_snapshots` document
3. Computes health status
4. Fires alerts if thresholds crossed

```typescript
// services/api/src/jobs/telemetry-runner.ts

import { CronJob } from 'cron';
import { runMongoProbe } from './probes/mongo.probe';
import { runAnthropicProbe } from './probes/anthropic.probe';
import { runOpenAIProbe } from './probes/openai.probe';
import { runPineconeProbe } from './probes/pinecone.probe';
import { runDiskProbe } from './probes/disk.probe';
import { runRedisProbe } from './probes/redis.probe';

// Schedule: every 1 minute — LLM APIs (rate-sensitive)
new CronJob('* * * * *', async () => {
  await Promise.allSettled([
    runAnthropicProbe(),
    runOpenAIProbe(),
  ]);
}, null, true, 'Asia/Kolkata');

// Schedule: every 5 minutes — DB and vector store
new CronJob('*/5 * * * *', async () => {
  await Promise.allSettled([
    runMongoProbe(),
    runPineconeProbe(),
    runRedisProbe(),
  ]);
}, null, true, 'Asia/Kolkata');

// Schedule: every 15 minutes — local disk (expensive OS probe)
new CronJob('*/15 * * * *', async () => {
  await runDiskProbe();
}, null, true, 'Asia/Kolkata');

// Schedule: nightly 1 AM — roll up daily summaries
new CronJob('0 1 * * *', async () => {
  await rebuildDailyUsageRollups();
}, null, true, 'Asia/Kolkata');
```

### 5.2 Health status computation — thresholds

```typescript
// services/api/src/jobs/probes/health.ts

export const HEALTH_THRESHOLDS = {
  mongodb: {
    storage_pct:            { warning: 70, critical: 85 },  // % of Atlas tier storage
    query_latency_ms:       { warning: 200, critical: 500 },
    connections_pct:        { warning: 70, critical: 85 },
    replication_lag_sec:    { warning: 10, critical: 30 },
  },
  anthropic: {
    error_rate_pct:         { warning: 2, critical: 10 },
    rpm_vs_limit_pct:       { warning: 70, critical: 90 },  // requests/min vs limit
    avg_latency_ms:         { warning: 3000, critical: 8000 },
    quota_remaining_pct:    { warning: 20, critical: 5 },
  },
  openai: {
    error_rate_pct:         { warning: 2, critical: 10 },
    rpm_vs_limit_pct:       { warning: 70, critical: 90 },
    avg_latency_ms:         { warning: 2000, critical: 5000 },
    quota_remaining_pct:    { warning: 20, critical: 5 },
  },
  pinecone: {
    storage_pct:            { warning: 75, critical: 90 },
    query_latency_ms:       { warning: 500, critical: 1500 },
  },
  disk: {
    used_pct:               { warning: 75, critical: 90 },
    inode_used_pct:         { warning: 80, critical: 95 },
  },
  redis: {
    memory_used_pct:        { warning: 70, critical: 85 },
    queue_depth:            { warning: 500, critical: 2000 },
    connected_clients_pct:  { warning: 70, critical: 85 },
  }
};

export function computeHealth(service: string, metrics: Record<string, number>): {
  status: 'healthy' | 'warning' | 'critical';
  reasons: string[];
} {
  const thresholds = HEALTH_THRESHOLDS[service];
  const reasons: string[] = [];
  let worstStatus: 'healthy' | 'warning' | 'critical' = 'healthy';

  for (const [metric, value] of Object.entries(metrics)) {
    if (!(metric in thresholds)) continue;
    const { warning, critical } = thresholds[metric];

    if (value >= critical) {
      reasons.push(`${metric} at ${value} (critical threshold: ${critical})`);
      worstStatus = 'critical';
    } else if (value >= warning && worstStatus !== 'critical') {
      reasons.push(`${metric} at ${value} (warning threshold: ${warning})`);
      worstStatus = 'warning';
    }
  }

  return { status: worstStatus, reasons };
}
```

---

## 6. F-15-B: MongoDB Usage Panel

### 6.1 What we measure

MongoDB Atlas exposes a Data API and a monitoring API. For self-hosted MongoDB, we use the `db.adminCommand()` interface via the existing Mongoose connection.

**Metrics collected per college DB:**
- Storage size in bytes (collection + index)
- Document count per collection
- Average query latency (from serverStatus)
- Active connections vs connection pool size
- Replication lag (if Atlas M10+ replica set)

**Platform-level metrics:**
- Total platform storage across all college DBs
- Platform DB (cost_events, snapshots) size
- Slowest queries in the last 15 minutes (from Atlas Profiler or Mongo Atlas API)

### 6.2 MongoDB probe implementation

```typescript
// services/api/src/jobs/probes/mongo.probe.ts

import mongoose from 'mongoose';
import { platformDb, getCollegeDb } from '../../db/college.db';

export async function runMongoProbe() {
  const probeStart = Date.now();
  const colleges = await platformDb.colleges.find({ status: 'active' }).toArray();

  // ── Platform DB stats ─────────────────────────────────────────
  const platformStats = await platformDb.db.command({ dbStats: 1, scale: 1048576 }); // MB
  const serverStatus = await platformDb.db.command({ serverStatus: 1 });

  const platformMetrics = {
    storage_gb: platformStats.storageSize / 1024,
    index_size_gb: platformStats.indexSize / 1024,
    document_count: platformStats.objects,
    collections: platformStats.collections,
    active_connections: serverStatus.connections?.current ?? 0,
    available_connections: serverStatus.connections?.available ?? 0,
    connections_pct: serverStatus.connections?.current
      ? (serverStatus.connections.current / (serverStatus.connections.current + serverStatus.connections.available)) * 100
      : 0,
    opcounters_per_sec: {
      query: serverStatus.opcounters?.query ?? 0,
      insert: serverStatus.opcounters?.insert ?? 0,
      update: serverStatus.opcounters?.update ?? 0,
    },
    replication_lag_sec: 0,  // platform DB is typically standalone
  };

  const { status: platformHealth, reasons: platformReasons } = computeHealth('mongodb', {
    storage_pct: (platformMetrics.storage_gb / parseFloat(process.env.MONGO_PLATFORM_STORAGE_LIMIT_GB || '5')) * 100,
    connections_pct: platformMetrics.connections_pct,
  });

  await saveSnapshot({
    service: 'mongodb',
    snapshot_type: 'platform',
    college_id: null,
    dept_id: null,
    metrics: platformMetrics,
    health_status: platformHealth,
    health_reasons: platformReasons,
    probe_duration_ms: Date.now() - probeStart,
  });

  // ── Per-college DB stats ──────────────────────────────────────
  for (const college of colleges) {
    try {
      const db = await getCollegeDb(college._id);
      const stats = await db.command({ dbStats: 1, scale: 1048576 });

      // Collection breakdown
      const collectionNames = ['documents', 'students', 'sessions', 'query_logs',
                               'srs_cards', 'quiz_sessions', 'chapter_maps', 'pyq_questions'];
      const collectionStats: Record<string, any> = {};

      for (const collName of collectionNames) {
        try {
          const collStats = await db.command({ collStats: collName });
          collectionStats[collName] = {
            count: collStats.count,
            storage_mb: collStats.storageSize / 1048576,
            index_size_mb: collStats.totalIndexSize / 1048576,
          };
        } catch { /* collection might not exist yet */ }
      }

      const collegeMetrics = {
        storage_gb: stats.storageSize / 1024,
        index_size_gb: stats.indexSize / 1024,
        document_count: stats.objects,
        storage_pct: (stats.storageSize / 1048576 / parseFloat(process.env.MONGO_COLLEGE_STORAGE_LIMIT_GB || '10')) * 100,
        collection_breakdown: collectionStats,
      };

      const { status, reasons } = computeHealth('mongodb', {
        storage_pct: collegeMetrics.storage_pct,
      });

      await saveSnapshot({
        service: 'mongodb',
        snapshot_type: 'college',
        college_id: college._id,
        dept_id: null,
        metrics: collegeMetrics,
        health_status: status,
        health_reasons: reasons,
        probe_duration_ms: Date.now() - probeStart,
      });
    } catch (err) {
      // Log probe failure — don't crash the entire probe run
      console.error(`MongoDB probe failed for college ${college._id}:`, err);
    }
  }
}
```

### 6.3 MongoDB panel UI

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🍃 MongoDB Atlas                              ● HEALTHY    [Detail] │
│ Platform DB + 6 college DBs                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Total storage: 4.2 GB / 50 GB   ████░░░░░░ 8.4%                  │
│ Total documents: 2.4M            Connections: 24 / 200   12%       │
│ Avg query latency: 18ms          Opcounters: 142 q/s               │
│                                                                     │
│ Per-College Storage                                                 │
│ MSRIT Medical           1.2 GB  ████████░░░░  24%                 │
│ Dayananda Eng           0.9 GB  ██████░░░░░░  18%                 │
│ KLE Medical             0.7 GB  █████░░░░░░░  14%                 │
│ PESCE Engineering       0.5 GB  ████░░░░░░░░  10%                 │
│ JSS Medical             0.5 GB  ████░░░░░░░░  10%                 │
│ SJCE Engineering        0.4 GB  ███░░░░░░░░░   8%                 │
│                                                                     │
│ Largest collections (platform)                                      │
│ cost_events          890K docs   service_snapshots  420K docs      │
│ query_logs           380K docs   srs_cards          220K docs      │
│                                                                     │
│ [24h trend ~~~~~~~~~~~~~~~~~~~~~~~~~~~]  Last probe: 3 min ago     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. F-15-C: Claude API (Anthropic) Usage Panel

### 7.1 What we measure

The Anthropic API does not expose a usage/quota endpoint in the same way as OpenAI. We proxy all calls through a wrapper that maintains real-time counters in Redis.

**Metrics maintained in Redis (updated on every API call, no additional API probe needed):**

```
anthropic:rpm_window        → sorted set of request timestamps (rolling 60s window)
anthropic:tpm_in_window     → sum of input tokens in last 60s
anthropic:tpm_out_window    → sum of output tokens in last 60s
anthropic:errors_1h         → counter of 4xx/5xx responses in last 1h
anthropic:total_requests_today → daily counter
anthropic:last_error_at     → timestamp of last error
anthropic:last_error_code   → last HTTP status code (429, 500, etc.)
anthropic:latency_p50_ms    → rolling percentile — updated every 100 calls
anthropic:latency_p95_ms    → rolling percentile
```

**The Anthropic probe does NOT call the Anthropic API** — it reads these Redis keys. This avoids adding any latency to the probe and ensures it works even when Anthropic is down.

### 7.2 Anthropic probe implementation

```typescript
// services/api/src/jobs/probes/anthropic.probe.ts

export async function runAnthropicProbe() {
  const probeStart = Date.now();

  // Read from Redis counters (populated by the LLM service wrapper)
  const now = Date.now();
  const window60s = now - 60000;

  // RPM: count requests in the last 60 seconds
  const recentRequests = await redis.zrangebyscore('anthropic:rpm_window', window60s, now);
  const rpm = recentRequests.length;

  // Token rates
  const tpmIn = parseInt(await redis.get('anthropic:tpm_in_window') || '0');
  const tpmOut = parseInt(await redis.get('anthropic:tpm_out_window') || '0');

  // Error stats
  const errors1h = parseInt(await redis.get('anthropic:errors_1h') || '0');
  const totalRequests1h = parseInt(await redis.get('anthropic:total_requests_1h') || '1');
  const errorRate = (errors1h / Math.max(totalRequests1h, 1)) * 100;

  // Latency percentiles
  const latencyP50 = parseInt(await redis.get('anthropic:latency_p50_ms') || '0');
  const latencyP95 = parseInt(await redis.get('anthropic:latency_p95_ms') || '0');

  // Last error
  const lastErrorAt = await redis.get('anthropic:last_error_at');
  const lastErrorCode = await redis.get('anthropic:last_error_code');

  // Monthly token consumption from cost_events (for quota tracking)
  const billingMonth = getBillingMonth();
  const monthlyUsage = await platformDb.cost_events.aggregate([
    { $match: { service: 'anthropic', billing_month: billingMonth } },
    { $group: {
      _id: null,
      total_input: { $sum: '$input_tokens' },
      total_output: { $sum: '$output_tokens' },
      haiku_tokens: {
        $sum: { $cond: [{ $eq: ['$model', 'claude-haiku-4-5-20251001'] }, '$total_tokens', 0] }
      },
      sonnet_tokens: {
        $sum: { $cond: [{ $eq: ['$model', 'claude-sonnet-4-6'] }, '$total_tokens', 0] }
      }
    }}
  ]).toArray();

  const monthlyData = monthlyUsage[0] || { total_input: 0, total_output: 0, haiku_tokens: 0, sonnet_tokens: 0 };
  const monthlyTokenLimit = parseInt(process.env.ANTHROPIC_MONTHLY_TOKEN_LIMIT || '100000000');
  const monthlyTokensUsed = monthlyData.total_input + monthlyData.total_output;
  const quotaRemainingPct = ((monthlyTokenLimit - monthlyTokensUsed) / monthlyTokenLimit) * 100;

  const metrics = {
    rpm,
    rpm_limit: parseInt(process.env.ANTHROPIC_RPM_LIMIT || '60'),
    rpm_vs_limit_pct: (rpm / parseInt(process.env.ANTHROPIC_RPM_LIMIT || '60')) * 100,
    tpm_input: tpmIn,
    tpm_output: tpmOut,
    error_rate_pct: errorRate,
    errors_last_1h: errors1h,
    latency_p50_ms: latencyP50,
    latency_p95_ms: latencyP95,
    last_error_code: lastErrorCode,
    last_error_at: lastErrorAt,
    monthly_tokens_used: monthlyTokensUsed,
    monthly_token_limit: monthlyTokenLimit,
    quota_remaining_pct: quotaRemainingPct,
    haiku_tokens_month: monthlyData.haiku_tokens,
    sonnet_tokens_month: monthlyData.sonnet_tokens,
  };

  const { status, reasons } = computeHealth('anthropic', {
    error_rate_pct: errorRate,
    rpm_vs_limit_pct: metrics.rpm_vs_limit_pct,
    avg_latency_ms: latencyP50,
    quota_remaining_pct: quotaRemainingPct,
  });

  await saveSnapshot({
    service: 'anthropic',
    snapshot_type: 'platform',
    college_id: null,
    dept_id: null,
    metrics,
    health_status: status,
    health_reasons: reasons,
    probe_duration_ms: Date.now() - probeStart,
  });

  // Fire alert if rate limit recently hit
  if (lastErrorCode === '429' && lastErrorAt) {
    const errorAge = Date.now() - parseInt(lastErrorAt);
    if (errorAge < 300000) { // within last 5 minutes
      await fireAlert({
        alert_type: 'anthropic_rate_limit_hit',
        severity: 'warning',
        service: 'anthropic',
        title: 'Anthropic API rate limit hit',
        message: `Claude API returned HTTP 429 ${Math.round(errorAge / 60000)} minutes ago. RPM: ${rpm}/${metrics.rpm_limit}`,
        metric_name: 'rpm_vs_limit_pct',
        metric_value: metrics.rpm_vs_limit_pct,
        threshold_value: 100,
        unit: '%',
      });
    }
  }
}
```

### 7.3 LLM service wrapper — Redis counter updates

Every LLM call in `llm.service.ts` must update these Redis counters **in addition to** writing to `cost_events`. This is the source of truth for real-time metrics:

```typescript
// Addition to services/api/src/services/llm.service.ts

async function updateAnthropicMetrics(
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  success: boolean,
  errorCode?: number
) {
  const now = Date.now();
  const pipe = redis.pipeline();

  // RPM tracking: add to sorted set, remove entries older than 60s
  pipe.zadd('anthropic:rpm_window', now, `${now}`);
  pipe.zremrangebyscore('anthropic:rpm_window', '-inf', now - 60000);
  pipe.expire('anthropic:rpm_window', 120);

  // Token rate tracking (rolling 60s window using simple increment + expire)
  pipe.incrby('anthropic:tpm_in_window', inputTokens);
  pipe.incrby('anthropic:tpm_out_window', outputTokens);
  pipe.expire('anthropic:tpm_in_window', 60);
  pipe.expire('anthropic:tpm_out_window', 60);

  // Daily totals
  const todayKey = `anthropic:total_requests:${getDateString()}`;
  pipe.incr(todayKey);
  pipe.expire(todayKey, 172800); // 48h

  // Error tracking
  if (!success) {
    const errKey = `anthropic:errors_1h`;
    pipe.incr(errKey);
    pipe.expire(errKey, 3600);
    pipe.set('anthropic:last_error_at', String(now), 'EX', 86400);
    pipe.set('anthropic:last_error_code', String(errorCode || 500), 'EX', 86400);
    pipe.incr('anthropic:errors_1h');
    pipe.expire('anthropic:errors_1h', 3600);
  }
  if (success) {
    // Clear last error if things are working again
    // Don't delete — let TTL expire naturally
  }

  // Latency tracking (simplified rolling average)
  // Store last 100 latencies in a list, compute percentiles on probe
  pipe.lpush('anthropic:latency_samples', latencyMs);
  pipe.ltrim('anthropic:latency_samples', 0, 99);     // keep last 100

  await pipe.exec();

  // Compute P50/P95 from the sample list (async, non-blocking)
  setImmediate(async () => {
    const samples = await redis.lrange('anthropic:latency_samples', 0, -1);
    const sorted = samples.map(Number).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    await redis.mset('anthropic:latency_p50_ms', p50, 'anthropic:latency_p95_ms', p95);
  });
}
```

### 7.4 Claude API panel UI

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🤖 Claude API (Anthropic)                    ● HEALTHY   [Detail]  │
│ claude-haiku-4-5 · claude-sonnet-4-6                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Real-time (last 60s)                                               │
│ Requests/min: 23 / 60    ████████░░░░░░ 38%   Latency P50:  420ms │
│ Input TPM:   12,400                            Latency P95: 1,240ms│
│ Output TPM:   5,800       Error rate: 0.2%   Last error: 4h ago   │
│                                                                     │
│ Monthly quota (May 2026)                                           │
│ Tokens used: 42.1M / 100M   ████████████░░░░░░░░ 42%             │
│ Haiku: 38.4M (91%)   Sonnet: 3.7M (9%)                           │
│ Estimated month-end: 68M (within quota)                           │
│                                                                     │
│ Today by college                                                    │
│ MSRIT Medical     8.4M tokens    PESCE Eng     3.1M tokens        │
│ Dayananda Eng     6.2M tokens    JSS Medical   2.8M tokens        │
│ KLE Medical       4.8M tokens    SJCE Eng      1.9M tokens        │
│                                                                     │
│ [30d trend ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~]                    │
│                                          Last probe: 45 sec ago   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. F-15-D: OpenAI Embeddings Usage Panel

### 8.1 What we measure

Same Redis-counter approach as Anthropic. The OpenAI embedding probe reads from Redis counters maintained by the `embedding.service.ts` wrapper.

**Additional OpenAI-specific metrics:**
- Batch vs real-time split (ingestion = batch; chat = real-time)
- Tokens embedded per document ingestion vs per student query

```typescript
// services/api/src/jobs/probes/openai.probe.ts

export async function runOpenAIProbe() {
  // Same Redis-reading pattern as Anthropic
  // Keys: openai:rpm_window, openai:tpm_window, openai:errors_1h, etc.

  // Additional split: ingestion vs real-time usage
  const ingestTokensToday = parseInt(await redis.get(`openai:ingest_tokens:${getDateString()}`) || '0');
  const queryTokensToday = parseInt(await redis.get(`openai:query_tokens:${getDateString()}`) || '0');

  // Monthly from cost_events
  const monthlyUsage = await platformDb.cost_events.aggregate([
    { $match: { service: 'openai_embeddings', billing_month: getBillingMonth() } },
    { $group: {
      _id: '$action_type',
      total_tokens: { $sum: '$embedding_tokens' }
    }}
  ]).toArray();

  // Build metrics object and save snapshot
  // Fire rate limit alert if last_error_code === '429'
}
```

### 8.2 OpenAI panel UI

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🧠 OpenAI Embeddings                         ● HEALTHY   [Detail]  │
│ text-embedding-3-small                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Real-time (last 60s)                                               │
│ Requests/min: 8 / 3000   ░░░░░░░░░░░░░░░░ 0.3%  Latency P50:  95ms│
│ Tokens/min: 6,200                           Error rate: 0.0%      │
│                                                                     │
│ Today's usage                                                       │
│ Total tokens:       2.4M                                           │
│ Ingestion (bulk):   1.8M (75%)   — document uploads               │
│ Real-time (query):  0.6M (25%)   — student chat queries            │
│                                                                     │
│ Monthly (May 2026)                                                  │
│ Total: 18.2M tokens   ████░░░░░░░░░░░░ 18%  (limit: 100M)        │
│ Est. month-end: 31M   Cost: $0.36                                  │
│                                                                     │
│ Today by trigger                                                    │
│ Doc ingestion (new uploads)    1.84M   Student chat queries  0.56M │
│                                                                     │
│ [30d trend ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~]                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. F-15-E: Pinecone Vector DB Usage Panel

### 9.1 What we measure

Pinecone exposes a management API (`api.pinecone.io/indexes`) that returns:
- Index size in GB
- Total vector count
- Dimension and metric type
- Pod status (ready/not ready)
- Replica status

We extend this with our own namespace-level tracking: we know which namespace corresponds to which college and department (using our naming convention `c_{cid}_d_{did}`), so we can break down vector counts by college.

```typescript
// services/api/src/jobs/probes/pinecone.probe.ts

import { Pinecone } from '@pinecone-database/pinecone';

export async function runPineconeProbe() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const probeStart = Date.now();

  // 1. Index-level stats
  const indexDescription = await pc.describeIndex(process.env.PINECONE_INDEX_NAME!);
  const indexStats = await pc.index(process.env.PINECONE_INDEX_NAME!).describeIndexStats();

  const totalVectors = indexStats.totalVectorCount ?? 0;
  const dimensionCount = indexDescription.dimension;
  const storageGb = (totalVectors * dimensionCount * 4) / (1024 ** 3); // 4 bytes per float32

  const podStatus = indexDescription.status?.state ?? 'unknown';
  const isReady = indexDescription.status?.ready ?? false;

  // 2. Namespace breakdown — map namespace → college/dept
  const namespaceStats = indexStats.namespaces ?? {};
  const colleges = await platformDb.colleges.find({ status: 'active' }).toArray();
  const namespaceBreakdown: Array<{
    college_name: string;
    dept_name: string;
    namespace: string;
    vector_count: number;
    storage_mb: number;
  }> = [];

  for (const [namespace, nsData] of Object.entries(namespaceStats)) {
    // Parse namespace: "c_{cid}_d_{did}" or "c_{cid}_d_{did}_pyq"
    const match = namespace.match(/^c_([^_]+(?:_[^_]+)*)_d_([^_]+(?:_[^_]+)*)(_pyq)?$/);
    if (!match) continue;

    const collegeId = match[1];
    const deptId = match[2];
    const isPyq = !!match[3];

    const college = colleges.find(c => c._id.toString() === collegeId);
    if (!college) continue;

    let deptName = 'Unknown';
    try {
      const dept = await getCollegeDb(collegeId).collection('departments').findOne({ _id: deptId });
      deptName = dept?.name ?? 'Unknown';
    } catch { /* skip */ }

    const vecCount = (nsData as any).vectorCount ?? 0;
    namespaceBreakdown.push({
      college_name: college.name,
      dept_name: isPyq ? `${deptName} (PYQ)` : deptName,
      namespace,
      vector_count: vecCount,
      storage_mb: (vecCount * dimensionCount * 4) / (1024 ** 2),
    });
  }

  // Sort by vector count descending
  namespaceBreakdown.sort((a, b) => b.vector_count - a.vector_count);

  // 3. Real-time RU usage from Redis (updated by pinecone.service.ts wrapper)
  const ruReadToday = parseInt(await redis.get(`pinecone:ru_read:${getDateString()}`) || '0');
  const ruWriteToday = parseInt(await redis.get(`pinecone:ru_write:${getDateString()}`) || '0');
  const queryLatencyP50 = parseInt(await redis.get('pinecone:latency_p50_ms') || '0');
  const queryLatencyP95 = parseInt(await redis.get('pinecone:latency_p95_ms') || '0');

  // 4. Storage % calculation
  const storageLimit = parseFloat(process.env.PINECONE_STORAGE_LIMIT_GB || '10');
  const storagePct = (storageGb / storageLimit) * 100;

  const metrics = {
    total_vectors: totalVectors,
    storage_gb: storageGb,
    storage_pct: storagePct,
    storage_limit_gb: storageLimit,
    pod_status: podStatus,
    is_ready: isReady,
    dimension: dimensionCount,
    namespace_count: Object.keys(namespaceStats).length,
    namespace_breakdown: namespaceBreakdown.slice(0, 20), // top 20
    ru_read_today: ruReadToday,
    ru_write_today: ruWriteToday,
    query_latency_ms: queryLatencyP50,
    query_latency_p95_ms: queryLatencyP95,
  };

  const { status, reasons } = computeHealth('pinecone', {
    storage_pct: storagePct,
    query_latency_ms: queryLatencyP50,
  });

  // Critical: pod not ready
  const healthStatus = !isReady ? 'critical' : status;
  const healthReasons = !isReady ? ['Pinecone index is not in Ready state', ...reasons] : reasons;

  await saveSnapshot({
    service: 'pinecone',
    snapshot_type: 'platform',
    college_id: null,
    dept_id: null,
    metrics,
    health_status: healthStatus,
    health_reasons: healthReasons,
    probe_duration_ms: Date.now() - probeStart,
  });
}
```

### 9.2 Pinecone panel UI

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🌲 Pinecone Vector DB                        ● HEALTHY   [Detail]  │
│ Index: college-chatbot · 1,536 dims · cosine                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Index health: ● Ready                                              │
│ Total vectors: 4.82M    Storage: 2.84 GB / 10 GB  ████░░░░░░ 28%  │
│ Namespaces: 31           RU Read today: 184K   RU Write: 12K      │
│ Query latency P50: 42ms  P95: 118ms                               │
│                                                                     │
│ Top namespaces by vector count                                      │
│ MSRIT · Pharmacology         481K vectors   1.13 GB               │
│ MSRIT · Anatomy              412K vectors   0.97 GB               │
│ Dayananda · CSE              388K vectors   0.91 GB               │
│ KLE · Physiology             320K vectors   0.75 GB               │
│ MSRIT · Pharmacology (PYQ)    48K vectors   0.11 GB               │
│ Dayananda · ECE              296K vectors   0.70 GB               │
│ [... 25 more namespaces]                                           │
│                                                                     │
│ Storage projection: at current rate, 10GB limit in ~8 months      │
│                                                                     │
│ [30d trend ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~]                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. F-15-F: Local Disk & File Storage Panel

### 10.1 What we measure

The disk probe uses Node.js `child_process` to run `df` and `du` commands on the server.

```typescript
// services/api/src/jobs/probes/disk.probe.ts

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export async function runDiskProbe() {
  const probeStart = Date.now();
  const storageRoot = process.env.STORAGE_ROOT || '/app/storage';

  // 1. Overall disk stats (df)
  const dfOutput = execSync(`df -B1 ${storageRoot} 2>/dev/null || df -B1 /`).toString();
  const dfLine = dfOutput.trim().split('\n').slice(-1)[0].split(/\s+/);
  const diskTotalBytes = parseInt(dfLine[1]);
  const diskUsedBytes = parseInt(dfLine[2]);
  const diskFreeBytes = parseInt(dfLine[3]);
  const diskUsedPct = (diskUsedBytes / diskTotalBytes) * 100;

  // 2. Inode stats
  const inodeOutput = execSync(`df -i ${storageRoot} 2>/dev/null || df -i /`).toString();
  const inodeLine = inodeOutput.trim().split('\n').slice(-1)[0].split(/\s+/);
  const inodeUsedPct = parseFloat(inodeLine[4].replace('%', ''));

  // 3. Per-college storage breakdown using du
  const collegesDir = path.join(storageRoot, 'colleges');
  const collegeBreakdown: Array<{ college_id: string; used_bytes: number; used_gb: number }> = [];

  if (fs.existsSync(collegesDir)) {
    const collegeDirs = fs.readdirSync(collegesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const collegeId of collegeDirs) {
      const collegePath = path.join(collegesDir, collegeId);
      try {
        const duOutput = execSync(`du -sb ${collegePath} 2>/dev/null`).toString().split('\t')[0];
        const usedBytes = parseInt(duOutput);
        collegeBreakdown.push({
          college_id: collegeId,
          used_bytes: usedBytes,
          used_gb: usedBytes / (1024 ** 3),
        });
      } catch { /* skip inaccessible dirs */ }
    }
    collegeBreakdown.sort((a, b) => b.used_bytes - a.used_bytes);
  }

  // 4. Sub-directory breakdown for top college
  const subDirBreakdown: Record<string, number> = {};
  if (collegeBreakdown.length > 0) {
    const topCollegeDir = path.join(collegesDir, collegeBreakdown[0].college_id);
    const subDirs = ['uploads', 'thumbnails', 'text_cache', 'transcripts', 'temp'];
    for (const subDir of subDirs) {
      const subPath = path.join(topCollegeDir, subDir);
      if (fs.existsSync(subPath)) {
        const duOut = execSync(`du -sb ${subPath} 2>/dev/null`).toString().split('\t')[0];
        subDirBreakdown[subDir] = parseInt(duOut);
      }
    }
  }

  const metrics = {
    disk_total_gb: diskTotalBytes / (1024 ** 3),
    disk_used_gb: diskUsedBytes / (1024 ** 3),
    disk_free_gb: diskFreeBytes / (1024 ** 3),
    disk_used_pct: diskUsedPct,
    inode_used_pct: inodeUsedPct,
    college_breakdown: collegeBreakdown,
    top_college_subdir_breakdown: subDirBreakdown,
    storage_root: storageRoot,
  };

  const { status, reasons } = computeHealth('disk', {
    used_pct: diskUsedPct,
    inode_used_pct: inodeUsedPct,
  });

  await saveSnapshot({
    service: 'local_disk',
    snapshot_type: 'platform',
    college_id: null,
    dept_id: null,
    metrics,
    health_status: status,
    health_reasons: reasons,
    probe_duration_ms: Date.now() - probeStart,
  });
}
```

### 10.2 Disk panel UI

```
┌─────────────────────────────────────────────────────────────────────┐
│ 💾 Local File Storage                        ⚠ WARNING   [Detail]  │
│ /app/storage · 500 GB volume                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Disk: 182 GB used / 500 GB   ████████████████░░░░░░░░░  36%       │
│ Free: 318 GB                  Inodes: 12% used                     │
│                                                                     │
│ By college                                                          │
│ MSRIT Medical          68.4 GB  ████████████████████████░░  38%   │
│ Dayananda Engineering  42.1 GB  ███████████████░░░░░░░░░░░  23%   │
│ KLE Medical            28.3 GB  ██████████░░░░░░░░░░░░░░░░  16%   │
│ PESCE Engineering      18.9 GB  ███████░░░░░░░░░░░░░░░░░░░  10%   │
│ JSS Medical            14.2 GB  █████░░░░░░░░░░░░░░░░░░░░░   8%   │
│ SJCE Engineering       10.1 GB  ████░░░░░░░░░░░░░░░░░░░░░░   6%   │
│                                                                     │
│ MSRIT Medical breakdown                                             │
│ uploads/      54.2 GB (79%)   text_cache/   8.1 GB (12%)          │
│ transcripts/   4.8 GB  (7%)   thumbnails/   1.2 GB  (2%)          │
│ temp/          0.1 GB  (0%)                                        │
│                                                                     │
│ Projection: at current growth (+2.1 GB/day), full in 151 days     │
│                                                                     │
│ [30d growth trend ~~~~~~~~~~~~~~~~~~~~~~~~~~~]                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 11. F-15-G: Redis Usage Panel

### 11.1 What we measure

Redis `INFO` command returns comprehensive stats. We run it via the existing `ioredis` connection.

```typescript
// services/api/src/jobs/probes/redis.probe.ts

export async function runRedisProbe() {
  const probeStart = Date.now();

  // INFO command returns a string — parse key-value pairs
  const info = await redis.info();
  const parsed: Record<string, string> = {};
  info.split('\r\n').forEach(line => {
    const [key, value] = line.split(':');
    if (key && value) parsed[key.trim()] = value.trim();
  });

  const memUsedMb = parseInt(parsed['used_memory'] || '0') / (1024 ** 2);
  const memMaxMb = parseInt(parsed['maxmemory'] || '0') / (1024 ** 2);
  const memUsedPct = memMaxMb > 0 ? (memUsedMb / memMaxMb) * 100 : 0;
  const connectedClients = parseInt(parsed['connected_clients'] || '0');
  const maxClients = parseInt(process.env.REDIS_MAXCLIENTS || '100');
  const hitRate = parseFloat(parsed['keyspace_hits'] || '0') /
    Math.max(1, parseFloat(parsed['keyspace_hits'] || '0') + parseFloat(parsed['keyspace_misses'] || '0'));

  // BullMQ queue depths
  const queueNames = ['ingestion_jobs', 'chapter_extraction', 'pyq_ingestion', 'telemetry_alerts'];
  const queueDepths: Record<string, { waiting: number; active: number; failed: number }> = {};

  for (const queueName of queueNames) {
    try {
      const waiting = await redis.llen(`bull:${queueName}:wait`);
      const active = await redis.llen(`bull:${queueName}:active`);
      const failed = await redis.llen(`bull:${queueName}:failed`);
      queueDepths[queueName] = { waiting, active, failed };
    } catch { /* queue doesn't exist */ }
  }

  const totalQueueDepth = Object.values(queueDepths)
    .reduce((sum, q) => sum + q.waiting + q.active, 0);

  const metrics = {
    memory_used_mb: memUsedMb,
    memory_max_mb: memMaxMb,
    memory_used_pct: memUsedPct,
    connected_clients: connectedClients,
    connected_clients_pct: (connectedClients / maxClients) * 100,
    keyspace_hit_rate_pct: hitRate * 100,
    total_keys: parseInt(parsed['db0']?.match(/keys=(\d+)/)?.[1] || '0'),
    uptime_days: parseInt(parsed['uptime_in_days'] || '0'),
    queue_depths: queueDepths,
    total_queue_depth: totalQueueDepth,
    ops_per_sec: parseInt(parsed['instantaneous_ops_per_sec'] || '0'),
  };

  const { status, reasons } = computeHealth('redis', {
    memory_used_pct: memUsedPct,
    queue_depth: totalQueueDepth,
    connected_clients_pct: metrics.connected_clients_pct,
  });

  await saveSnapshot({
    service: 'redis',
    snapshot_type: 'platform',
    college_id: null,
    dept_id: null,
    metrics,
    health_status: status,
    health_reasons: reasons,
    probe_duration_ms: Date.now() - probeStart,
  });
}
```

### 11.2 Redis panel UI

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🔴 Redis Cache & Queue                       ● HEALTHY   [Detail]  │
│ Uptime: 47 days                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Memory: 284 MB / 512 MB   ████████████████░░░░░░░ 55%             │
│ Clients: 18 / 100   18%   Keys: 42,810   Hit rate: 94.2%          │
│ Ops/sec: 820                                                        │
│                                                                     │
│ BullMQ Queue Status                                                 │
│ ingestion_jobs      ● 2 waiting · 1 active · 0 failed             │
│ chapter_extraction  ● 0 waiting · 0 active · 0 failed             │
│ pyq_ingestion       ● 5 waiting · 2 active · 0 failed             │
│ telemetry_alerts    ● 0 waiting · 0 active · 0 failed             │
│                                                                     │
│ Notable keys (by size)                                              │
│ anthropic:rpm_window     (sorted set, 23 entries)                  │
│ srs:due_cache:*          (480 student caches, expires hourly)      │
│ disease_query:cache:*    (18 cached disease results)               │
│                                                                     │
│ [24h memory trend ~~~~~~~~~~~~~~~~~~~~~~~~~~~]                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 12. F-15-H: The Unified Observatory Screen

### 12.1 Full screen layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🧠 EduMind AI Console    [Colleges] [Policies] [Observatory ●] [Reports] [Settings]    [SK] │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  UNIFIED USAGE OBSERVATORY                    [⟳ Auto-refresh: ON]  [Export]  May 20, 2026 │
│  6 colleges · 28 departments · 1,247 active students                                        │
│                                                                                              │
│  System Status: ● ALL SYSTEMS OPERATIONAL                   Last updated: 23 seconds ago     │
│  ─────────────────────────────────────────────────────────────────────────────────────────── │
│                                                                                              │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐│
│  │ 🍃 MongoDB               │  │ 🤖 Claude API             │  │ 🧠 OpenAI Embeddings      ││
│  │ ● HEALTHY                │  │ ● HEALTHY                 │  │ ● HEALTHY                 ││
│  │                          │  │                           │  │                           ││
│  │ Storage  4.2/50 GB   8%  │  │ RPM  23/60   38%         │  │ RPM   8/3000  0.3%        ││
│  │ Docs     2.4M            │  │ TPM  18,200              │  │ TPM   6,200               ││
│  │ Latency  18ms            │  │ P50  420ms               │  │ P50   95ms                ││
│  │ Conns    24/200  12%     │  │ Err  0.2%                │  │ Err   0.0%                ││
│  │                          │  │                           │  │                           ││
│  │ ~~~ 24h trend ~~~~       │  │ ~~~ 24h trend ~~~~        │  │ ~~~ 24h trend ~~~~        ││
│  │              [Detail →]  │  │              [Detail →]   │  │              [Detail →]   ││
│  └───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘│
│                                                                                              │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐│
│  │ 🌲 Pinecone VectorDB     │  │ 💾 Local Disk             │  │ 🔴 Redis                  ││
│  │ ● HEALTHY                │  │ ⚠ WARNING                 │  │ ● HEALTHY                 ││
│  │                          │  │                           │  │                           ││
│  │ Vectors  4.82M           │  │ Used  182/500 GB   36%   │  │ Memory  284/512 MB  55%   ││
│  │ Storage  2.84/10 GB  28% │  │ Free  318 GB             │  │ Clients   18/100   18%    ││
│  │ Namespaces  31           │  │ Inodes  12%              │  │ Queues  10 jobs pending   ││
│  │ Q.Latency  42ms          │  │ ⚠ MSRIT: 38% of total   │  │ Hit rate  94.2%           ││
│  │ RU Read  184K today      │  │                           │  │                           ││
│  │                          │  │ Proj: full in 151 days   │  │                           ││
│  │ ~~~ 24h trend ~~~~       │  │ ~~~ 24h trend ~~~~        │  │ ~~~ 24h trend ~~~~        ││
│  │              [Detail →]  │  │              [Detail →]   │  │              [Detail →]   ││
│  └───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘│
│                                                                                              │
│  Active Alerts (2)                                                                          │
│  ─────────────────────────────────────────────────────────────────────────────────────────── │
│  ⚠  Local Disk · MSRIT Medical using 38% of total platform disk · Consider storage policy   │
│  ℹ  Pinecone · Storage at 28% — projection: 10GB limit reached in ~8 months                │
│                                                                     [View all 2 alerts →]   │
│                                                                                              │
│  Usage by College (Live)                                                                     │
│  ─────────────────────────────────────────────────────────────────────────────────────────── │
│  College            Claude RPM   Embed TPM   Vectors    Disk     MongoDB   Students Online   │
│  MSRIT Medical         9          2,100      1.2M      68.4 GB   1.2 GB         142         │
│  Dayananda Eng         6          1,400       820K      42.1 GB   0.9 GB         98          │
│  KLE Medical           4            980       680K      28.3 GB   0.7 GB          71          │
│  PESCE Eng             2            520       440K      18.9 GB   0.5 GB          34          │
│  JSS Medical           1            280       280K      14.2 GB   0.5 GB          18          │
│  SJCE Eng              1            220       380K      10.1 GB   0.4 GB          12          │
│                                                              [Drilldown: pick college →]    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 12.2 The "All Systems Operational" banner

The top-level status banner is computed from the worst health status across all six services:

```javascript
function computeOverallStatus(snapshots) {
  const statuses = snapshots.map(s => s.health_status);
  if (statuses.includes('critical')) {
    return { status: 'DEGRADED', color: 'red', icon: '🔴' };
  }
  if (statuses.includes('warning')) {
    return { status: 'SOME SYSTEMS DEGRADED', color: 'amber', icon: '⚠️' };
  }
  return { status: 'ALL SYSTEMS OPERATIONAL', color: 'green', icon: '●' };
}
```

### 12.3 Auto-refresh mechanism

The Observatory page uses Server-Sent Events (SSE) for live updates — the same pattern used in the student chat. A persistent SSE connection streams updated panel data every 60 seconds without page reload.

```typescript
// GET /api/v1/super-admin/observatory/stream
// SSE endpoint — pushes updated snapshot data every 60 seconds

async function observatoryStream(req, reply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendSnapshot = async () => {
    const latestSnapshots = await getLatestSnapshots();  // one per service
    const overallStatus = computeOverallStatus(latestSnapshots);
    const activeAlerts = await getActiveAlerts();
    const collegeMatrix = await getLiveCollegeMatrix();

    reply.raw.write(`data: ${JSON.stringify({
      type: 'observatory_update',
      snapshots: latestSnapshots,
      overall_status: overallStatus,
      active_alerts: activeAlerts,
      college_matrix: collegeMatrix,
      updated_at: new Date().toISOString(),
    })}\n\n`);
  };

  // Send immediately on connect
  await sendSnapshot();

  // Then every 60 seconds
  const interval = setInterval(sendSnapshot, 60000);

  // Clean up on client disconnect
  req.raw.on('close', () => clearInterval(interval));
}
```

---

## 13. F-15-I: Real-Time Alerts & Anomaly Detection

### 13.1 Alert firing logic

Alerts are fired by the probe functions after computing health status. To prevent alert spam, we implement deduplication: if an alert of the same `alert_type` is already `active`, we update its `last_fired_at` instead of creating a new document.

```typescript
async function fireAlert(params: AlertParams) {
  const existingAlert = await observatoryAlertsCollection.findOne({
    alert_type: params.alert_type,
    college_id: params.college_id || null,
    status: 'active'
  });

  if (existingAlert) {
    // Update existing alert
    await observatoryAlertsCollection.updateOne(
      { _id: existingAlert._id },
      { $set: { last_fired_at: new Date(), metric_value: params.metric_value } }
    );
    return;
  }

  // Create new alert
  const alert = {
    _id: generateUUID(),
    ...params,
    status: 'active',
    first_fired_at: new Date(),
    last_fired_at: new Date(),
    notification_sent: false,
  };

  await observatoryAlertsCollection.insertOne(alert);

  // Send email for warning and critical severity
  if (params.severity !== 'info') {
    await sendAlertEmail(alert);
  }
}
```

### 13.2 Anomaly detection — sudden usage spikes

In addition to threshold-based alerts, we run a simple anomaly detector on the 1-minute Anthropic and OpenAI snapshots:

```typescript
// Spike detection: if current RPM > 3× rolling 7-day average RPM for this hour
async function detectSpike(service: string, currentValue: number, metric: string) {
  const hourOfDay = new Date().getHours();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // Get historical values for the same hour of day, last 7 days
  const historicalSnapshots = await serviceSnapshotsCollection.find({
    service,
    snapshot_type: 'platform',
    captured_at: { $gte: sevenDaysAgo },
    // Filter to same hour: use $expr + $hour
    $expr: { $eq: [{ $hour: '$captured_at' }, hourOfDay] }
  }).toArray();

  if (historicalSnapshots.length < 5) return; // not enough data

  const historicalValues = historicalSnapshots.map(s => s.metrics[metric] ?? 0);
  const rollingAvg = historicalValues.reduce((sum, v) => sum + v, 0) / historicalValues.length;
  const stdDev = Math.sqrt(historicalValues.reduce((sum, v) => sum + (v - rollingAvg) ** 2, 0) / historicalValues.length);

  // Spike: current > avg + 3× stdDev (3-sigma rule)
  if (currentValue > rollingAvg + 3 * stdDev && currentValue > rollingAvg * 2) {
    await fireAlert({
      alert_type: 'platform_wide_degradation',
      severity: 'warning',
      service,
      title: `Unusual ${metric} spike on ${service}`,
      message: `Current ${metric}: ${currentValue} vs 7-day avg for this hour: ${Math.round(rollingAvg)}. This is ${Math.round(currentValue / rollingAvg)}× normal.`,
      metric_name: metric,
      metric_value: currentValue,
      threshold_value: rollingAvg * 2,
      unit: '',
    });
  }
}
```

### 13.3 Auto-resolution

Alerts auto-resolve when the condition clears:

```typescript
// Run after each probe — check if active alerts for this service have cleared
async function checkAlertResolution(service: string, currentHealth: string) {
  if (currentHealth === 'healthy') {
    await observatoryAlertsCollection.updateMany(
      { service, status: 'active', severity: { $in: ['warning', 'info'] } },
      { $set: { status: 'auto_resolved', resolved_at: new Date(), auto_resolved: true } }
    );
  }
  // Critical alerts require manual acknowledgement — never auto-resolve
}
```

---

## 14. F-15-J: Usage Drill-Down — College & Department

### 14.1 College drill-down page

`GET /super-admin/observatory/college/:collegeId`

Shows the same six service panels but filtered to one college's contribution:
- MongoDB: that college's DB stats
- Anthropic/OpenAI: tokens used by that college (from cost_events, grouped by college_id)
- Pinecone: namespaces belonging to that college
- Disk: that college's folder size
- Redis: SRS queue and session cache keys belonging to that college's students

### 14.2 Department drill-down page

`GET /super-admin/observatory/college/:collegeId/dept/:deptId`

Narrowest drilldown:
- Pinecone: one namespace `c_{cid}_d_{did}` — vector count, storage, query latency
- Anthropic/OpenAI: tokens from `cost_events` filtered by `dept_id`
- Disk: `storage/colleges/{cid}/uploads/{deptId}/` size
- MongoDB: documents and sessions belonging to this dept

### 14.3 Drill-down UI (college level)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← Observatory    MSRIT Medical College — Usage Detail    Live                        │
│                                                                                      │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐                  │
│  │ 🍃 MongoDB (MSRIT DB)      │  │ 🤖 Claude API (MSRIT)       │                  │
│  │ Storage: 1.2 GB / 10 GB    │  │ Tokens today: 8.4M          │                  │
│  │ Documents: 284,000         │  │ RPM now: 9                  │                  │
│  │ Largest coll: query_logs   │  │ Error rate: 0.1%            │                  │
│  └─────────────────────────────┘  └─────────────────────────────┘                  │
│                                                                                      │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐                  │
│  │ 🌲 Pinecone (MSRIT NS)     │  │ 💾 Disk (MSRIT)             │                  │
│  │ Namespaces: 6              │  │ Used: 68.4 GB               │                  │
│  │ Vectors: 1.2M              │  │ Uploads: 54.2 GB (79%)      │                  │
│  │ Storage: 0.71 GB           │  │ Text cache: 8.1 GB (12%)    │                  │
│  └─────────────────────────────┘  └─────────────────────────────┘                  │
│                                                                                      │
│  By Department                                                                       │
│  Dept         Claude Tokens  Pinecone Vecs  Disk     Students  [Drilldown]         │
│  Pharmacology    3.1M          481K          22.1 GB    48      →                   │
│  Anatomy         2.2M          412K          18.4 GB    38      →                   │
│  Physiology      1.4M          198K          12.2 GB    29      →                   │
│  Pathology       1.0M          109K           9.8 GB    22      →                   │
│  General (FB)    0.7M           --            5.9 GB    --      →                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 15. Telemetry Collection Jobs

### Summary of all jobs

| Job | Frequency | What it does |
|---|---|---|
| `runAnthropicProbe` | Every 1 min | Read Redis counters → save platform snapshot |
| `runOpenAIProbe` | Every 1 min | Read Redis counters → save platform snapshot |
| `runMongoProbe` | Every 5 min | dbStats per college DB → save college snapshots |
| `runPineconeProbe` | Every 5 min | describeIndexStats → save platform snapshot + namespace breakdown |
| `runRedisProbe` | Every 5 min | Redis INFO + queue depths → save platform snapshot |
| `runDiskProbe` | Every 15 min | df + du per college dir → save platform + college snapshots |
| `checkAlertResolution` | After each probe | Auto-resolve cleared alerts |
| `detectSpike` | After Anthropic/OpenAI probe | 3-sigma anomaly detection |
| `rebuildDailyUsageRollups` | Nightly 1 AM | Aggregate snapshots → daily_usage_rollups |
| `snapshotTTLCleanup` | Handled by MongoDB TTL index | Auto-deletes old service_snapshots |

---

## 16. API Route Map

All routes require `role: super_admin` JWT.

```
# Observatory main
GET    /api/v1/super-admin/observatory                     (current snapshot of all 6 services)
GET    /api/v1/super-admin/observatory/stream             (SSE — live updates every 60s)
GET    /api/v1/super-admin/observatory/history?days=30    (daily rollups for trend charts)

# Per-service detail
GET    /api/v1/super-admin/observatory/mongodb
GET    /api/v1/super-admin/observatory/anthropic
GET    /api/v1/super-admin/observatory/openai
GET    /api/v1/super-admin/observatory/pinecone
GET    /api/v1/super-admin/observatory/disk
GET    /api/v1/super-admin/observatory/redis

# College and dept drilldown
GET    /api/v1/super-admin/observatory/college/:collegeId
GET    /api/v1/super-admin/observatory/college/:collegeId/dept/:deptId

# Alerts
GET    /api/v1/super-admin/observatory/alerts             ?status=active|resolved&service=&severity=
PUT    /api/v1/super-admin/observatory/alerts/:alertId/acknowledge
PUT    /api/v1/super-admin/observatory/alerts/:alertId/resolve

# Rate table management (update when vendor pricing changes)
GET    /api/v1/super-admin/observatory/rate-table
PUT    /api/v1/super-admin/observatory/rate-table/:service

# Thresholds management (customise health thresholds)
GET    /api/v1/super-admin/observatory/thresholds
PUT    /api/v1/super-admin/observatory/thresholds/:service   (update warning/critical thresholds)

# Manual probe trigger (for testing / immediate refresh)
POST   /api/v1/super-admin/observatory/probe/:service        (trigger on-demand probe)

# Export
GET    /api/v1/super-admin/observatory/export?format=csv&days=30   (CSV download)
```

---

## 17. Frontend Component Tree

```
apps/super-admin/app/dashboard/observatory/
├── page.tsx                              # Main observatory page
├── [service]/
│   └── page.tsx                         # Per-service detail page
└── college/
    └── [collegeId]/
        ├── page.tsx                     # College drilldown
        └── dept/
            └── [deptId]/
                └── page.tsx             # Dept drilldown

apps/super-admin/components/observatory/
├── ObservatoryGrid.tsx                  # 2×3 panel grid layout
├── SystemStatusBanner.tsx               # "ALL SYSTEMS OPERATIONAL" header
├── ObservatorySSEConsumer.tsx           # SSE connection + state management
├── panels/
│   ├── BasePanel.tsx                    # Shared panel wrapper (health indicator, title, detail link)
│   ├── MongoDBPanel.tsx
│   ├── AnthropicPanel.tsx
│   ├── OpenAIPanel.tsx
│   ├── PineconePanel.tsx
│   ├── DiskPanel.tsx
│   └── RedisPanel.tsx
├── shared/
│   ├── HealthBadge.tsx                  # ● HEALTHY / ⚠ WARNING / 🔴 CRITICAL
│   ├── UsageBar.tsx                     # [████░░░] 42% progress bar
│   ├── Sparkline.tsx                    # 24h mini trend chart (SVG, no library)
│   ├── ProjectionLabel.tsx              # "Full in 151 days" computed label
│   └── LastUpdatedLabel.tsx            # "Last probe: 45 seconds ago"
├── alerts/
│   ├── AlertsPanel.tsx                  # Alert log strip below grid
│   ├── AlertRow.tsx                     # Individual alert row
│   └── AlertsBadge.tsx                  # Count badge on nav item
├── matrix/
│   └── CollegeUsageMatrix.tsx           # Multi-column live college table
└── drilldown/
    ├── CollegeDrilldown.tsx
    └── DeptDrilldown.tsx
```

---

## 18. Environment Variables

```bash
# Addition to services/api/.env

# Telemetry probe schedules (cron format)
TELEMETRY_LLM_CRON=* * * * *               # every 1 minute
TELEMETRY_DB_CRON=*/5 * * * *              # every 5 minutes
TELEMETRY_DISK_CRON=*/15 * * * *           # every 15 minutes
TELEMETRY_ROLLUP_CRON=0 1 * * *            # 1 AM nightly

# Health thresholds — override defaults
THRESHOLD_MONGO_STORAGE_WARN=70            # % warning
THRESHOLD_MONGO_STORAGE_CRITICAL=85
THRESHOLD_DISK_USED_WARN=75
THRESHOLD_DISK_USED_CRITICAL=90
THRESHOLD_ANTHROPIC_ERROR_RATE_WARN=2      # %
THRESHOLD_ANTHROPIC_ERROR_RATE_CRITICAL=10
THRESHOLD_ANTHROPIC_RPM_WARN=70            # % of limit
THRESHOLD_PINECONE_STORAGE_WARN=75
THRESHOLD_PINECONE_STORAGE_CRITICAL=90
THRESHOLD_REDIS_MEMORY_WARN=70
THRESHOLD_REDIS_MEMORY_CRITICAL=85

# Capacity limits (for % calculation)
ANTHROPIC_RPM_LIMIT=60
ANTHROPIC_MONTHLY_TOKEN_LIMIT=100000000    # 100M tokens
OPENAI_RPM_LIMIT=3000
OPENAI_MONTHLY_TOKEN_LIMIT=500000000       # 500M tokens
PINECONE_STORAGE_LIMIT_GB=10
MONGO_PLATFORM_STORAGE_LIMIT_GB=5
MONGO_COLLEGE_STORAGE_LIMIT_GB=10          # per college
REDIS_MAXCLIENTS=100

# BullMQ queue names (for depth monitoring)
BULLMQ_QUEUE_NAMES=ingestion_jobs,chapter_extraction,pyq_ingestion,telemetry_alerts

# Alert emails
OBSERVATORY_ALERT_EMAIL_TO=sudipta@edumindai.com
OBSERVATORY_ALERT_EMAIL_CC=ops@edumindai.com    # optional second recipient

# Snapshot retention
SNAPSHOT_TTL_1MIN_HOURS=24                 # keep 1-min snapshots for 24h
SNAPSHOT_TTL_5MIN_DAYS=7                   # keep 5-min snapshots for 7 days
SNAPSHOT_TTL_15MIN_DAYS=30                 # keep 15-min snapshots for 30 days
```

---

## 19. Build Order

Add as **Phase 13 — Unified Usage Observatory** after Phase 12 in main architecture doc:

```
Phase 13 — Unified Usage Observatory

Step 1 — Schema setup
  → Create service_snapshots collection + all indexes (including TTL index)
  → Create observatory_alerts collection + indexes
  → Create daily_usage_rollups collection + indexes
  → Verify: insert a test snapshot, confirm TTL index is active

Step 2 — Redis counter instrumentation (in existing services)
  → Add updateAnthropicMetrics() call to every Anthropic API call in llm.service.ts
  → Add updateOpenAIMetrics() call to every OpenAI embedding call in embedding.service.ts
  → Add updatePineconeMetrics() call to every Pinecone query/upsert in pinecone.service.ts
  → Verify: make a test LLM call → check Redis has anthropic:rpm_window entry

Step 3 — Probe functions
  → services/api/src/jobs/probes/health.ts  (shared thresholds + computeHealth())
  → services/api/src/jobs/probes/mongo.probe.ts
  → services/api/src/jobs/probes/anthropic.probe.ts
  → services/api/src/jobs/probes/openai.probe.ts
  → services/api/src/jobs/probes/pinecone.probe.ts
  → services/api/src/jobs/probes/disk.probe.ts
  → services/api/src/jobs/probes/redis.probe.ts
  → Unit test each probe: verify output shape, verify health computation

Step 4 — Alert system
  → fireAlert() function with deduplication
  → checkAlertResolution() function
  → detectSpike() function (3-sigma anomaly)
  → sendAlertEmail() via existing email service (nodemailer)
  → Verify: manually trigger a warning condition → alert created → email sent

Step 5 — Telemetry runner + schedule
  → services/api/src/jobs/telemetry-runner.ts (cron jobs)
  → Register telemetry-runner as a startup process (not a background worker)
  → rebuildDailyUsageRollups() nightly job
  → Verify: wait 5 minutes → check service_snapshots has entries for all 6 services

Step 6 — API routes
  → GET /observatory (aggregate latest snapshot per service)
  → GET /observatory/stream (SSE — 60s updates)
  → GET /observatory/:service (per-service detail)
  → GET /observatory/college/:cid + /college/:cid/dept/:did
  → GET /observatory/alerts + PUT /alerts/:id/acknowledge
  → POST /observatory/probe/:service (manual trigger)
  → GET /observatory/export (CSV)

Step 7 — Frontend
  → ObservatorySSEConsumer.tsx (SSE connection state)
  → BasePanel.tsx + HealthBadge.tsx + UsageBar.tsx + Sparkline.tsx
  → All 6 service panels (MongoDB, Anthropic, OpenAI, Pinecone, Disk, Redis)
  → SystemStatusBanner.tsx
  → ObservatoryGrid.tsx (2×3 layout)
  → AlertsPanel.tsx + AlertRow.tsx
  → CollegeUsageMatrix.tsx (live table at bottom)
  → Add "Observatory" nav item with alert count badge

Step 8 — Drilldown pages
  → CollegeDrilldown.tsx (per-service filtered to one college)
  → DeptDrilldown.tsx (narrowest level)

Step 9 — Threshold management UI
  → Settings page: editable thresholds per service
  → Live preview: "At this threshold, MSRIT would currently be in WARNING"

Step 10 — Testing
  → Verify auto-refresh: leave page open 5 minutes → observe 5 updates via SSE
  → Verify alert: set disk threshold to current usage value → alert fires within 15 min probe
  → Verify auto-resolution: raise threshold above current usage → alert auto-resolves
  → Verify spike detection: generate 10× normal RPM → anomaly alert fires
  → Verify drill-down: MSRIT college → Pharmacology dept → correct namespace vectors shown
  → Verify export: download 30-day CSV → all 6 services in columns
  → Verify TTL: check that 25h-old 1-minute snapshots are deleted by MongoDB TTL
```

---

*Document: F-15-unified-usage-observatory.md · v1.0 · May 2026*  
*Extends: F-12-super-admin-cost-intelligence.md v1.0 · college-chatbot-architecture.md v2.0*  
*Distinction from F-12: F-12 = financial cost tracking. F-15 = operational infrastructure health. Both are needed; neither replaces the other.*  
*For Claude Code: Phase 13, 10 steps. Start with Step 2 (Redis instrumentation) — without live counters, the Anthropic and OpenAI panels have no real-time data. Step 3 (probes) depends on Step 2.*
