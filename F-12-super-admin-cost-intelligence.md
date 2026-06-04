# F-12: Super Admin Portal
## Login · Cost Policy Engine · Third-Party Usage Intelligence

> **Parent doc:** `college-chatbot-architecture.md` v2.0  
> **Scope:** Super Admin login screen, token/cost policy definition per college and per dept, real-time third-party cost tracking dashboard (Anthropic LLM · OpenAI Embeddings · Cohere Reranking · Pinecone · Local Storage) at platform → college → department granularity  
> **Who uses this:** Only your team (Super Admin role). No college-level user ever accesses this portal.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [Feature Overview & Mental Model](#1-feature-overview--mental-model)
2. [Third-Party Services to Track](#2-third-party-services-to-track)
3. [Database Schema](#3-database-schema)
4. [F-12-A: Super Admin Login Screen](#4-f-12-a-super-admin-login-screen)
5. [F-12-B: Cost Policy Engine](#5-f-12-b-cost-policy-engine)
6. [F-12-C: Usage Metering — How We Capture Costs](#6-f-12-c-usage-metering--how-we-capture-costs)
7. [F-12-D: Super Admin Dashboard — Platform Overview](#7-f-12-d-super-admin-dashboard--platform-overview)
8. [F-12-E: College-Level Cost Drilldown](#8-f-12-e-college-level-cost-drilldown)
9. [F-12-F: Department-Level Cost Drilldown](#9-f-12-f-department-level-cost-drilldown)
10. [F-12-G: Cost Plan Builder](#10-f-12-g-cost-plan-builder)
11. [F-12-H: Alerts & Threshold Notifications](#11-f-12-h-alerts--threshold-notifications)
12. [API Route Map](#12-api-route-map)
13. [Frontend Component Tree](#13-frontend-component-tree)
14. [Environment Variables](#14-environment-variables)
15. [Build Order](#15-build-order)

---

## 1. Feature Overview & Mental Model

### Why this matters

Every student chat call costs money. Specifically:

| Action | Service billed | Unit cost (approx) |
|---|---|---|
| Student sends a message | Anthropic (Claude Haiku) | ~$0.00025 / 1K tokens |
| Embedding a query | OpenAI (text-embedding-3-small) | ~$0.00002 / 1K tokens |
| Ingesting a document | OpenAI (batch embeddings) | ~$0.00002 / 1K tokens |
| Reranking retrieved chunks | Cohere (rerank-english-v3) | ~$0.001 / 1K searches |
| Indexing vectors | Pinecone | ~$0.096 / 1M vectors/month |
| Storage (thumbnails, cache) | Local disk — capex, not opex | Track bytes, not $ |

Without systematic tracking, you have no way to: (1) know which college is eating your margin, (2) set per-college pricing confidently, (3) detect runaway usage before the credit card bill arrives, or (4) model what a new college will cost you.

This spec builds:
- **Cost metering** — every API call to every third party is logged with cost
- **Policy engine** — you define hard limits and soft warnings per college and per dept
- **Intelligence dashboard** — drill from platform → college → dept → individual student
- **Cost plan builder** — see your actual cost per college and set a profitable price

### The hierarchy of cost control

```
Platform (Super Admin sets global defaults)
└── College (Super Admin sets per-college limits, overrides defaults)
    └── Department (Super Admin or college owner sets per-dept limits, overrides college defaults)
        └── Student (subject to dept limits — no individual student controls, just rate limits)
```

When a request arrives, cost enforcement cascades:
```
Check dept limit → Check college limit → Check platform global limit → Allow / Deny
```

---

## 2. Third-Party Services to Track

### 2.1 Service inventory

| Service | API | What triggers cost | Unit | Approx price |
|---|---|---|---|---|
| Anthropic Claude Haiku | `/v1/messages` | Every student chat message; AI summaries | per 1K input+output tokens | $0.00025 input / $0.00125 output per 1K tokens |
| Anthropic Claude Sonnet | `/v1/messages` | Exam question generation | per 1K input+output tokens | $0.003 input / $0.015 output per 1K tokens |
| OpenAI Embeddings | `/v1/embeddings` | Query embedding (every chat) + document ingestion | per 1K tokens embedded | $0.00002 per 1K tokens |
| Cohere Rerank | `/v1/rerank` | Every chat query retrieval | per 1K searches | $0.001 per 1K searches |
| Pinecone | vector DB | Storage of embedded chunks (monthly) + queries | per 1M RUs (read units) + storage GB | ~$0.096/1M RUs; $0.35/GB/month |
| Local Storage | disk | File uploads, thumbnails, text caches | GB stored | Track as bytes — no direct $ cost but disk capacity matters |

### 2.2 Cost attribution model

Every cost event is attributed along four dimensions:
```
college_id → dept_id → action_type → service
```

This means you can answer:
- "How much did MSRIT spend on Anthropic this month?" → filter by college_id + service=anthropic
- "Which department in MSRIT generates the most Cohere costs?" → filter by college_id, group by dept_id, service=cohere
- "What does a typical student chat query cost end-to-end?" → sum all services for action_type=chat_message
- "What is our gross margin on the Department tier (₹3,999/mo)?" → compare plan_price vs actual_cost_per_college

---

## 3. Database Schema

### 3.1 Platform DB additions

```js
// platform_admins collection (additions)
{
  _id: UUID,
  email: String,
  password_hash: String,
  role: "super_admin",
  name: String,
  avatar_initials: String,           // e.g. "SK"
  last_login: Date,
  mfa_secret: String,                // TOTP secret for 2FA (hashed)
  mfa_enabled: Boolean,
  failed_login_attempts: Number,
  locked_until: Date,                // null if not locked
  created_at: Date,
  updated_at: Date
}

// cost_policies collection (platform DB — one policy per target)
{
  _id: UUID,
  target_type: Enum["global", "college", "dept"],
  target_id: String,                 // "global" | college_id | dept_id
  college_id: String,                // null for global; dept's college_id for dept policies
  
  // LLM limits
  llm_token_limit_per_month: Number,             // total input+output tokens (Haiku + Sonnet combined)
  llm_token_soft_warn_pct: Number,               // default 80 — warn at 80% of limit
  llm_token_hard_stop: Boolean,                  // default true — stop at 100% of limit
  
  // Per-request limits (rate limiting)
  max_chat_queries_per_student_per_day: Number,  // default 50
  max_ai_summaries_per_student_per_day: Number,  // default 10
  max_exam_gen_per_student_per_day: Number,      // default 5
  
  // Model tier selection
  allowed_llm_models: [String],                  // ["claude-haiku-4-5-20251001"] or include sonnet
  embedding_model: String,                       // "text-embedding-3-small"
  
  // Cost budget (your internal cost ceiling — not the price charged to college)
  cost_budget_usd_per_month: Number,             // internal budget in USD
  cost_soft_warn_pct: Number,                    // default 75 — warn at 75% of budget
  
  // Storage limits
  storage_limit_gb: Number,                      // max local storage for this college/dept
  
  // Policy metadata
  notes: String,                                 // free text: why this limit was set
  created_by: UUID,                              // platform_admin_id
  created_at: Date,
  updated_at: Date
}

// cost_events collection (platform DB — every billable third-party call)
{
  _id: UUID,
  
  // Attribution
  college_id: String,
  dept_id: String,
  student_id: String,                // null for ingestion events (no student involved)
  session_id: String,                // null for non-chat events
  
  // Action context
  action_type: Enum[
    "chat_message",       // student sent a message
    "ai_summary",         // student triggered AI summary
    "exam_generation",    // student/admin triggered exam Q generator
    "doc_ingestion",      // faculty uploaded a document
    "query_embedding",    // embedding a student query
    "rerank",             // Cohere rerank call
    "pinecone_write",     // vector upsert
    "pinecone_read"       // vector query
  ],
  
  // Service details
  service: Enum["anthropic", "openai_embeddings", "cohere", "pinecone"],
  model: String,                     // e.g. "claude-haiku-4-5-20251001" or "text-embedding-3-small"
  
  // Token/unit counts
  input_tokens: Number,              // 0 for non-LLM services
  output_tokens: Number,             // 0 for non-LLM services
  total_tokens: Number,              // input + output
  embedding_tokens: Number,          // tokens embedded (OpenAI)
  rerank_units: Number,              // number of docs reranked (Cohere)
  vector_write_units: Number,        // vectors upserted (Pinecone)
  vector_read_units: Number,         // RUs consumed (Pinecone)
  
  // Cost (in USD, 6 decimal precision)
  cost_usd: Number,                  // computed at insert time from current rate table
  
  // Billing period helpers
  billing_month: String,             // "2026-05" — for fast monthly aggregation
  billing_day: String,               // "2026-05-12" — for daily aggregation
  
  created_at: Date
}

// monthly_cost_summaries collection (materialised — rebuilt nightly)
// Pre-aggregated for dashboard performance — avoids scanning all cost_events
{
  _id: UUID,
  billing_month: String,             // "2026-05"
  
  // Dimensions (one document per unique combination)
  college_id: String,
  dept_id: String,                   // "ALL" for college-level summary
  
  // Per-service breakdown (USD)
  anthropic_cost_usd: Number,
  openai_cost_usd: Number,
  cohere_cost_usd: Number,
  pinecone_cost_usd: Number,
  total_cost_usd: Number,
  
  // Token/unit counts
  llm_input_tokens: Number,
  llm_output_tokens: Number,
  embedding_tokens: Number,
  rerank_calls: Number,
  pinecone_write_units: Number,
  pinecone_read_units: Number,
  
  // Usage stats
  chat_message_count: Number,
  ai_summary_count: Number,
  exam_gen_count: Number,
  doc_ingestion_count: Number,
  unique_students: Number,
  
  // Storage snapshot (from latest observation)
  storage_used_gb: Number,
  
  // Policy reference at snapshot time
  llm_token_limit: Number,
  token_utilisation_pct: Number,     // (llm_input_tokens + llm_output_tokens) / limit * 100
  cost_budget_usd: Number,
  cost_utilisation_pct: Number,      // total_cost_usd / budget * 100
  
  computed_at: Date
}

// rate_table collection (platform DB — current third-party pricing)
// Updated manually when vendor pricing changes
{
  _id: UUID,
  service: Enum["anthropic", "openai_embeddings", "cohere", "pinecone"],
  model: String,                     // model or tier name
  
  // Pricing (USD)
  input_token_cost_per_1k: Number,   // Anthropic, OpenAI
  output_token_cost_per_1k: Number,  // Anthropic only
  per_unit_cost: Number,             // Cohere: per 1K searches; Pinecone: per 1M RUs
  storage_cost_per_gb_per_month: Number,   // Pinecone vector storage
  
  effective_from: Date,
  notes: String,
  updated_by: UUID,
  updated_at: Date
}
```

### 3.2 Indexes for cost_events

```javascript
// Fast monthly aggregation by college
db.cost_events.createIndex({ college_id: 1, billing_month: 1, service: 1 });
// Fast dept drilldown
db.cost_events.createIndex({ college_id: 1, dept_id: 1, billing_month: 1 });
// Daily trend queries
db.cost_events.createIndex({ college_id: 1, billing_day: 1 });
// Action type analysis
db.cost_events.createIndex({ action_type: 1, billing_month: 1 });
// Real-time limit checks
db.cost_events.createIndex({ college_id: 1, billing_month: 1, action_type: 1 });
```

---

## 4. F-12-A: Super Admin Login Screen

### 4.1 Design spec

The login screen is the only public-facing surface of the Super Admin portal. It must feel secure, minimal, and completely distinct from the college-facing student/admin portals.

**URL:** `https://admin.edumindai.com/login` (separate subdomain, not shared with college portals)

**Visual design:**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         [Deep navy bg]                           │
│                                                                  │
│           🧠  EduMind AI                                         │
│           Super Admin Console                                    │
│                                                                  │
│    ┌────────────────────────────────────────┐                   │
│    │  Work email                            │                   │
│    │  [sudipta@edumindai.com              ] │                   │
│    │                                        │                   │
│    │  Password                              │                   │
│    │  [●●●●●●●●●●●●                      ] │                   │
│    │                                  [👁] │                   │
│    │                                        │                   │
│    │  [    Sign in to console →           ] │                   │
│    └────────────────────────────────────────┘                   │
│                                                                  │
│           — or if 2FA is enabled —                               │
│                                                                  │
│    ┌────────────────────────────────────────┐                   │
│    │  Authenticator code                    │                   │
│    │  [  6  ][  digit  ][  code  ]         │                   │
│    └────────────────────────────────────────┘                   │
│                                                                  │
│    🔒 Secured · Internal use only · v2.0                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**No "Forgot password" link on the UI** — Super Admin password reset is done only via the CLI seed script or direct DB operation. This reduces attack surface. If needed, display: "Contact your system administrator."

### 4.2 Authentication flow

```
1. Admin enters email + password
2. POST /api/v1/auth/super-admin/login
3. Server:
   a. Find platform_admin by email
   b. Check failed_login_attempts — if >= 5 and locked_until > now() → return 429 "Account locked"
   c. bcrypt.compare(password, password_hash)
   d. If wrong: increment failed_login_attempts, if >= 5 set locked_until = now() + 30min → return 401
   e. If correct: reset failed_login_attempts = 0
   f. If mfa_enabled === true:
      → Return { requires_mfa: true, mfa_session_token: <short-lived UUID stored in Redis 5min> }
      → UI shows TOTP input
      → POST /api/v1/auth/super-admin/mfa-verify { mfa_session_token, totp_code }
      → Server verifies TOTP against mfa_secret using speakeasy/totp
      → If valid: proceed to step g
   g. Generate JWT: { sub: admin_id, role: "super_admin", exp: now + 8h }
   h. Generate refresh token: UUID, stored in Redis with 7-day TTL
   i. Set refresh token in httpOnly cookie
   j. Return access JWT
4. Frontend stores JWT in memory (NOT localStorage), redirects to dashboard

Security hardening:
  - Rate limit login endpoint: 10 attempts per IP per 15 minutes (Redis)
  - Constant-time password comparison (bcrypt)
  - JWT contains no sensitive data beyond admin_id and role
  - All Super Admin API routes validate: role === "super_admin" AND JWT not expired
  - Session activity log: every login recorded with IP + user-agent + timestamp
```

### 4.3 Login API

```
POST /api/v1/auth/super-admin/login
Body: { email: String, password: String }
Response (MFA disabled): { access_token, expires_at }
Response (MFA enabled):  { requires_mfa: true, mfa_session_token }

POST /api/v1/auth/super-admin/mfa-verify
Body: { mfa_session_token: String, totp_code: String }
Response: { access_token, expires_at }

POST /api/v1/auth/super-admin/logout
Response: 200 (clears refresh cookie, invalidates refresh token in Redis)

POST /api/v1/auth/super-admin/refresh
Cookie: refresh_token
Response: { access_token, expires_at }
```

### 4.4 Post-login: session context

After login, every Super Admin page shows:
- Logged in as: `sudipta@edumindai.com`
- Session expires: `in 7h 42m` (auto-refresh in background)
- Last login: `May 11, 2026 at 10:32 PM · Bangalore, IN`
- Red warning banner if any college has crossed 90% of its cost budget

---

## 5. F-12-B: Cost Policy Engine

### 5.1 What is a cost policy?

A cost policy is a set of rules attached to a target (global / college / dept) that governs:
1. How many LLM tokens can be consumed per month
2. What happens when the limit is hit (warn vs hard stop)
3. Which LLM models are permitted (Haiku only, or Haiku + Sonnet)
4. Your internal cost budget ceiling (your cost, not the price charged to college)
5. Per-student daily rate limits (prevents one student from burning all tokens)
6. Storage limits

### 5.2 Policy inheritance cascade

```
Global policy (defaults for all colleges)
  │
  ├── College A policy (overrides specific fields for this college)
  │     │
  │     ├── CS Dept policy (overrides specific fields for this dept)
  │     ├── Mech Dept policy
  │     └── [Generic Dept inherits college policy — no override possible]
  │
  └── College B policy
        └── [Depts inherit college policy unless explicitly overridden]
```

**Resolution logic at request time:**
```javascript
function resolvePolicy(collegeId, deptId) {
  const globalPolicy  = getCostPolicy("global", "global");
  const collegePolicy = getCostPolicy("college", collegeId);
  const deptPolicy    = getCostPolicy("dept", deptId);

  // Merge: dept overrides college, college overrides global
  // undefined fields fall through to the coarser level
  return {
    llm_token_limit_per_month:          deptPolicy?.llm_token_limit_per_month
                                        ?? collegePolicy?.llm_token_limit_per_month
                                        ?? globalPolicy.llm_token_limit_per_month,
    allowed_llm_models:                 deptPolicy?.allowed_llm_models
                                        ?? collegePolicy?.allowed_llm_models
                                        ?? globalPolicy.allowed_llm_models,
    max_chat_queries_per_student_per_day: deptPolicy?.max_chat_queries_per_student_per_day
                                        ?? collegePolicy?.max_chat_queries_per_student_per_day
                                        ?? globalPolicy.max_chat_queries_per_student_per_day,
    cost_budget_usd_per_month:          deptPolicy?.cost_budget_usd_per_month
                                        ?? collegePolicy?.cost_budget_usd_per_month
                                        ?? globalPolicy.cost_budget_usd_per_month,
    // ... all other fields follow same pattern
  };
}
```

### 5.3 Policy enforcement at query time

Every chat message goes through policy enforcement before hitting the LLM:

```javascript
async function enforceCostPolicy(collegeId, deptId, studentId, requestedModel) {
  const policy = resolvePolicy(collegeId, deptId);

  // 1. Check if requested model is allowed
  if (!policy.allowed_llm_models.includes(requestedModel)) {
    throw new Error(`Model ${requestedModel} not permitted for this department`);
  }

  // 2. Check monthly token usage for this college
  const collegeMonthlyTokens = await getMonthlyTokenUsage(collegeId, null);  // null = all depts
  if (policy.llm_token_hard_stop && collegeMonthlyTokens >= policy.llm_token_limit_per_month) {
    throw new CostLimitError("COLLEGE_TOKEN_LIMIT_REACHED", {
      used: collegeMonthlyTokens,
      limit: policy.llm_token_limit_per_month
    });
  }

  // 3. Check monthly token usage for this dept
  const deptPolicy = getCostPolicy("dept", deptId);
  if (deptPolicy?.llm_token_limit_per_month) {
    const deptMonthlyTokens = await getMonthlyTokenUsage(collegeId, deptId);
    if (deptMonthlyTokens >= deptPolicy.llm_token_limit_per_month) {
      throw new CostLimitError("DEPT_TOKEN_LIMIT_REACHED", { used: deptMonthlyTokens });
    }
  }

  // 4. Check student daily rate limit (Redis: per-student, per-day counter)
  const studentDayKey = `rl:chat:${studentId}:${today()}`;
  const studentDayCount = await redis.incr(studentDayKey);
  if (studentDayCount === 1) await redis.expire(studentDayKey, 86400);
  if (studentDayCount > policy.max_chat_queries_per_student_per_day) {
    throw new RateLimitError("STUDENT_DAILY_LIMIT_REACHED", {
      limit: policy.max_chat_queries_per_student_per_day
    });
  }

  // 5. Check cost budget
  const monthlyCostUsd = await getMonthlyCostUsd(collegeId);
  const budgetUtilisation = monthlyCostUsd / policy.cost_budget_usd_per_month;
  if (budgetUtilisation >= 1.0 && policy.llm_token_hard_stop) {
    throw new CostLimitError("COLLEGE_BUDGET_EXCEEDED", { cost: monthlyCostUsd });
  }

  // 6. Trigger soft warnings (async — don't block the request)
  if (budgetUtilisation >= policy.cost_soft_warn_pct / 100) {
    queueSoftWarningAlert(collegeId, "cost_budget", budgetUtilisation);
  }

  return policy;  // return resolved policy (contains model choice, etc.)
}
```

### 5.4 Policy editor UI

**Screen: Super Admin → Policies → [Global | College | Department]**

```
┌──────────────────────────────────────────────────────────────────────┐
│ Cost Policy Editor                              [Save Policy] [Reset]│
│ Target: MSRIT Medical College                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ LLM Token Limits                                                     │
│ ─────────────────────────────────────────────────────                │
│ Monthly token limit          [5,000,000    ] tokens                  │
│                              ≈ $1.25 at Haiku rates                  │
│                              [    ●─────── 80% warn ─────────   ]   │
│ Warn at                      [ 80 ]%                                 │
│ Hard stop at limit           [✓ Yes  ○ No — continue but alert]     │
│                                                                      │
│ Allowed Models                                                       │
│ ─────────────────────────────────────────────────────                │
│ [✓] Claude Haiku   (fast, cheap — recommended for chat)             │
│ [ ] Claude Sonnet  (richer — exam generation only)                  │
│                                                                      │
│ Per-Student Daily Limits                                             │
│ ─────────────────────────────────────────────────────                │
│ Max chat queries / student / day     [ 50 ]                          │
│ Max AI summaries / student / day     [ 10 ]                          │
│ Max exam generations / student / day [  5 ]                          │
│                                                                      │
│ Internal Cost Budget (your cost, not college price)                  │
│ ─────────────────────────────────────────────────────                │
│ Monthly budget ceiling (USD)         [ $2.50  ]                      │
│ Warn at                              [ 75 ]%                         │
│ ← This college is on ₹3,999/mo plan = ~$48/mo revenue               │
│    Current estimated cost: $1.40/mo → Margin: $46.60 (97%)          │
│                                                                      │
│ Storage                                                              │
│ ─────────────────────────────────────────────────────                │
│ Max local storage                    [ 50 ] GB                       │
│                                                                      │
│ Notes (internal)                                                      │
│ ─────────────────────────────────────────────────────                │
│ [Pilot college — generous limits. Review after 60 days.            ] │
│                                                                      │
│ ⚠️  Dept-level policies can only LOWER these limits, not raise them  │
└──────────────────────────────────────────────────────────────────────┘
```

**Key UX behaviour:**
- Token limit field shows live cost estimate as you type: "5,000,000 tokens ≈ $1.25/month at Haiku rates"
- Margin line: "Revenue ₹3,999 (~$48) − Estimated cost $1.40 = **$46.60 margin (97%)**"
- Policy changes take effect immediately (no waiting for billing period reset)
- History tab: "Changed by sudipta@edumindai.com on May 10, 2026: limit raised from 2M to 5M"
- A policy saved at dept level shows a yellow banner: "This dept policy overrides the college policy for: token limit, model selection"

---

## 6. F-12-C: Usage Metering — How We Capture Costs

### 6.1 Metering hook — where to insert

Every LLM/embedding/rerank call already goes through a service layer. Add metering as a post-call interceptor:

```javascript
// services/api/src/services/llm.service.ts

async function callLLMWithMetering(params: {
  collegeId: string;
  deptId: string;
  studentId: string | null;
  sessionId: string | null;
  actionType: CostEventActionType;
  model: string;
  messages: MessageParam[];
  maxTokens: number;
  stream: boolean;
}) {
  const startTime = Date.now();

  // Policy enforcement first
  await enforceCostPolicy(params.collegeId, params.deptId, params.studentId, params.model);

  // Call Anthropic
  const response = await anthropic.messages.create({ /* ... */ });

  // Compute cost from rate table
  const rateTable = await getRateTable("anthropic", params.model);
  const costUsd = (
    (response.usage.input_tokens  / 1000) * rateTable.input_token_cost_per_1k +
    (response.usage.output_tokens / 1000) * rateTable.output_token_cost_per_1k
  );

  // Fire-and-forget metering (don't await — don't slow the response)
  setImmediate(() => recordCostEvent({
    college_id:    params.collegeId,
    dept_id:       params.deptId,
    student_id:    params.studentId,
    session_id:    params.sessionId,
    action_type:   params.actionType,
    service:       "anthropic",
    model:         params.model,
    input_tokens:  response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    total_tokens:  response.usage.input_tokens + response.usage.output_tokens,
    cost_usd:      costUsd,
    billing_month: getBillingMonth(),      // "2026-05"
    billing_day:   getBillingDay(),        // "2026-05-12"
    created_at:    new Date()
  }));

  return response;
}
```

### 6.2 Metering for embeddings (OpenAI)

```javascript
// services/api/src/services/embedding.service.ts

async function embedWithMetering(text: string, collegeId: string, deptId: string, actionType: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  const rateTable = await getRateTable("openai_embeddings", "text-embedding-3-small");
  const costUsd = (response.usage.total_tokens / 1000) * rateTable.input_token_cost_per_1k;

  setImmediate(() => recordCostEvent({
    college_id:      collegeId,
    dept_id:         deptId,
    student_id:      null,        // ingestion — no student
    action_type:     actionType,  // "query_embedding" or "doc_ingestion"
    service:         "openai_embeddings",
    model:           "text-embedding-3-small",
    embedding_tokens: response.usage.total_tokens,
    cost_usd:         costUsd,
    billing_month:   getBillingMonth(),
    billing_day:     getBillingDay(),
    created_at:      new Date()
  }));

  return response.data[0].embedding;
}
```

### 6.3 Metering for Cohere reranking

```javascript
// After Cohere rerank call
const cohereResponse = await cohere.rerank({ /* ... */ });

const rateTable = await getRateTable("cohere", "rerank-english-v3");
const costUsd = (1 / 1000) * rateTable.per_unit_cost;  // 1 rerank call = 1 unit

setImmediate(() => recordCostEvent({
  college_id:   collegeId,
  dept_id:      deptId,
  student_id:   studentId,
  action_type:  "rerank",
  service:      "cohere",
  model:        "rerank-english-v3",
  rerank_units: 1,
  cost_usd:     costUsd,
  billing_month: getBillingMonth(),
  billing_day:   getBillingDay(),
  created_at:   new Date()
}));
```

### 6.4 Nightly materialised summary (cron job)

Running a MongoDB aggregation over all `cost_events` on every dashboard load would be too slow. Instead, a nightly job at 1 AM rebuilds the `monthly_cost_summaries` collection:

```javascript
// services/api/src/jobs/rebuild-cost-summaries.ts

async function rebuildMonthlyCostSummaries() {
  const currentMonth = getBillingMonth();    // "2026-05"

  // Get all unique (college_id, dept_id) combinations for this month
  const dimensions = await platformDb.cost_events.aggregate([
    { $match: { billing_month: currentMonth } },
    { $group: { _id: { college_id: "$college_id", dept_id: "$dept_id" } } }
  ]).toArray();

  for (const dim of dimensions) {
    const { college_id, dept_id } = dim._id;

    // Aggregate all cost events for this (college, dept, month)
    const summary = await platformDb.cost_events.aggregate([
      { $match: { college_id, dept_id, billing_month: currentMonth } },
      { $group: {
        _id: null,
        anthropic_cost_usd:   { $sum: { $cond: [{ $eq: ["$service","anthropic"] },       "$cost_usd", 0] } },
        openai_cost_usd:      { $sum: { $cond: [{ $eq: ["$service","openai_embeddings"] },"$cost_usd", 0] } },
        cohere_cost_usd:      { $sum: { $cond: [{ $eq: ["$service","cohere"] },           "$cost_usd", 0] } },
        pinecone_cost_usd:    { $sum: { $cond: [{ $eq: ["$service","pinecone"] },         "$cost_usd", 0] } },
        total_cost_usd:       { $sum: "$cost_usd" },
        llm_input_tokens:     { $sum: "$input_tokens" },
        llm_output_tokens:    { $sum: "$output_tokens" },
        embedding_tokens:     { $sum: "$embedding_tokens" },
        rerank_calls:         { $sum: "$rerank_units" },
        chat_message_count:   { $sum: { $cond: [{ $eq: ["$action_type","chat_message"] }, 1, 0] } },
        ai_summary_count:     { $sum: { $cond: [{ $eq: ["$action_type","ai_summary"] },   1, 0] } },
        exam_gen_count:       { $sum: { $cond: [{ $eq: ["$action_type","exam_generation"]},1, 0] } },
        unique_students:      { $addToSet: "$student_id" }
      }},
      { $project: { unique_students: { $size: "$unique_students" }, /* other fields */ } }
    ]).toArray();

    const policy = resolvePolicy(college_id, dept_id);

    // Upsert summary document
    await platformDb.monthly_cost_summaries.updateOne(
      { billing_month: currentMonth, college_id, dept_id },
      { $set: {
        ...summary[0],
        llm_token_limit:        policy.llm_token_limit_per_month,
        token_utilisation_pct:  ((summary[0].llm_input_tokens + summary[0].llm_output_tokens) / policy.llm_token_limit_per_month) * 100,
        cost_budget_usd:        policy.cost_budget_usd_per_month,
        cost_utilisation_pct:   (summary[0].total_cost_usd / policy.cost_budget_usd_per_month) * 100,
        computed_at:            new Date()
      }},
      { upsert: true }
    );
  }
}
```

---

## 7. F-12-D: Super Admin Dashboard — Platform Overview

The first screen after login. Shows the health of the entire platform at a glance.

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🧠 EduMind AI Console        Colleges  Policies  Reports  Settings      [S] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Platform Overview — May 2026                               [← Prev] [Export]│
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Total Cost  │  │ LLM Tokens  │  │ Active       │  │ Total Msgs  │      │
│  │ $18.42      │  │ 42.1M       │  │ Colleges: 7  │  │ 84,200      │      │
│  │ ↑ 12% MoM   │  │ 68% of cap  │  │ Students:1.2k│  │ this month  │      │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                                             │
│  Cost by College (May 2026)                     Cost by Service             │
│  ──────────────────────────────────────         ──────────────────────────  │
│  MSRIT Medical        $4.21  ████████ 23%       Anthropic LLM   $14.20 77% │
│  Dayananda Eng        $3.87  ███████  21%       OpenAI Embed     $2.10 11% │
│  KLE Medical          $3.12  ██████   17%       Cohere Rerank    $1.30  7% │
│  PESCE Engineering    $2.44  █████    13%       Pinecone         $0.82  4% │
│  JSS Medical          $2.18  ████     12%                                   │
│  SJCE Engineering     $1.43  ███       8%       Daily trend (last 30 days)  │
│  Global Pilot Test    $1.17  ██        6%       [sparkline chart]           │
│                                                                             │
│  🔴 Alerts (2)                                                              │
│  ────────────────────────────────────────────────────────────────────────  │
│  ⚠️  MSRIT Medical — Pharmacology dept at 94% of token limit               │
│  ⚠️  KLE Medical — cost budget at 78% (warn threshold: 75%)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Key metrics computed

| Metric | Source | Computation |
|---|---|---|
| Total platform cost (month) | `monthly_cost_summaries` | SUM(total_cost_usd) all colleges, current month |
| Total LLM tokens | `monthly_cost_summaries` | SUM(llm_input + llm_output) all colleges |
| Most expensive college | `monthly_cost_summaries` | MAX(total_cost_usd) by college |
| Cost by service | `monthly_cost_summaries` | SUM per service across all colleges |
| Active colleges | `platform.colleges` | COUNT(status=active) |
| Alerts | `cost_policies` + `monthly_cost_summaries` | Colleges/depts where utilisation_pct > warn threshold |

### 7.3 Month selector and export

- **Month selector**: dropdown `[May 2026 ▼]` — shows last 12 months. Switching month re-fetches from `monthly_cost_summaries`.
- **Export**: CSV download of all college rows with columns: college, total_cost, anthropic_cost, openai_cost, cohere_cost, pinecone_cost, token_count, chat_count, students.

---

## 8. F-12-E: College-Level Cost Drilldown

**Route:** `/super-admin/colleges/:collegeId/costs?month=2026-05`

### 8.1 Page layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Platform Overview    MSRIT Medical College — Cost Detail    May 2026      │
│                                                       [Edit Policy] [Export] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Total Cost  │  │ Token Usage │  │ Budget Used │  │ Chat Msgs   │      │
│  │   $4.21     │  │  16.8M tkns │  │   $4.21     │  │   31,400    │      │
│  │             │  │  ████░ 84%  │  │  ████░ 84%  │  │             │      │
│  │ limit: $5.00│  │  limit: 20M │  │  limit: $5  │  │             │      │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                                             │
│  Token / Cost by Department                                                 │
│  ──────────────────────────────────────────────────────────────────         │
│  Department         Tokens      Token%   Cost USD  Cost%   Chat Msgs  [→]  │
│  Pharmacology       6.2M        37%      $1.55     37%     11,600      →   │
│  Anatomy            4.1M        24%      $1.03     24%      7,700      →   │
│  Pathology          2.8M        17%      $0.70     17%      5,200      →   │
│  Surgery            2.1M        13%      $0.52     12%      3,900      →   │
│  General (fallback) 1.6M         9%      $0.41     10%      3,000      →   │
│                                                                             │
│  Cost by Service (this college)                                             │
│  ──────────────────────────────────────────────────────────────────         │
│  [Donut chart: Anthropic 76%, OpenAI 12%, Cohere 8%, Pinecone 4%]          │
│                                                                             │
│  Daily Cost Trend — May 2026                                                │
│  [Bar chart: daily cost, last 31 days. Hover shows day total + breakdown]   │
│                                                                             │
│  Policy in effect for this college                                          │
│  ──────────────────────────────────────────────────────────────────         │
│  Token limit:    20,000,000 / month    [84% used]                          │
│  Budget ceiling: $5.00 / month         [84% used]                          │
│  Models:         Claude Haiku only                                          │
│  Student limit:  50 chats / day                                             │
│  Storage limit:  50 GB                   [used: 12.4 GB]                   │
│  Plan:           Department (₹3,999/mo per dept × 4 depts = ₹15,996/mo)   │
│  Margin:         ₹15,996 revenue − $4.21 cost (~₹350) = ₹15,646 (98%)    │
│                                                                             │
│                                              [Edit Policy for this college] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Margin calculator

This is the most valuable screen for business decisions:

```
Revenue:  ₹15,996 / month  (4 departments × ₹3,999 plan)
Cost:     $4.21 / month    → ₹350 at current exchange rate
──────────────────────────────────────────────────────
Margin:   ₹15,646 / month  (97.8%)
Cost/Revenue ratio: 2.2%
```

If the cost/revenue ratio exceeds a configurable threshold (default: 20%), the margin cell turns yellow. If it exceeds 40%, it turns red.

---

## 9. F-12-F: Department-Level Cost Drilldown

**Route:** `/super-admin/colleges/:collegeId/depts/:deptId/costs?month=2026-05`

### 9.1 Page layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← MSRIT Medical    Pharmacology Department — Cost Detail    May 2026        │
│                                                       [Edit Dept Policy]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Dept Cost    │  │ LLM Tokens   │  │ Unique       │  │ Avg Cost /   │  │
│  │   $1.55      │  │   6.2M       │  │ Students     │  │ Student      │  │
│  │ 37% of coll. │  │ ░░░░███ 37%  │  │   142        │  │   $0.011     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                             │
│  Cost by Action Type                       Cost by Service (this dept)      │
│  ──────────────────────────────────        ─────────────────────────────── │
│  Chat Messages       $1.12  72%            Anthropic LLM    $1.20  77%     │
│  AI Summaries        $0.21  14%            OpenAI Embeds    $0.19  12%     │
│  Exam Generation     $0.15   9%            Cohere Rerank    $0.11   7%     │
│  Document Ingestion  $0.07   5%            Pinecone         $0.05   3%     │
│                                                                             │
│  Top 10 Students by token usage (this month)                                │
│  ──────────────────────────────────────────────────────────────────         │
│  Roll      Name (masked)   Tokens    Cost    Chats   AI Sum  Exam Gen      │
│  23PH001   Stu***001       412,000   $0.103   82      4       3            │
│  23PH002   Stu***002       387,000   $0.097   77      3       2            │
│  23PH003   Stu***003       301,000   $0.075   60      2       1            │
│  [... 7 more ...]                                                           │
│                                                                             │
│  Daily Chat Volume — May 2026                                               │
│  [Line chart: messages per day. Spikes visible around exam dates.]          │
│                                                                             │
│  Per-Query Cost Analysis (last 100 queries)                                 │
│  ──────────────────────────────────────────────────────────────────         │
│  Average cost per chat message:    $0.000036                                │
│  Average cost per AI summary:      $0.000185                                │
│  Average cost per exam generation: $0.000520 (Sonnet used)                 │
│  Average tokens per chat message:  142 in + 312 out = 454 total            │
│                                                                             │
│  Policy in effect                                                           │
│  ──────────────────────────────────────────────────────────────────         │
│  Token limit:  [Inherited from college: 20M combined] — no dept override    │
│  Models:       [Inherited: Haiku only]                                      │
│  Student limit:[Inherited: 50 chats/day]                                    │
│  Storage:      2.4 GB used of 50 GB college limit                          │
│                                              [Set department-specific policy]│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Per-query cost breakdown

This is particularly useful for understanding cost drivers:

```
Average full-pipeline cost of one student chat message:
  Query embedding (OpenAI):    0.028¢  (142 tokens × $0.00002/1K)
  Vector search (Pinecone):    0.001¢  (1 read unit)
  Cohere rerank (5 results):   0.001¢  (1/1000 × $0.001)
  LLM generation (Haiku):      0.032¢  (128 input × $0.00025/1K + 312 output × $0.00125/1K)
  ─────────────────────────────────────
  Total per message:           0.062¢  ($0.00062)
  Monthly at 50 msgs/day × 142 students = 213,000 msgs/month = $1.32
```

---

## 10. F-12-G: Cost Plan Builder

**Route:** `/super-admin/cost-planner`

This is the tool you use to figure out what to charge colleges.

### 10.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Cost Plan Builder                                           [Save as Template]│
│ Model a new college or verify pricing for an existing one                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  College profile                                                            │
│  ─────────────────────────────────────────────────────                      │
│  Type:          [Engineering ▼]                                              │
│  Departments:   [4] (e.g. CS, ECE, Mech, Civil)                            │
│  Students/dept: [300]                                                        │
│  Active ratio:  [40]% (% who actually use the bot per month)                │
│                                                                             │
│  Usage assumptions (editable, pre-filled from real averages)               │
│  ─────────────────────────────────────────────────────                      │
│  Avg chats / active student / day:  [8]                                     │
│  Avg tokens / chat (in + out):      [454]                                   │
│  AI summaries / active student / month: [5]                                 │
│  Avg tokens / AI summary:           [820]                                   │
│  Documents uploaded / dept / month: [3]                                     │
│  Avg pages per doc:                 [60]                                     │
│  Avg tokens per page (embedding):   [380]                                   │
│                                                                             │
│  Projected Monthly Costs                                                    │
│  ─────────────────────────────────────────────────────                      │
│  Active students:      480 (4 depts × 300 × 40%)                           │
│                                                                             │
│  LLM (Anthropic Haiku)                                                      │
│  Chat:      480 × 8 × 25 days × 454 tokens = 43.6M tokens = $10.90        │
│  Summaries: 480 × 5 × 820 tokens = 1.97M tokens = $0.49                   │
│                                                                             │
│  Embeddings (OpenAI)                                                        │
│  Query embed: 480 × 8 × 25 × 142 tokens = 13.6M tokens = $0.27            │
│  Ingestion:   4 depts × 3 docs × 60 pages × 380 tokens = 273.6K = $0.01   │
│                                                                             │
│  Cohere Rerank: 480 × 8 × 25 = 96,000 reranks = $0.10                     │
│                                                                             │
│  Pinecone: ~50K vectors stored = ~$0.05                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  TOTAL ESTIMATED COST:  $11.82 / month                              │   │
│  │  Per department:         $2.96 / month                              │   │
│  │  Per active student:     $0.025 / month                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Pricing simulation                                                         │
│  ─────────────────────────────────────────────────────                      │
│  Your price (per dept/month):  [₹3,999]  = $48.17                         │
│  Revenue (4 depts):            ₹15,996 = $192.68                           │
│  Cost:                         $11.82                                       │
│  ──────────────────────────────────────────────────                         │
│  Gross margin:                 $180.86 / month  (93.9%)                     │
│  Break-even usage:             [shows how many students = 0% margin]        │
│                                                                             │
│  Token limit recommendation                                                 │
│  ─────────────────────────────────────────────────────                      │
│  Projected usage:    45.6M tokens / month                                   │
│  Recommended limit:  55M tokens (20% headroom)                             │
│  Hard stop:          ✓ (to protect margin)                                 │
│                                                                             │
│  [Apply this policy to a college → [Select college ▼] [Apply]]             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Real data benchmarks

The cost plan builder pre-fills assumptions from actual platform averages:

```javascript
// Computed nightly and cached in Redis
async function getPlatformAverages() {
  const last30Days = await platformDb.cost_events.aggregate([
    { $match: { billing_month: { $in: [lastMonth, currentMonth] } } },
    { $group: {
      _id: "$action_type",
      avg_tokens_per_event: { $avg: "$total_tokens" },
      avg_cost_per_event:   { $avg: "$cost_usd" },
      count:                { $sum: 1 }
    }}
  ]).toArray();

  return {
    avg_tokens_per_chat: last30Days.find(r => r._id === "chat_message")?.avg_tokens_per_event || 454,
    avg_tokens_per_summary: last30Days.find(r => r._id === "ai_summary")?.avg_tokens_per_event || 820,
    // ...
  };
}
```

---

## 11. F-12-H: Alerts & Threshold Notifications

### 11.1 Alert types

| Alert | Trigger | Channel | Who sees it |
|---|---|---|---|
| College soft warn — tokens | token_utilisation_pct >= warn_pct | Dashboard banner + email | Super Admin |
| College hard stop — tokens | token_utilisation_pct >= 100% | Dashboard banner + email (urgent) | Super Admin |
| College soft warn — budget | cost_utilisation_pct >= warn_pct | Dashboard banner + email | Super Admin |
| College budget exceeded | cost_utilisation_pct >= 100% | Dashboard banner + email (urgent) | Super Admin |
| Dept soft warn — tokens | dept token_utilisation >= 80% | Dashboard banner | Super Admin |
| Anomaly detection | daily cost > 3× rolling 7-day average | Dashboard banner + email | Super Admin |
| Student blocked | student hits daily chat limit | In-chat message to student | Student only |
| College suspended | Super Admin suspends college | Email to college owner | College owner |

### 11.2 Alert evaluation (runs every 15 minutes via cron)

```javascript
async function evaluateAlerts() {
  const colleges = await platformDb.colleges.find({ status: "active" }).toArray();

  for (const college of colleges) {
    const summary = await platformDb.monthly_cost_summaries.findOne({
      billing_month: currentMonth,
      college_id: college._id,
      dept_id: "ALL"
    });
    if (!summary) continue;

    const policy = resolvePolicy(college._id, null);

    // Token alerts
    if (summary.token_utilisation_pct >= 100 && policy.llm_token_hard_stop) {
      await createOrUpdateAlert(college._id, "COLLEGE_TOKEN_HARD_STOP", {
        severity: "critical",
        message: `${college.name} has exhausted its monthly token limit. LLM calls are blocked.`,
        value: summary.token_utilisation_pct
      });
    } else if (summary.token_utilisation_pct >= policy.llm_token_soft_warn_pct) {
      await createOrUpdateAlert(college._id, "COLLEGE_TOKEN_SOFT_WARN", {
        severity: "warning",
        message: `${college.name} is at ${summary.token_utilisation_pct.toFixed(1)}% of its token limit.`,
        value: summary.token_utilisation_pct
      });
    }

    // Budget alerts
    if (summary.cost_utilisation_pct >= policy.cost_soft_warn_pct) {
      await createOrUpdateAlert(college._id, "COLLEGE_BUDGET_WARN", {
        severity: "warning",
        message: `${college.name} cost budget at ${summary.cost_utilisation_pct.toFixed(1)}%.`,
        value: summary.cost_utilisation_pct
      });
    }

    // Anomaly detection: compare today's spend to rolling 7-day average
    const todayCost = await getDailyCostUsd(college._id, today());
    const avg7DayCost = await get7DayRollingAvgCost(college._id);
    if (todayCost > avg7DayCost * 3 && avg7DayCost > 0) {
      await createOrUpdateAlert(college._id, "COST_ANOMALY", {
        severity: "warning",
        message: `${college.name} today's cost ($${todayCost.toFixed(2)}) is ${(todayCost/avg7DayCost).toFixed(1)}× the 7-day average.`,
        value: todayCost
      });
    }
  }
}
```

---

## 12. API Route Map

All routes require `role: super_admin` JWT.

```
# Auth
POST   /api/v1/auth/super-admin/login
POST   /api/v1/auth/super-admin/mfa-verify
POST   /api/v1/auth/super-admin/logout
POST   /api/v1/auth/super-admin/refresh

# Platform Overview
GET    /api/v1/super-admin/dashboard?month=2026-05
       Response: { platform_totals, cost_by_college[], cost_by_service, daily_trend[], alerts[] }

# Cost Policies
GET    /api/v1/super-admin/policies/global
PUT    /api/v1/super-admin/policies/global
GET    /api/v1/super-admin/policies/college/:collegeId
PUT    /api/v1/super-admin/policies/college/:collegeId
DELETE /api/v1/super-admin/policies/college/:collegeId    (resets to global defaults)
GET    /api/v1/super-admin/policies/dept/:deptId
PUT    /api/v1/super-admin/policies/dept/:deptId
DELETE /api/v1/super-admin/policies/dept/:deptId          (resets to college defaults)
GET    /api/v1/super-admin/policies/college/:collegeId/all  (college + all dept policies)

# College Cost Drilldown
GET    /api/v1/super-admin/colleges/:collegeId/costs?month=2026-05
       Response: { totals, by_dept[], by_service, by_action_type, daily_trend[], policy, margin }
GET    /api/v1/super-admin/colleges/:collegeId/costs/export?month=2026-05
       Response: CSV download

# Dept Cost Drilldown
GET    /api/v1/super-admin/colleges/:cid/depts/:deptId/costs?month=2026-05
       Response: { totals, by_action_type, by_service, top_students[], per_query_analysis, policy }

# Cost Plan Builder
GET    /api/v1/super-admin/cost-planner/platform-averages
       Response: { avg_tokens_per_chat, avg_tokens_per_summary, avg_reranks_per_chat, ... }
POST   /api/v1/super-admin/cost-planner/simulate
       Body: { type, num_depts, students_per_dept, active_ratio, price_inr_per_dept }
       Response: { projected_cost_usd, margin_usd, margin_pct, recommended_token_limit, by_service }

# Rate Table (cost per unit of each service)
GET    /api/v1/super-admin/rate-table
PUT    /api/v1/super-admin/rate-table/:service  (update pricing when vendor changes rates)

# Alerts
GET    /api/v1/super-admin/alerts?status=active|resolved
PUT    /api/v1/super-admin/alerts/:alertId/resolve
```

---

## 13. Frontend Component Tree

```
apps/super-admin/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx                    # Login screen + MFA step
│   │
│   ├── dashboard/
│   │   ├── page.tsx                        # Platform overview
│   │   ├── colleges/
│   │   │   ├── page.tsx                    # College list
│   │   │   ├── new/page.tsx                # Create college
│   │   │   └── [collegeId]/
│   │   │       ├── page.tsx                # College detail
│   │   │       ├── costs/page.tsx          # College cost drilldown
│   │   │       ├── policy/page.tsx         # Edit college policy
│   │   │       └── depts/
│   │   │           └── [deptId]/
│   │   │               ├── costs/page.tsx  # Dept cost drilldown
│   │   │               └── policy/page.tsx # Edit dept policy
│   │   ├── policies/
│   │   │   ├── page.tsx                    # Global policy editor
│   │   │   └── [target]/page.tsx           # Policy history
│   │   ├── cost-planner/
│   │   │   └── page.tsx                    # Cost plan builder
│   │   └── alerts/
│   │       └── page.tsx                    # All active alerts
│
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── MfaStep.tsx
│   ├── dashboard/
│   │   ├── PlatformKPICards.tsx            # 4 top-line metric cards
│   │   ├── CostByCollegeTable.tsx          # Sortable table with sparklines
│   │   ├── CostByServiceDonut.tsx          # Recharts donut chart
│   │   ├── DailyTrendChart.tsx             # Recharts bar/line chart
│   │   └── AlertsBanner.tsx               # Red/yellow alert list
│   ├── policy/
│   │   ├── PolicyEditor.tsx               # The policy form
│   │   ├── PolicyInheritanceBadge.tsx     # "Inherited from college" indicator
│   │   ├── TokenLimitInput.tsx            # Input with live cost estimate
│   │   └── MarginCalculator.tsx           # Revenue vs cost margin display
│   ├── costs/
│   │   ├── CollegeCostDetail.tsx
│   │   ├── DeptCostDetail.tsx
│   │   ├── TopStudentsTable.tsx           # Masked student usage table
│   │   ├── PerQueryAnalysis.tsx           # Cost breakdown per action
│   │   └── CostExportButton.tsx           # CSV download
│   └── cost-planner/
│       ├── CollegeProfileForm.tsx         # Usage assumption inputs
│       ├── ProjectedCostBreakdown.tsx     # Computed cost by service
│       └── PricingSimulator.tsx           # Revenue vs cost margin
│
└── store/
    ├── superAdmin.store.ts                # Auth state, current admin info
    └── costDashboard.store.ts             # Selected month, filters
```

---

## 14. Environment Variables

```bash
# Addition to services/api/.env

# Super Admin auth
SUPER_ADMIN_JWT_SECRET=<very-long-secret-different-from-student-jwt-secret>
SUPER_ADMIN_JWT_EXPIRY=8h
SUPER_ADMIN_REFRESH_TTL=604800            # 7 days in seconds
SUPER_ADMIN_LOGIN_MAX_ATTEMPTS=5
SUPER_ADMIN_LOCKOUT_MINUTES=30
SUPER_ADMIN_PORTAL_URL=https://admin.edumindai.com

# MFA (TOTP)
MFA_ISSUER=EduMind AI Console
MFA_TOTP_WINDOW=1                         # ±1 time step tolerance (30s each)

# Rate table defaults (used to seed initial rate_table collection)
ANTHROPIC_HAIKU_INPUT_COST_PER_1K=0.00025
ANTHROPIC_HAIKU_OUTPUT_COST_PER_1K=0.00125
ANTHROPIC_SONNET_INPUT_COST_PER_1K=0.003
ANTHROPIC_SONNET_OUTPUT_COST_PER_1K=0.015
OPENAI_EMBEDDING_COST_PER_1K=0.00002
COHERE_RERANK_COST_PER_1K=0.001
PINECONE_READ_UNIT_COST_PER_1M=0.096
PINECONE_STORAGE_COST_PER_GB=0.35

# Alert evaluation
ALERT_EVALUATION_INTERVAL_MINUTES=15
ALERT_EMAIL_FROM=alerts@edumindai.com
ALERT_EMAIL_TO=sudipta@edumindai.com     # comma-separated for multiple recipients

# Cost summary rebuild
COST_SUMMARY_REBUILD_CRON=0 1 * * *      # 1 AM daily
PLATFORM_AVERAGES_CACHE_TTL=86400        # 24 hours

# Default global policy (used when no college/dept policy exists)
DEFAULT_TOKEN_LIMIT_PER_MONTH=5000000
DEFAULT_COST_BUDGET_USD=2.50
DEFAULT_MAX_CHATS_PER_STUDENT_PER_DAY=50
DEFAULT_MAX_SUMMARIES_PER_STUDENT_PER_DAY=10
DEFAULT_MAX_EXAM_GEN_PER_STUDENT_PER_DAY=5
DEFAULT_STORAGE_LIMIT_GB=50
```

---

## 15. Build Order

Add as **Phase 10 — Super Admin Cost Intelligence** (after Phase 9 in main spec):

```
Phase 10 — Super Admin Cost Intelligence

Step 1 — Database setup
  → Seed rate_table collection with current vendor pricing
  → Create cost_policies collection + seed global default policy
  → Create cost_events collection + all indexes
  → Create monthly_cost_summaries collection + indexes
  → Create platform_admins collection (add mfa_secret, failed_login_attempts, locked_until)
  → Create alerts collection

Step 2 — Metering hooks (insert into existing services)
  → Wrap llm.service.ts: callLLMWithMetering()
  → Wrap embedding.service.ts: embedWithMetering()
  → Wrap pinecone.service.ts: queryWithMetering() + upsertWithMetering()
  → Wrap rag.service.ts: add Cohere rerank metering
  → Validate: send a test chat → check cost_events record created

Step 3 — Policy engine
  → resolvePolicy() function (cascade: global → college → dept)
  → enforceCostPolicy() middleware (called before every LLM call)
  → CRUD API for cost_policies (tRPC router)
  → Test: set token limit to 1 → verify next chat returns 429

Step 4 — Super Admin auth
  → POST /auth/super-admin/login (email + password + lockout)
  → POST /auth/super-admin/mfa-verify (TOTP with speakeasy)
  → POST /auth/super-admin/logout + refresh
  → Super Admin JWT middleware (separate from student/dept middleware)
  → Seed first super admin account via CLI: node infra/seed-super-admin.ts

Step 5 — Nightly jobs
  → rebuildMonthlyCostSummaries() cron (1 AM daily)
  → evaluateAlerts() cron (every 15 minutes)
  → getPlatformAverages() — rebuild and cache in Redis (daily)
  → cleanupOldCostEvents() — archive cost_events older than 24 months

Step 6 — Dashboard API routes
  → GET /super-admin/dashboard (platform overview)
  → GET /super-admin/colleges/:cid/costs (college drilldown)
  → GET /super-admin/colleges/:cid/depts/:did/costs (dept drilldown)
  → GET /super-admin/cost-planner/platform-averages
  → POST /super-admin/cost-planner/simulate
  → GET /super-admin/rate-table + PUT (update pricing)
  → GET /super-admin/alerts

Step 7 — Frontend (apps/super-admin)
  → Login page + MFA step component
  → Platform dashboard: KPI cards, college cost table, service donut, daily trend
  → College cost drilldown page
  → Dept cost drilldown page + top students table
  → Policy editor: global, per-college, per-dept with inheritance indicators
  → Cost plan builder (simulation form + output)
  → Alerts page

Step 8 — Testing
  → Login with wrong password × 5 → verify lockout triggers
  → Login with correct credentials → verify JWT + session activity log
  → Enable MFA → verify TOTP flow
  → Send 10 chat messages → verify 10 cost_events created with correct $ amounts
  → Set college token limit to 0 → verify next student chat returns 403
  → Set soft warn to 80% → exhaust 80% of tokens → verify alert created
  → Set dept policy (lower than college) → verify dept limit enforced independently
  → Run cost summary rebuild → verify monthly_cost_summaries populated
  → Open dashboard → verify college cost table sums match cost_events
  → Export CSV → verify all columns present and correct
  → Run cost planner simulation → verify numbers match manual calculation
```

---

*Document: F-12-super-admin-cost-intelligence.md · v1.0 · May 2026 · Extends college-chatbot-architecture.md v2.0*  
*For Claude Code: implement Phase 10 steps in order. Metering hooks (Step 2) are the highest-priority item — without them, the dashboard has no data.*
