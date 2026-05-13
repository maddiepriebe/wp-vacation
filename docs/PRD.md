# Time Off & Scheduling System
## Product Requirements Document

**Version:** 1.0 (Draft)
**Date:** May 2026
**Owner:** Maddie
**Status:** Ready for Claude Code implementation

---

## 1. Overview

### 1.1 Product Summary
A web-based time-off management and staff scheduling system for a single-location preschool/daycare with ~35 employees and 3 admins. Employees access the system as an installable mobile PWA to view balances and request time off. Admins use a desktop-first interface to manage schedules, approve requests, and ensure classroom coverage compliance.

### 1.2 Goals
- Give employees clear visibility into accrued time, used time, pending requests, and renewal date — with intuitive balance bars that decrement on approval.
- Give admins fast, context-rich approval workflows that surface who else is out, ratio impact, and substitute suggestions.
- Replace ad-hoc tracking with a single source of truth for time off, scheduling, and coverage.

### 1.3 Non-Goals (Out of Scope for v1)
- Time clock / clock in–out
- Payroll integration or processing
- Individual student/child records or attendance
- Performance reviews
- Native iOS/Android apps (mobile PWA only)
- Multi-tenant / multi-location

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Next.js API routes (Route Handlers) |
| Database | Postgres via Supabase |
| Auth | Clerk |
| Hosting | Vercel |
| Email | Resend (recommended) |
| Mobile | Progressive Web App — installable on iOS Home Screen and Android |

---

## 3. User Roles & Permissions

The system has two distinct user types stored in separate tables. **Admins do not have employee profiles** — they don't appear in the schedule, never work in classrooms, and don't accrue time off.

| Capability | Employee | Admin |
|---|---|---|
| View own balances & schedule | ✅ | N/A |
| Submit vacation request | ✅ | ❌ |
| Self-log sick day (no approval) | ✅ | ❌ |
| Self-log bereavement (auto-approved) | ✅ | ❌ |
| Cancel own pending request | ✅ | ❌ |
| Withdraw own approved request | ✅ | ❌ |
| View all employees | ❌ | ✅ |
| Create/edit class schedules | ❌ | ✅ |
| Approve/reject vacation requests | ❌ | ✅ |
| Override 2-week advance-notice rule | ❌ | ✅ |
| Grant unpaid or unallocated time | ❌ | ✅ |
| Manage holidays | ❌ | ✅ |
| Upload/add employees | ❌ | ✅ |
| Configure settings (thresholds, notice window) | ❌ | ✅ |
| Export reports | ❌ | ✅ |

All three admin roles (**Owner**, **HR**, **Director**) share identical permissions in v1.

---

## 4. Data Models

### 4.1 Employee
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `first_name` | text | |
| `last_name` | text | |
| `email` | text, unique | Used for Clerk invite |
| `phone` | text, nullable | |
| `anniversary_date` | date | Treated as hire date. Drives tenure tier, balance reset, and milestone timing. |
| `default_class_id` | uuid (fk → Class) | |
| `role_in_class` | enum | `teacher` \| `assistant_teacher` |
| `scheduled_hours_per_week` | decimal | Used for balance grants when schedule has not yet been built; falls back to actual scheduled hours once the schedule exists. |
| `vacation_hours_balance` | decimal | Live balance. Decrements on approval. |
| `personal_hours_balance` | decimal | Live balance. Decrements on self-log. |
| `is_active` | boolean | Default `true`. Soft delete on deactivation. |
| `clerk_user_id` | text, nullable | Populated when employee completes the Clerk invite. |
| `created_at`, `updated_at` | timestamps | |

### 4.2 Admin
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `first_name`, `last_name`, `email` | text | |
| `admin_role` | enum | `owner` \| `hr` \| `director` |
| `clerk_user_id` | text | |

### 4.3 Class
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `name` | text | e.g., "Toddler Room A" |
| `age_group` | enum | `infant` \| `toddler` \| `preschool` \| `floater_pool` |
| `ratio_teacher_to_students` | int | Derived from age_group. `null` for floater_pool. |
| `max_group_size` | int | Derived. `null` for floater_pool. |
| `is_floater_pool` | boolean | `true` only for the single Floater Pool record |

**Seed data:** 1 Infant class, 3 Toddler classes (Ducks, Bumblebees, Turtles), 4 Preschool classes (Penguins, Panthers, Pre-K, Kindergarten), 1 Floater Pool. Total = 9 class records.

### 4.4 EnrollmentForecast
Expected student counts per class per day. Driven by admin input or spreadsheet upload.
| Field | Type |
|---|---|
| `id` | uuid (pk) |
| `class_id` | uuid (fk) |
| `date` | date |
| `expected_students` | int |

### 4.5 ScheduleShift
Represents one continuous block of an employee assigned to a class.
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `employee_id` | uuid (fk) | |
| `class_id` | uuid (fk) | |
| `start_time` | timestamp | 15-min granularity, M–F, 07:00–17:00 |
| `end_time` | timestamp | |
| `is_template` | boolean | `true` for recurring weekly template shifts |
| `template_day_of_week` | int (0=Mon…4=Fri), nullable | Used when `is_template = true` |
| `effective_from`, `effective_until` | date, nullable | Template validity window |
| `overrides_template` | boolean | Mark week-specific exceptions to the template |

### 4.6 TimeOffRequest
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `employee_id` | uuid (fk) | |
| `type` | enum | `vacation` \| `sick` \| `bereavement` \| `unpaid` \| `unallocated` |
| `status` | enum | `pending` \| `approved` \| `rejected` \| `cancelled` |
| `submitted_at` | timestamp | |
| `reason` | text, nullable | Required for vacation; optional otherwise |
| `bereavement_relation` | enum, nullable | `parent` \| `sibling` \| `spouse` \| `child` \| `grandparent` |
| `total_hours` | decimal | Sum of `TimeOffRequestDay.hours` |
| `decision_by` | uuid (fk → Admin), nullable | |
| `decision_at` | timestamp, nullable | |
| `decision_note` | text, nullable | |
| `advance_notice_overridden` | boolean | Set when admin approves inside 14-day window |

Sick and bereavement requests are created with `status = approved` and `decision_at = submitted_at` by the system, no admin involved.

### 4.7 TimeOffRequestDay
One per calendar day in a request.
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `request_id` | uuid (fk) | |
| `date` | date | |
| `hours` | decimal | Computed from full or partial selection; `0` for holidays |
| `is_full_day` | boolean | |
| `is_holiday` | boolean | Auto-flagged if date matches a paid holiday and employee is eligible |
| `start_time`, `end_time` | time, nullable | Only for partial-day selections |

### 4.8 Holiday
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `date` | date | |
| `name` | text | e.g., "Memorial Day" |
| `is_paid` | boolean | Default `true` |

### 4.9 Notification
| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `recipient_type` | enum | `employee` \| `admin` |
| `recipient_id` | uuid | |
| `kind` | enum | See Notification Matrix in §8 |
| `payload` | jsonb | Links, names, dates |
| `read_at` | timestamp, nullable | |
| `sent_email_at` | timestamp, nullable | |
| `created_at` | timestamp | |

### 4.10 Settings (singleton)
| Field | Type | Default |
|---|---|---|
| `low_balance_threshold_hours` | int | 16 |
| `vacation_advance_notice_days` | int | 14 |
| `business_hours_start` | time | 07:00 |
| `business_hours_end` | time | 17:00 |

---

## 5. Business Rules

### 5.1 Vacation Accrual & Balance

**Tenure tiers** (measured from `anniversary_date`):
| Tenure | Allotment |
|---|---|
| 6 months – 1 year | 5 days |
| 1 – 3 completed years | 10 days |
| 4 – 5 completed years | 15 days |
| 6+ years | 20 days |

**Days-to-hours conversion.** Vacation is tracked and displayed in **hours**, not days. The "X days" allotment is converted using the employee's average daily scheduled hours:

```
avg_daily_hours = scheduled_hours_per_week / 5
hour_allotment  = tenure_days × avg_daily_hours
```

Example: a teacher scheduled 35 hours/week at the 1–3 year tier receives `10 × 7 = 70 hours` of vacation.

**Grant timing.** The full hour allotment is granted on the anniversary date. Unused hours do **not** carry over.

**Tenure tier bumps** happen on the anniversary date, not retroactively. A teacher hitting 4 years on March 15 has their bucket grow from 70 → 105 hours on March 15.

**Accrual framing.** The business uses "accrual" terminology so they can claw back unearned time if an employee separates having used more than they earned. The system grants full upfront and does **not** enforce this — it's handled offline.

**Decrement timing.** Hours decrement from the live balance **on approval**, not when the time is actually taken.

**Effective balance.** Pending requests are "reserved" — the employee's effective available balance = `vacation_hours_balance − sum(pending_request_hours)`.

### 5.2 Personal/Sick Days

- **4 days** granted at 90 days of employment
- **+5 days** at 6 months (cumulative: 9 days)
- **`[CONFIRM]` Does this grow further with tenure?** Current assumption: stays at 9 days/year after 6 months, regardless of tenure.
- Hour conversion: same formula as vacation
- Resets on anniversary date
- Does not carry over
- Not paid out on termination
- **Self-logged by employee — no admin approval required.** Sick logs decrement the balance immediately on submission.

### 5.3 Bereavement

- 2 days per occurrence; no cap on number of occurrences per year
- Qualifying relations: parent, sibling, spouse, child, grandparent
- Employee selects relation when logging
- **Auto-approved** by system on submission
- **No balance bar on the dashboard.** The bereavement section is visible only when at least one bereavement day has been used this year, displayed as a list of past instances.

### 5.4 Holidays

- 9 paid holidays per year. Admin enters dates each year (dates change year-to-year).
- New employees within their first 90 days of employment are **not eligible** for holiday pay. Holidays during this window do not appear as a benefit on their dashboard.
- **Holiday hours within a vacation request are not deducted from the balance.** If a 3-day vacation request includes one paid holiday for which the employee is eligible, only 2 days of hours are deducted. The holiday day on the request shows `0 hours — holiday`.
- Holidays render as closed days on schedules and calendars.

### 5.5 Vacation Request Rules

- Must be submitted **≥ 14 days in advance** (configurable in Settings).
- Admin can override the advance-notice requirement when approving — checkbox on the decision panel.
- Admin can grant **unpaid** time off (no deduction from any bucket).
- Admin can grant **unallocated** time (use before accrued; no deduction). This is for cases where an employee hasn't yet earned vacation but needs time off.
- Employees can **cancel** pending requests freely.
- Employees can **withdraw** approved requests; hours return to balance.
- Employees can **edit** pending requests; approved requests must be cancelled and resubmitted to change.
- Requests do not auto-expire; they remain pending until acted on.

### 5.6 Coverage & Ratios

**Ratios by age group:**
| Age Group | Teacher:Student | Max Group Size |
|---|---|---|
| Infant | 1:3 | 7 |
| Toddler | 1:4 | 9 |
| Preschool | 1:10 | 20 |

**Target staffing:** each class typically runs with one extra teacher beyond ratio minimum.

**Coverage check on request review.** When admin opens a pending request, the system displays, for each requested date:
- Expected enrollment for the employee's default class
- Currently scheduled teachers in that class (excluding this employee)
- Ratio status: ✓ Compliant / ⚠️ Non-compliant
- Other employees in the same class already on approved leave
- Whether only an assistant teacher would remain (assistants cannot be alone with students — separate warning)

**Suggested substitutes.** System suggests, in priority order:
1. Floater Pool members not scheduled and not on approved leave during the time slot
2. Other employees not scheduled and not on approved leave during the time slot

**Approval behavior.** Coverage problems **warn** but never block approval. Admin retains final authority.

### 5.7 Anniversary Date Logic

`anniversary_date` is treated as the hire date. All tenure milestones (90 days, 6 months, 1 year, 3 years, 5 years) are computed as offsets from this date. On each annual anniversary, the system:
1. Resets vacation balance to the appropriate tier allotment (in hours)
2. Resets personal/sick balance
3. Re-evaluates tenure tier and applies any bump
4. Logs the reset event for audit

### 5.8 Floater Pool

Modeled as a **Class entity** with `is_floater_pool = true`, `age_group = floater_pool`, no ratio, no max group size. Floaters have this as their `default_class_id`. They appear in the schedule grid like any other class. Coverage logic prioritizes them when suggesting substitutes.

---

## 6. Page Inventory

### 6.1 Employee App (Mobile-First PWA)

#### Sign In / Invite Acceptance
- Clerk-hosted email auth
- First-time users land here from the invite email sent at onboarding

#### Dashboard (Home)
Primary screen. Designed for fast glance comprehension.

**Top section — Balance bars:**
- **Vacation:** horizontal progress bar. Total accrued (e.g., 80h) with used portion filled, pending portion shown in lighter shade, available portion empty. Labels: `Used: 24h · Pending: 8h · Available: 48h`. Renewal date shown below: `Renews March 15, 2027`.
- **Personal/Sick:** same treatment. Renewal date shown.

**Bereavement section:** Only renders when used this year. Lists each instance: date, relation.

**Upcoming time off:** Cards for each approved future leave with date range, type, and total hours.

**Pending requests:** Cards with status indicator, date range, total hours, and a Cancel button.

**Primary CTAs:** "Request time off" (large button) and "View my schedule" (secondary).

#### Request Time Off (multi-step form)

**Step 1 — Type:** Vacation, Personal/Sick, Bereavement, Unpaid.

**Step 2 — Dates:** Calendar widget for date range selection. Weekends, holidays, and non-scheduled days are visually distinguished.

**Step 3 — Hours per day:** List of each weekday in range. Each row shows the employee's scheduled hours for that day with two options:
- **Full day** (default; auto-fills scheduled hours)
- **Partial day** (time-range picker, 15-min increments, must be within scheduled shift)

Days where the employee is not scheduled show `Not scheduled — 0 hours` and are non-editable.

Paid-eligible holidays in the range show `Holiday — 0 hours deducted` and are non-editable.

**Step 4 — Details:**
- **Vacation:** reason required (textarea)
- **Sick:** reason optional
- **Bereavement:** relation dropdown required
- **Unpaid:** reason required

**Step 5 — Review:**
- Summary of total hours
- Available balance before and after
- Advance-notice warning if under 14 days
- Submit button

**Sick and Bereavement** skip the admin queue — submission immediately reflects on the dashboard as approved.

#### My Schedule
- Mobile-friendly weekly view: each day a card with the employee's shifts (start–end time, class name).
- Approved leaves visually marked as `OUT` overlaying the shift.
- Toggle to month view.

#### Notifications Inbox
- Chronological list of in-app notifications.
- Tap to mark read and navigate to the relevant page.

---

### 6.2 Admin App (Desktop-First, Responsive)

#### Dashboard
Single-screen operational view.

**Top row — KPI tiles:**
1. **Out today:** count + names + classes
2. **Pending requests:** count, click-through to queue
3. **Upcoming this week:** count of approved leaves Mon–Fri ahead
4. **Low balance:** count of employees under threshold

**Today's coverage snapshot:** list of all 7 student-facing classes with ratio status (✓ / ⚠️), staffed count, and expected enrollment.

**Recent activity log:** last 20 events (requests submitted/approved/rejected/cancelled, sick logs, bereavement logs).

#### Requests
- Tabs: **Pending** (default) | **Approved** | **Rejected** | **All**
- Default sort: newest pending first
- Table columns: Employee, Type, Submitted, Dates, Hours, Status, Actions

**Request detail panel** (slide-over or modal):
- Employee info (name, default class, balances)
- Request: type, dates, hours, reason
- **Coverage section** — for each requested date:
  - Expected enrollment
  - Currently scheduled teachers in the class (this employee struck through)
  - Ratio status
  - Other staff already approved off
  - Lead teacher coverage check
  - Suggested substitutes list (floaters first, then unscheduled)
- **Decision section:**
  - Advance-notice override checkbox (if applicable)
  - Decision note (optional)
  - Approve / Reject buttons

Filters: employee, type, date range, status.

#### Employees
- Table: Name, Default Class, Role, Vacation Balance, Personal Balance, Anniversary, Status (Active/Pending Invite/Inactive)
- Filters: class, role, low balance only, status
- Search by name or email
- "Add Employee" button → manual form
  - Required: `first_name`, `last_name`, `anniversary_date`, `email`
  - Optional at create: `phone`, `default_class`, `role_in_class`, `scheduled_hours_per_week`, `current_vacation_hours_remaining`, `current_personal_hours_remaining`
- Click row → **Employee Profile**:
  - Info section (editable)
  - Current balances with edit capability (audit-logged)
  - Balance history timeline
  - All requests (sortable, filterable)
  - Schedule preview
  - Deactivate button

#### Classes & Schedules
- Left rail: list of 8 classes (Infant, 3× Toddler, 3× Preschool, Floater Pool)
- Right pane: **Schedule grid**:
  - Rows = teachers assigned to that class (default + any shift-only assignments for the week)
  - Columns = M, T, W, Th, F
  - Cells = time bars rendered 07:00–17:00 in 15-min granularity
  - Drag-and-drop to move/resize shifts
  - Click empty area to add shift; click shift to edit/delete
  - Approved leaves render as `OUT` blocks over the corresponding shift
- **Template mode toggle:** edit the recurring weekly template vs. the specific week
- **Week navigator:** previous/next week, week-of date display, "Today" button
- **Save as template** button — promotes the current week to the recurring template
- **Copy from last week** button — clones prior week's shifts into the current week
- **Print view** — clean, printer-friendly schedule with employee name column and time-block bars

**Enrollment forecast row** at the top of the grid: expected students per day. Click any cell to edit. "Upload" button accepts a spreadsheet (CSV or XLSX) with columns `date, expected_students`.

#### Calendar (Company-Wide)
- Month view
- All approved leaves overlaid as colored chips (color by employee or by class)
- Holidays highlighted
- Filters: class, employee, type
- Click a leave chip → request detail

#### Holidays
- Two sections: **Current Year** and **Next Year**
- Each holiday row: date, name, is_paid toggle, delete
- "Add Holiday" form
- "Copy from previous year" — duplicates dates with manual date adjustment

#### Setup / Bulk Onboarding (Initial)
**Step 1 — Download template:**
Spreadsheet with these columns:
```
first_name, last_name, email, anniversary_date,
default_class, scheduled_hours_per_week,
current_vacation_hours_remaining, current_personal_hours_remaining
```

**Step 2 — Upload:** drag-and-drop or browse for `.xlsx` or `.csv`.

**Step 3 — Preview:** parsed rows shown in a table with row-level validation:
- Missing email → row flagged "Will be created, invite later"
- Missing required fields (first_name, last_name, anniversary_date) → blocking error
- Unknown `default_class` value → will be created as a new class entity (admin confirms)
- Existing employee by email match → marked "Will update"

**Step 4 — Confirm import.** System:
- Creates/updates Employee records
- Creates Class records for new `default_class` values
- Sends Clerk invite emails to employees with addresses
- Initializes balances from the spreadsheet values

#### Settings
- Low balance threshold (default: 16 hours; applies to both vacation and personal)
- Vacation advance-notice window (default: 14 days)
- Business hours (default: 07:00–17:00)
- Notification preferences

#### Exports
**Configurable report builder:**
- Choose entity: Requests, Employees, Balances, Schedule
- Choose columns (multi-select)
- Choose filters (date range, employee, class, status, type)
- Output: CSV download

---

## 7. API Surface

High-level route plan. All routes are Next.js Route Handlers under `/api`.

### Auth & Identity
- `POST /api/auth/invite` — admin creates Clerk invite for a new employee
- `GET /api/me` — current user info (employee or admin)

### Employees
- `GET /api/employees` — list (admin)
- `POST /api/employees` — create (admin)
- `PATCH /api/employees/:id` — update (admin)
- `POST /api/employees/:id/deactivate` — soft delete (admin)
- `POST /api/employees/upload` — spreadsheet import (admin); accepts multipart, returns preview rows; second call with `confirm=true` commits.
- `GET /api/employees/:id/balance-history` — admin view
- `POST /api/employees/:id/balance-adjust` — manual balance adjustment with audit log

### Classes & Schedule
- `GET /api/classes`
- `GET /api/classes/:id/schedule?week=YYYY-MM-DD` — returns shifts for the week (resolved against templates + overrides)
- `POST /api/shifts` / `PATCH /api/shifts/:id` / `DELETE /api/shifts/:id`
- `POST /api/classes/:id/schedule/save-as-template`
- `POST /api/classes/:id/schedule/copy-week` — `{ from_week, to_week }`
- `GET /api/enrollment-forecast?class_id=...&from=...&to=...`
- `POST /api/enrollment-forecast/upload` — spreadsheet upload

### Time Off Requests
- `POST /api/time-off-requests` — employee submits
- `GET /api/time-off-requests` — admin queue, supports `?status=pending&employee_id=...&type=...&from=...&to=...`
- `GET /api/time-off-requests/mine` — employee view of own requests
- `POST /api/time-off-requests/:id/decision` — `{ decision: 'approve'|'reject', note?, override_advance_notice? }`
- `POST /api/time-off-requests/:id/cancel` — employee cancel
- `POST /api/time-off-requests/:id/withdraw` — employee withdraw approved request
- `PATCH /api/time-off-requests/:id` — employee edit while pending

### Coverage
- `GET /api/coverage?class_id=...&date=...` — returns ratio status, scheduled staff, conflicts
- `GET /api/coverage/suggested-substitutes?class_id=...&start=...&end=...` — ranked list

### Holidays
- `GET /api/holidays?year=...`
- `POST /api/holidays`
- `PATCH /api/holidays/:id`
- `DELETE /api/holidays/:id`
- `POST /api/holidays/copy-from-previous-year`

### Settings
- `GET /api/settings`
- `PATCH /api/settings`

### Notifications
- `GET /api/notifications` — current user
- `POST /api/notifications/:id/read`

### Exports
- `POST /api/exports/build` — `{ entity, columns, filters }`; returns a download URL

### Cron / Scheduled Jobs
- `POST /api/cron/anniversary-resets` — daily; processes any employees with anniversary today
- `POST /api/cron/monday-digest` — Monday 8am ET; sends weekly upcoming-leave digest to admins
- `POST /api/cron/day-before-reminder` — daily 5pm ET; sends day-before reminders to employees with leave tomorrow

---

## 8. Notification Matrix

| Trigger | Recipient | Email | In-App | Timing |
|---|---|---|---|---|
| Vacation request submitted | All admins | ✅ | ✅ | Instant |
| Sick day logged | All admins | ✅ | ✅ | Instant |
| Bereavement logged | All admins | ✅ | ✅ | Instant |
| Request approved | Employee | ✅ | ✅ | Instant |
| Request rejected | Employee | ✅ | ✅ | Instant |
| Upcoming leaves digest | Admins | ✅ | ✅ | Monday 8am ET, prior week |
| Day-before leave reminder | Employee | ✅ | ✅ | Day before, 5pm ET |
| Low balance crossed | Employee | ✅ | ✅ banner | Once on crossing |
| New employee invite | Employee | ✅ | N/A | On admin upload or manual add |
| Anniversary balance reset | Employee | ✅ | ✅ | On anniversary date, 8am ET |

---

## 9. Sample Acceptance Criteria

Written test-first style. Full set defined per feature during build phases.

### Vacation Request Submission
- **AC1:** Given an employee with 40 available hours and a 24-hour scheduled request, when they submit, then the request status is `pending` and their effective available balance shows 16 hours.
- **AC2:** Given a request submitted inside the 14-day advance window, when employee reviews, then a warning is shown but submit is enabled.
- **AC3:** Given a 3-day request spanning a paid holiday, when employee reviews, then the holiday day shows `0 hours — holiday` and is excluded from the total.
- **AC4:** Given an employee tries to request more hours than available + pending, when they review, then submit is disabled with a clear error.

### Admin Approval with Coverage
- **AC5:** Given a pending request, when admin opens it, then they see for each requested date the expected enrollment, scheduled staff (this employee excluded), and ratio status.
- **AC6:** Given approving would leave a class with only an assistant teacher, when admin clicks approve, then an "assistants cannot be alone with students" warning fires and admin must confirm to proceed.
- **AC7:** Given approval, when admin confirms, then hours deduct from `vacation_hours_balance`, the request shows as `approved` in employee dashboard, and instant email + in-app notifications fire to the employee.

### Sick Day Self-Log
- **AC8:** Given an employee with 16 personal hours, when they log a 6-hour sick day, then balance drops to 10 hours immediately with no admin involvement, and admins receive instant notification.

### Bereavement
- **AC9:** Given an employee logs a bereavement event, when they select relation = `parent` and submit, then 2 days at their scheduled hour rate are auto-approved and admins receive instant notification.

### Anniversary Reset
- **AC10:** Given employee anniversary is today and they crossed into year 4, when the daily cron runs, then their vacation balance resets to `15 × avg_daily_hours`, their personal balance resets, and they receive an anniversary notification.

### Holiday Logic
- **AC11:** Given an employee within their first 90 days of employment, when admin views the employee dashboard, then paid holidays in that window are visually marked as "ineligible" and not counted as a benefit.
- **AC12:** Given a paid holiday in a vacation request, when computing total hours, then the holiday day contributes 0 hours.

### Coverage Suggestions
- **AC13:** Given admin reviews a request, when the system suggests substitutes, then floater pool members appear first, followed by other employees not scheduled during the time slot and not on approved leave.

---

## 10. Build Phases

Each phase is independently shippable. Claude Code should treat each phase as a milestone with its own PR set.

### Phase 1 — Foundations
**Goal:** Auth, schema, shell UIs, no business logic.
- Next.js + Supabase + Clerk + Vercel scaffold
- Schema migrations: Employee, Admin, Class, Holiday, Settings, Notification
- Clerk auth flow for both admin and employee
- Admin shell: dashboard (empty), Employees list, Classes list, Settings, Holidays
- Employee shell: dashboard with mocked balance bars, navigation
- Seed script: 8 classes, 3 admins, ~5 sample employees

### Phase 2 — Setup & Schedule
**Goal:** Admin can onboard employees and build schedules.
- Employee spreadsheet upload: parser, validator, preview, commit
- Manual employee add
- Clerk invite email on employee create
- Schedule grid UI with template + week-override modes
- 15-min granularity drag-drop shifts
- Save-as-template and copy-week actions
- Print-friendly schedule view
- Enrollment forecast input + spreadsheet upload

### Phase 3 — Time Off Core
**Goal:** Full request and approval lifecycle.
- Vacation request flow (employee submit, admin approve/reject)
- Sick day self-log
- Bereavement self-log
- Unpaid and unallocated request handling
- Balance math engine: tenure tier resolution, hour conversion, anniversary reset cron
- Holiday hour exclusion logic
- Effective balance (pending reservation) display
- Edit, cancel, withdraw flows

### Phase 4 — Coverage Intelligence
**Goal:** Admins approve with full context.
- Coverage check API
- Coverage panel on request detail: enrollment, staff, ratio, conflicts
- Assistant-teacher-only warning
- Suggested substitutes algorithm (floaters first)
- Company-wide calendar view

### Phase 5 — Notifications & Polish
- Resend integration
- In-app notifications center
- Notification matrix wiring across all events
- Low balance warnings
- Monday admin digest cron
- Day-before employee reminder cron
- Anniversary notification

### Phase 6 — Reporting & PWA
- Configurable export builder → CSV
- PWA manifest, service worker, install prompts
- iOS Add to Home Screen testing
- Android install testing
- Accessibility audit (WCAG AA)
- Final UX polish

---

## 11. Open Questions & Confirmations

Items to verify or decide before / during build:

1. **Personal/sick growth with tenure** — `[CONFIRM]` Current assumption: stays at 9 days/year regardless of tenure after the 6-month mark. Confirm or define growth schedule.
2. **Email provider** — Resend recommended. Confirm.
3. **Color palette / branding** — to be defined during Phase 1 design pass.
4. **Schedule conflicts** — if an admin schedules an employee in two classes for overlapping time, should the system block, warn, or allow? Assumption: block, since an employee can only be in one place. Confirm.
5. **Admin login** — admins authenticate via Clerk too, with a separate `Admin` table linked by `clerk_user_id`. Should new admins be added through a self-serve admin invite flow, or hard-coded for v1? Assumption: hard-coded seed for v1, add-admin UI in future.
6. **Audit logging** — balance adjustments, employee deactivations, holiday changes should all write to an audit log. Define retention.

---

## 12. Glossary

- **Anniversary date** — Employee's hire date. Drives all tenure milestones and annual balance resets.
- **Tenure tier** — Vacation allotment level based on years since anniversary date.
- **Effective balance** — Live balance minus hours reserved by pending requests.
- **Floater pool** — A class entity with no enrolled students; employees in this class are available to cover any room.
- **Template shift** — A recurring weekly schedule entry that applies until overridden for a specific week.
- **Lead teacher** — Employee with `role_in_class = teacher`. Required by policy for any class with students present.
- **Assistant teacher** — Employee with `role_in_class = assistant_teacher`. Cannot be alone with students.

---

*End of document.*