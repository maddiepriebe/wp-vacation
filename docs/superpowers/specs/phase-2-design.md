# Phase 2 — Setup & Schedule: Design

**Status:** in progress, Sections 1–2 approved, Section 3 (onboarding pipeline) next.

**Phase goal (per PRD §10):** admin can onboard employees and build schedules.

---

## Phase 2 scope (locked)

- Manual "Add Employee" form (admin).
- Bulk employee upload (XLSX + CSV via SheetJS): parse → validate → preview → commit.
- Initial balance import writes `balance_transaction(source='initial_import')` rows and sets denormalized `employee.*_hours_balance` (live balance = SUM of transactions).
- Clerk invite is **admin-triggered** from the employee profile, not automatic on create.
- Schedule grid UI with two modes: template (recurring) and week (concrete instances).
- Shift editing UX is **hybrid**: click-to-create / click-to-edit modal at 15-min granularity, plus drag-to-move on existing shifts. Resize is via the edit modal, not a resize handle.
- Save-as-template, copy-week, print view.
- Enrollment forecast: per-cell edit + spreadsheet upload.
- Approved-leave overlay on the grid is **deferred to Phase 3** (tables added now; rendering wired later).

## Decisions that override or extend prior docs

These supersede the corresponding entries in `docs/PRD.md` for Phase 2 build purposes. `docs/CLAUDE.md` already captures the architecture-level decisions.

1. **Unknown `default_class` on bulk upload is a blocking row error**, not a "create new class" prompt. (Already in `docs/CLAUDE.md`; PRD §6.2 contradicts and is overridden.)
2. **Shift overlap rules** (PRD §11 Q4 resolved):
   - (a) Same employee, two classes, overlapping times → **block**.
   - (b) Same time slot, same class, two employees → **allow** (lead + assistant is normal).
   - (c) Same employee, same class, overlapping templates with different times → **block**.
   - (d) Same employee, same class, same time (duplicate) → **block**.
3. **Save-as-template UX:** confirmation dialog showing every shift in the resolved week with its source. Template-derived rows checked by default; override rows unchecked by default with a one-line label (e.g. `override — Tuesday, Maria covering for Jess`). Admin reviews checkboxes before confirming. Prevents one-off coverage from getting baked into the recurring template.
4. **Template closure rule:** one active template per class at a time. When a new template is saved with `effective_from = weekStart`, the Server Action sets `effective_until = weekStart - 1` on every other template for that class where `effective_until IS NULL`. Enforced at write time in the action, not by a DB constraint.
5. **Delete semantics:** templates are the only place to remove a recurring shift. In week mode, admins can edit a template-derived slot (writes a `schedule_shift` override) but cannot delete it — single-week absences are covered by time-off requests in Phase 3, not by negative-space tombstones in the schedule. `deleteShiftAction` only operates on existing `schedule_shift` rows and reverts the slot to template-derived.
6. **Clerk invite precondition:** `sendInviteAction` requires an existing employee (or admin) row with `clerk_user_id IS NULL`. Fails fast if the row is missing or already linked. The webhook handler in Phase 1 handles the inbound link-back.
7. **Resolver caching:** `resolveWeek` is wrapped in `React.cache()` for per-request memoization across Server Components. No `unstable_cache` — invalidation isn't worth the complexity at this scale.
8. **Resolver shape:** plain async function imported from Server Components and Server Actions. No `'use server'` directive. Reads don't need it, and decorating it would force every caller through the Server Action protocol unnecessarily.
9. **Vacation and sick balances are tenure-derived from `hire_date`.** Computed via `src/lib/balances/entitlements.ts`. They are *not* importable spreadsheet columns. Prior-system usage in the current anniversary year is captured separately via the historical-usage entry on the employee profile (§3.6). Unpaid is the only balance bucket admitted from the spreadsheet.

---

## Section 1 — File & module layout

New code mirrors the Phase 1 conventions: `(admin)` route group for admin pages, `src/lib/*` for cross-cutting domain logic, `src/db/schema/*` for per-table Drizzle modules, `_components/` underscore prefix for non-routed component directories.

### Domain logic — `src/lib/`

- `src/lib/dates.ts` — central date utilities. Exports `weekStart(date)` (Monday 00:00 ET), `weekEnd(date)`, `toEtDate(utc)`, `fromEtDate(local)`, `isSameWeek(a, b)`, `daysInRange(start, end)`. Used by the resolver, save-as-template, copy-week, and Phase 5 cron jobs.
- `src/lib/balances/entitlements.ts` — `computeVacationEntitlement(hireDate, asOf)` and `computeSickEntitlement(hireDate, asOf)`. Tenure-derived formulas, single source of truth used by §3 onboarding and the Phase 5 anniversary cron.
- `src/lib/employees/schemas.ts` — Zod schemas: `employeeInputSchema` (manual add) and `employeeImportRowSchema` (spreadsheet rows). Shared row-level validation across §3.
- `src/lib/schedule/resolver.ts` — `resolveWeek(classId, weekStart) → ResolvedShift[]`, plain async function wrapped in `React.cache()`. Returns shifts with `source: 'template' | 'override'` so the UI can style overrides distinctly.
- `src/lib/schedule/conflicts.ts` — pure functions. `detectShiftConflicts(candidate, existing) → ConflictReason[]` implements the four overlap rules (a)/(b)/(c)/(d). No DB access; Server Actions fetch the relevant week's resolved shifts and pass them in.
- `src/lib/sheets/parse.ts` — thin SheetJS wrapper. `parseSheet(buffer, schema) → Row[]` returning typed rows or per-row errors.
- `src/lib/sheets/employee-import.ts` — validator + commit for the employee sheet. Writes `employees`, `balance_transaction(source='initial_import')`, and sets denormalized `*_hours_balance`.
- `src/lib/sheets/enrollment-import.ts` — validator + commit for the enrollment forecast sheet.
- `src/lib/clerk-invite.ts` — wraps Clerk's Backend SDK `invitations.createInvitation()`. Normalizes Clerk's error shapes into the app's `ActionError` type and centralizes the redirect URL + email template config.

### Schema — `src/db/schema/`

- **New:** `enrollment-forecast.ts`, `time-off-request.ts`, `time-off-request-day.ts`.
- **Modified:** `schedule-shift-template.ts` (tighten `effective_from` to NOT NULL).
- **New enums in `enums.ts`:** `time_off_type`, `time_off_status`, `bereavement_relation` (declared in Phase 2 so the FKs compile; row writes happen in Phase 3).
- `src/db/schema/index.ts` re-exports the new modules.

### Routes & UI — `src/app/(admin)/admin/`

- `employees/new/page.tsx` — manual add form.
- `employees/upload/page.tsx` — three-step bulk upload (upload → preview → confirm).
- `employees/[id]/page.tsx` — profile, with "Send invite" button gated on `clerk_user_id IS NULL`.
- `employees/actions.ts` — `createEmployeeAction`, `commitEmployeeImportAction`, `sendInviteAction`.
- `classes/[id]/schedule/page.tsx` — schedule grid. **Server Component**: calls `resolveWeek()`, serializes `ResolvedShift[]`, passes as props.
- `classes/[id]/schedule/print/page.tsx` — print view route with `@media print` CSS.
- `classes/[id]/schedule/_components/` — `WeekGrid`, `ShiftBlock`, `ShiftEditDialog`, `SaveAsTemplateDialog`, `CopyWeekDialog`, `WeekNavigator`, `ModeToggle` (at top level of the grid view), `EnrollmentRow`. All Client Components.
- `classes/[id]/actions.ts` — `createShiftAction`, `updateShiftAction`, `deleteShiftAction`, `saveAsTemplateAction`, `copyWeekAction`, `upsertEnrollmentAction`, `commitEnrollmentImportAction`.

### Server/client split for the schedule grid

The page is a Server Component that resolves the week and passes the result down. `WeekGrid` and its descendants are Client Components. Mutations are Server Actions imported into the client tree. This keeps the resolver's DB access on the server and the drag/click interactions on the client without a separate API layer.

### Upload preview state

Client-side, persisted in `sessionStorage` keyed by upload session id. A mid-flow refresh restores the preview without re-uploading the file. A server-side draft table would be overkill at ~35 rows.

### Tests — `src/**/__tests__/`

- `lib/dates/__tests__/dates.test.ts` — week boundaries across DST transitions.
- `lib/schedule/__tests__/resolver.test.ts`, `conflicts.test.ts` — pure-function unit tests, fixture-driven.
- `lib/sheets/__tests__/employee-import.test.ts`, `enrollment-import.test.ts` — fixture sheets for the happy path and each row-level error.
- Server Actions are integration-tested against the dev Supabase project using transactional rollback: each test opens a Drizzle transaction at setup, runs the action, asserts, rolls back. No mocks, no separate test project, no test data pollution.

### Why this shape

- The resolver and conflict detector are pure functions, independently testable, and reused by the print view, save-as-template, and copy-week without route coupling.
- Server Actions live next to the route that uses them (Next.js App Router convention).
- Sheet parsing is split per-domain (employee vs enrollment) because the validators have nothing in common beyond "uses SheetJS."
- `src/lib/dates.ts` exists as a single import point because timezone bugs in this app are inevitable otherwise — UTC store / ET display / ET cron is non-negotiable per `docs/CLAUDE.md`.

---

## Section 2 — Schema migration #2

Drizzle generates the migration from schema diffs (`pnpm db:generate` → `drizzle/0001_<slug>.sql`). Three new tables, three new enums, one column tightening, plus the indexes the resolver / conflict detector / admin queue listings actually need.

### New enums (`src/db/schema/enums.ts`)

```ts
export const timeOffTypeEnum = pgEnum("time_off_type", [
  "vacation", "sick", "bereavement", "unpaid", "unallocated",
]);
export const timeOffStatusEnum = pgEnum("time_off_status", [
  "pending", "approved", "rejected", "cancelled",
]);
export const bereavementRelationEnum = pgEnum("bereavement_relation", [
  "parent", "sibling", "spouse", "child", "grandparent",
]);
```

### New table: `enrollment_forecast`

`src/db/schema/enrollment-forecast.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `defaultRandom()` |
| `class_id` | uuid fk → class | not null |
| `date` | date (mode: string) | not null |
| `expected_students` | int | not null, CHECK `expected_students >= 0` |
| `created_at`, `updated_at` | timestamptz | defaults match Phase 1 |

**Unique:** `(class_id, date)` — one forecast per class per day. Cell-edit Server Action uses `ON CONFLICT (class_id, date) DO UPDATE`.

The unique constraint covers `(class_id, date)` range scans for the top-of-grid render, so no additional index needed.

### New table: `time_off_request`

`src/db/schema/time-off-request.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `employee_id` | uuid fk → employee | not null |
| `type` | `time_off_type` | not null |
| `status` | `time_off_status` | not null, default `'pending'` |
| `submitted_at` | timestamptz | not null, defaultNow |
| `reason` | text | nullable |
| `bereavement_relation` | `bereavement_relation` | nullable |
| `total_hours` | numeric(6,2) | not null, default 0 (denormalized sum of `time_off_request_day.hours`) |
| `decision_by` | uuid fk → admin | nullable |
| `decision_at` | timestamptz | nullable |
| `decision_note` | text | nullable |
| `advance_notice_overridden` | boolean | not null, default false |
| `created_at`, `updated_at` | timestamptz | |

**CHECK constraints** (correctness invariants of the model, cheap to add now even though writes happen in Phase 3):

- `(type = 'bereavement') = (bereavement_relation IS NOT NULL)` — relation iff bereavement.
- `(status IN ('approved','rejected')) = (decision_at IS NOT NULL)` — decision_at iff decided.
- `decision_by IS NULL OR decision_at IS NOT NULL` — can't have a decider without a decision time.

**Indexes:**

- `(employee_id, status)` — covers both the employee's "my requests" view and admin queue filters by employee.
- `(status, submitted_at DESC)` — admin queue default sort ("newest pending first" per PRD §6.2).

### New table: `time_off_request_day`

`src/db/schema/time-off-request-day.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid fk → time_off_request | not null, **ON DELETE CASCADE** |
| `date` | date (mode: string) | not null |
| `hours` | numeric(5,2) | not null, CHECK `hours >= 0` |
| `is_full_day` | boolean | not null |
| `is_holiday` | boolean | not null, default false |
| `start_time` | time | nullable |
| `end_time` | time | nullable |

**CHECK:** `is_full_day OR (start_time IS NOT NULL AND end_time IS NOT NULL)` — partial days must specify a range.

**Unique:** `(request_id, date)` — one row per day per request.

**Index:** `(date)` — powers Phase 3's "who's out on date X" coverage lookup. Cheap to add now.

### Modified: `schedule_shift_template`

`effective_from` → **NOT NULL**. The table is empty in Phase 1 (seed creates no template rows), so the `ALTER COLUMN ... SET NOT NULL` is safe and the migration doesn't need a backfill. The closure rule depends on this invariant: every active template has a known start date.

### Modified: `employee`

Add a case-insensitive unique index on email:

```sql
CREATE UNIQUE INDEX employee_email_lower_unique ON employee (LOWER(email));
```

Manual add and import both check collisions on `LOWER(email)` (§3.2 step 4). If Phase 1 already has a plain `UNIQUE(email)` constraint, the new index replaces it (drop in the same migration); the lowercase normalization in `employeeInputSchema` makes the plain constraint redundant.

### Modified: `balance_transaction`

Add `'historical_usage'` to the `balance_source` enum. Used by §3.6 to record vacation/sick days drawn in a prior system before the employee was onboarded into wp-vacation.

```sql
ALTER TYPE balance_source ADD VALUE 'historical_usage';
```

`'initial_import'` is already present from Phase 1 (per `docs/CLAUDE.md` v1 pinning); no change there.

### Indexes on existing schedule tables

These weren't needed in Phase 1 (tables empty). Added in migration #2 ahead of Phase 2's resolver/conflict workload:

- `schedule_shift_template(class_id, effective_from)` — resolver fetches "templates for class C effective before weekEnd."
- `schedule_shift(class_id, date)` — resolver fetches "concrete overrides for class C in week W."
- `schedule_shift(employee_id, date)` — conflict rule (a) needs "all shifts for employee E on date D across classes."

### Migration review

`pnpm db:generate` produces `drizzle/0001_<slug>.sql`. Reviewed by hand before apply to confirm:

- The three new tables with their CHECKs.
- The `ALTER COLUMN effective_from SET NOT NULL`.
- The three new enums precede their referencing columns in the SQL.
- Indexes use `CREATE INDEX IF NOT EXISTS` (Drizzle default).

### What's deliberately not here

- **No `audit_log` schema changes.** The table exists from Phase 1; Phase 2 actions write to it without further schema work.
- **No exclusion constraint** for the template-closure invariant. App-level enforcement in the Server Action.
- **No DB-level uniqueness on `schedule_shift(employee_id, date)`.** Split shifts (morning + afternoon) are valid. Overlap is checked by the conflict detector, not by the DB.

---

## Section 3 — Onboarding pipeline

Three entry points: manual single-employee form, bulk spreadsheet upload, and an admin-triggered Clerk invite issued from the profile page after the row exists. Plus a historical-usage tool for capturing prior-system vacation/sick draws. All live under `src/app/(admin)/admin/employees/` and share row-level validation via Zod schemas in `src/lib/employees/schemas.ts`.

### 3.1 Shared validation

`src/lib/employees/schemas.ts` exports two Zod schemas, single source of truth for row-level rules.

- `employeeInputSchema` (manual form): required `first_name`, `last_name`, `email`, `role`, `default_class_id`, `hire_date`. No balance fields — vacation and sick are derived from `hire_date`; unpaid starts at 0.
- `employeeImportRowSchema` (spreadsheet rows): superset of the form schema, replaces `default_class_id` with `default_class_name` (case-insensitive **exact** match against `class.name` — no fuzzy matching), adds `current_unpaid_hours_remaining` (numeric, default 0). No vacation or sick columns; those are computed.

Both schemas normalize email to lowercase before storage.

### 3.2 Manual add — `createEmployeeAction`

Route: `employees/new/page.tsx`. Client form uses React Hook Form + zodResolver. On submit, calls `createEmployeeAction(input)` from `employees/actions.ts`.

Action runs in a single Drizzle transaction:

1. Auth: caller must be admin (Phase 1 helper).
2. Re-parse with `employeeInputSchema` server-side.
3. Verify `default_class_id` exists in `class`.
4. Check `email` collision — unique on `LOWER(email)`.
5. Insert `employee` with `clerk_user_id = NULL`, all `*_hours_balance` = 0 initially.
6. Compute `vacationHours = computeVacationEntitlement(hire_date, today)` and `sickHours = computeSickEntitlement(hire_date, today)` from `src/lib/balances/entitlements.ts`. For each non-zero result, write `balance_transaction(source='initial_import', type, delta=hours, occurred_at=now)` and set the corresponding denormalized column.
7. Write one `audit_log` row: `action = 'employee.create'`, payload = validated input.
8. `revalidatePath('/admin/employees')`, return `{ ok: true, id }`.

No invite is sent on create. The profile page exposes a separate "Send invite" button (§3.5).

### 3.3 Bulk upload pipeline

Three steps: upload → preview → commit. Preview state in `sessionStorage`.

**Step 1 — upload** (`employees/upload/page.tsx`)

Client uploads XLSX or CSV. A Server Action `parseEmployeeImportAction(formData)`:

- Reads the buffer.
- Calls `parseSheet(buffer, employeeImportRowSchema)` from `src/lib/sheets/parse.ts`. SheetJS reads the first sheet; CSV detected by extension.
- Per-row result: `{ ok: true, value }` or `{ ok: false, errors: RowError[] }` where `RowError = { row, column, code, message }`.
- Cross-row checks: duplicate emails within the sheet; `default_class_name` resolution against `class` (no match → blocking row error per `docs/CLAUDE.md`).
- Returns `{ sessionId, rows: ParsedRow[] }`. Nothing written to DB.

Client stores the result in `sessionStorage` keyed by `sessionId`, then navigates to `/admin/employees/upload/preview?session=<id>`.

**Step 2 — preview** (`/admin/employees/upload/preview`)

Client Component reads `sessionStorage`. Renders a table with valid rows in default styling and errored rows highlighted with inline messages per cell. Header summary: `N valid, M errors`. If any errors exist, the "Confirm import" button is disabled — partial imports are not supported in v1. Admin fixes the spreadsheet and re-uploads.

Edit-in-place is not offered in v1. The spreadsheet stays the source of truth; re-upload is simpler and avoids two divergent input modes.

**Step 3 — commit — `commitEmployeeImportAction`**

Client sends the array of valid rows back. Single transaction:

1. Re-parse against `employeeImportRowSchema` (never trust `sessionStorage`).
2. Re-resolve `default_class_id` (class may have been deleted between preview and commit → fail the whole transaction with a class-missing error; admin re-uploads).
3. For each row: insert `employee`, then write balance rows (§3.4).
4. Write one summary `audit_log` row: `action = 'employee.import'`, payload = `{ count, sessionId }`. Per-row creation logs are skipped — the `employee` rows themselves with `created_at` are sufficient forensic data, and 35 near-identical audit rows would just be noise.
5. `revalidatePath('/admin/employees')`, return `{ ok: true, ids }`.

On any failure, full transaction rollback. The `sessionStorage` entry survives so the admin can retry or inspect.

### 3.4 Initial balance writes

For each newly-inserted employee (both manual and import paths), inside the same transaction as the `employee` insert:

- **Vacation:** `vacationHours = computeVacationEntitlement(hire_date, today)`. If non-zero, write `balance_transaction(source='initial_import', type='vacation', delta=vacationHours, occurred_at=now, note='Initial entitlement on onboarding')` and set `employee.vacation_hours_balance = vacationHours`.
- **Sick:** same shape, using `computeSickEntitlement(hire_date, today)`.
- **Unpaid:** import path uses the spreadsheet's `current_unpaid_hours_remaining` (default 0); manual path uses 0. If non-zero, write `balance_transaction(source='initial_import', type='unpaid', delta=hours, occurred_at=now, note='Initial unpaid balance from import')` and set `employee.unpaid_hours_balance`.

**Invariant:** `employee.<type>_hours_balance = SUM(balance_transaction.delta WHERE employee_id = E AND type = T)` always holds. Phase 3 maintains it on approve/withdraw; Phase 5 anniversary cron maintains it on annual reset. Onboarding writes both halves in the same transaction.

`src/lib/balances/entitlements.ts` is the single source of truth for the tenure formulas. Reused by the Phase 5 anniversary cron — same function, different `asOf`.

### 3.5 Admin-triggered Clerk invite

Route: `employees/[id]/page.tsx`. Profile page shows employee details. "Send invite" button is disabled with tooltip "Already linked" if `clerk_user_id IS NOT NULL`.

`sendInviteAction(employeeId)`:

1. Auth: admin only.
2. Load employee. Missing → `{ ok: false, error: 'not_found' }`. Already linked → `{ ok: false, error: 'already_linked' }`. Fast-fail per spec decision #6.
3. Call `inviteUser({ emailAddress, redirectUrl, publicMetadata: { employeeId, role } })` from `src/lib/clerk-invite.ts`.
4. Write `audit_log` row: `action = 'employee.invite_sent'`, payload = `{ employeeId, clerkInvitationId }`.
5. `revalidatePath('/admin/employees/[id]')`.

`src/lib/clerk-invite.ts` (thin wrapper):

- Calls `clerkClient.invitations.createInvitation()` with `notify: true`.
- Centralizes `redirectUrl = ${APP_URL}/sign-up`.
- Catches Clerk errors and maps to the app's `ActionError` shape. Distinguishes Clerk's "invitation already pending" into `code: 'invite_pending'` so the UI can surface "Pending invite exists" with a "Resend" affordance.

The Phase 1 Clerk webhook handler completes the link by setting `clerk_user_id` when the invitee finishes sign-up. No admin follow-up.

**Resend:** if `invite_pending` is returned, the profile page exposes a "Resend invite" button → `resendInviteAction(employeeId)`. Implementation: revoke the existing Clerk invitation, create a new one. Audit log: `action = 'employee.invite_resent'`.

### 3.6 Historical usage entry

Admin tool for recording vacation or sick days used in a prior system. Needed because vacation and sick are granted at full entitlement on onboarding; prior-period draws aren't otherwise represented.

Surface: `employees/[id]/page.tsx`, "Record previously used time off" button opens `HistoricalUsageDialog` (Client Component).

Form fields:

- Type — `vacation | sick` (radio).
- Start date, end date (date pickers).
- Optional note.

`recordHistoricalUsageAction({ employeeId, type, startDate, endDate, note })`:

1. Auth: admin only.
2. Validate: `startDate <= endDate`; both dates fall within the employee's current anniversary year for the given `type`. Out-of-range entries are rejected — they wouldn't affect today's balance anyway (prior anniversary year's grant is gone).
3. Compute hours: count weekdays (M–F) in `[startDate, endDate]` × 8 hrs/day. Weekends excluded. Holidays are **not** excluded in v1 — admin shortens the range manually if a holiday falls in it.
4. Write `balance_transaction(source='historical_usage', employee_id, type, delta=-hours, occurred_at=startDate, note)`.
5. Decrement denormalized `employee.<type>_hours_balance` by `hours`. Invariant preserved (balance = SUM of deltas).
6. Audit log: `action = 'employee.historical_usage_recorded'`, payload = `{ type, startDate, endDate, hours }`.

### 3.7 Route summary

| Route | Type | Purpose |
|---|---|---|
| `/admin/employees` | Server | List (Phase 1 scaffold; gains "Bulk upload" link) |
| `/admin/employees/new` | Server + Client form | Manual add |
| `/admin/employees/upload` | Client | File upload step |
| `/admin/employees/upload/preview` | Client | Preview step (reads `sessionStorage`) |
| `/admin/employees/[id]` | Server | Profile + invite + historical-usage actions |

All gated by the `(admin)` layout's admin check (Phase 1 already enforces).
