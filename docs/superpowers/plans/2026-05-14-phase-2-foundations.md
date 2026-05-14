# Phase 2 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Phase 2's schema migration (#2) and the cross-cutting runtime + test infrastructure (validators, `runActionTx` with ALS savepoint joining, `withTx` harness, fixtures, schema-version check) that every subsequent Phase 2 plan depends on. No user-facing feature ships from this plan; it's the foundation.

**Architecture:** Schema additions are a single Drizzle migration (`#2`) covering 3 new tables, 3 new enums, one column tightening, one FK behavior change, one case-insensitive unique index, and 3 new indexes. Runtime helpers go under `src/lib/` (`dates.ts`, `actions/`, `employees/normalize.ts`). Test infrastructure goes under `src/test/` and is keyed on `AsyncLocalStorage` so Server Action transactions called from tests join the test's transaction as savepoints rather than committing top-level.

**Tech Stack:** Drizzle ORM + drizzle-kit; Postgres (Supabase); Vitest; Zod (used by later plans, schemas land here); Node's built-in `node:async_hooks` AsyncLocalStorage.

**Spec reference:** `docs/superpowers/specs/phase-2-design.md` — primarily §2 (schema), §7.1–7.5 (runtime + test infra), plus §1's file inventory.

---

## File Structure

This plan touches or creates the following files:

**Schema (modify):**
- `src/db/schema/enums.ts` — add 3 enums, add 1 enum value
- `src/db/schema/employee.ts` — drop plain `unique()` on email
- `src/db/schema/schedule-shift.ts` — add `onDelete: "set null"` to `sourceTemplateId`
- `src/db/schema/schedule-shift-template.ts` — tighten `effective_from` to NOT NULL
- `src/db/schema/index.ts` — re-export new modules

**Schema (create):**
- `src/db/schema/enrollment-forecast.ts`
- `src/db/schema/time-off-request.ts`
- `src/db/schema/time-off-request-day.ts`

**Migration (generate + hand-edit):**
- `src/db/migrations/0001_<slug>.sql`

**Runtime helpers (create):**
- `src/lib/dates.ts` — date/time utilities including validators
- `src/lib/employees/normalize.ts` — `normalizeEmail`
- `src/lib/actions/errors.ts` — `ActionError`, `ActionResult` types
- `src/lib/actions/transactions.ts` — `txStorage`, `IntentionalRollback`, `runActionTx`, `dbOrTx`, `sanitizeContext`, `logInternalError`

**Test infrastructure (create):**
- `src/test/with-tx.ts`
- `src/test/fixtures.ts`
- `src/test/check-schema.ts`

**Config (modify):**
- `vitest.config.ts` — wire `globalSetup`
- ESLint config — Phase 1 has no `eslint.config*` file (relies on `next lint` defaults); Task 21 creates `eslint.config.mjs` to add a `no-restricted-imports` rule for direct `db` in tests.

**Tests (create):**
- `src/lib/__tests__/dates.test.ts`
- `src/lib/employees/__tests__/normalize.test.ts`
- `src/lib/actions/__tests__/transactions.test.ts`
- `src/test/__tests__/with-tx.test.ts`
- `src/test/__tests__/fixtures.test.ts`
- `src/test/__tests__/check-schema.test.ts`

---

## Task 1: Verify Phase 1 baseline before changes

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean working tree**

Run: `git status`
Expected: only `src/db/seed.ts` modified (user's unrelated change); no other dirty files in `src/` or `docs/`.

- [ ] **Step 2: Confirm Phase 1 typecheck + tests pass**

Run: `pnpm typecheck && pnpm test:run`
Expected: both exit 0. If anything fails, halt and report — Plan 1 assumes a green baseline.

- [ ] **Step 3: Confirm dev DB is reachable and at migration #0**

Run: `pnpm db:studio` to verify env / connection (visually), or:
Run: `psql $DATABASE_URL -c "SELECT id FROM __drizzle_migrations__ ORDER BY created_at;"` (table name may be `__drizzle_migrations`; verify either way)
Expected: one migration row corresponding to `0000_secret_white_tiger.sql`.

If `__drizzle_migrations__` doesn't exist or has a different shape, note the actual name — Task 23's `check-schema.ts` needs to query the right table.

---

## Task 2: Add 3 new enums to `enums.ts`

**Files:**
- Modify: `src/db/schema/enums.ts` — append at end of file
- Modify: `src/db/schema/enums.ts` — extend `balanceSourceEnum`

- [ ] **Step 1: Append the three new pgEnum exports**

In `src/db/schema/enums.ts`, append after the existing exports:

```ts
export const timeOffTypeEnum = pgEnum("time_off_type", [
  "vacation",
  "sick",
  "bereavement",
  "unpaid",
  "unallocated",
]);

export const timeOffStatusEnum = pgEnum("time_off_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const bereavementRelationEnum = pgEnum("bereavement_relation", [
  "parent",
  "sibling",
  "spouse",
  "child",
  "grandparent",
]);
```

- [ ] **Step 2: Extend `balanceSourceEnum` with `'historical_usage'`**

Find the existing `balanceSourceEnum` (line ~41) and add `"historical_usage"` to the array. The full list becomes:

```ts
export const balanceSourceEnum = pgEnum("balance_source", [
  "initial_import",
  "anniversary_reset",
  "tenure_tier_bump",
  "vacation_approval",
  "vacation_withdrawal",
  "sick_log",
  "bereavement_log",
  "admin_adjustment",
  "historical_usage",
]);
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

No commit yet — combined with subsequent schema changes in Task 10.

---

## Task 3: Create `enrollment_forecast` schema module

**Files:**
- Create: `src/db/schema/enrollment-forecast.ts`

- [ ] **Step 1: Write the schema module**

Create `src/db/schema/enrollment-forecast.ts`:

```ts
import {
  check,
  date,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classes } from "./class";

export const enrollmentForecasts = pgTable(
  "enrollment_forecast",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id),
    date: date("date", { mode: "string" }).notNull(),
    expectedStudents: integer("expected_students").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    classDateUnique: unique("enrollment_forecast_class_date_unique").on(
      table.classId,
      table.date,
    ),
    expectedStudentsCheck: check(
      "enrollment_forecast_expected_students_check",
      sql`${table.expectedStudents} >= 0`,
    ),
  }),
);

export type EnrollmentForecast = typeof enrollmentForecasts.$inferSelect;
export type NewEnrollmentForecast = typeof enrollmentForecasts.$inferInsert;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 4: Create `time_off_request` schema module

**Files:**
- Create: `src/db/schema/time-off-request.ts`

- [ ] **Step 1: Write the schema module**

Create `src/db/schema/time-off-request.ts`:

```ts
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bereavementRelationEnum,
  timeOffStatusEnum,
  timeOffTypeEnum,
} from "./enums";
import { employees } from "./employee";
import { admins } from "./admin";

export const timeOffRequests = pgTable(
  "time_off_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    type: timeOffTypeEnum("type").notNull(),
    status: timeOffStatusEnum("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
    bereavementRelation: bereavementRelationEnum("bereavement_relation"),
    totalHours: numeric("total_hours", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    decisionBy: uuid("decision_by").references(() => admins.id),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    advanceNoticeOverridden: boolean("advance_notice_overridden")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    bereavementRelationIff: check(
      "time_off_request_bereavement_relation_iff",
      sql`(${table.type} = 'bereavement') = (${table.bereavementRelation} IS NOT NULL)`,
    ),
    decisionAtIff: check(
      "time_off_request_decision_at_iff",
      sql`(${table.status} IN ('approved', 'rejected')) = (${table.decisionAt} IS NOT NULL)`,
    ),
    decisionByRequiresAt: check(
      "time_off_request_decision_by_requires_at",
      sql`${table.decisionBy} IS NULL OR ${table.decisionAt} IS NOT NULL`,
    ),
    employeeStatusIdx: index("time_off_request_employee_status_idx").on(
      table.employeeId,
      table.status,
    ),
    statusSubmittedIdx: index("time_off_request_status_submitted_idx").on(
      table.status,
      table.submittedAt.desc(),
    ),
  }),
);

export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type NewTimeOffRequest = typeof timeOffRequests.$inferInsert;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 5: Create `time_off_request_day` schema module

**Files:**
- Create: `src/db/schema/time-off-request-day.ts`

- [ ] **Step 1: Write the schema module**

Create `src/db/schema/time-off-request-day.ts`:

```ts
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  time,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { timeOffRequests } from "./time-off-request";

export const timeOffRequestDays = pgTable(
  "time_off_request_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => timeOffRequests.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    isFullDay: boolean("is_full_day").notNull(),
    isHoliday: boolean("is_holiday").notNull().default(false),
    startTime: time("start_time"),
    endTime: time("end_time"),
  },
  (table) => ({
    hoursCheck: check(
      "time_off_request_day_hours_check",
      sql`${table.hours} >= 0`,
    ),
    partialDayNeedsRange: check(
      "time_off_request_day_partial_day_range",
      sql`${table.isFullDay} OR (${table.startTime} IS NOT NULL AND ${table.endTime} IS NOT NULL)`,
    ),
    requestDateUnique: unique("time_off_request_day_request_date_unique").on(
      table.requestId,
      table.date,
    ),
    dateIdx: index("time_off_request_day_date_idx").on(table.date),
  }),
);

export type TimeOffRequestDay = typeof timeOffRequestDays.$inferSelect;
export type NewTimeOffRequestDay = typeof timeOffRequestDays.$inferInsert;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 6: Tighten `schedule_shift_template.effective_from` to NOT NULL

**Files:**
- Modify: `src/db/schema/schedule-shift-template.ts`

- [ ] **Step 1: Add `.notNull()` to `effectiveFrom`**

In `src/db/schema/schedule-shift-template.ts`, change line 26 from:

```ts
effectiveFrom: date("effective_from", { mode: "string" }),
```

to:

```ts
effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
```

`effectiveUntil` (line 27) stays nullable — it's NULL for the currently-active version.

- [ ] **Step 2: Add the (class_id, effective_from) index**

Extend the table definition with an index (this column was `unindexed` in Phase 1; resolver needs it). Change the pgTable call to include a second argument:

```ts
export const scheduleShiftTemplates = pgTable("schedule_shift_template", {
  // ... existing columns ...
}, (table) => ({
  classEffectiveFromIdx: index("schedule_shift_template_class_effective_from_idx")
    .on(table.classId, table.effectiveFrom),
}));
```

Add `index` to the import list at the top: `import { date, index, integer, pgTable, time, timestamp, uuid } from "drizzle-orm/pg-core";`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 7: Add `ON DELETE SET NULL` to `schedule_shift.source_template_id` + add indexes

**Files:**
- Modify: `src/db/schema/schedule-shift.ts`

- [ ] **Step 1: Add `onDelete: "set null"` to the FK**

In `src/db/schema/schedule-shift.ts`, change the `sourceTemplateId` definition (line 20) from:

```ts
sourceTemplateId: uuid("source_template_id").references(
  () => scheduleShiftTemplates.id,
),
```

to:

```ts
sourceTemplateId: uuid("source_template_id").references(
  () => scheduleShiftTemplates.id,
  { onDelete: "set null" },
),
```

- [ ] **Step 2: Add the two new indexes**

Extend `pgTable` with the second-arg builder:

```ts
export const scheduleShifts = pgTable("schedule_shift", {
  // ... existing columns ...
}, (table) => ({
  classDateIdx: index("schedule_shift_class_date_idx").on(table.classId, table.date),
  employeeDateIdx: index("schedule_shift_employee_date_idx").on(table.employeeId, table.date),
}));
```

Add `index` to the imports.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 8: Drop plain `unique()` on `employee.email`

**Files:**
- Modify: `src/db/schema/employee.ts`

The plain `unique()` is replaced by a `LOWER(email)` unique index added manually in the generated migration (Task 11). Drizzle's diff will generate the DROP CONSTRAINT for the existing unique; we'll add the new index inline.

- [ ] **Step 1: Remove `.unique()` from the email column**

In `src/db/schema/employee.ts`, change line 17 from:

```ts
email: text("email").notNull().unique(),
```

to:

```ts
email: text("email").notNull(),
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

(Removing this constraint at the type level is safe — Drizzle's inferred types don't carry uniqueness.)

---

## Task 9: Re-export new schema modules from `index.ts`

**Files:**
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1: Append the three new exports**

In `src/db/schema/index.ts`, append after the existing exports:

```ts
export * from "./enrollment-forecast";
export * from "./time-off-request";
export * from "./time-off-request-day";
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

---

## Task 10: Generate the migration

**Files:**
- Create: `src/db/migrations/0001_<auto-slug>.sql`
- Create: `src/db/migrations/meta/0001_snapshot.json` (auto)

- [ ] **Step 1: Generate**

Run: `pnpm db:generate`
Expected: a new `src/db/migrations/0001_<slug>.sql` file appears; meta snapshot updated.

- [ ] **Step 2: Read the generated SQL**

Open `src/db/migrations/0001_<slug>.sql` and confirm it contains, in approximately this order:

- `CREATE TYPE time_off_type AS ENUM (...);`
- `CREATE TYPE time_off_status AS ENUM (...);`
- `CREATE TYPE bereavement_relation AS ENUM (...);`
- `ALTER TYPE balance_source ADD VALUE 'historical_usage';`
- `CREATE TABLE enrollment_forecast (...);`
- `CREATE TABLE time_off_request (...);`
- `CREATE TABLE time_off_request_day (...);`
- `ALTER TABLE schedule_shift_template ALTER COLUMN effective_from SET NOT NULL;`
- `ALTER TABLE schedule_shift DROP CONSTRAINT schedule_shift_source_template_id_schedule_shift_template_id_fk;`
- `ALTER TABLE schedule_shift ADD CONSTRAINT ... FOREIGN KEY (source_template_id) REFERENCES schedule_shift_template(id) ON DELETE SET NULL;`
- `ALTER TABLE employee DROP CONSTRAINT employee_email_unique;` (or similar)
- New indexes: `CREATE INDEX schedule_shift_template_class_effective_from_idx ...`, `CREATE INDEX schedule_shift_class_date_idx ...`, `CREATE INDEX schedule_shift_employee_date_idx ...`, etc.
- New table indexes for `time_off_request` and `time_off_request_day`.
- CHECK constraints for `enrollment_forecast`, `time_off_request`, `time_off_request_day`.

If anything is missing, fix the schema modules and re-generate (delete the just-generated `0001_*.sql` first to avoid stacking files).

- [ ] **Step 3: Verify the file count**

Run: `ls src/db/migrations/*.sql | wc -l`
Expected: `2` (the existing `0000_*` plus the new `0001_*`).

---

## Task 11: Append the case-insensitive email unique index to the migration

**Files:**
- Modify: `src/db/migrations/0001_<slug>.sql`

Drizzle doesn't generate expression-based indexes from schema changes; we add it manually.

- [ ] **Step 1: Append the CREATE UNIQUE INDEX statement**

At the **end** of `src/db/migrations/0001_<slug>.sql`, append:

```sql
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_email_lower_unique" ON "employee" (LOWER("email"));
```

The `--> statement-breakpoint` marker matches Drizzle's migration-statement separator.

- [ ] **Step 2: Sanity check**

Open the file again and confirm the new statement is the last one. The DROP CONSTRAINT for the old `employee_email_unique` should appear earlier in the same file (from Task 10's diff).

---

## Task 12: Apply the migration to the dev DB

**Files:** none (DB state)

- [ ] **Step 1: Apply**

Run: `pnpm db:migrate`
Expected: output indicating `0001_*.sql` was applied; no errors.

If the migration fails (e.g., `ADD VALUE` and `CREATE TABLE` in the same transaction — Postgres restricts `ALTER TYPE ... ADD VALUE` from being followed by usage of that enum in the same transaction), split the migration: move the `ALTER TYPE balance_source ADD VALUE 'historical_usage';` into its own statement and verify Drizzle's `--> statement-breakpoint` separates it from the table creates. If still failing, run that statement manually first:

```bash
psql "$DATABASE_URL" -c "ALTER TYPE balance_source ADD VALUE 'historical_usage';"
```

Then re-run `pnpm db:migrate`.

- [ ] **Step 2: Verify migration was recorded**

Run: `psql "$DATABASE_URL" -c "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"` (adjust schema/table name if Phase 1 uses a different one — `__drizzle_migrations__` or `public.__drizzle_migrations`).
Expected: two rows, the second being the new migration.

- [ ] **Step 3: Spot-check new tables exist**

Run: `psql "$DATABASE_URL" -c "\dt enrollment_forecast time_off_request time_off_request_day"`
Expected: three rows listed.

- [ ] **Step 4: Spot-check the LOWER(email) index**

Run: `psql "$DATABASE_URL" -c "\d employee" | grep -i email`
Expected: a row showing `employee_email_lower_unique` btree unique on `lower(email)`.

---

## Task 13: Commit schema work

- [ ] **Step 1: Stage and commit**

```bash
git add src/db/schema/enums.ts \
        src/db/schema/employee.ts \
        src/db/schema/schedule-shift.ts \
        src/db/schema/schedule-shift-template.ts \
        src/db/schema/enrollment-forecast.ts \
        src/db/schema/time-off-request.ts \
        src/db/schema/time-off-request-day.ts \
        src/db/schema/index.ts \
        src/db/migrations/0001_*.sql \
        src/db/migrations/meta/0001_snapshot.json \
        src/db/migrations/meta/_journal.json
git commit -m "feat(schema): Phase 2 migration #2 — new tables, enums, indexes, FK behavior"
```

- [ ] **Step 2: Verify**

Run: `git status`
Expected: clean (apart from any pre-existing `src/db/seed.ts` changes).

---

## Task 14: Build `src/lib/dates.ts` — date and time helpers (TDD)

**Files:**
- Create: `src/lib/__tests__/dates.test.ts`
- Create: `src/lib/dates.ts`

Includes both schedule-domain helpers (`weekStart`, `weekEnd`, etc.) and validation helpers (`isISODateString`, `isMondayISODate`, `timeToMinutes`, `assertTimeRange`).

- [ ] **Step 1: Write the failing test file**

Create `src/lib/__tests__/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  assertTimeRange,
  isISODateString,
  isMondayISODate,
  timeToMinutes,
  todayET,
  weekEnd,
  weekStartOf,
} from "@/lib/dates";

describe("isISODateString", () => {
  it("accepts real YYYY-MM-DD", () => {
    expect(isISODateString("2026-05-14")).toBe(true);
  });
  it("rejects wrong format", () => {
    expect(isISODateString("2026/05/14")).toBe(false);
    expect(isISODateString("14-05-2026")).toBe(false);
    expect(isISODateString("2026-5-14")).toBe(false);
  });
  it("rejects non-real dates", () => {
    expect(isISODateString("2026-02-30")).toBe(false);
    expect(isISODateString("2026-13-01")).toBe(false);
  });
});

describe("isMondayISODate", () => {
  it("accepts a Monday in ET", () => {
    expect(isMondayISODate("2026-05-18")).toBe(true); // Monday
  });
  it("rejects non-Mondays", () => {
    expect(isMondayISODate("2026-05-14")).toBe(false); // Thursday
    expect(isMondayISODate("2026-05-17")).toBe(false); // Sunday
  });
  it("rejects invalid date strings", () => {
    expect(isMondayISODate("not-a-date")).toBe(false);
  });
});

describe("timeToMinutes", () => {
  it("returns minutes since midnight for 15-min granular times", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("08:15")).toBe(8 * 60 + 15);
    expect(timeToMinutes("23:45")).toBe(23 * 60 + 45);
  });
  it("returns NaN for non-15-min granular", () => {
    expect(Number.isNaN(timeToMinutes("08:07"))).toBe(true);
    expect(Number.isNaN(timeToMinutes("08:60"))).toBe(true);
  });
  it("returns NaN for malformed strings", () => {
    expect(Number.isNaN(timeToMinutes("8:00"))).toBe(true);
    expect(Number.isNaN(timeToMinutes("not a time"))).toBe(true);
  });
});

describe("assertTimeRange", () => {
  it("accepts start strictly less than end", () => {
    expect(() => assertTimeRange("08:00", "12:00")).not.toThrow();
  });
  it("throws on start equal to end", () => {
    expect(() => assertTimeRange("08:00", "08:00")).toThrow();
  });
  it("throws on start after end", () => {
    expect(() => assertTimeRange("12:00", "08:00")).toThrow();
  });
  it("throws on invalid times", () => {
    expect(() => assertTimeRange("invalid", "08:00")).toThrow();
  });
});

describe("weekStartOf", () => {
  it("returns the Monday of a Thursday's week (ET)", () => {
    expect(weekStartOf("2026-05-14")).toBe("2026-05-11"); // Thu → prior Mon
  });
  it("returns the same day for a Monday", () => {
    expect(weekStartOf("2026-05-11")).toBe("2026-05-11");
  });
});

describe("weekEnd", () => {
  it("returns Friday of the week given Monday", () => {
    expect(weekEnd("2026-05-11")).toBe("2026-05-15");
  });
});

describe("addDaysISO", () => {
  it("adds days to an ISO date", () => {
    expect(addDaysISO("2026-05-11", 4)).toBe("2026-05-15");
  });
  it("handles negative deltas", () => {
    expect(addDaysISO("2026-05-15", -4)).toBe("2026-05-11");
  });
  it("handles month boundaries", () => {
    expect(addDaysISO("2026-05-30", 5)).toBe("2026-06-04");
  });
});

describe("todayET", () => {
  it("returns a string in YYYY-MM-DD format", () => {
    expect(isISODateString(todayET())).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; confirm they fail**

Run: `pnpm test:run src/lib/__tests__/dates.test.ts`
Expected: all tests FAIL with "Cannot find module '@/lib/dates'" or similar.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

Create `src/lib/dates.ts`:

```ts
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import {
  addDays,
  format,
  getDay,
  isValid,
  parse,
} from "date-fns";

export const APP_TIMEZONE = "America/New_York";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export function isISODateString(value: string): boolean {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) && format(d, "yyyy-MM-dd") === value;
}

export function isMondayISODate(value: string): boolean {
  if (!isISODateString(value)) return false;
  // Day-of-week in ET wall clock.
  const dEt = toZonedTime(parse(value, "yyyy-MM-dd", new Date()), APP_TIMEZONE);
  return getDay(dEt) === 1; // 0=Sun, 1=Mon
}

export function timeToMinutes(value: string): number {
  if (typeof value !== "string" || !TIME_RE.test(value)) return NaN;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function assertTimeRange(start: string, end: string): void {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) {
    throw new Error(`Invalid time(s): ${start}, ${end}`);
  }
  if (s >= e) {
    throw new Error(`start (${start}) must be strictly less than end (${end})`);
  }
}

export function todayET(): string {
  return formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
}

export function weekStartOf(isoDate: string): string {
  if (!isISODateString(isoDate)) {
    throw new Error(`Not an ISO date: ${isoDate}`);
  }
  // Treat the date as ET wall-clock; find the Monday of its week.
  const d = toZonedTime(parse(isoDate, "yyyy-MM-dd", new Date()), APP_TIMEZONE);
  const dow = getDay(d); // 0=Sun..6=Sat
  const daysToSubtract = dow === 0 ? 6 : dow - 1;
  return formatInTimeZone(
    addDays(d, -daysToSubtract),
    APP_TIMEZONE,
    "yyyy-MM-dd",
  );
}

export function weekEnd(weekStartISO: string): string {
  return addDaysISO(weekStartISO, 4); // Mon → Fri
}

export function addDaysISO(isoDate: string, days: number): string {
  if (!isISODateString(isoDate)) {
    throw new Error(`Not an ISO date: ${isoDate}`);
  }
  const d = parse(isoDate, "yyyy-MM-dd", new Date());
  return format(addDays(d, days), "yyyy-MM-dd");
}

export function daysInRange(startISO: string, endISO: string): string[] {
  if (!isISODateString(startISO) || !isISODateString(endISO)) {
    throw new Error(`Invalid date range: ${startISO} to ${endISO}`);
  }
  const out: string[] = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}
```

- [ ] **Step 4: Run tests; confirm PASS**

Run: `pnpm test:run src/lib/__tests__/dates.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/__tests__/dates.test.ts
git commit -m "feat(lib/dates): date + time helpers with ISO/Monday/15-min validators"
```

---

## Task 15: Build `src/lib/employees/normalize.ts` (TDD)

**Files:**
- Create: `src/lib/employees/__tests__/normalize.test.ts`
- Create: `src/lib/employees/normalize.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/employees/__tests__/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/employees/normalize";

describe("normalizeEmail", () => {
  it("lowercases the entire string", () => {
    expect(normalizeEmail("Jane@Example.COM")).toBe("jane@example.com");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  jane@example.com  ")).toBe("jane@example.com");
  });
  it("does both at once", () => {
    expect(normalizeEmail("  Jane@EXAMPLE.com\n")).toBe("jane@example.com");
  });
  it("returns empty string for empty input", () => {
    expect(normalizeEmail("")).toBe("");
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/employees/__tests__/normalize.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/lib/employees/normalize.ts`:

```ts
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/employees/__tests__/normalize.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/employees/normalize.ts src/lib/employees/__tests__/normalize.test.ts
git commit -m "feat(lib/employees): normalizeEmail helper for Zod transforms"
```

---

## Task 16: Define `ActionError` and `ActionResult` types

**Files:**
- Create: `src/lib/actions/errors.ts`

No tests — pure type definitions; correctness is verified by downstream usage.

- [ ] **Step 1: Write the file**

Create `src/lib/actions/errors.ts`. `ConflictReason` is defined here (not in `schedule/conflicts.ts` from Plan 3) so it can be referenced by `ActionError` without a forward dependency. Plan 3's conflict-detector imports the type from here.

```ts
export type ConflictReason =
  | {
      rule: "a";
      otherClassId: string;
      otherId: string;
      otherWindow: { start: string; end: string };
    }
  | {
      rule: "c";
      otherTemplateId: string;
      otherWindow: { start: string; end: string };
    }
  | { rule: "d"; otherId: string };

export type ActionError =
  | { code: "unauthorized"; message: string }
  | {
      code: "validation";
      message: string;
      fieldErrors?: Record<string, string[]>;
    }
  | { code: "conflict"; message: string; conflicts: ConflictReason[] }
  | { code: "not_found"; message: string }
  | { code: "already_linked"; message: string }
  | { code: "invite_pending"; message: string }
  | { code: "class_missing"; message: string }
  | { code: "internal"; message: string; details?: unknown };

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/errors.ts
git commit -m "feat(lib/actions): ActionError envelope + ActionResult"
```

---

## Task 17: Build `src/lib/actions/transactions.ts` — runActionTx, ALS, dbOrTx (TDD)

**Files:**
- Create: `src/lib/actions/__tests__/transactions.test.ts`
- Create: `src/lib/actions/transactions.ts`

This task has integration tests that require a real DB. They use `db.transaction` directly (no `withTx` yet — `withTx` is built on top of this module). Each test opens its own transaction and rolls back via the same `IntentionalRollback` mechanism the production code uses.

- [ ] **Step 1: Write the test file**

Create `src/lib/actions/__tests__/transactions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { IntentionalRollback, txStorage } from "@/lib/actions/transactions";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult } from "@/lib/actions/errors";

async function rollbackAfter<T>(test: () => Promise<T>): Promise<T> {
  try {
    await db.transaction(async (tx) => {
      await txStorage.run(tx, async () => {
        const v = await test();
        throw new IntentionalRollback(v);
      });
    });
    throw new Error("unreachable");
  } catch (e) {
    if (e instanceof IntentionalRollback) return e.value as T;
    throw e;
  }
}

describe("runActionTx", () => {
  it("commits when handler returns ok:true (top-level call)", async () => {
    // Top-level: runActionTx opens a real transaction. We'll insert, return
    // ok:true, then verify the row exists, then manually delete to clean up.
    const result = await runActionTx<{ id: string }>(
      "test.commit",
      {},
      async (tx) => {
        const [row] = await tx
          .insert(classes)
          .values({
            name: `RX-commit-${crypto.randomUUID().slice(0, 8)}`,
            ageGroup: "preschool",
            ratioTeacherToStudents: 4,
            maxGroupSize: 16,
          })
          .returning();
        return { ok: true, data: { id: row.id } };
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, result.data.id),
    });
    expect(found?.id).toBe(result.data.id);

    // Clean up.
    await db.delete(classes).where(eq(classes.id, result.data.id));
  });

  it("rolls back when handler returns ok:false", async () => {
    let insertedId: string | undefined;

    const result = await runActionTx<unknown>("test.rollback", {}, async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({
          name: `RX-rollback-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      insertedId = row.id;
      return {
        ok: false,
        error: { code: "validation", message: "intentional" },
      };
    });
    expect(result.ok).toBe(false);
    expect(insertedId).toBeDefined();

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, insertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("rolls back + returns 'internal' on unexpected throw", async () => {
    let insertedId: string | undefined;

    const result = await runActionTx<unknown>("test.throw", {}, async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({
          name: `RX-throw-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      insertedId = row.id;
      throw new Error("boom");
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal");

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, insertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("joins outer transaction as savepoint when ALS bound (ok:true → outer commits both)", async () => {
    // Simulate a "test" by manually binding ALS.
    let outerId: string | undefined;
    let innerId: string | undefined;

    const result = await rollbackAfter(async () => {
      // Inside outer tx; runActionTx should use a savepoint.
      const tx = txStorage.getStore()!;
      const [outer] = await tx
        .insert(classes)
        .values({
          name: `RX-outer-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      outerId = outer.id;

      const inner = await runActionTx<{ id: string }>(
        "test.savepoint.ok",
        {},
        async (innerTx) => {
          const [row] = await innerTx
            .insert(classes)
            .values({
              name: `RX-inner-${crypto.randomUUID().slice(0, 8)}`,
              ageGroup: "preschool",
              ratio: 4,
              maxGroupSize: 16,
            })
            .returning();
          return { ok: true, data: { id: row.id } };
        },
      );
      expect(inner.ok).toBe(true);
      if (inner.ok) innerId = inner.data.id;

      // Before outer rollback, both rows should be visible to the outer tx.
      const outerSeen = await tx.query.classes.findFirst({
        where: eq(classes.id, outerId!),
      });
      const innerSeen = await tx.query.classes.findFirst({
        where: eq(classes.id, innerId!),
      });
      expect(outerSeen?.id).toBe(outerId);
      expect(innerSeen?.id).toBe(innerId);

      return { outerId, innerId };
    });

    expect(result.outerId).toBeDefined();
    expect(result.innerId).toBeDefined();

    // After outer rollback, neither row should persist.
    const outerAfter = await db.query.classes.findFirst({
      where: eq(classes.id, result.outerId!),
    });
    const innerAfter = await db.query.classes.findFirst({
      where: eq(classes.id, result.innerId!),
    });
    expect(outerAfter).toBeUndefined();
    expect(innerAfter).toBeUndefined();
  });

  it("savepoint rollback (handler ok:false) does not abort outer transaction", async () => {
    let outerId: string | undefined;

    const result = await rollbackAfter(async () => {
      const tx = txStorage.getStore()!;
      const [outer] = await tx
        .insert(classes)
        .values({
          name: `RX-outer2-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      outerId = outer.id;

      const inner = await runActionTx<unknown>(
        "test.savepoint.fail",
        {},
        async (innerTx) => {
          await innerTx.insert(classes).values({
            name: `RX-inner2-${crypto.randomUUID().slice(0, 8)}`,
            ageGroup: "preschool",
            ratioTeacherToStudents: 4,
            maxGroupSize: 16,
          });
          return { ok: false, error: { code: "validation", message: "x" } };
        },
      );
      expect(inner.ok).toBe(false);

      // Outer row should still be visible — savepoint rolled back but outer is alive.
      const outerSeen = await tx.query.classes.findFirst({
        where: eq(classes.id, outerId!),
      });
      expect(outerSeen?.id).toBe(outerId);

      return outerId;
    });

    expect(result).toBeDefined();
  });

  it("does not log raw input — only allowlisted ids", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runActionTx<unknown>(
      "test.sanitize",
      { email: "leak@example.com", classId: "abc-123", note: "secret" },
      async () => {
        throw new Error("boom");
      },
    );

    // sanitizeContext + logInternalError use console.error in v1.
    const calls = logSpy.mock.calls.flat().map(String).join(" ");
    expect(calls).not.toContain("leak@example.com");
    expect(calls).not.toContain("secret");
    expect(calls).toContain("abc-123"); // classId is allowlisted
    expect(calls).toContain("test.sanitize");

    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/actions/__tests__/transactions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement transactions.ts**

Create `src/lib/actions/transactions.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/db/client";
import type { ActionResult } from "@/lib/actions/errors";

// Drizzle's transaction parameter doesn't have a clean exported type in
// our version; we infer it from the callback signature.
type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const txStorage = new AsyncLocalStorage<DrizzleTx>();

export class IntentionalRollback<T> extends Error {
  constructor(public value: T) {
    super("intentional-rollback");
  }
}

export function dbOrTx(): typeof db | DrizzleTx {
  return txStorage.getStore() ?? db;
}

const SANITIZE_ALLOWLIST = [
  "classId",
  "employeeId",
  "shiftId",
  "templateId",
  "sessionId",
  "mode",
  "weekStartISO",
  "sourceWeekStartISO",
  "effectiveFromISO",
  "targetWeekStartISO",
  "date",
];

function sanitizeContext(
  actionName: string,
  input: unknown,
): Record<string, unknown> {
  const safe: Record<string, unknown> = { action: actionName };
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of SANITIZE_ALLOWLIST) {
      if (key in (input as object)) {
        safe[key] = (input as Record<string, unknown>)[key];
      }
    }
  }
  return safe;
}

async function logInternalError(
  err: unknown,
  ctx: Record<string, unknown>,
): Promise<void> {
  // v1 logger: console.error. Replace with structured logger later if needed.
  const message = err instanceof Error ? err.message : String(err);
  console.error("[runActionTx:internal]", { message, ...ctx });
}

export async function runActionTx<T>(
  actionName: string,
  input: unknown,
  handler: (tx: DrizzleTx) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const outer = txStorage.getStore();
  const runIn = outer
    ? outer.transaction.bind(outer)
    : db.transaction.bind(db);

  try {
    return await runIn(async (tx) =>
      txStorage.run(tx, async () => {
        const result = await handler(tx);
        if (!result.ok) throw new IntentionalRollback(result);
        return result;
      }),
    );
  } catch (e) {
    if (e instanceof IntentionalRollback) {
      return e.value as ActionResult<T>;
    }
    await logInternalError(e, sanitizeContext(actionName, input));
    return {
      ok: false,
      error: { code: "internal", message: "Unexpected error" },
    };
  }
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/actions/__tests__/transactions.test.ts`
Expected: all 6 tests PASS.

If the savepoint tests fail with "current transaction is aborted," the test's `IntentionalRollback` is escaping the wrong scope. Re-read `rollbackAfter` and verify it catches the rollback at the outermost level only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/transactions.ts src/lib/actions/__tests__/transactions.test.ts
git commit -m "feat(lib/actions): runActionTx with ALS savepoint joining + sanitized internal-error logging"
```

---

## Task 18: Build `src/test/with-tx.ts` (TDD)

**Files:**
- Create: `src/test/__tests__/with-tx.test.ts`
- Create: `src/test/with-tx.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/__tests__/with-tx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { runActionTx, txStorage } from "@/lib/actions/transactions";

describe("withTx", () => {
  it("returns the test body's value", async () => {
    const value = await withTx(async () => 42);
    expect(value).toBe(42);
  });

  it("rolls back direct writes via tx", async () => {
    let insertedId: string | undefined;

    await withTx(async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({
          name: `WT-direct-${crypto.randomUUID().slice(0, 8)}`,
          ageGroup: "preschool",
          ratioTeacherToStudents: 4,
          maxGroupSize: 16,
        })
        .returning();
      insertedId = row.id;
    });

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, insertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("binds ALS so runActionTx joins as savepoint and rolls back with the test", async () => {
    let actionInsertedId: string | undefined;

    await withTx(async (_tx) => {
      const result = await runActionTx<{ id: string }>(
        "test.via-withTx",
        {},
        async (innerTx) => {
          const [row] = await innerTx
            .insert(classes)
            .values({
              name: `WT-action-${crypto.randomUUID().slice(0, 8)}`,
              ageGroup: "preschool",
              ratio: 4,
              maxGroupSize: 16,
            })
            .returning();
          return { ok: true, data: { id: row.id } };
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) actionInsertedId = result.data.id;
    });

    const found = await db.query.classes.findFirst({
      where: eq(classes.id, actionInsertedId!),
    });
    expect(found).toBeUndefined();
  });

  it("ALS is unset after withTx completes", async () => {
    await withTx(async () => {});
    expect(txStorage.getStore()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/test/__tests__/with-tx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement withTx**

Create `src/test/with-tx.ts`:

```ts
import { db } from "@/db/client";
import {
  IntentionalRollback,
  txStorage,
} from "@/lib/actions/transactions";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTx<T>(
  test: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return await db
    .transaction(async (tx) =>
      txStorage.run(tx, async () => {
        const value = await test(tx);
        throw new IntentionalRollback(value);
      }),
    )
    .catch((e) => {
      if (e instanceof IntentionalRollback) return e.value as T;
      throw e;
    });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/test/__tests__/with-tx.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/test/with-tx.ts src/test/__tests__/with-tx.test.ts
git commit -m "feat(test): withTx harness with ALS binding for savepoint-joining Server Actions"
```

---

## Task 19: Build `src/test/fixtures.ts` — unique-default builders (TDD)

**Files:**
- Create: `src/test/__tests__/fixtures.test.ts`
- Create: `src/test/fixtures.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/__tests__/fixtures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withTx } from "@/test/with-tx";
import {
  makeClass,
  makeEmployee,
  makeShift,
  makeTemplate,
} from "@/test/fixtures";

describe("fixtures", () => {
  it("makeClass produces unique names across calls", async () => {
    await withTx(async (tx) => {
      const a = await makeClass(tx);
      const b = await makeClass(tx);
      expect(a.id).not.toBe(b.id);
      expect(a.name).not.toBe(b.name);
    });
  });

  it("makeEmployee produces unique emails across calls", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const e1 = await makeEmployee(tx, { defaultClassId: cls.id });
      const e2 = await makeEmployee(tx, { defaultClassId: cls.id });
      expect(e1.email).not.toBe(e2.email);
      expect(e1.email).toMatch(/^test-.+@example\.com$/);
    });
  });

  it("overrides take precedence over defaults", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx, { name: "MyClass" });
      expect(cls.name).toBe("MyClass");
    });
  });

  it("makeTemplate inserts a valid template row", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const t = await makeTemplate(tx, {
        classId: cls.id,
        employeeId: emp.id,
        dayOfWeek: 0,
        startTime: "08:00",
        endTime: "12:00",
        effectiveFrom: "2026-05-11",
      });
      expect(t.id).toBeDefined();
      expect(t.effectiveFrom).toBe("2026-05-11");
    });
  });

  it("makeShift inserts a valid shift row", async () => {
    await withTx(async (tx) => {
      const cls = await makeClass(tx);
      const emp = await makeEmployee(tx, { defaultClassId: cls.id });
      const s = await makeShift(tx, {
        classId: cls.id,
        employeeId: emp.id,
        date: "2026-05-11",
        startTime: "08:00",
        endTime: "12:00",
      });
      expect(s.id).toBeDefined();
      expect(s.sourceTemplateId).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/test/__tests__/fixtures.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fixtures**

Create `src/test/fixtures.ts`:

```ts
import { db } from "@/db/client";
import {
  classes,
  employees,
  scheduleShiftTemplates,
  scheduleShifts,
  type Class,
  type Employee,
  type NewClass,
  type NewEmployee,
  type NewScheduleShift,
  type NewScheduleShiftTemplate,
  type ScheduleShift,
  type ScheduleShiftTemplate,
} from "@/db/schema";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function uniqueSuffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

export async function makeClass(
  tx: DrizzleTx,
  overrides: Partial<NewClass> = {},
): Promise<Class> {
  const defaults: NewClass = {
    name: `Test Class ${uniqueSuffix()}`,
    ageGroup: "preschool",
    ratioTeacherToStudents: 4,
    maxGroupSize: 16,
  };
  const [row] = await tx
    .insert(classes)
    .values({ ...defaults, ...overrides })
    .returning();
  return row;
}

export async function makeEmployee(
  tx: DrizzleTx,
  overrides: Partial<NewEmployee> & { defaultClassId: string },
): Promise<Employee> {
  const defaults = {
    firstName: "Test",
    lastName: "User",
    email: `test-${crypto.randomUUID()}@example.com`,
    anniversaryDate: "2024-01-01",
    roleInClass: "teacher" as const,
    scheduledHoursPerWeek: "40",
  };
  const [row] = await tx
    .insert(employees)
    .values({ ...defaults, ...overrides })
    .returning();
  return row;
}

export async function makeTemplate(
  tx: DrizzleTx,
  overrides: Partial<NewScheduleShiftTemplate> & {
    classId: string;
    employeeId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    effectiveFrom: string;
  },
): Promise<ScheduleShiftTemplate> {
  const [row] = await tx
    .insert(scheduleShiftTemplates)
    .values(overrides)
    .returning();
  return row;
}

export async function makeShift(
  tx: DrizzleTx,
  overrides: Partial<NewScheduleShift> & {
    classId: string;
    employeeId: string;
    date: string;
    startTime: string;
    endTime: string;
  },
): Promise<ScheduleShift> {
  const [row] = await tx.insert(scheduleShifts).values(overrides).returning();
  return row;
}
```

If `class.ts` doesn't export `Class` / `NewClass` types, add them via `typeof classes.$inferSelect` / `$inferInsert` in `src/db/schema/class.ts` (mirroring `employee.ts`). Verify by reading `src/db/schema/class.ts` first; if the types are missing, add them in this task.

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/test/__tests__/fixtures.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/test/fixtures.ts src/test/__tests__/fixtures.test.ts
git commit -m "feat(test): fixture builders with unique defaults for parallel-safe tests"
```

---

## Task 20: Build `src/test/check-schema.ts` + Vitest globalSetup

**Files:**
- Create: `src/test/check-schema.ts`
- Modify: `vitest.config.ts`

The schema check queries `__drizzle_migrations` and compares the highest applied migration name against the highest `0NNN_*.sql` file under `src/db/migrations/`.

- [ ] **Step 1: Implement check-schema.ts**

Create `src/test/check-schema.ts`:

```ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

function highestMigrationFile(): string {
  const dir = join(process.cwd(), "src/db/migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error("No migration files found under src/db/migrations/");
  }
  return files[files.length - 1].replace(/\.sql$/, "");
}

async function highestAppliedMigration(): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL not set");
  }
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    // Drizzle's migration table is at `drizzle.__drizzle_migrations` by default.
    const rows = await client<{ hash: string; created_at: string }[]>`
      SELECT hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].hash;
  } finally {
    await client.end();
  }
}

export default async function checkSchema(): Promise<void> {
  const expected = highestMigrationFile();
  const applied = await highestAppliedMigration();
  if (applied === null) {
    throw new Error(
      "Test DB has no applied migrations. Run `pnpm db:migrate` and retry.",
    );
  }
  // Drizzle's "hash" is a content hash, not the file name. We can't compare
  // file names directly. Instead compare counts: number of rows in
  // __drizzle_migrations should equal number of .sql files. This is a coarse
  // check that catches the "DB is N behind" case without parsing snapshots.
  const url = process.env.DATABASE_URL!;
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    const [{ count }] = await client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    const fileCount = readdirSync(
      join(process.cwd(), "src/db/migrations"),
    ).filter((f) => /^\d{4}_.*\.sql$/.test(f)).length;
    if (count !== fileCount) {
      throw new Error(
        `DB has ${count} applied migrations but ${fileCount} migration files exist. Run \`pnpm db:migrate\`.`,
      );
    }
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 2: Wire globalSetup into vitest.config.ts**

Modify `vitest.config.ts` to add `globalSetup`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globalSetup: ["./src/test/check-schema.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Vitest's `globalSetup` runs once before any tests. If `checkSchema` throws, the whole run aborts with the error message.

- [ ] **Step 3: Verify globalSetup runs (green path)**

Run: `pnpm test:run src/lib/__tests__/dates.test.ts`
Expected: dates tests run (and pass) — globalSetup ran without error. If you see "DB has N applied but M files," migrations are out of sync — fix that first.

- [ ] **Step 4: Verify it fails when DB is stale (manual sim, optional)**

Optional verification — only run if you want to confirm the failure path:

```bash
# Temporarily simulate stale state by renaming the latest migration file:
mv src/db/migrations/0001_*.sql src/db/migrations/0001_*.sql.bak
pnpm test:run src/lib/__tests__/dates.test.ts
# Expected: globalSetup throws with "DB has 2 applied migrations but 1 migration files exist"
mv src/db/migrations/0001_*.sql.bak src/db/migrations/0001_*.sql
```

- [ ] **Step 5: Commit**

```bash
git add src/test/check-schema.ts vitest.config.ts
git commit -m "feat(test): schema/version check as Vitest globalSetup"
```

---

## Task 21: Add ESLint `no-restricted-imports` for direct `db` in tests

**Files:**
- Modify or create: `eslint.config.mjs` (Next.js 15 flat config) OR `.eslintrc.js` (legacy) — locate the existing config first.

- [ ] **Step 1: Locate the existing ESLint config**

Run: `ls eslint.config* .eslintrc* 2>/dev/null`
Expected: one file. Phase 1 uses `next lint` so a config file should exist. If none is present, create `eslint.config.mjs` matching the Next.js 15 flat-config style:

```js
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
```

- [ ] **Step 2: Add the `no-restricted-imports` override for test files**

Append to the config:

```js
config.push({
  files: ["src/**/__tests__/**/*.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
  ignores: ["src/test/with-tx.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/db/client",
            importNames: ["db"],
            message:
              "Tests must take `tx` as a parameter (via withTx) rather than importing `db` directly. Only src/test/with-tx.ts is exempt.",
          },
        ],
      },
    ],
  },
});
```

- [ ] **Step 3: Verify the rule fires**

Add a temporary offending line (e.g., `import { db } from "@/db/client";`) at the top of `src/test/__tests__/fixtures.test.ts`, then run:

Run: `pnpm lint`
Expected: error pointing to the new import; mentions `withTx`.

Revert the temporary edit.

- [ ] **Step 4: Verify clean state passes**

Run: `pnpm lint`
Expected: no errors.

Some legitimate test files do import `db` (e.g., `src/lib/actions/__tests__/transactions.test.ts` from Task 17 — which uses `db.transaction` directly because it's testing the transaction wrapper itself, before `withTx` exists). Add that file to the `ignores` list:

```js
ignores: [
  "src/test/with-tx.ts",
  "src/lib/actions/__tests__/transactions.test.ts",
],
```

Re-run `pnpm lint` and confirm clean.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs   # or .eslintrc.js, as applicable
git commit -m "chore(eslint): forbid direct db import in test files; require withTx"
```

---

## Task 22: Final verification — full test run + typecheck + lint

**Files:** none

- [ ] **Step 1: Run the full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: all three exit 0.

- [ ] **Step 2: Confirm git state**

Run: `git log --oneline -10`
Expected: ~9 new commits from this plan (one for schema, one per infrastructure module). Numbers don't matter; what matters is that each task committed independently.

- [ ] **Step 3: Confirm no untracked files in covered paths**

Run: `git status`
Expected: nothing under `src/db/`, `src/lib/`, `src/test/`, or `docs/` (pre-existing seed.ts diff aside).

---

## What this plan does NOT cover

(Documented to set expectations for Plan 2+.)

- `src/lib/schedule/types.ts`, `schedule/resolver.ts`, `schedule/conflicts.ts`, `schedule/schemas.ts`, `schedule/closure.ts` — Plan 3.
- `src/lib/employees/schemas.ts`, `src/lib/sheets/parse.ts`, `src/lib/sheets/employee-import.ts`, `src/lib/sheets/enrollment-import.ts`, `src/lib/clerk-invite.ts`, `src/lib/balances/entitlements.ts` — Plan 2 (onboarding) or Plan 4 (enrollment import).
- Any Server Actions or routes — Plans 2/3/4.
- The Playwright happy-path E2E — Plan 4 (after the full flow exists).
- Audit log write helpers (e.g., a `writeAuditLog(tx, ...)` wrapper) — added by Plan 2 when the first audit-writing action lands; envelope conventions are documented in §7.3 and don't need scaffolding here.

---

## Spec coverage check

Each Plan 1 task maps to spec sections:

- Tasks 2–13: §2 (Schema migration #2) — all sub-sections.
- Task 14: §1 (`src/lib/dates.ts`) + §7.2 (shared validators).
- Task 15: §1 (`src/lib/employees/normalize.ts`) + §7.2 (email normalization).
- Task 16: §5.1 (`ActionError` / `ActionResult`).
- Task 17: §7.1 (`runActionTx`, ALS, sanitized logging, `dbOrTx`, `IntentionalRollback`).
- Task 18: §7.4 (`withTx` harness).
- Task 19: §7.4 (fixture builders + unique-default invariant).
- Task 20: §7.5 (schema/version pre-test check; Vitest globalSetup wiring).
- Task 21: §7.4 (direct-`db` guard via `no-restricted-imports`).
- Task 22: §7.5 (CI gates — `pnpm test`, `pnpm typecheck`, `pnpm lint` must all pass).

Spec sections not addressed in Plan 1 (deliberately deferred):

- §3 (onboarding) → Plan 2.
- §4 (resolver + grid) and §5 (mutations) → Plan 3.
- §6 (save/copy/enrollment/print) → Plan 4.
- §7.3 audit log conventions are followed by Plan 2+ when the first audit row is written; the envelope shape is documented in the spec and doesn't require Plan 1 infrastructure.
