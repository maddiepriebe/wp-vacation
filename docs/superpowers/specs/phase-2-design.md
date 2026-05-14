# Phase 2 — Setup & Schedule: Design

**Status:** all sections drafted (1–7); self-review applied; pending user review.

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

- `src/lib/dates.ts` — central date utilities. Exports `weekStart(date)` (Monday 00:00 ET), `weekEnd(date)`, `toEtDate(utc)`, `fromEtDate(local)`, `isSameWeek(a, b)`, `daysInRange(start, end)`, plus validation helpers `isISODateString`, `isMondayISODate`, `timeToMinutes`, `assertTimeRange`. Used by the resolver, save-as-template, copy-week, Phase 5 cron jobs, and every Zod schema that touches dates or times.
- `src/lib/actions/errors.ts` — `ActionError` and `ActionResult<T>` types. Single source of truth for the Server Action error envelope (§5.1).
- `src/lib/actions/transactions.ts` — `runActionTx` wrapper, `txStorage` (AsyncLocalStorage), `IntentionalRollback` sentinel, `dbOrTx()` helper, `sanitizeContext` for internal-error logging. Centralizes the commit / rollback / sanitized-log contract for every mutating action (§7.1).
- `src/lib/balances/entitlements.ts` — `computeVacationEntitlement(hireDate, asOf)` and `computeSickEntitlement(hireDate, asOf)`. Tenure-derived formulas, single source of truth used by §3 onboarding and the Phase 5 anniversary cron.
- `src/lib/employees/normalize.ts` — `normalizeEmail(email)`. Called inside Zod transforms; action bodies do not re-normalize.
- `src/lib/employees/schemas.ts` — Zod schemas: `employeeInputSchema` (manual add) and `employeeImportRowSchema` (spreadsheet rows). Shared row-level validation across §3.
- `src/lib/schedule/types.ts` — `ShiftSource`, `ScheduleMode`, `ResolvedShift` (discriminated union for `template` / `override` variants), plus `ShiftLike` / `TemplateLike` shapes consumed by the conflict detector.
- `src/lib/schedule/resolver.ts` — `resolveWeek(classId, weekStartISO)` and `resolveTemplateWeek(classId, weekStartISO)`, both wrapped in `React.cache()` and using `dbOrTx()` for tx-aware reads. Shared `expandTemplates` helper.
- `src/lib/schedule/conflicts.ts` — pure `detectShiftConflicts(candidate, ctx) → ConflictReason[]` implementing rules (a)/(c)/(d). No DB access; Server Actions fetch context and pass it in.
- `src/lib/schedule/schemas.ts` — Zod input schemas for every shift/template Server Action (create / update / delete / save-as-template / copy-week).
- `src/lib/schedule/closure.ts` — `applyClosureRule(tx, classId, newEffectiveFromISO)`. Called only by `saveAsTemplateAction` (§6.1).
- `src/lib/sheets/parse.ts` — thin SheetJS wrapper. `parseSheet(buffer, schema) → Row[]` returning typed rows or per-row errors.
- `src/lib/sheets/employee-import.ts` — validator + commit support for the employee sheet.
- `src/lib/sheets/enrollment-import.ts` — validator + commit support for the per-class enrollment forecast sheet.
- `src/lib/clerk-invite.ts` — exports `inviteUser` and `resendInvite`, thin wrappers around Clerk Backend SDK `invitations.createInvitation()` (and revoke + re-create for resend). Normalize Clerk's error shapes into the app's `ActionError` codes (specifically mapping "invitation already pending" → `code: 'invite_pending'`) and centralize `redirectUrl` + `notify: true` config.

### Schema — `src/db/schema/`

- **New:** `enrollment-forecast.ts`, `time-off-request.ts`, `time-off-request-day.ts`.
- **Modified:** `schedule-shift-template.ts` (tighten `effective_from` to NOT NULL).
- **New enums in `enums.ts`:** `time_off_type`, `time_off_status`, `bereavement_relation` (declared in Phase 2 so the FKs compile; row writes happen in Phase 3).
- `src/db/schema/index.ts` re-exports the new modules.

### Routes & UI — `src/app/(admin)/admin/`

- `employees/new/page.tsx` — manual add form.
- `employees/upload/page.tsx` — three-step bulk upload (upload → preview → confirm).
- `employees/upload/preview/page.tsx` — preview step (reads `sessionStorage`).
- `employees/[id]/page.tsx` — profile, with "Send invite" / "Resend invite" buttons (gated on `clerk_user_id`) and "Record previously used time off" affordance.
- `employees/actions.ts` — `createEmployeeAction`, `parseEmployeeImportAction`, `commitEmployeeImportAction`, `sendInviteAction`, `resendInviteAction`, `recordHistoricalUsageAction`.
- `classes/[id]/schedule/page.tsx` — schedule grid. **Server Component**: calls `resolveWeek()` or `resolveTemplateWeek()` per `mode`, passes `ResolvedShift[]` as props.
- `classes/[id]/schedule/print/page.tsx` — print view route with `@media print` CSS and a manual `Print` button (no auto-trigger).
- `classes/[id]/schedule/_components/` — `ScheduleClient` (top-level Client Component owning mode + week state), `WeekGrid`, `ShiftBlock`, `ShiftEditDialog`, `SaveAsTemplateDialog`, `CopyWeekDialog`, `HistoricalUsageDialog`, `WeekNavigator`, `ModeToggle`, `EnrollmentRow`, `ConflictModal`. All Client Components.
- `classes/[id]/enrollment/upload/page.tsx` — per-class enrollment bulk upload (parse → preview → confirm).
- `classes/[id]/actions.ts` — `createShiftAction`, `updateShiftAction`, `deleteShiftAction`, `createShiftTemplateAction`, `updateShiftTemplateAction`, `deleteShiftTemplateAction`, `saveAsTemplateAction`, `copyWeekAction`, `upsertEnrollmentForecastAction`, `deleteEnrollmentForecastAction`, `commitEnrollmentImportAction`.

### Server/client split for the schedule grid

The page is a Server Component that resolves the week and passes the result down. `WeekGrid` and its descendants are Client Components. Mutations are Server Actions imported into the client tree. This keeps the resolver's DB access on the server and the drag/click interactions on the client without a separate API layer.

### Upload preview state

Client-side, persisted in `sessionStorage` keyed by upload session id. A mid-flow refresh restores the preview without re-uploading the file. A server-side draft table would be overkill at ~35 rows.

### Tests — `src/**/__tests__/`

- `src/test/with-tx.ts` — `withTx` harness. Opens a Drizzle transaction, binds the test body to `txStorage` (ALS), rolls back at end. Server Actions invoked through `runActionTx` join as savepoints (§7.1 / §7.4).
- `src/test/fixtures.ts` — `makeClass`, `makeEmployee`, `makeTemplate`, `makeShift`, etc. All take `tx`; generate globally unique defaults to avoid unique-constraint collisions in parallel test runs.
- `src/test/check-schema.ts` — pre-test schema/version check; fails fast if `__drizzle_migrations` doesn't match the highest file in `drizzle/`.
- `lib/dates/__tests__/dates.test.ts` — week boundaries across DST transitions; `isISODateString` / `isMondayISODate` / time helpers.
- `lib/balances/__tests__/entitlements.test.ts` — vacation/sick tenure formulas across boundary dates.
- `lib/schedule/__tests__/resolver.test.ts`, `conflicts.test.ts` — fixture-driven; `conflicts` is pure unit, `resolver` is integration via `withTx`. See §4.8 / §5.7.
- `lib/sheets/__tests__/employee-import.test.ts`, `enrollment-import.test.ts` — fixture sheets for the happy path and each row-level error.
- Server Action integration tests live next to the action (`src/app/(admin)/**/__tests__/*.test.ts`) and run inside `withTx` + `runActionTx` savepoint join. No mocks; no separate test project.
- One Playwright happy-path E2E at `tests/e2e/admin-onboard-and-schedule.spec.ts` (§7.4).

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

### Modified: `schedule_shift`

Change `source_template_id` foreign key from the Phase 1 default (`NO ACTION` — blocks template deletion when overrides reference it) to `ON DELETE SET NULL`:

```sql
ALTER TABLE schedule_shift
  DROP CONSTRAINT schedule_shift_source_template_id_schedule_shift_template_id_fk,
  ADD CONSTRAINT schedule_shift_source_template_id_fk
    FOREIGN KEY (source_template_id) REFERENCES schedule_shift_template(id)
    ON DELETE SET NULL;
```

(Drizzle generates the actual constraint name; `pnpm db:generate` will produce the correct ALTER.) Drizzle schema change: add `{ onDelete: "set null" }` to the `references()` call in `src/db/schema/schedule-shift.ts`. With this in place, deleting a template that has replacement overrides converts those overrides into standalone overrides (`source_template_id` becomes `NULL`) instead of failing the delete — matches the resolver's standalone-vs-replacement semantics (§4.7).

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
3. Compute hours: count weekdays (M–F) in `[startDate, endDate]` × 8 hrs/day. The 8-hr default is the Phase 2 v1 assumption — there is no `default_hours_per_day` field on `employee` in Phase 1. If part-time hours per day are introduced later, this multiplier is replaced by `employee.default_hours_per_day`. Weekends excluded. Holidays are **not** excluded in v1 — admin shortens the range manually if a holiday falls in it.
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

### 3.8 Tests for §3 actions

Integration tests (`src/app/(admin)/admin/employees/__tests__/actions.test.ts`, transactional rollback via `withTx`):

- `createEmployeeAction`: happy path; `validation` on bad email / missing required field; `class_missing`; `LOWER(email)` collision.
- `createEmployeeAction`: vacation/sick rows written only when the tenure entitlement is non-zero; the denormalized balance matches the inserted `balance_transaction.delta`.
- `parseEmployeeImportAction`: happy path returns rows with `ok: true`; row-level errors for bad email / unknown `default_class_name` / duplicate emails within sheet; cross-row error count matches expectations.
- `commitEmployeeImportAction`: happy path inserts N rows + balance transactions atomically; class deletion between preview and commit fails the whole transaction with `class_missing`.
- `sendInviteAction`: happy path writes audit row with the Clerk invitation id; `not_found` for missing employee; `already_linked` when `clerk_user_id IS NOT NULL`; Clerk's "invitation already pending" maps to `invite_pending`.
- `resendInviteAction`: happy path revokes the previous Clerk invitation then creates a new one; audit row written as `employee.invite_resent`.
- `recordHistoricalUsageAction`: happy path writes a negative `balance_transaction(source='historical_usage')` and decrements the denormalized column; `validation` for `startDate > endDate`; `validation` for dates outside the current anniversary year; weekday-counting math matches expected hours for a range spanning a weekend.

`lib/balances/__tests__/entitlements.test.ts` — pure unit tests for `computeVacationEntitlement` and `computeSickEntitlement` across boundary dates (under 90 days, exactly 90 days, just before/after 6 months, just before/after each anniversary).

---

## Section 4 — Schedule resolver & render path

### 4.1 Core types

```ts
// src/lib/schedule/types.ts
export type ShiftSource = 'template' | 'override';
export type ScheduleMode = 'template' | 'week';

export type ResolvedShift = {
  date: string;            // 'YYYY-MM-DD', ET wall-clock
  employee_id: string;
  start_time: string;      // 'HH:MM' (ET wall-clock, 15-min granularity)
  end_time: string;
  employee: { id: string; first_name: string; last_name: string; role: EmployeeRole };
} & (
  | { source: 'template'; template_id: string }
  | { source: 'override'; shift_id: string; source_template_id: string | null }
);
```

Discriminated union. `source: 'template'` carries `template_id` (the parent template row's id). `source: 'override'` carries `shift_id` (the `schedule_shift.id`) and `source_template_id`:

- `source_template_id: string` — **replacement override**: replaces the matching template's slot for this `(employee, date)`.
- `source_template_id: null` — **standalone override**: an additive one-off shift that doesn't replace any template.

Edit dialogs use these fields to identify which row to mutate.

### 4.2 Two resolver functions, one per mode

`src/lib/schedule/resolver.ts`:

```ts
export const resolveWeek = React.cache(
  async (classId: string, weekStartISO: string): Promise<ResolvedShift[]> => { ... }
);

export const resolveTemplateWeek = React.cache(
  async (classId: string, weekStartISO: string): Promise<ResolvedShift[]> => { ... }
);
```

Both take `weekStartISO: string` (`'YYYY-MM-DD'`), **not `Date`**. `React.cache` dedupes by argument identity — two callers constructing fresh `Date` objects for the same Monday would miss the cache. The string is also the URL representation and avoids ET/UTC confusion from `Date.toISOString()`.

**Shared expansion helper:**

```ts
function expandTemplates(
  templates: ScheduleShiftTemplate[],
  weekStartISO: string,
  suppressedTemplateKeys?: Set<string>,
): ResolvedShift[]
```

Used by both resolvers. Week mode passes a populated suppression set; template mode passes none (all template-derived slots render).

**`resolveWeek` (week mode — default):**

1. Compute `weekEndISO` (Friday in `'YYYY-MM-DD'`) via `src/lib/dates.ts`. Schedule dates are M–F only; no need to extend through Sunday.
2. Fetch active templates: `WHERE class_id = ? AND effective_from <= weekEndISO AND (effective_until IS NULL OR effective_until >= weekStartISO)`. Uses `schedule_shift_template(class_id, effective_from)` index.
3. Fetch concrete shifts (overrides): `WHERE class_id = ? AND date >= weekStartISO AND date <= weekEndISO` (inclusive date-only bounds, no timestamp coercion). Uses `schedule_shift(class_id, date)` index.
4. Build template-suppression set from **replacement** overrides only — those with a non-null `source_template_id`:

   ```ts
   const suppressedTemplateKeys = new Set(
     overrides
       .filter((o) => o.source_template_id !== null)
       .map((o) => `${o.source_template_id}|${o.employee_id}|${o.date}`)
   );
   ```

   Standalone overrides (`source_template_id = null`) suppress nothing — they render alongside template-derived shifts.
5. Call `expandTemplates(templates, weekStartISO, suppressedTemplateKeys)`. For each template, expand into per-date slots for `dayOfWeek ∈ [0..4]` within the week, skipping dates outside `[effective_from, effective_until]` and dates where `${template.id}|${template.employee_id}|${date}` is in the suppression set.
6. Append all override rows as `source: 'override'`. Replacement and standalone overrides both render; replacements have already removed their parent template's slot in step 5.
7. Batch-join employee details (single query keyed by the union of `employee_id` values).
8. Sort by:

   ```
   date ASC,
   start_time ASC,
   end_time ASC,
   employee.last_name ASC,
   employee.first_name ASC,
   employee_id ASC,
   source ASC,        // 'override' < 'template' alphabetically; ties resolve deterministically
   id ASC             // template_id for template rows, shift_id for override rows
   ```

   Deterministic ordering for snapshot tests, stable render, and print pagination.

**`resolveTemplateWeek` (template mode):**

Same as steps 1, 2, 7, 8, plus `expandTemplates(templates, weekStartISO)` with no suppression set. Returns only `source: 'template'` rows. Used when the admin is editing the recurring schedule directly; overrides shouldn't visually mask the underlying templates.

**Resolver does not validate.** Overlap rules (a)–(d) from decision #2 are enforced in the mutation layer (Section 5). The resolver always returns what the DB contains. If overlapping shifts exist (data drift, race, or pre-existing rows), all of them render; warnings surface in the UI but the resolver doesn't filter.

### 4.3 Caching

`React.cache()` memoizes per request, keyed by argument identity. Two Server Components on the same page calling `resolveWeek('A', '2026-05-18')` get a single DB roundtrip. The `weekStartISO` string ensures cache hits across call sites; a `Date`-typed argument would defeat memoization (fresh objects, different identity per construction).

No cross-request caching; `revalidatePath` from Server Actions invalidates the page render on mutation. At ~7 employees × 5 days = ~35 rows per call, `unstable_cache` isn't worth the invalidation bookkeeping.

### 4.4 Page composition

Route: `src/app/(admin)/admin/classes/[id]/schedule/page.tsx` — **Server Component**.

```tsx
export default async function SchedulePage({ params, searchParams }) {
  const weekStartISO = parseWeekParam(searchParams.week) ?? weekStartOf(todayET());
  // both return 'YYYY-MM-DD' strings, not Date.
  const mode: ScheduleMode = searchParams.mode === 'template' ? 'template' : 'week';
  const shifts = mode === 'template'
    ? await resolveTemplateWeek(params.id, weekStartISO)
    : await resolveWeek(params.id, weekStartISO);
  const classData = await db.query.classes.findFirst({ where: eq(classes.id, params.id) });

  return (
    <ScheduleClient
      classId={params.id}
      weekStartISO={weekStartISO}
      mode={mode}
      initialShifts={shifts}
      classData={classData}
    />
  );
}
```

`weekStartISO` flows as a plain `'YYYY-MM-DD'` string the whole way through: URL param → server resolver → client props. **No `Date.toISOString()` on schedule week dates** — the UTC conversion can shift the intended ET date when run from a non-ET locale. `src/lib/dates.ts` exports ET wall-clock helpers (`weekStartOf`, `todayET`, `addDaysISO`, etc.) that return strings.

`ScheduleClient` is the top-level Client Component (owns `ModeToggle`, `WeekNavigator`, `WeekGrid`). Mode and `weekStartISO` live in the URL — switching either is a navigation that re-runs the Server Component and threads fresh `ResolvedShift[]` down. No SWR, no React Query, no separate API layer.

Mutations (Section 5) are Server Actions imported into the client tree. They call `revalidatePath('/admin/classes/[id]/schedule')` to refresh after writes.

### 4.5 Mode toggle behavior

`ModeToggle` updates `searchParams.mode`. The two modes diverge in:

| Aspect | Week mode | Template mode |
|---|---|---|
| Data source | `resolveWeek` (templates merged with overrides) | `resolveTemplateWeek` (templates only) |
| Visual cue on overrides | Distinct styling (e.g., dashed border) | N/A — overrides hidden |
| Click empty cell | Creates a `schedule_shift` (standalone override) | Creates a `schedule_shift_template` slot |
| Click existing cell | Edit/delete an override, or edit a template-derived slot (writes replacement override) | Edit/delete the template row directly |
| "Save as template" button | Visible | Hidden |

Template-mode edits do *not* trigger the closure rule (decision #4) — that's for "save week as new template" (§6). Direct template-row edits modify the existing row in place.

**Click target identity.** Every `ShiftBlock` in the grid carries the identity of the underlying row it was rendered from — `template_id` for `source: 'template'` rows, `shift_id` for `source: 'override'` rows. The click handler reads that field directly; there is no fuzzy match by `(employee, dayOfWeek, time)`. This matters when an employee has multiple template slots on the same day (e.g., Maria 8–12 *and* Maria 1–5): the admin clicks the specific block they want to edit, and the corresponding action receives that exact `template_id` (template mode) or sets `source_template_id` to that template's id (week mode, creating a replacement override). No ambiguity about which template a click is targeting.

### 4.6 Print view

The print route (`schedule/print/page.tsx`) is also a Server Component calling `resolveWeek(classId, weekStartISO)`. Both interactive and print views share the same resolver call shape — no separate read path. Print-specific layout, page-break rules, and `@media print` CSS are detailed in §6.

### 4.7 Edge cases

- **DST transitions.** Wall-clock storage and rendering; admin never sees DST in the UI. `src/lib/dates.ts` handles the underlying math via `date-fns-tz`.
- **Template `effective_from` mid-week.** Per-date expansion respects the template's range. Earlier dates in the week fall through to the prior template (closure rule guarantees `prior.effective_until = next.effective_from - 1`).
- **Template `effective_until` mid-week.** Symmetric — closing template covers up to and including its `effective_until` date.
- **Multiple active templates for the same `(class_id, employee_id, day_of_week, start_time, end_time)`.** *This exact tuple* is the conflict key. Maria 8–12 and Maria 1–5 on Mondays are two valid templates, not a conflict — the start/end times differ. Two rows matching the full key: take the one with the latest `effective_from` and log a warning with `{ class_id, day_of_week, employee_id, date, conflictingTemplateIds }` so an oncall can investigate. The closure rule should prevent this; the defensive guard catches drift.
- **Standalone override (`source_template_id: null`) plus active template same `(employee, date)`.** Both render. Standalone overrides are additive, not replacements.
- **Replacement override (`source_template_id: T1`) plus separate active template T2 for same `(employee, date)`.** T1's slot is suppressed; T2's slot still renders; the override appears alongside T2. (E.g., Maria's morning template overridden but her afternoon template stays.)
- **Replacement override whose parent template is later deleted.** The §2 migration sets `schedule_shift.source_template_id ON DELETE SET NULL`. The override survives as a standalone (`source_template_id` becomes null) and renders alongside any remaining templates for that day. Same semantics as if it were created standalone.

### 4.8 Tests

`lib/schedule/__tests__/resolver.test.ts` — fixture-driven, transactional Drizzle test DB:

- empty class / empty week → `[]`
- one template, no overrides → 5 weekday slots
- replacement override (`source_template_id = T1`) → T1's slot suppressed for that `(employee, date)`; override renders
- replacement override on `(Maria, D)` with `source_template_id = T1`, plus active T2 for Maria on D (different time slot) → T1 suppressed; T2 still renders; override renders alongside T2
- standalone override (`source_template_id = null`) plus active template same `(employee, date)` → both render
- replacement override whose parent template is deleted (FK sets `source_template_id` to NULL) → renders standalone alongside any remaining templates
- two employees same slot (rule b at read time) → both appear
- template `effective_from` mid-week → partial expansion
- template `effective_until` in prior week → not expanded
- `resolveTemplateWeek` ignores all overrides (replacement and standalone)
- sort order is deterministic across re-runs (snapshot test)

`lib/schedule/__tests__/resolver.dst.test.ts` — week containing Mar/Nov DST cutover renders correctly under ET wall-clock semantics.

---

## Section 5 — Shift mutations & conflict enforcement

### 5.1 Error envelope (`ActionError`)

Referenced from §1 and used by every Server Action.

```ts
// src/lib/actions/errors.ts
export type ActionError =
  | { code: 'unauthorized'; message: string }
  | { code: 'validation'; message: string; fieldErrors?: Record<string, string[]> }
  | { code: 'conflict'; message: string; conflicts: ConflictReason[] }
  | { code: 'not_found'; message: string }
  | { code: 'already_linked'; message: string }
  | { code: 'invite_pending'; message: string }
  | { code: 'class_missing'; message: string }
  | { code: 'internal'; message: string; details?: unknown };

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
```

Discriminated by `code`. Clients surface `message` and render conflict details from `conflicts`.

### 5.2 `detectShiftConflicts` — pure function

`src/lib/schedule/conflicts.ts`. No DB access; callers fetch context.

```ts
type ShiftLike    = { id: string; classId: string; employeeId: string; date: string;       startTime: string; endTime: string };
type TemplateLike = { id: string; classId: string; employeeId: string; dayOfWeek: number;  startTime: string; endTime: string;
                      effectiveFrom: string; effectiveUntil: string | null };

type ShiftCandidate    = { kind: 'shift';    classId: string; employeeId: string; date: string;       startTime: string; endTime: string };
type TemplateCandidate = { kind: 'template'; classId: string; employeeId: string; dayOfWeek: number; startTime: string; endTime: string;
                           effectiveFromISO: string };

type ConflictContext = {
  crossClassShifts:    ShiftLike[];      // for shift candidates: employee's shifts on `date` in other classes
  crossClassTemplates: TemplateLike[];   // for template candidates: employee's templates in other classes on same dayOfWeek
  sameClassTemplates:  TemplateLike[];   // for rules (c), (d): employee's templates in this class
  excludeShiftId?: string;
  excludeTemplateId?: string;
};

export type ConflictReason =
  | { rule: 'a'; otherClassId: string; otherId: string; otherWindow: { start: string; end: string } }
  | { rule: 'c'; otherTemplateId: string; otherWindow: { start: string; end: string } }
  | { rule: 'd'; otherId: string };

export function detectShiftConflicts(
  candidate: ShiftCandidate | TemplateCandidate,
  ctx: ConflictContext,
): ConflictReason[];
```

Rules:

- **(a) Cross-class overlap.**
  - *Shift candidate:* report any `crossClassShifts` row with overlapping time window on the candidate's `date`.
  - *Template candidate:* report any `crossClassTemplates` row with the same `dayOfWeek`, same `employeeId`, time-window overlap, AND `other.effectiveUntil IS NULL OR other.effectiveUntil >= candidate.effectiveFromISO`. Range-vs-open-ended-range overlap, not point-in-range — catches future-starting cross-class templates whose effective range hasn't begun yet but whose times overlap the candidate's open-ended future.
- **(b) Same class, same slot, two employees.** Allowed (lead + assistant). Not a conflict.
- **(c) Same employee, same class, overlapping templates with *different* times.**
  - *Shift candidate:* check `sameClassTemplates` where `employeeId` matches, `dayOfWeek` matches the candidate date's day-of-week, the template's effective range covers the candidate's date (`effective_from <= date AND (effective_until IS NULL OR effective_until >= date)`), times overlap, times differ.
  - *Template candidate:* check `sameClassTemplates` where `employeeId` matches, `dayOfWeek` matches, the range predicate from rule (a) holds (`other.effectiveUntil IS NULL OR other.effectiveUntil >= candidate.effectiveFromISO`), times overlap, times differ.
- **(d) Same employee, same class, *identical* times.** Same predicate as (c) but times equal → reported with `rule: 'd'`.
- **(e) Within-class, same employee, shift-vs-template overlap.** **Not enforced in v1.** The resolver renders both the override and the unrelated template; admins resolve visually.
  - *Worked example:* Maria has T1 = Mon 8–12 and T2 = Mon 1–5. Admin overrides T1 to 11–3 — the resolver suppresses T1 via `source_template_id`, but the override's 11–3 window overlaps T2's 1–5. Both render; the admin sees the overlap and resolves it (re-edit, delete one, etc.).

Overlap test: `aStart < bEnd && bStart < aEnd` (open intervals — 10–12 and 12–2 don't overlap).

**Predicate consistency.** The same effective-range predicate must be applied in the Server Action's fetch queries *and* (re-)checked inside `detectShiftConflicts`. The predicate can live in either layer — fetch-narrowing is preferred for performance, in-function re-check is preferred for defensive purity — but it must be consistent end-to-end. The tests in §5.7 assert this by exercising both layers via integration.

### 5.3 Week-mode actions

Location: `src/app/(admin)/admin/classes/[id]/actions.ts`. Every action: admin-only, Zod-validated input, single Drizzle transaction, audit row, `revalidatePath` on success.

**`createShiftAction({ classId, employeeId, date, startTime, endTime, sourceTemplateId? })`**

1. Auth + Zod parse. Inputs from `src/lib/schedule/schemas.ts` (sibling to `employees/schemas.ts`).
2. Verify `classId`, `employeeId`, `sourceTemplateId` (if present) exist.
3. Conflict fetch: shifts for `(employeeId, date)` across classes (rule a); active templates for `classId` covering `date` (rules c, d).
4. `detectShiftConflicts(candidate, ctx)`. Non-empty → `{ ok: false, error: { code: 'conflict', conflicts } }`.
5. Insert `schedule_shift`. `source_template_id` from input (null = standalone, set = replacement).
6. Audit: `action = 'shift.create'`. Revalidate.

**`updateShiftAction({ shiftId, startTime?, endTime?, employeeId? })`**

`classId` and `date` are immutable — to move a shift to a different date, delete + create. Keeps the action narrow and avoids re-checking rule (a) against an entirely different date.

1. Auth + Zod. Load row → `not_found` if missing.
2. Compute post-update candidate.
3. Conflict fetch with **post-update** fields:
   - rule (a) cross-class shifts fetched for the *post-update* `employeeId` on the unchanged `date`. Critical when the admin changes `employeeId` — the rule-a context must reflect the new employee's schedule, not the old one's. A naive "fetch by current row" would miss conflicts.
   - same-class templates fetched for the post-update `employeeId` on the date's `dayOfWeek`.
   - Pass `excludeShiftId: shiftId` to skip self-collision against the current row.
4. `detectShiftConflicts`. Conflict → return.
5. Update, audit (`shift.update`), revalidate.

**`deleteShiftAction({ shiftId })`**

Per spec decision #5: only operates on existing `schedule_shift` rows. UI gates the affordance — template-derived slots in week mode have no delete button. Single-week absences are Phase 3.

1. Auth + Zod. Load → `not_found` if missing.
2. Delete. Audit (`shift.delete`). Revalidate.

### 5.4 Template-mode actions

Same file. Direct CRUD on the recurring schedule.

**`createShiftTemplateAction({ classId, employeeId, dayOfWeek, startTime, endTime, effectiveFromISO? })`**

1. Auth + Zod (`dayOfWeek ∈ [0..4]`, times on 15-min granularity, `start < end`).
2. `effectiveFromISO` defaults to `weekStartOf(todayET())`.
3. Conflict fetch: active templates for `classId` matching the range predicate (rules c, d); employee's active templates in *other* classes on the same `dayOfWeek` matching the range predicate (rule a for templates).
4. `detectShiftConflicts(candidate, ctx)`. Conflict → return.
5. Insert with `effective_until = NULL`. Audit + revalidate.

Does not invoke the closure rule. Adding a slot to the existing active version isn't a new version — closure is only for save-as-template (§6).

**`updateShiftTemplateAction({ templateId, startTime?, endTime?, employeeId?, dayOfWeek? })`**

1. Auth + Zod. Load → `not_found`.
2. Conflict check with `excludeTemplateId`.
3. Update in place. Audit + revalidate.

In-place template edits propagate to all weeks, past and future, except where overrides exist. Past-week views without overrides will retroactively reflect new template times. Admins wanting a forward-only cutover use save-as-template (§6).

**`deleteShiftTemplateAction({ templateId })`**

1. Auth + Zod. Load → `not_found`.
2. Delete. Per §2's `ON DELETE SET NULL`, replacement overrides referencing this template become standalone.
3. Audit + revalidate.

### 5.5 Drag-to-move

UX-only wrapper. Client preserves duration, computes new `startTime`/`endTime`, calls `updateShiftAction` (week) or `updateShiftTemplateAction` (template) with the new times. Optimistic state while pending; on `conflict`, revert + surface reasons.

No new Server Action. No new validation path.

### 5.6 Closure-rule helper (forward-declared)

```ts
// src/lib/schedule/closure.ts
export async function applyClosureRule(
  tx: DrizzleTx,
  classId: string,
  newEffectiveFromISO: string,
): Promise<{ closedTemplateIds: string[] }>;
```

Sets `effective_until = newEffectiveFromISO - 1` on every `schedule_shift_template` for `classId` where `effective_until IS NULL AND effective_from < newEffectiveFromISO`. Returns closed ids for the audit row. **Called only from `saveAsTemplateAction` (§6).** Direct CRUD in §5.4 doesn't invoke it.

### 5.7 Tests

`lib/schedule/__tests__/conflicts.test.ts` — pure unit tests, fixture-driven:

- rule (a) shifts: cross-class overlap on same date → conflict
- rule (a) templates: cross-class overlap, same `dayOfWeek`, both with `effective_until = NULL` → conflict
- rule (a) templates: future-starting cross-class template (`other.effective_from > candidate.effective_from`) with overlapping times → conflict (range-vs-open-ended overlap)
- rule (a) templates: cross-class template whose `effective_until < candidate.effective_from` (closed in the past) → no conflict
- rule (a): adjacent times (10–12 / 12–2) → no conflict (open intervals)
- rule (b): same class, same slot, two employees → no conflict
- rule (c) shift candidate: existing same-class template covering the date, overlapping times, different → conflict
- rule (c) template candidate: existing same-class template, future-starting, overlapping times, different → conflict
- rule (d): identical times → `rule: 'd'`, not `rule: 'c'`
- rule (e) is *not* asserted as a conflict — instead, a fixture verifies the resolver renders both the override and the unrelated template (cross-reference to resolver tests in §4.8)
- self-exclusion: update to current values → no conflict

`(admin)/classes/[id]/__tests__/actions.test.ts` — integration tests, transactional rollback against dev Supabase:

- shift create: happy, rule-a conflict, rule-c conflict
- shift update: happy, self-exclusion works, conflict with foreign row
- shift delete: happy, `not_found`
- template create: happy, rule-c conflict, cross-class rule-a conflict including future-starting variant
- template update: happy, in-place propagation visible in resolver output for both past and future weeks (no-override case)
- template delete: succeeds with dependent overrides; their `source_template_id` becomes NULL
- drag-to-move: duration preserved, conflict path reverts cleanly

---

## Section 6 — Save-as-template, copy-week, enrollment forecast, print view

### 6.1 Save-as-template

UX (per spec decision #3): admin clicks "Save as template" from week view. `SaveAsTemplateDialog` opens, fed by `resolveWeek(classId, weekStartISO)`. Each shift gets a checkbox:

- `source: 'template'` rows → checked by default. Label: employee name + time window.
- `source: 'override'` rows → unchecked by default. Label: `override — <day>, <employee> <times>` (e.g., `override — Tue, Maria 11–3 (replaces 8–12)`).

Default semantics: "ratify the current recurring pattern as-is; opt in to bake any one-off coverage into it." Admin ticks/unticks, optionally edits `effectiveFromISO` (defaults to the displayed `weekStartISO`), confirms.

**Past-dated `effectiveFromISO` is blocked in v1.** Validation requires `effectiveFromISO >= weekStartOf(todayET())`. Past-dating would retroactively change historical week appearance (per §5.4's in-place-edit propagation note) — risky for admin trust and auditability without a strong product driver.

**`saveAsTemplateAction({ classId, sourceWeekStartISO, effectiveFromISO, selectedShifts })`**

```ts
type SelectedShift =
  | { source: 'template'; templateId: string }
  | { source: 'override'; shiftId: string };
```

Both week-start values are explicit inputs. `sourceWeekStartISO` is the week the admin reviewed in the dialog. `effectiveFromISO` is the new template version's start date — admin-editable, may equal `sourceWeekStartISO` or be later. Selection validation runs against the *source* week; new template rows use the *effective* date.

1. Auth + Zod. `effectiveFromISO >= weekStartOf(todayET())` → else `validation` error.
2. Re-call `resolveWeek(classId, sourceWeekStartISO)` server-side. Validate every `SelectedShift` id exists in that resolved set. Stale → `validation` error with the missing ids.
3. Project selected `ResolvedShift`s to candidate template rows: `{ employee_id, day_of_week (derived from date), start_time, end_time, effective_from: effectiveFromISO, effective_until: NULL }`.
4. Open transaction.
5. `applyClosureRule(tx, classId, effectiveFromISO)` (§5.6) — closes all currently-active same-class templates. Returns `closedTemplateIds`.
6. Conflict check on the candidate set against the post-closure DB state. For each candidate, call `detectShiftConflicts` with:
   - `sameClassTemplates` = the *other* candidates in the set (after closure, no prior same-class active templates remain).
   - `crossClassTemplates` = employee's active templates in other classes on the same `dayOfWeek`, range predicate from §5.2 rule (a) applied.
   - Aggregate `ConflictReason[]` across candidates. Non-empty → rollback, return `{ ok: false, error: { code: 'conflict', conflicts } }`.
7. Insert the candidate template rows.
8. Audit: `action = 'template.save'`, payload `{ classId, sourceWeekStartISO, effectiveFromISO, newTemplateIds, closedTemplateIds, sourceShiftIds }`.
9. Revalidate.

The conflict check runs *inside* the transaction, after closure, so it sees the state that would actually persist. Internal-set overlaps (admin selected two rows that would form same-employee/same-day/same-time templates) and cross-class rule (a) drift both surface here.

**Empty-selection guard.** Dialog confirms before submit: "This will leave no recurring schedule for this class. Continue?" Action accepts empty `selectedShifts`; closure still fires; class ends up with no active template version.

**Existing overrides survive.** The save writes templates and closes the prior version; it does not touch `schedule_shift` rows. After save, the displayed week should generally look the same — the new template version was built from the selected resolved rows, and any existing concrete overrides remain untouched. Future weeks resolve from the new template version. Admin can manually delete now-baked overrides as a follow-up if desired.

### 6.2 Copy-week

**Semantic: copy overrides only.** Copy-week duplicates the source week's *overrides* (replacement and standalone) into the target week. Template-derived rows from the source are **not** copied — those are produced by template expansion in both weeks already. Target renders as: target's current template base + the copied overrides.

**Why not full-snapshot.** A "snapshot all rendered rows into the target" rule would either:

- (a) tie copied template-derived rows to source template ids (`source_template_id = sourceTemplate.id`) — this suppresses the wrong template in the target if templates have changed, and breaks down if the source template was closed before the target week, or
- (b) insert all copied rows as standalone (`source_template_id = null`) — under §4's revised rules, standalone overrides suppress nothing, so target's current templates would expand alongside the copied rows, producing duplicates.

Neither preserves "what you saw in the source week" predictably once templates diverge between source and target. A clean snapshot would require a new week-level suppression concept (e.g., a `schedule_week_override_mode` table) — deferred. Override-only copy is the v1 trade-off: matching templates → identical result; diverged templates → target's templates plus source's deviations.

UX: "Copy week" button on the schedule grid. `CopyWeekDialog` shows source `weekStartISO` and a date picker for the target. Confirmation:

> `Copy N overrides from <source> to <target>? Existing concrete shifts in the target week will be deleted.`

`N` is the count of `source: 'override'` rows in the resolved source week — not all rendered rows.

**`copyWeekAction({ classId, sourceWeekStartISO, targetWeekStartISO })`**

1. Auth + Zod. `sourceWeekStartISO !== targetWeekStartISO` → `validation` error.
2. `resolveWeek(classId, sourceWeekStartISO)`. Filter to `source: 'override'` rows.
3. Open transaction.
4. Delete existing `schedule_shift` rows in the target week: `WHERE class_id = ? AND date >= targetWeekStartISO AND date <= targetWeekEndISO`.
5. For each source override, insert a `schedule_shift` in the target week:
   - `date` = source `date` + `(targetWeekStartISO - sourceWeekStartISO)` days.
   - `employee_id`, `start_time`, `end_time` copied verbatim.
   - `source_template_id` = source override's `source_template_id` (may be null, may be a still-existing template id). Persisting the same template reference preserves replacement semantics when that template still expands into the target week; if the template was closed or deleted, FK cleanup (`ON DELETE SET NULL`) or the resolver's standalone rendering handles the rest.
6. Audit: `action = 'week.copy'`, payload `{ classId, sourceWeekStartISO, targetWeekStartISO, copiedOverrideCount, deletedShiftIds }`.
7. Revalidate.

No conflict check on insert. Rule (a) was satisfied in the source week; rules (c)/(d) apply only to templates; the delete-target-first step prevents concrete-vs-concrete duplicates.

**Edge cases:**

- Target's template base has changed since source. Target renders new templates + copied overrides. A copied replacement override referencing a template that's been closed before the target week renders as standalone (no suppression, since the template doesn't expand there anyway).
- Source week has no overrides → `N = 0` shown in the dialog. If admin confirms anyway, target's concrete shifts are still deleted (a documented reset). Reasonable; dialog made it explicit.

### 6.3 Enrollment forecast

Two surfaces: per-cell inline edit on the schedule grid, and a per-class bulk spreadsheet upload.

**Per-cell edit.** Top row of `WeekGrid` is `EnrollmentRow` — five cells, one per weekday. Clicking turns the cell into an inline number input. Blur or Enter:

- Non-empty input ≥ 0 → `upsertEnrollmentForecastAction({ classId, date, expectedStudents })`.
- Empty input (admin cleared the cell) → `deleteEnrollmentForecastAction({ classId, date })`.

Two separate actions, not overloading upsert with `expectedStudents: number | null`. Matches the Zod schema's "value or no row" model and keeps audit log actions distinct.

**`upsertEnrollmentForecastAction`:**

1. Auth + Zod (`expectedStudents >= 0`, integer).
2. `INSERT INTO enrollment_forecast (class_id, date, expected_students) ... ON CONFLICT (class_id, date) DO UPDATE SET expected_students = EXCLUDED.expected_students, updated_at = now()`. Drizzle's `.onConflictDoUpdate()`.
3. Audit: `action = 'enrollment.upsert'`. Revalidate.

**`deleteEnrollmentForecastAction`:**

1. Auth + Zod.
2. `DELETE FROM enrollment_forecast WHERE class_id = ? AND date = ?`. No-op if absent.
3. Audit: `action = 'enrollment.delete'`. Revalidate.

**Bulk upload.** Route: `/admin/classes/[id]/enrollment/upload`. Same three-step UX as employee import: upload → preview → confirm.

`src/lib/sheets/enrollment-import.ts`:

- `enrollmentImportRowSchema` (Zod): `date` (`YYYY-MM-DD`), `expected_students` (int >= 0). No `class_name` column — route is per-class.
- `parseSheet(buffer, enrollmentImportRowSchema)` → `{ sessionId, rows }`. Same `RowError` shape.
- Cross-row check: no duplicate `date` within the sheet.

`commitEnrollmentImportAction({ classId, rows })`:

1. Auth + Zod (re-parse).
2. Transaction. Per row: `ON CONFLICT (class_id, date) DO UPDATE`.
3. Audit summary: `action = 'enrollment.import'`, `{ classId, count, sessionId }`.
4. Revalidate.

Cross-class bulk (one sheet, multiple classes) is deferred — v1 is per-class.

### 6.4 Print view

Route: `src/app/(admin)/admin/classes/[id]/schedule/print/page.tsx` — Server Component calling `resolveWeek(classId, weekStartISO)` and `db.query.enrollmentForecast.findMany()` for the same week.

**Layout (single page, letter landscape):**

```
+-----------------------------------------------------------+
| <class.name> — Week of <Monday, May 18, 2026>            |
+-----------------------------------------------------------+
| Expected students:  M:18   T:18   W:20   T:20   F:16     |
+----------+----------+----------+----------+----------+-----+
| Employee | Mon      | Tue      | Wed      | Thu      | Fri |
+----------+----------+----------+----------+----------+-----+
| Maria L. | 8:00–12  | 8:00–12  | 8:00–12  | 8:00–12  | …   |
| Jess T.  | 1:00–5   |          | 1:00–5   |          |     |
| …                                                          |
+-----------------------------------------------------------+
```

Rows = employees with at least one shift in the week, sorted by `last_name, first_name`. Empty cells render blank. Multi-shift cells stack vertically.

`@media print` CSS:

- Hide navigation, buttons, controls, all non-grid chrome.
- `@page { size: letter landscape; margin: 0.5in; }`.
- Page break after the table (one class per page if multi-class print is ever added — out of scope).
- Footer / URL bar suppressed by browser's default print options.

**Manual print trigger.** The route renders the layout with a single visible `Print` button at the top (hidden under `@media print`). Admin clicks it; `window.print()` fires. No auto-trigger on mount — admins can preview without surprise.

**Out of scope for v1:**

- Multi-week PDF export.
- Multi-class print (one PDF spanning all classes).
- Custom styling per class.

### 6.5 Tests

Integration tests (`(admin)/classes/[id]/__tests__/actions.test.ts`, transactional rollback):

- `saveAsTemplate`: happy path — closure closes prior templates, new rows have correct `effective_from`/`effective_until`.
- `saveAsTemplate`: validates selected ids against `sourceWeekStartISO`, not against `effectiveFromISO`. (Fixture: source is W1, effective is W2 — selection ids exist in W1's resolved set; accepted.)
- `saveAsTemplate`: rejects internally overlapping selected shifts for same `(employee, dayOfWeek)` overlapping times (rule c) and identical times (rule d).
- `saveAsTemplate`: rejects cross-class rule-a conflict using the open-ended range predicate.
- `saveAsTemplate`: stale selection (template id deleted between resolve and confirm) → `validation` error with missing ids.
- `saveAsTemplate`: empty selection — closure still fires, no new templates.
- `saveAsTemplate`: `effectiveFromISO < weekStartOf(todayET())` → `validation` error.
- `copyWeek`: happy path — target's concrete shifts equal source's overrides shifted by date delta; template-derived source rows are not duplicated as target shifts.
- `copyWeek`: target had existing shifts → deleted before insert.
- `copyWeek`: source = target → `validation` error.
- `copyWeek`: target's templates differ from source's templates — copied overrides render alongside target's templates without duplicating template-derived rows.
- `copyWeek`: source override referenced a now-closed template — copied row's `source_template_id` is preserved but renders standalone in the target (closed template doesn't expand).
- `upsertEnrollmentForecast`: insert; update via conflict.
- `deleteEnrollmentForecast`: deletes existing; no-op on absent.
- `commitEnrollmentImport`: happy path; duplicate-date row error.

Print view: smoke test only — render the route, assert markup contains resolved shifts plus a visible `Print` button. Asserts `window.print` is *not* called on mount (no auto-trigger).

---

## Section 7 — Errors, validation, audit, testing

### 7.1 Error handling

The `ActionError` type from §5.1 is the universal error contract for Server Actions. Every action returns `ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError }`. No thrown exceptions cross the action boundary — unexpected exceptions are caught and mapped to `code: 'internal'`.

**`runActionTx` — shared transaction wrapper.**

Every mutating Server Action runs through `runActionTx` from `src/lib/actions/transactions.ts`. The wrapper enforces three invariants — actions do not hand-roll try/catch/rollback logic, which prevents the bug class where a handler returns `{ ok: false }` after a partial write but the transaction commits because no rollback sentinel was thrown.

```ts
// src/lib/actions/transactions.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from '@/db';
import type { DrizzleTx } from '@/db/types';

export const txStorage = new AsyncLocalStorage<DrizzleTx>();
export class IntentionalRollback<T> extends Error { constructor(public value: T) { super('rollback'); } }

export async function runActionTx<T>(
  actionName: string,
  input: unknown,
  handler: (tx: DrizzleTx) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const outerTx = txStorage.getStore();
  const runIn = outerTx ? outerTx.transaction.bind(outerTx) : db.transaction.bind(db);
  try {
    return await runIn(async (tx) =>
      txStorage.run(tx, async () => {
        const result = await handler(tx);
        if (!result.ok) throw new IntentionalRollback(result);
        return result;
      })
    );
  } catch (e) {
    if (e instanceof IntentionalRollback) return e.value as ActionResult<T>;
    await logInternalError(e, sanitizeContext(actionName, input));
    return { ok: false, error: { code: 'internal', message: 'Unexpected error' } };
  }
}
```

Invariants:

- handler returns `ok: true` → commit.
- handler returns `ok: false` → roll back, return the `ActionError` envelope.
- handler throws unexpectedly → roll back, log sanitized context, return `{ code: 'internal' }`.

**ALS savepoint joining for tests.** When `runActionTx` is invoked inside `withTx` (§7.4), the ALS lookup finds the outer test transaction and uses `outerTx.transaction(...)` — a SAVEPOINT — instead of opening a fresh top-level transaction. Without this, integration tests would see the Server Action's writes commit independently and pollute the dev DB; only the test's own direct writes via `tx` would roll back.

**Server Action template:**

```ts
export async function someAction(input: unknown): Promise<ActionResult<T>> {
  const admin = await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation', message: 'Invalid input',
                                 fieldErrors: parsed.error.flatten().fieldErrors } };
  }
  return runActionTx('someAction', parsed.data, async (tx) => {
    // business logic; return { ok: true, data } or { ok: false, error: { code, ... } }
  });
}
```

Auth + parse happen outside `runActionTx` so unauthorized / validation failures don't open a transaction. Business writes — including the audit log row — happen inside.

**Sanitized internal-error logging.** `logInternalError(e, ctx)` writes to the **application logger**, not the audit log. Audit log is for business events only.

```ts
function sanitizeContext(actionName: string, input: unknown): Record<string, unknown> {
  const safe: Record<string, unknown> = { action: actionName };
  if (input && typeof input === 'object') {
    const allowed = ['classId', 'employeeId', 'shiftId', 'templateId', 'sessionId',
                     'mode', 'weekStartISO', 'sourceWeekStartISO', 'effectiveFromISO',
                     'targetWeekStartISO', 'date'];
    for (const key of allowed) {
      if (key in (input as object)) safe[key] = (input as Record<string, unknown>)[key];
    }
  }
  return safe;
}
```

Allowlist approach — only stable identifiers are logged. **Never logged:** raw `input`, emails, names, full row payloads, import rows, invite metadata, form bodies. New actions add identifiers to the allowlist explicitly when needed.

**Client surfacing:**

| Error `code` | UI treatment |
|---|---|
| `unauthorized` | Redirect to `/sign-in` (usually `requireAdmin` already redirected). |
| `validation` | Field-level errors via React Hook Form `setError`; non-field messages in a form-top error block. |
| `conflict` | Modal listing each `ConflictReason` with opposing entity names + time windows. Revise / Cancel affordances. |
| `not_found`, `class_missing`, `already_linked`, `invite_pending` | Toast with human message + a flow-specific action affordance. |
| `internal` | Toast: "Something went wrong — please retry. If this persists, contact an admin." No internal details to the user. |

### 7.2 Validation

**Five layers.** Each layer assumes upstream layers may be bypassed.

| Layer | Where | Responsibility |
|---|---|---|
| L1 | URL/searchParams parser | `weekStartISO`, `mode`, etc. Invalid `weekStartISO` (not ISO, not Monday) → **redirect to canonical URL for the current week**, never silently render a different week. `mode` defaults to `'week'` on bad input. |
| L2 | Client form (RHF + zodResolver) | UX. Inline errors as the user types. Never authoritative. |
| L3 | Server Action `safeParse` | Authoritative input shape check. First thing every action does after auth. |
| L4 | Business rules | Existence checks, conflict detection, closure preconditions. Returns `ActionError` shapes. |
| L5 | DB constraints | Should never trigger if L3/L4 pass. If it does, mapped to `code: 'internal'`. |

**Shared validators — `src/lib/dates.ts` additions:**

```ts
export function isISODateString(value: string): boolean;        // 'YYYY-MM-DD' that parses to a real date
export function isMondayISODate(value: string): boolean;        // additionally: weekday is Monday in ET
export function timeToMinutes(value: string): number;           // 'HH:MM' → 0..1439; validates 15-min granularity
export function assertTimeRange(start: string, end: string): void; // throws if end <= start (open intervals)
```

Used inside Zod `.refine()` / `.superRefine()` calls **and** directly in the resolver and conflict utilities. Single source of truth — regex-only validation in earlier sections is upgraded to real-date / real-time checks via these helpers.

**Schedule-domain validation rules:**

- `weekStartISO` must be a real `YYYY-MM-DD` date **and** a Monday in ET. URL parser canonicalizes on bad input; Server Action `safeParse` rejects.
- Schedule dates (`date` on shifts; `effective_from`/`effective_until` on templates) must be real calendar dates, not just regex-shaped strings.
- Time strings must match `HH:MM` and be 15-minute granular (`mm ∈ {00, 15, 30, 45}`). Enforced via `timeToMinutes` returning `NaN` on bad granularity, with the schema rejecting `NaN`.
- `endTime > startTime` strictly. Enforced by `assertTimeRange` inside a Zod `.superRefine()`.
- Schedule dates remain plain `'YYYY-MM-DD'` strings end-to-end (URL → resolver → client props). Never `Date.toISOString()` — UTC conversion shifts the intended ET date.

**Schema locations:**

- `src/lib/employees/schemas.ts` — `employeeInputSchema`, `employeeImportRowSchema`.
- `src/lib/schedule/schemas.ts` — every shift/template Server Action's input schema.
- `src/lib/sheets/employee-import.ts`, `src/lib/sheets/enrollment-import.ts` — sheet-row schemas.

**Email normalization.** A single helper, called from inside the Zod transform:

```ts
// src/lib/employees/normalize.ts
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

Action bodies never re-normalize. The Zod-parsed value is authoritative end-to-end. New code that touches `email` before parsing must call `normalizeEmail` explicitly or pass through the schema.

### 7.3 Audit log conventions

`audit_log` is for **business events only**. Internal exceptions go to the application logger, never to `audit_log`.

Standardized envelope:

```ts
type AuditLogRow = {
  actor_id: string;        // admin id from auth
  action: string;          // dot-namespaced
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: timestamptz;
};
```

**Action namespace inventory** (Phase 2):

`employee.create`, `employee.import`, `employee.invite_sent`, `employee.invite_resent`, `employee.historical_usage_recorded`, `shift.create`, `shift.update`, `shift.delete`, `template.create`, `template.update`, `template.delete`, `template.save`, `week.copy`, `enrollment.upsert`, `enrollment.delete`, `enrollment.import`.

**Payload rules:**

- **Mutations: changed-fields-only before/after snapshots.** Don't dump the whole row.

  ```ts
  payload: {
    classId, shiftId,
    before: { startTime: '08:00', endTime: '12:00' },
    after:  { startTime: '08:15', endTime: '12:15' }
  }
  ```

- **Deletes: enough of the deleted row to reconstruct the business action.** FK ids + primary identifying fields. No more.

  ```ts
  payload: {
    deleted: { shiftId, classId, employeeId, date, startTime, endTime, sourceTemplateId }
  }
  ```

- **Imports: one summary row, not per-source-row.** `payload: { count, sessionId }`. The created `employee` / `enrollment_forecast` rows are the per-record history (their `created_at` + the `sessionId` tie them back).
- **Minimal PII.** Identifiers over free-text content. If a `note` field is part of the business action (`historical_usage.note`), include it; otherwise skip.
- **Audit writes happen inside `runActionTx`'s transaction.** Roll back together — no orphaned "action happened" entries if the business write fails.

### 7.4 Testing strategy

Strategy: **transactional rollback against the dev Supabase project.** No mocks, no separate test DB, no test data pollution.

**`withTx` harness — `src/test/with-tx.ts`:**

```ts
import { db } from '@/db';
import { txStorage, IntentionalRollback } from '@/lib/actions/transactions';

export async function withTx<T>(test: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) =>
    txStorage.run(tx, async () => {
      const value = await test(tx);
      throw new IntentionalRollback(value);
    })
  ).catch((e) => {
    if (e instanceof IntentionalRollback) return e.value as T;
    throw e;
  });
}
```

ALS context is bound before the test body runs so any Server Action invoked through `runActionTx` joins this transaction as a savepoint. The outer rollback covers both the test's direct writes and the action's writes — no dev-DB pollution from action-triggered top-level transactions.

**Read-path ALS awareness.** The resolver and other read helpers access the DB via a small `dbOrTx()` helper that returns `txStorage.getStore() ?? db`. This lets a test's writes (via `tx` or via a Server Action's savepoint) be visible to a subsequent `resolveWeek` call inside the same `withTx`. In production (no ALS context), `dbOrTx()` returns the global `db` — no behavior change.

**Fixture builders — `src/test/fixtures.ts`.** Every builder generates globally unique defaults so parallel tests don't collide on unique constraints (e.g., `LOWER(email)`):

```ts
export async function makeEmployee(tx: DrizzleTx, overrides?: Partial<NewEmployee>): Promise<Employee> {
  const defaults = {
    firstName: 'Test',
    lastName: 'User',
    email: `test-${crypto.randomUUID()}@example.com`,
    /* ...other required fields with safe defaults */
  };
  return tx.insert(employees).values({ ...defaults, ...overrides }).returning().then(r => r[0]);
}

export async function makeClass(tx: DrizzleTx, overrides?: Partial<NewClass>): Promise<Class> {
  const defaults = { name: `Test Class ${crypto.randomUUID().slice(0, 8)}` /* ... */ };
  return tx.insert(classes).values({ ...defaults, ...overrides }).returning().then(r => r[0]);
}
```

Same pattern for `makeTemplate`, `makeShift`. Composable. Every builder takes the `tx`, never the global `db`.

**Direct-`db` guard.** ESLint `no-restricted-imports` rule for files under `src/**/__tests__/**` and `src/test/**` *except* `src/test/with-tx.ts`: importing `db` from `@/db` is disallowed. All other test code must take `tx` as a parameter. Catches accidental "I'll just do this one thing without `withTx`" pollution at lint time.

**Test organization:**

- `src/lib/**/__tests__/*.test.ts` — pure unit tests (no DB) and resolver-style tests (DB via `withTx`).
- `src/app/(admin)/**/__tests__/*.test.ts` — Server Action integration tests via `withTx` + savepoint join through `runActionTx`.
- `src/app/**/page.test.tsx` — page-render smoke tests.
- `src/app/**/_components/*.test.tsx` — component tests for critical UI surfaces.

**Coverage targets:**

| Layer | Approach | Coverage |
|---|---|---|
| Pure functions (conflicts, entitlements, dates, time helpers) | Unit tests | 100% branch |
| Resolver | Integration via `withTx` | All scenarios in §4.8 |
| Server Actions | Integration via `withTx` + savepoint | Happy path + every documented `ActionError` |
| Pages | Smoke render | No crash |
| Critical UI components | Targeted component tests (see below) | Specified behaviors |

**Critical UI component tests:**

- `ConflictModal` renders each `ConflictReason` variant with opposing entity names.
- `EmployeeFormErrors` (and analogous form-error components) map `ActionError.fieldErrors` to RHF errors.
- Print page does *not* call `window.print()` on mount; the `Print` button is visible and triggers `window.print()` on click.

**One thin happy-path E2E** (`tests/e2e/admin-onboard-and-schedule.spec.ts`, Playwright):

1. Admin signs in (Clerk test mode).
2. Manually adds an employee.
3. Opens the class schedule page.
4. Adds a template shift via template mode.
5. Switches to week mode, adds a standalone override.
6. Navigates to print view; confirms the shift renders.

Catches route/Server-Action/client-wiring bugs that per-action integration tests miss (revalidatePath flow, search-params handling, mode toggle URL navigation). One test only; keeps Playwright surface minimal in v1.

**Tests added specifically for §7:**

1. Server Action returning `{ ok: false }` inside `runActionTx` rolls back partial writes.
2. Unexpected thrown error inside `runActionTx` rolls back and returns `{ code: 'internal' }`.
3. Internal-error logger does not include raw `input` — only the allowlisted ID context.
4. Audit row rolls back when the business write rolls back (atomic together).
5. Fixture builders generate unique emails and class names by default.
6. URL parser rejects/canonicalizes a `weekStartISO` that is not a Monday (e.g., Wednesday input → redirect to that week's Monday).
7. Delete audit payload includes the fields needed to reconstruct the deleted entity.
8. Integration test calling a Server Action via `withTx` sees the action's writes inside the test transaction (proves savepoint join), and those writes roll back when the test transaction does.

### 7.5 CI gates

Phase 1 already wires `pnpm test`, `pnpm typecheck`, `pnpm lint`. Phase 2 adds:

- ESLint `no-restricted-imports` rule for the test-file direct-`db` guard.
- A pre-test **schema/version check** — `src/test/check-schema.ts` runs as a Vitest `globalSetup` step, queries `__drizzle_migrations`, and confirms the highest applied migration matches the highest file in `drizzle/`. Mismatch → fail fast with: `"DB is stale: run pnpm db:migrate"`. Prevents the entire test job from running against an out-of-date schema.

Migrations are applied outside CI (against dev/staging DBs by the deployer). The CI test job assumes the DB is current; the schema check enforces it.

**Migration workflow:**

- `pnpm db:generate` produces `drizzle/0001_<slug>.sql` from schema diffs.
- Human review of the SQL per §2's "Migration review" checklist.
- `pnpm db:migrate` applies it.
- Migration committed alongside the schema changes.

### 7.6 Out of scope for Phase 2 testing

- Visual regression / pixel-diff for print.
- Load / performance benchmarks (resolver at ~35 rows isn't a concern).
- Cross-browser print compatibility (Chrome/Edge/Safari assumed reasonable).
- Migration rollback tests — forward-only, restore-from-snapshot.
- Full-suite E2E — only the one happy-path smoke test described in §7.4.
