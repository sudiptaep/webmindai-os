# F-16: College Admin Role System
## Three-Tier Admin Hierarchy · College Admin · Dept Admin · Super Admin User Creation

> **Parent doc:** `college-chatbot-architecture.md` v2.0  
> **Problem being solved:** The current architecture has only two admin roles — `super_admin` and `dept_admin` (with a boolean `is_college_owner` flag). This is insufficient. A Principal or HOD needs a dedicated role that gives them cross-department visibility without system-level super powers. Dept faculty need a clean, scoped login that shows only their one department. Super Admin needs a UI to provision both types without CLI access.  
> **What this document does:** Introduces `college_admin` as a first-class role. Refactors the `dept_admin` role to be purely single-department. Adds a full User Management screen to the Super Admin portal for creating, editing, and deactivating both types. Updates all JWT middleware, permission matrices, and API routes to reflect the new hierarchy.  
> **Version:** 1.0 · May 2026

---

## Table of Contents

1. [The Problem with the Current Role System](#1-the-problem-with-the-current-role-system)
2. [The New Three-Tier Hierarchy](#2-the-new-three-tier-hierarchy)
3. [Role Definitions — Precise Permissions](#3-role-definitions--precise-permissions)
4. [Updated Permission Matrix](#4-updated-permission-matrix)
5. [Database Schema — Changes and Additions](#5-database-schema--changes-and-additions)
6. [F-16-A: College Admin — What They See](#6-f-16-a-college-admin--what-they-see)
7. [F-16-B: Dept Admin — Scoped Login](#7-f-16-b-dept-admin--scoped-login)
8. [F-16-C: Super Admin — User Management Screen](#8-f-16-c-super-admin--user-management-screen)
9. [F-16-D: Invitation & Onboarding Flow](#9-f-16-d-invitation--onboarding-flow)
10. [Updated Authentication & JWT](#10-updated-authentication--jwt)
11. [Updated Middleware Stack](#11-updated-middleware-stack)
12. [API Route Map — New & Updated Routes](#12-api-route-map--new--updated-routes)
13. [Frontend Component Tree](#13-frontend-component-tree)
14. [Migration from v1 Role System](#14-migration-from-v1-role-system)
15. [Environment Variables](#15-environment-variables)
16. [Build Order](#16-build-order)

---

## 1. The Problem with the Current Role System

### What exists today

```
super_admin          — platform owner, you
dept_admin           — faculty, manages one or more depts
  └── is_college_owner: Boolean    ← hacky way to give cross-dept access
```

The `is_college_owner` boolean on `dept_admin` was a temporary workaround. It created several problems:

**Problem 1 — Ambiguous identity.** A user with `is_college_owner: true` is simultaneously a department admin and a college-level viewer. There is no clean answer to "what can this person do?" — it depends on which route they're hitting.

**Problem 2 — Wrong analytics scope.** The HOD of MSRIT Medical College wants to see across ALL departments — student activity, confusion heatmaps, unanswered queries — for every department under them. The current `dept_admin` role only ever queries one department's data. Giving the HOD `dept_ids: ["all_depts"]` is fragile and breaks when new departments are added.

**Problem 3 — No self-service user creation.** Right now, creating a `dept_admin` requires either CLI access to MongoDB or an API call from Super Admin. There is no UI for Super Admin to create college admin or dept admin users. This doesn't scale beyond 2–3 colleges.

**Problem 4 — Wrong login page UX.** A `dept_admin` who is the college owner and a `dept_admin` who is a faculty member for one subject both hit the same login page and see the same post-login screen. The Principal of a medical college should land on a completely different dashboard than a single-department faculty member.

### What the new system needs

```
super_admin          — platform owner, you
  └── creates colleges + creates college_admin users

college_admin        — Principal / HOD / Registrar / Dean
  └── sees ALL departments of their college
  └── can create dept_admin users for their college
  └── can view but NOT modify documents (read-only on content)

dept_admin           — Faculty / Subject Teacher
  └── sees ONLY their one assigned department
  └── cannot see other departments even in the same college
  └── cannot create other users
```

---

## 2. The New Three-Tier Hierarchy

```
TIER 1: super_admin
│  Your team only. Platform-wide. Provisions colleges.
│  Creates college_admin users for each college.
│
├── TIER 2: college_admin (NEW ROLE)
│   One or more per college (Principal, HOD, Dean, Registrar...)
│   Sees ALL departments of their college.
│   Can create dept_admin users within their college.
│   Read-only on documents — cannot upload or delete.
│   Full visibility: cross-dept analytics, all student activity.
│   Scope: one college, all departments.
│   │
│   └── TIER 3: dept_admin (REFINED — no longer has is_college_owner)
│       One per department (faculty, lab in-charge, subject teacher).
│       Sees ONLY their assigned department.
│       Read-write on documents — upload, delete, reingest.
│       View own dept analytics only.
│       Scope: one college, exactly one department.
│
└── TIER 0: student
    Self-registers. Sees their department's content only.
```

### Who creates whom

| Creator | Can create |
|---|---|
| Super Admin | college_admin (for any college), dept_admin (for any dept) |
| college_admin | dept_admin (only within their own college) |
| dept_admin | No user creation ability |
| student | No user creation ability |

---

## 3. Role Definitions — Precise Permissions

### Role: `college_admin` (new)

**Who:** Principal, Dean, HOD (college-wide), Registrar, academic coordinator  
**Scope:** Single college, ALL departments  
**Login URL:** `https://{slug}.edumindai.com/college-admin/login`  
**Post-login:** College Dashboard — cross-department view

**Can do:**
- View all departments in their college (list, stats, document counts)
- View analytics for ALL departments simultaneously — query volume, confusion heatmaps, unanswered queries
- View list of all documents per department (cannot upload or delete)
- View list of all students per department (cannot modify)
- View all dept admin users in their college + their activity
- **Create** dept_admin users for any department in their college
- **Deactivate** dept_admin users in their college
- **Reset password** for dept_admin users in their college
- View cost usage for their entire college (read-only, not editable)
- Create and manage subjects across departments
- Flag unanswered queries across departments for respective dept admins
- Export reports (student counts, document counts, usage) as CSV/PDF

**Cannot do:**
- Upload, delete, or reingest documents
- Modify or delete departments (only Super Admin can)
- Access other colleges
- Change billing or LLM token limits (Super Admin only)
- Approve or deny student registrations (auto-approved)

### Role: `dept_admin` (refined — simpler than before)

**Who:** Faculty member, subject teacher, lab in-charge  
**Scope:** Single college, single assigned department  
**Login URL:** `https://{slug}.edumindai.com/dept-admin/login`  
**Post-login:** Department Dashboard — one department view

**Can do:**
- Upload documents (PDF, PPT, MP4, DOCX) to their department
- Delete and reingest their department's documents
- Create and manage subjects within their department
- View analytics for their department only
- View their department's student list (read-only)
- View their department's unanswered query log and flag/resolve items
- Reset a student's password within their department

**Cannot do:**
- See any other department's data, documents, or analytics
- Create any users
- See college-level aggregated analytics
- Access any other college

### Role: `super_admin` (expanded responsibilities)

**New capabilities added:**
- Full User Management UI to create `college_admin` and `dept_admin` users for any college
- View all `college_admin` and `dept_admin` users across the platform
- Deactivate or reset passwords for any admin user at any level
- Impersonate any `college_admin` or `dept_admin` (view as them) for support

---

## 4. Updated Permission Matrix

| Action | super_admin | college_admin | dept_admin | student |
|---|:---:|:---:|:---:|:---:|
| Create college | ✓ | ✗ | ✗ | ✗ |
| Delete college (soft) | ✓ | ✗ | ✗ | ✗ |
| Create department | ✓ | ✗ | ✗ | ✗ |
| Delete department | ✓ | ✗ | ✗ | ✗ |
| **Create college_admin** | ✓ | ✗ | ✗ | ✗ |
| **Create dept_admin** | ✓ | ✓ (own college) | ✗ | ✗ |
| **Deactivate college_admin** | ✓ | ✗ | ✗ | ✗ |
| **Deactivate dept_admin** | ✓ | ✓ (own college) | ✗ | ✗ |
| **View all departments (cross-dept)** | ✓ | ✓ (own college) | ✗ | ✗ |
| View own department | ✓ | ✓ | ✓ | ✗ |
| Upload documents | ✓ | ✗ | ✓ (own dept) | ✗ |
| Delete documents | ✓ | ✗ | ✓ (own dept) | ✗ |
| Reingest documents | ✓ | ✗ | ✓ (own dept) | ✗ |
| View documents (read-only) | ✓ | ✓ (all depts) | ✓ (own dept) | ✓ (own dept) |
| Manage subjects | ✓ | ✓ (any dept) | ✓ (own dept) | ✗ |
| **View cross-dept analytics** | ✓ | ✓ (own college) | ✗ | ✗ |
| View own dept analytics | ✓ | ✓ | ✓ | ✗ |
| View student list | ✓ | ✓ (all depts) | ✓ (own dept) | ✗ |
| Disable student | ✓ | ✓ (own college) | ✓ (own dept) | ✗ |
| Reset student password | ✓ | ✓ (own college) | ✓ (own dept) | ✗ |
| Chat with bot | ✗ | ✗ | ✗ | ✓ |
| Set LLM token limits | ✓ | ✗ | ✗ | ✗ |
| View cost usage | ✓ | ✓ (read-only, own college) | ✗ | ✗ |
| Delete Generic Dept | ✗ | ✗ | ✗ | ✗ |
| **Impersonate college_admin** | ✓ | ✗ | ✗ | ✗ |
| **Impersonate dept_admin** | ✓ | ✗ | ✗ | ✗ |

---

## 5. Database Schema — Changes and Additions

### 5.1 New collection: `college_admins` (per-college DB)

Previously, college-level users were stored as `dept_admins` with `is_college_owner: true`. This was wrong. They now get their own collection with their own schema.

```js
// college_admins collection (in college_{college_id} DB)
{
  _id: UUID,                           // college_admin_id
  college_id: UUID,                    // which college they administer

  // Identity
  name: String,
  email: String,
  password_hash: String,               // bcrypt, 12 rounds
  phone: String,                       // optional — for SMS alerts

  // Role
  role: "college_admin",               // hardcoded
  admin_title: String,                 // "Principal" | "HOD" | "Dean" | "Registrar" | "Custom"
  custom_title: String,                // if admin_title = "Custom"

  // Permissions — what college_admin can do within their college
  can_create_dept_admins: Boolean,     // default true
  can_deactivate_dept_admins: Boolean, // default true
  can_view_student_list: Boolean,      // default true
  can_export_reports: Boolean,         // default true
  can_view_cost_usage: Boolean,        // default false — turn on for finance HOD

  // Status
  status: Enum["active", "invited", "disabled"],
  invite_token: String,                // UUID set on creation, cleared on first login
  invite_token_expires_at: Date,       // 7 days from creation
  invited_by: UUID,                    // platform_admin_id who created this
  invite_accepted_at: Date,

  // Session tracking
  last_login: Date,
  last_login_ip: String,
  last_login_user_agent: String,
  login_count: Number,

  // Password management
  password_reset_token: String,
  password_reset_expires_at: Date,
  must_change_password: Boolean,       // set to true on first invite

  created_at: Date,
  updated_at: Date
}

// Indexes
db.college_admins.createIndex({ email: 1 }, { unique: true });
db.college_admins.createIndex({ college_id: 1, status: 1 });
db.college_admins.createIndex({ invite_token: 1 });
```

### 5.2 Updated `dept_admins` collection (per-college DB)

The `is_college_owner` boolean is removed entirely. Dept admins now have exactly one department.

```js
// dept_admins collection — UPDATED schema (removes is_college_owner)
{
  _id: UUID,                           // dept_admin_id
  college_id: UUID,
  dept_id: UUID,                       // CHANGED: single UUID, not an array
                                        // Each faculty member manages exactly one dept
                                        // If someone manages 2 depts, create 2 dept_admin records

  // Identity
  name: String,
  email: String,
  password_hash: String,
  phone: String,                       // optional

  // Role
  role: "dept_admin",
  faculty_title: String,               // "Professor" | "Associate Prof" | "Assistant Prof" | "Lab In-Charge"

  // REMOVED: is_college_owner: Boolean   ← this field is deleted

  // Permissions within their dept
  can_upload_documents: Boolean,       // default true
  can_delete_documents: Boolean,       // default true
  can_manage_subjects: Boolean,        // default true
  can_view_student_list: Boolean,      // default true
  can_reset_student_passwords: Boolean,// default false — only enable for dept coordinators

  // Status
  status: Enum["active", "invited", "disabled"],
  invite_token: String,
  invite_token_expires_at: Date,
  invited_by: UUID,                    // college_admin_id OR platform_admin_id
  invited_by_role: Enum["super_admin", "college_admin"],
  invite_accepted_at: Date,

  // Session tracking
  last_login: Date,
  last_login_ip: String,
  login_count: Number,

  // Password management
  password_reset_token: String,
  password_reset_expires_at: Date,
  must_change_password: Boolean,

  created_at: Date,
  updated_at: Date
}

// Indexes (updated)
db.dept_admins.createIndex({ email: 1 }, { unique: true });
db.dept_admins.createIndex({ college_id: 1, dept_id: 1, status: 1 });
db.dept_admins.createIndex({ invite_token: 1 });
```

### 5.3 Updated platform `colleges` collection

Add tracking of college_admin count for Super Admin dashboard:

```js
// additions to colleges collection in platform DB
{
  // ... all existing fields ...
  college_admin_count: Number,          // denormalised count
  dept_admin_count: Number,             // denormalised count
  primary_contact_email: String,        // first college_admin email — for billing/alerts
}
```

### 5.4 New collection: `admin_activity_logs` (per-college DB)

Track every admin action for audit trail:

```js
{
  _id: UUID,
  college_id: UUID,

  // Who did it
  actor_id: UUID,
  actor_role: Enum["super_admin", "college_admin", "dept_admin"],
  actor_name: String,                  // denormalised for readability

  // What they did
  action: Enum[
    "create_college_admin",
    "create_dept_admin",
    "deactivate_college_admin",
    "deactivate_dept_admin",
    "reset_admin_password",
    "upload_document",
    "delete_document",
    "reingest_document",
    "create_subject",
    "delete_subject",
    "create_department",
    "disable_student",
    "reset_student_password",
    "update_college_admin_permissions",
    "update_dept_admin_permissions",
    "impersonate_admin"
  ],

  // What was affected
  target_type: Enum["college_admin", "dept_admin", "student", "document", "subject", "department"],
  target_id: UUID,
  target_name: String,                 // denormalised

  // Context
  dept_id: UUID,                       // null for college-level actions
  dept_name: String,
  metadata: Object,                    // free JSON for action-specific details

  // Request context
  ip_address: String,
  user_agent: String,
  created_at: Date
}

db.admin_activity_logs.createIndex({ college_id: 1, created_at: -1 });
db.admin_activity_logs.createIndex({ actor_id: 1, created_at: -1 });
db.admin_activity_logs.createIndex({ action: 1, created_at: -1 });
```

---

## 6. F-16-A: College Admin — What They See

### 6.1 Login page

**URL:** `https://{slug}.edumindai.com/college-admin/login`

The login page is visually distinct from the dept_admin login. It shows:
- College logo and name (fetched by slug)
- "College Administration Portal" subtitle
- Email + password fields
- "For faculty login, use: /dept-admin/login" — small footer link

### 6.2 College Admin Dashboard

The first screen after login. Shows the entire college at a glance.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ MSRIT Medical College          [Dr. Priya Nair — Principal]      [Logout]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ College Overview                                        May 2026            │
│ ─────────────────────────────────────────────────────────────────────────── │
│ ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────┐ │
│ │ 6 Departments  │  │ 847 Students   │  │ 3,241 Queries  │  │ 87% Answd  │ │
│ │ 4 with content │  │ 214 active now │  │ this week      │  │            │ │
│ └────────────────┘  └────────────────┘  └────────────────┘  └────────────┘ │
│                                                                              │
│ Departments                                            [+ Create Dept Admin] │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Department        Admin         Documents  Students  Queries/wk  Status    │
│ ● Pharmacology    Dr. Sharma    14 docs    142 stu   1,240 Q     Active   │
│ ● Anatomy         Dr. Kumar     11 docs    138 stu   980 Q       Active   │
│ ● Physiology      Dr. Menon     9 docs     112 stu   742 Q       Active   │
│ ● Pathology       Dr. Raj       8 docs     98 stu    621 Q       Active   │
│ ⚠ Surgery        (No admin)    0 docs     88 stu    0 Q         No Admin  │
│ ⚠ General (FB)   —             3 docs     269 stu   —           Fallback  │
│                                                                              │
│ Confusion Heatmap — All Departments                                         │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Pharmacology · Renal Physiology     ████████████ 47 queries   [View →]     │
│ Anatomy · Brachial Plexus           █████████    38 queries   [View →]     │
│ Physiology · Cardiac Cycle          ███████      29 queries   [View →]     │
│ Pathology · Enzyme Kinetics         █████        21 queries   [View →]     │
│                                                                              │
│ Unanswered Queries — Across All Departments (34 pending)                    │
│ ─────────────────────────────────────────────────────────────────────────── │
│ 15 in Pharmacology (content gap)   8 in Anatomy   6 in Physiology   5 other│
│                                     [View full unanswered queue →]          │
│                                                                              │
│ Faculty (Dept Admins)               [+ Add Dept Admin]                     │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Dr. R. Sharma    Pharmacology    Active    Last login: 2h ago              │
│ Dr. A. Kumar     Anatomy         Active    Last login: 1d ago              │
│ Dr. P. Menon     Physiology      Active    Last login: 3d ago              │
│ Dr. K. Raj       Pathology       Invited   (Pending acceptance)            │
│ [Surgery dept]   —               Vacant    [+ Assign faculty →]            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Cross-department analytics view

Dedicated `/college-admin/analytics` page with:

**Tab 1 — Usage Overview**
- Daily query volume across all departments (stacked bar chart by dept)
- Answer rate per department (table + colour indicators)
- Top 20 most asked questions platform-wide for this college

**Tab 2 — Confusion Heatmap (college-wide)**
- Aggregated confusion scores across all departments
- Filter: department, date range, subject
- Drill to specific department → specific question

**Tab 3 — Unanswered Queries Queue**
- All unanswered queries across all departments in one list
- Assign to dept admin for follow-up
- Mark as "out of scope", "content added", "pending"

**Tab 4 — Faculty Activity**
- When each dept admin last logged in
- How many documents each dept admin uploaded this month
- Documents with failed ingestion (alert to fix)

**Tab 5 — Student Overview**
- Student count per department and their activity
- Students still on Generic Dept fallback (their dept has no content)
- Recently registered students

### 6.4 Department drill-down (from College Admin)

When clicking on a department row in the dashboard:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← College Dashboard     Pharmacology Department                             │
│                          Dept Admin: Dr. R. Sharma [Last active: 2h ago]   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐ │
│ │ 14 Documents  │  │ 142 Students  │  │ 1,240 Q/wk   │  │ 6 Unanswered  │ │
│ └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘ │
│                                                                              │
│ Documents (read-only view — contact Dr. Sharma to modify)                   │
│ Guyton 13th Ed.pdf      46.5 MB   ✓ Ingested   48 chapters                │
│ Kandel Neuroscience.pdf 66.2 MB   ✓ Ingested   32 chapters                │
│ KD Tripathi.pdf         28.4 MB   ✓ Ingested   41 chapters                │
│ [+ 11 more documents]                                                       │
│                                                                              │
│ Confusion Topics this week                                                  │
│ Renal Physiology (47 queries, low confidence)                              │
│ Drug Interactions (38 queries, partially answered)                         │
│                                                                              │
│ [Message Dr. Sharma about unanswered queries →]    [View full analytics →] │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key constraint:** College Admin sees documents, analytics, and student lists for ALL departments — but the upload/delete/reingest actions are hidden (greyed out with tooltip: "Only Dr. Sharma can manage Pharmacology documents"). The college admin is a viewer for department content, not a manager.

---

## 7. F-16-B: Dept Admin — Scoped Login

### 7.1 Login page

**URL:** `https://{slug}.edumindai.com/dept-admin/login`

After authentication, the JWT contains:
```json
{
  "sub": "dept_admin_uuid",
  "role": "dept_admin",
  "college_id": "college_uuid",
  "dept_id": "pharmacology_dept_uuid",
  "dept_name": "Pharmacology",
  "college_slug": "msrit"
}
```

The dept_admin UI is completely pre-filtered to their one department. There is no department selector dropdown. The header shows their department name, not the college name.

### 7.2 Dept Admin Dashboard

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Pharmacology Department          [Dr. R. Sharma — Associate Professor] [↓]  │
│ MSRIT Medical College                                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ This Week                                                                   │
│ ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────┐ │
│ │ 1,240 Queries  │  │ 87% Answered   │  │ 142 Students   │  │ 6 Pending  │ │
│ │                │  │                │  │ 94 active      │  │ Questions  │ │
│ └────────────────┘  └────────────────┘  └────────────────┘  └────────────┘ │
│                                                                              │
│ My Documents                                    [+ Upload Document]         │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Guyton 13th Ed.pdf      ✓ 48 chapters   90%  [Study] [Reingest] [Delete]  │
│ KD Tripathi.pdf         ✓ 41 chapters   87%  [Study] [Reingest] [Delete]  │
│ PYQ 2022-24.pdf         ✓ 312 questions      [View] [Reingest] [Delete]   │
│ Faculty Notes Ch.4.pdf  ⏳ Processing…       [Cancel]                      │
│                                                                              │
│ Student Confusion — This Week                                               │
│ Renal Physiology          47 queries  ████████████ [Add content]           │
│ Drug Interactions         38 queries  █████████    [Add content]           │
│ Cardiac Cycle             29 queries  ███████      Mostly answered ✓       │
│                                                                              │
│ Unanswered Queries (6 pending)        [View full queue]                     │
│ "What are the side effects of..."   May 19 · 11:42 PM  [Mark resolved]    │
│ "Explain the action of diuretics..."May 18 · 9:15 PM   [Mark resolved]    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

The dept admin sees NOTHING from other departments. No "switch department" option. No college-level stats. This is their complete world.

---

## 8. F-16-C: Super Admin — User Management Screen

### 8.1 Where it lives

A new top-level navigation item in the Super Admin portal: **Users** (alongside Colleges, Policies, Observatory, Reports).

**URL:** `/super-admin/users`

### 8.2 User management screen layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🧠 EduMind AI Console    Colleges  Policies  Observatory  Reports  [Users ●]  Settings  [SK] │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  USER MANAGEMENT                                         [+ Create College Admin]           │
│                                                          [+ Create Dept Admin]              │
│                                                                                              │
│  Filter: [All roles ▼]  [All colleges ▼]  [All statuses ▼]  [Search name/email...]         │
│                                                                                              │
│  COLLEGE ADMINS (14 total)                                                                  │
│  ─────────────────────────────────────────────────────────────────────────────────────────  │
│  Name              College               Title          Status    Last Login    Actions     │
│  Dr. Priya Nair    MSRIT Medical         Principal      ● Active  2h ago        [Edit][✗]  │
│  Mr. K. Venkat     MSRIT Medical         Registrar      ● Active  1d ago        [Edit][✗]  │
│  Dr. A. Sharma     Dayananda Eng         Dean           ● Active  3d ago        [Edit][✗]  │
│  Dr. M. Pillai     KLE Medical           Principal      ● Active  5h ago        [Edit][✗]  │
│  Dr. R. Iyer       PESCE Engineering     HOD            ⏳ Invited (Pending)     [Resend]   │
│  [... 9 more ...]                                                        [Export CSV]       │
│                                                                                              │
│  DEPT ADMINS (42 total)                                                                     │
│  ─────────────────────────────────────────────────────────────────────────────────────────  │
│  Name              College               Department     Status    Last Login    Actions     │
│  Dr. R. Sharma     MSRIT Medical         Pharmacology   ● Active  2h ago        [Edit][✗]  │
│  Dr. A. Kumar      MSRIT Medical         Anatomy        ● Active  1d ago        [Edit][✗]  │
│  Dr. P. Menon      MSRIT Medical         Physiology     ● Active  3d ago        [Edit][✗]  │
│  Prof. S. Rao      Dayananda Eng         CSE            ● Active  6h ago        [Edit][✗]  │
│  Prof. M. Das      Dayananda Eng         ECE            ⏳ Invited (Pending)     [Resend]   │
│  Prof. T. Nair     KLE Medical           Pathology      ✗ Disabled (12 May)     [Reactivate]│
│  [... 36 more ...]                                                       [Export CSV]       │
│                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Create College Admin form (Super Admin)

Triggered by `[+ Create College Admin]` button. Slide-over panel:

```
┌──────────────────────────────────────────────────────────────┐
│ Create College Admin                                   [✕]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ College *          [MSRIT Medical College ▼]                 │
│                                                              │
│ Full Name *        [Dr. Priya Nair                      ]   │
│                                                              │
│ Work Email *       [p.nair@msrit.edu                    ]   │
│                                                              │
│ Title *            [Principal ▼]                            │
│                    (Principal / Dean / HOD / Registrar /    │
│                     Academic Director / Custom)             │
│                                                              │
│ Phone              [+91 98765 43210                     ]   │
│                                                              │
│ Permissions                                                  │
│ ─────────────────────────────────────────────────────────── │
│ [✓] Can create dept admins for their college                │
│ [✓] Can deactivate dept admins                              │
│ [✓] Can view student list                                   │
│ [✓] Can export reports                                      │
│ [ ] Can view cost usage (billing)      ← off by default    │
│                                                              │
│ ─────────────────────────────────────────────────────────── │
│ An invitation email will be sent to p.nair@msrit.edu        │
│ They set their own password on first login.                 │
│                                                              │
│           [Cancel]        [Create & Send Invite]           │
└──────────────────────────────────────────────────────────────┘
```

### 8.4 Create Dept Admin form (Super Admin)

```
┌──────────────────────────────────────────────────────────────┐
│ Create Dept Admin                                      [✕]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ College *          [MSRIT Medical College ▼]                 │
│                                                              │
│ Department *       [Pharmacology ▼]                          │
│                    (Shows all depts for selected college)    │
│                                                              │
│ Full Name *        [Dr. R. Sharma                       ]   │
│                                                              │
│ Work Email *       [r.sharma@msrit.edu                  ]   │
│                                                              │
│ Faculty Title      [Associate Professor ▼]                  │
│                    (Professor / Assoc. Prof / Asst. Prof /  │
│                     Lab In-Charge / Coordinator)            │
│                                                              │
│ Phone              [+91 99887 76655                     ]   │
│                                                              │
│ Permissions within their department                         │
│ ─────────────────────────────────────────────────────────── │
│ [✓] Can upload documents                                    │
│ [✓] Can delete documents                                    │
│ [✓] Can manage subjects                                     │
│ [✓] Can view student list                                   │
│ [ ] Can reset student passwords    ← off by default        │
│                                                              │
│           [Cancel]        [Create & Send Invite]           │
└──────────────────────────────────────────────────────────────┘
```

### 8.5 Create Dept Admin form (College Admin)

College Admins can also create Dept Admins, but with reduced options — they can only create within their own college, and they cannot change permissions (defaults apply):

```
┌──────────────────────────────────────────────────────────────┐
│ Add Faculty to Department                              [✕]  │
│ MSRIT Medical College                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Department *       [Surgery ▼]                              │
│                    (Only departments in their college)       │
│                                                              │
│ Full Name *        [Dr. T. Reddy                        ]   │
│                                                              │
│ Work Email *       [t.reddy@msrit.edu                   ]   │
│                                                              │
│ Faculty Title      [Professor ▼]                            │
│                                                              │
│ ─────────────────────────────────────────────────────────── │
│ An invitation email will be sent to t.reddy@msrit.edu       │
│ Standard department admin permissions will apply.           │
│ (To customise permissions, contact the platform admin)      │
│                                                              │
│           [Cancel]          [Send Invitation]              │
└──────────────────────────────────────────────────────────────┘
```

### 8.6 Edit user panel (Super Admin)

Clicking `[Edit]` on any user opens an edit slide-over:

```
┌──────────────────────────────────────────────────────────────┐
│ Edit College Admin                                     [✕]  │
│ Dr. Priya Nair · MSRIT Medical College                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Full Name          [Dr. Priya Nair                      ]   │
│ Title              [Principal ▼]                            │
│ Phone              [+91 98765 43210                     ]   │
│                                                              │
│ Permissions                                                  │
│ [✓] Can create dept admins                                  │
│ [✓] Can deactivate dept admins                              │
│ [✓] Can view student list                                   │
│ [✓] Can export reports                                      │
│ [✓] Can view cost usage                                     │
│                                                              │
│ Account                                                      │
│ Status: ● Active                                            │
│ Last login: 2h ago · 192.168.1.45                          │
│ Login count: 47                                             │
│ Member since: 2026-03-15                                    │
│                                                              │
│ ─────────────────────────────────────────────────────────── │
│ [Save Changes]   [Reset Password]   [Deactivate Account]   │
│                                                             │
│ Activity Log (last 10 actions)                              │
│ 2h ago   Viewed Pharmacology dept analytics                 │
│ 1d ago   Created dept admin Dr. T. Reddy (Surgery)         │
│ 3d ago   Reset student password (Roll: 22PH001)            │
│ [View full log →]                                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. F-16-D: Invitation & Onboarding Flow

### 9.1 Invitation email

When a college_admin or dept_admin is created, an invitation email is sent immediately.

**College Admin invitation email:**
```
Subject: You've been added as College Administrator — EduMind AI

Dr. Priya Nair,

You have been set up as the College Administrator for MSRIT Medical College
on EduMind AI — the AI-powered curriculum chatbot platform.

Your role: Principal
Access: All departments in MSRIT Medical College

Click the link below to set your password and access the platform:
[Accept Invitation & Set Password →]

https://msrit.edumindai.com/college-admin/accept-invite?token=abc123...

This link expires in 7 days.

Once logged in, you'll be able to:
• View all departments and their AI usage
• Monitor student confusion topics across all departments
• Add and manage faculty (dept admin) users
• Export college usage reports

Need help? Contact support@edumindai.com

— EduMind AI Team
```

**Dept Admin invitation email:**
```
Subject: You've been added as Dept Admin — Pharmacology · EduMind AI

Dr. R. Sharma,

You have been set up as the Department Administrator for:
Department: Pharmacology
College: MSRIT Medical College
Role: Associate Professor

[Accept Invitation & Set Password →]

https://msrit.edumindai.com/dept-admin/accept-invite?token=xyz789...

This link expires in 7 days.

Once logged in, you'll be able to:
• Upload textbooks, notes, and lecture videos for your students
• Monitor what your students are asking the AI
• See which topics confuse them most
• Generate quizzes and exam questions from your materials

— EduMind AI Team
```

### 9.2 Accept invitation flow

```
1. User clicks invitation link
2. System validates:
   a. Token exists in DB
   b. Token not expired (invite_token_expires_at > now)
   c. User status = "invited"
3. If invalid: "This invitation link has expired. Contact your administrator."
4. If valid: Show set-password form
   - Password: min 8 chars, 1 uppercase, 1 number
   - Confirm password
5. On submit:
   a. bcrypt.hash(password)
   b. Update user record:
      { password_hash, status: "active", invite_token: null,
        invite_token_expires_at: null, invite_accepted_at: now(),
        must_change_password: false }
   c. Issue JWT + refresh token
   d. Redirect to respective dashboard
      → college_admin: /college-admin/dashboard
      → dept_admin: /dept-admin/dashboard
```

### 9.3 Resend invitation

Super Admin or College Admin can resend an invitation if:
- Status = "invited" AND invite_token_expires_at < now (expired)
- Or any time (resend generates a new token and extends expiry by 7 days)

```
POST /api/v1/super-admin/users/college-admins/:adminId/resend-invite
POST /api/v1/super-admin/users/dept-admins/:adminId/resend-invite
POST /api/v1/college/:cid/college-admin/dept-admins/:adminId/resend-invite
```

### 9.4 Password reset (post-onboarding)

From the login page, "Forgot password?" link:
```
1. Enter email → system checks college_admins and dept_admins
2. If found: generate password_reset_token (UUID, 1h TTL)
3. Send password reset email with link
4. User clicks link → verify token → set new password → auto-login
```

---

## 10. Updated Authentication & JWT

### 10.1 Login endpoints

```
# College Admin login
POST /api/v1/auth/college-admin/login?college_slug=msrit
Body: { email, password }

# Accept invitation (set password on first login)
POST /api/v1/auth/college-admin/accept-invite
Body: { token, password }

POST /api/v1/auth/dept-admin/accept-invite
Body: { token, password }

# Password reset
POST /api/v1/auth/college-admin/forgot-password
POST /api/v1/auth/college-admin/reset-password
Body: { token, new_password }

POST /api/v1/auth/dept-admin/forgot-password
POST /api/v1/auth/dept-admin/reset-password
Body: { token, new_password }
```

### 10.2 Updated JWT payloads

**College Admin JWT:**
```json
{
  "sub": "college_admin_uuid",
  "role": "college_admin",
  "college_id": "college_uuid",
  "college_slug": "msrit",
  "college_name": "MSRIT Medical College",
  "admin_name": "Dr. Priya Nair",
  "admin_title": "Principal",
  "permissions": {
    "can_create_dept_admins": true,
    "can_deactivate_dept_admins": true,
    "can_view_student_list": true,
    "can_export_reports": true,
    "can_view_cost_usage": false
  },
  "iat": 1234567890,
  "exp": 1234567890
}
```

**Dept Admin JWT (updated — no is_college_owner, single dept_id):**
```json
{
  "sub": "dept_admin_uuid",
  "role": "dept_admin",
  "college_id": "college_uuid",
  "college_slug": "msrit",
  "dept_id": "pharmacology_dept_uuid",
  "dept_name": "Pharmacology",
  "admin_name": "Dr. R. Sharma",
  "faculty_title": "Associate Professor",
  "permissions": {
    "can_upload_documents": true,
    "can_delete_documents": true,
    "can_manage_subjects": true,
    "can_view_student_list": true,
    "can_reset_student_passwords": false
  },
  "iat": 1234567890,
  "exp": 1234567890
}
```

### 10.3 Token expiry and refresh

Both college_admin and dept_admin:
- Access token: 8 hours (longer than student's 1 hour — admins work long sessions)
- Refresh token: 30 days (stored in httpOnly cookie)
- Refresh token rotation on every use

---

## 11. Updated Middleware Stack

```typescript
// Updated middleware stack — 6 layers for admin routes

// Layer 1: JWT verification (all protected routes)
async function verifyJWT(req, reply) {
  const token = req.headers.authorization?.split(' ')[1];
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  req.jwtPayload = payload;
}

// Layer 2: Resolve college (all /college/:collegeId routes)
async function resolveCollege(req, reply) {
  const { collegeId } = req.params;
  const { college_id } = req.jwtPayload;
  if (college_id !== collegeId) return reply.status(403).send({ error: 'Cross-college access denied' });
  req.college = await platformDb.colleges.findOne({ _id: collegeId, status: 'active' });
  if (!req.college) return reply.status(404).send({ error: 'College not found or inactive' });
}

// Layer 3: Check role (role-specific routes)
async function checkRole(allowedRoles: string[]) {
  return (req, reply) => {
    if (!allowedRoles.includes(req.jwtPayload.role)) {
      return reply.status(403).send({ error: `Role '${req.jwtPayload.role}' cannot access this resource` });
    }
  };
}

// Layer 4: Check dept scope — for dept_admin routes
// dept_admin can ONLY access their one assigned dept
async function checkDeptScope(req, reply) {
  if (req.jwtPayload.role !== 'dept_admin') return; // college_admin and super_admin bypass this
  const { deptId } = req.params;
  if (deptId && req.jwtPayload.dept_id !== deptId) {
    return reply.status(403).send({ error: 'Department access denied' });
  }
}

// Layer 5: Check college_admin permission flag
async function checkCollegeAdminPermission(permissionKey: string) {
  return (req, reply) => {
    if (req.jwtPayload.role !== 'college_admin') return; // super_admin bypasses
    if (!req.jwtPayload.permissions[permissionKey]) {
      return reply.status(403).send({ error: `Permission '${permissionKey}' not granted to this account` });
    }
  };
}

// Layer 6: Check dept_admin permission flag
async function checkDeptAdminPermission(permissionKey: string) {
  return (req, reply) => {
    if (req.jwtPayload.role !== 'dept_admin') return;
    if (!req.jwtPayload.permissions[permissionKey]) {
      return reply.status(403).send({ error: `Permission '${permissionKey}' not granted` });
    }
  };
}
```

### Middleware chains per route type

```typescript
// Route accessible by: super_admin + college_admin (any dept within their college)
router.get('/college/:cid/analytics/cross-dept', [
  verifyJWT,
  resolveCollege,
  checkRole(['super_admin', 'college_admin']),
  // college_admin: full access to all depts in their college
  // dept_admin: 403
  // student: 403
]);

// Route accessible by: super_admin + college_admin + dept_admin (own dept only)
router.get('/college/:cid/dept/:deptId/documents', [
  verifyJWT,
  resolveCollege,
  checkRole(['super_admin', 'college_admin', 'dept_admin']),
  checkDeptScope,  // blocks dept_admin from accessing other depts
]);

// Route accessible by: dept_admin only (own dept, must have can_upload permission)
router.post('/college/:cid/dept/:deptId/documents/upload', [
  verifyJWT,
  resolveCollege,
  checkRole(['super_admin', 'dept_admin']),
  checkDeptScope,
  checkDeptAdminPermission('can_upload_documents'),
]);

// Route accessible by: super_admin only
router.post('/super-admin/users/college-admins', [
  verifyJWT,
  checkRole(['super_admin']),
]);

// Route accessible by: super_admin + college_admin with permission
router.post('/college/:cid/college-admin/dept-admins', [
  verifyJWT,
  resolveCollege,
  checkRole(['super_admin', 'college_admin']),
  checkCollegeAdminPermission('can_create_dept_admins'),
]);
```

---

## 12. API Route Map — New & Updated Routes

### New: College Admin auth routes

```
POST   /api/v1/auth/college-admin/login              ?college_slug=msrit
POST   /api/v1/auth/college-admin/accept-invite      Body: { token, password }
POST   /api/v1/auth/college-admin/forgot-password    Body: { email, college_slug }
POST   /api/v1/auth/college-admin/reset-password     Body: { token, new_password }
POST   /api/v1/auth/dept-admin/accept-invite         Body: { token, password }
POST   /api/v1/auth/dept-admin/forgot-password
POST   /api/v1/auth/dept-admin/reset-password
```

### New: Super Admin — User Management

```
# College Admins
GET    /api/v1/super-admin/users/college-admins               ?college_id=&status=&q=
POST   /api/v1/super-admin/users/college-admins               (create + invite)
GET    /api/v1/super-admin/users/college-admins/:adminId
PUT    /api/v1/super-admin/users/college-admins/:adminId       (edit name, title, permissions)
PATCH  /api/v1/super-admin/users/college-admins/:adminId/deactivate
PATCH  /api/v1/super-admin/users/college-admins/:adminId/reactivate
POST   /api/v1/super-admin/users/college-admins/:adminId/reset-password
POST   /api/v1/super-admin/users/college-admins/:adminId/resend-invite
GET    /api/v1/super-admin/users/college-admins/:adminId/activity-log
POST   /api/v1/super-admin/users/college-admins/:adminId/impersonate  (returns impersonation JWT)

# Dept Admins
GET    /api/v1/super-admin/users/dept-admins                  ?college_id=&dept_id=&status=&q=
POST   /api/v1/super-admin/users/dept-admins                  (create + invite)
GET    /api/v1/super-admin/users/dept-admins/:adminId
PUT    /api/v1/super-admin/users/dept-admins/:adminId
PATCH  /api/v1/super-admin/users/dept-admins/:adminId/deactivate
PATCH  /api/v1/super-admin/users/dept-admins/:adminId/reactivate
POST   /api/v1/super-admin/users/dept-admins/:adminId/reset-password
POST   /api/v1/super-admin/users/dept-admins/:adminId/resend-invite
GET    /api/v1/super-admin/users/dept-admins/:adminId/activity-log
POST   /api/v1/super-admin/users/dept-admins/:adminId/impersonate

# Bulk export
GET    /api/v1/super-admin/users/export?format=csv&role=college_admin|dept_admin
```

### New: College Admin — Their Own Portal Routes

```
# Dashboard
GET    /api/v1/college/:cid/college-admin/dashboard
       Response: { departments[], kpi_cards, confusion_heatmap, unanswered_queue, dept_admins[] }

# Cross-department analytics
GET    /api/v1/college/:cid/college-admin/analytics/cross-dept  ?date_from=&date_to=
GET    /api/v1/college/:cid/college-admin/analytics/dept/:deptId
GET    /api/v1/college/:cid/college-admin/analytics/confusion
GET    /api/v1/college/:cid/college-admin/analytics/unanswered
GET    /api/v1/college/:cid/college-admin/analytics/faculty-activity
GET    /api/v1/college/:cid/college-admin/analytics/students

# Departments (read-only for content)
GET    /api/v1/college/:cid/college-admin/departments
GET    /api/v1/college/:cid/college-admin/departments/:deptId
GET    /api/v1/college/:cid/college-admin/departments/:deptId/documents   (read-only)
GET    /api/v1/college/:cid/college-admin/departments/:deptId/students

# Subjects (college_admin CAN manage subjects)
GET    /api/v1/college/:cid/college-admin/subjects
POST   /api/v1/college/:cid/college-admin/subjects
PUT    /api/v1/college/:cid/college-admin/subjects/:subjectId
DELETE /api/v1/college/:cid/college-admin/subjects/:subjectId

# Dept Admin management (college_admin creates/manages dept admins)
GET    /api/v1/college/:cid/college-admin/dept-admins
POST   /api/v1/college/:cid/college-admin/dept-admins              (create + invite)
GET    /api/v1/college/:cid/college-admin/dept-admins/:adminId
PATCH  /api/v1/college/:cid/college-admin/dept-admins/:adminId/deactivate
PATCH  /api/v1/college/:cid/college-admin/dept-admins/:adminId/reactivate
POST   /api/v1/college/:cid/college-admin/dept-admins/:adminId/resend-invite
GET    /api/v1/college/:cid/college-admin/dept-admins/:adminId/activity-log

# Student management (college_admin can see and manage)
GET    /api/v1/college/:cid/college-admin/students               ?dept_id=&status=
PATCH  /api/v1/college/:cid/college-admin/students/:studentId/disable
POST   /api/v1/college/:cid/college-admin/students/:studentId/reset-password

# Reports (if can_export_reports permission)
GET    /api/v1/college/:cid/college-admin/reports/usage-summary  ?month=2026-05
GET    /api/v1/college/:cid/college-admin/reports/export         ?type=csv&month=

# Profile
GET    /api/v1/college/:cid/college-admin/profile
PUT    /api/v1/college/:cid/college-admin/profile                (name, phone only — not email)
POST   /api/v1/college/:cid/college-admin/profile/change-password
```

### Updated: Dept Admin routes (now explicitly single-dept)

```
# All existing dept_admin routes remain — but now enforced strictly to one dept
# No route accepts dept_id as a query param from dept_admin — it comes from JWT

GET    /api/v1/college/:cid/dept-admin/dashboard                 (dept_id from JWT)
GET    /api/v1/college/:cid/dept-admin/documents
POST   /api/v1/college/:cid/dept-admin/documents/upload
DELETE /api/v1/college/:cid/dept-admin/documents/:docId
POST   /api/v1/college/:cid/dept-admin/documents/:docId/reingest
GET    /api/v1/college/:cid/dept-admin/subjects
POST   /api/v1/college/:cid/dept-admin/subjects
PUT    /api/v1/college/:cid/dept-admin/subjects/:subjectId
DELETE /api/v1/college/:cid/dept-admin/subjects/:subjectId
GET    /api/v1/college/:cid/dept-admin/analytics/queries
GET    /api/v1/college/:cid/dept-admin/analytics/unanswered
GET    /api/v1/college/:cid/dept-admin/analytics/confusion
GET    /api/v1/college/:cid/dept-admin/students
PATCH  /api/v1/college/:cid/dept-admin/students/:studentId/disable
POST   /api/v1/college/:cid/dept-admin/students/:studentId/reset-password  (if permission)
GET    /api/v1/college/:cid/dept-admin/profile
PUT    /api/v1/college/:cid/dept-admin/profile
POST   /api/v1/college/:cid/dept-admin/profile/change-password
```

---

## 13. Frontend Component Tree

```
apps/admin/                              # RENAMED: was apps/admin-ui/
│                                        # Now hosts BOTH college_admin and dept_admin apps
│                                        # Role determines which layout renders post-login
├── app/
│   ├── (auth)/
│   │   ├── college-admin/
│   │   │   ├── login/page.tsx
│   │   │   ├── accept-invite/page.tsx
│   │   │   └── forgot-password/page.tsx
│   │   └── dept-admin/
│   │       ├── login/page.tsx
│   │       ├── accept-invite/page.tsx
│   │       └── forgot-password/page.tsx
│   │
│   ├── college-admin/                   # College Admin portal (all-dept view)
│   │   ├── layout.tsx                   # College Admin shell + nav
│   │   ├── dashboard/page.tsx           # Cross-dept overview
│   │   ├── departments/
│   │   │   ├── page.tsx                 # All departments list
│   │   │   └── [deptId]/page.tsx        # Single dept detail (read-only content)
│   │   ├── analytics/
│   │   │   ├── page.tsx                 # Overview
│   │   │   ├── confusion/page.tsx       # Cross-dept confusion heatmap
│   │   │   └── unanswered/page.tsx      # Unanswered queue
│   │   ├── faculty/
│   │   │   ├── page.tsx                 # All dept admins
│   │   │   ├── new/page.tsx             # Create dept admin form
│   │   │   └── [adminId]/page.tsx       # Edit / view dept admin
│   │   ├── students/page.tsx            # All students across depts
│   │   └── reports/page.tsx             # Export reports
│   │
│   └── dept-admin/                      # Dept Admin portal (single-dept view)
│       ├── layout.tsx                   # Dept Admin shell (shows dept name)
│       ├── dashboard/page.tsx           # Own dept overview
│       ├── documents/
│       │   ├── page.tsx                 # Document list + upload
│       │   └── [docId]/page.tsx         # Ingestion status
│       ├── subjects/page.tsx            # Subject management
│       ├── students/page.tsx            # Own dept students
│       ├── analytics/
│       │   ├── page.tsx                 # Dept analytics overview
│       │   └── unanswered/page.tsx      # Unanswered queue
│       └── profile/page.tsx             # Change password, name

apps/super-admin/app/dashboard/
├── users/
│   ├── page.tsx                         # User management main screen
│   ├── college-admins/
│   │   ├── new/page.tsx                 # Create college admin
│   │   └── [adminId]/page.tsx           # Edit college admin
│   └── dept-admins/
│       ├── new/page.tsx                 # Create dept admin
│       └── [adminId]/page.tsx           # Edit dept admin

components/admin/
├── college-admin/
│   ├── CollegeAdminShell.tsx            # Layout + top nav
│   ├── DepartmentOverviewTable.tsx      # All depts with stats
│   ├── CrossDeptAnalytics.tsx           # Multi-dept charts
│   ├── CrossDeptConfusionHeatmap.tsx
│   ├── CrossDeptUnansweredQueue.tsx
│   ├── FacultyManagementTable.tsx       # Dept admins list
│   └── CreateDeptAdminModal.tsx         # Quick create form
├── dept-admin/
│   ├── DeptAdminShell.tsx               # Layout + dept name header
│   ├── DeptDashboard.tsx
│   ├── DocumentManager.tsx              # Upload + manage docs
│   └── SubjectManager.tsx
└── shared/
    ├── InviteStatusBadge.tsx            # ● Active / ⏳ Invited / ✗ Disabled
    ├── ActivityLog.tsx                  # Admin action history
    └── PermissionsCheckboxGroup.tsx     # Permission toggles

components/super-admin/users/
├── UserManagementTable.tsx              # Unified user list
├── CreateCollegeAdminForm.tsx
├── CreateDeptAdminForm.tsx
├── EditUserPanel.tsx                    # Slide-over for edit
├── UserActivityLog.tsx
└── ImpersonateBanner.tsx               # "You are viewing as Dr. Priya Nair [Exit]"
```

---

## 14. Migration from v1 Role System

The current system uses `dept_admins` with `is_college_owner: Boolean`. This needs a clean migration.

### 14.1 Migration steps

```javascript
// Migration script: infra/migrations/016-college-admin-role.js

async function migrate() {
  const colleges = await platformDb.colleges.find({ status: 'active' }).toArray();

  for (const college of colleges) {
    const db = await getCollegeDb(college._id);

    // 1. Find all is_college_owner = true dept_admins — migrate to college_admin
    const collegeOwners = await db.dept_admins.find({ is_college_owner: true }).toArray();

    for (const owner of collegeOwners) {
      // Create corresponding college_admin record
      await db.collection('college_admins').insertOne({
        _id: generateUUID(),
        college_id: college._id,
        name: owner.name,
        email: owner.email,
        password_hash: owner.password_hash,    // reuse existing hash — same password
        phone: null,
        role: 'college_admin',
        admin_title: 'Principal',              // default — admin should update
        custom_title: null,
        can_create_dept_admins: true,
        can_deactivate_dept_admins: true,
        can_view_student_list: true,
        can_export_reports: true,
        can_view_cost_usage: false,
        status: owner.status,                  // preserve current status
        invite_token: null,
        invite_token_expires_at: null,
        invited_by: null,                      // legacy — unknown
        invite_accepted_at: owner.created_at,  // assume accepted on creation
        last_login: owner.last_login,
        last_login_ip: null,
        login_count: 0,
        password_reset_token: null,
        password_reset_expires_at: null,
        must_change_password: false,
        created_at: owner.created_at,
        updated_at: new Date()
      });

      // 2. Remove is_college_owner from the original dept_admin record
      //    If they ALSO have specific dept_ids, keep as dept_admin too
      //    If dept_ids is empty, they were pure college owners — deactivate dept_admin record
      if (owner.dept_ids && owner.dept_ids.length > 0) {
        // Convert to single-dept admin (use first dept_id)
        await db.dept_admins.updateOne({ _id: owner._id }, {
          $unset: { is_college_owner: '' },
          $set: { dept_id: owner.dept_ids[0], updated_at: new Date() },
          $unset: { dept_ids: '' }
        });
      } else {
        // Pure college owner — disable the dept_admin record
        await db.dept_admins.updateOne({ _id: owner._id }, {
          $set: { status: 'disabled', updated_at: new Date() }
        });
      }
    }

    // 3. Convert all remaining dept_admins from dept_ids[] to single dept_id
    const regularAdmins = await db.dept_admins.find({ is_college_owner: false }).toArray();
    for (const admin of regularAdmins) {
      if (Array.isArray(admin.dept_ids) && admin.dept_ids.length > 0) {
        // If managing multiple depts, create separate records for each
        if (admin.dept_ids.length > 1) {
          for (let i = 1; i < admin.dept_ids.length; i++) {
            const newAdmin = { ...admin, _id: generateUUID(), dept_id: admin.dept_ids[i] };
            delete newAdmin.dept_ids;
            delete newAdmin.is_college_owner;
            await db.dept_admins.insertOne(newAdmin);
          }
        }
        // Update original to use single dept_id
        await db.dept_admins.updateOne({ _id: admin._id }, {
          $set: { dept_id: admin.dept_ids[0], updated_at: new Date() },
          $unset: { dept_ids: '', is_college_owner: '' }
        });
      }
    }

    console.log(`✓ Migrated college: ${college.name}`);
  }
}
```

### 14.2 JWT invalidation after migration

After migration, all existing `dept_admin` JWTs that have `is_college_owner: true` become invalid for college-level routes. Admins need to re-login. Add a Redis key to force token refresh:

```javascript
// After migration completes
await redis.set('force_token_refresh:all_dept_admins', '1', 'EX', 86400);

// In verifyJWT middleware — check this flag
const forceRefresh = await redis.get('force_token_refresh:all_dept_admins');
if (forceRefresh && req.jwtPayload.role === 'dept_admin' && req.jwtPayload.is_college_owner) {
  return reply.status(401).send({ error: 'Your session has been updated. Please log in again.' });
}
```

---

## 15. Environment Variables

```bash
# Addition to services/api/.env

# College Admin JWT (separate secret from dept_admin)
COLLEGE_ADMIN_JWT_SECRET=<long-secret-different-from-dept-admin>
COLLEGE_ADMIN_JWT_EXPIRY=8h
COLLEGE_ADMIN_REFRESH_TTL=2592000      # 30 days

# Dept Admin JWT
DEPT_ADMIN_JWT_SECRET=<long-secret>
DEPT_ADMIN_JWT_EXPIRY=8h
DEPT_ADMIN_REFRESH_TTL=2592000         # 30 days

# Invitation config
INVITE_TOKEN_TTL_DAYS=7
INVITE_EMAIL_FROM=noreply@edumindai.com
INVITE_EMAIL_FROM_NAME=EduMind AI

# Password reset
PASSWORD_RESET_TOKEN_TTL_HOURS=1

# Impersonation (Super Admin only)
IMPERSONATION_JWT_EXPIRY=2h            # impersonation sessions are shorter
IMPERSONATION_ENABLED=true

# Migration
MIGRATION_VERSION=016
```

---

## 16. Build Order

Add as **Phase 14 — College Admin Role System** after Phase 13 in main architecture doc:

```
Phase 14 — College Admin Role System

Step 1 — Database schema
  → Create college_admins collection + indexes (per-college DB)
  → Create admin_activity_logs collection + indexes
  → Update dept_admins collection: remove is_college_owner,
    change dept_ids array to single dept_id
  → Add college_admin_count, dept_admin_count to platform colleges collection
  → Run migration script: infra/migrations/016-college-admin-role.js

Step 2 — New auth routes
  → POST /auth/college-admin/login     (college_slug resolution + bcrypt verify)
  → POST /auth/college-admin/accept-invite (token validation + password set)
  → POST /auth/college-admin/forgot-password + reset-password
  → POST /auth/dept-admin/accept-invite
  → POST /auth/dept-admin/forgot-password + reset-password
  → Test: create college_admin via direct DB insert → accept invite → login → get JWT

Step 3 — Updated middleware
  → Refactor verifyJWT to handle 3 admin roles (super_admin, college_admin, dept_admin)
  → Add checkCollegeAdminPermission() middleware
  → Update checkDeptScope() to reject dept_admin on cross-dept routes
  → Remove all is_college_owner checks from existing middleware
  → Test: dept_admin JWT cannot access /college-admin/* routes → 403

Step 4 — Super Admin user management API
  → GET/POST/PUT/PATCH for college-admins (create, edit, deactivate, resend-invite)
  → GET/POST/PUT/PATCH for dept-admins (same operations)
  → POST /impersonate routes (return impersonation JWT with flag)
  → GET /export (CSV of all admins)
  → Invitation email sending via existing nodemailer setup

Step 5 — College Admin portal API routes
  → GET /college-admin/dashboard (cross-dept aggregated KPIs)
  → GET /college-admin/analytics/cross-dept (all-dept analytics)
  → GET /college-admin/departments + /departments/:deptId (read-only)
  → POST/PUT/DELETE /college-admin/subjects (write access to subjects)
  → GET/POST/PATCH /college-admin/dept-admins (create + manage faculty)
  → GET/PATCH /college-admin/students (view all, can disable)

Step 6 — Dept Admin portal API routes
  → All existing /admin/* routes migrated to /dept-admin/* 
  → Remove dept_id from query params — inject from JWT
  → Enforce single-dept scope on all routes

Step 7 — Super Admin UI: User Management
  → UserManagementTable.tsx (unified admin list)
  → CreateCollegeAdminForm.tsx (slide-over)
  → CreateDeptAdminForm.tsx (slide-over)
  → EditUserPanel.tsx (edit + deactivate + resend)
  → ImpersonateBanner.tsx (shows when impersonating)
  → Add "Users" to Super Admin nav

Step 8 — College Admin portal UI
  → apps/admin/app/college-admin/ layout + pages
  → CollegeAdminShell.tsx (nav: Dashboard, Departments, Analytics, Faculty, Students, Reports)
  → DepartmentOverviewTable.tsx (all depts with inline stats)
  → CrossDeptAnalytics.tsx (charts, confusion heatmap, unanswered queue)
  → CreateDeptAdminModal.tsx (college admin creates faculty)

Step 9 — Dept Admin portal UI  
  → apps/admin/app/dept-admin/ layout + pages
  → DeptAdminShell.tsx (shows dept name in header, no college nav)
  → Migrate existing admin-ui pages to new dept-admin path
  → Remove any cross-dept UI elements

Step 10 — Invitation + accept-invite flow (both roles)
  → Email templates for college_admin invitation
  → Email templates for dept_admin invitation
  → Accept invite pages (token validation + password form)
  → Forgot password + reset pages

Step 11 — Activity logging
  → Add logAdminAction() utility function
  → Instrument: create_college_admin, create_dept_admin, deactivate_*, upload_document,
    delete_document, create_subject, disable_student, impersonate_admin
  → Admin activity log visible in edit panel (last 10 actions) + full log page

Step 12 — Testing
  → Create college_admin from Super Admin UI → verify invite email sent
  → Accept invite → set password → login → verify JWT has role=college_admin
  → Verify college_admin sees all 6 departments in dashboard
  → Verify college_admin CANNOT upload documents (405 Method Not Allowed)
  → College_admin creates a dept_admin → verify invite email sent
  → dept_admin accepts invite → login → verify only their one dept visible
  → dept_admin tries to access /analytics/cross-dept → expect 403
  → Super Admin impersonates college_admin → verify impersonation JWT issued
  → Run migration on existing test data → verify is_college_owner users moved to college_admins
  → Force token refresh → existing dept_admin tokens with is_college_owner → 401
```

---

*Document: F-16-college-admin-role-system.md · v1.0 · May 2026*  
*Extends: college-chatbot-architecture.md v2.0*  
*Breaking change: removes is_college_owner from dept_admins. Migration script in Step 1 handles existing data. All existing dept_admin JWTs are invalidated after migration — users must re-login.*  
*For Claude Code: Phase 14, 12 steps. Start with Step 1 (migration) — the rest of the build depends on the new schema being in place.*
