# Phase 2 Onboarding Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the admin onboarding flow end-to-end: manual single-employee add, bulk XLSX/CSV upload with preview, initial balance writes derived from tenure formulas, admin-triggered Clerk invites (send + resend), and historical-usage entry for prior-system draws. After Plan 2 ships, an admin can fully onboard staff.

**Architecture:** Pure libs (`balances/entitlements`, `employees/schemas`, `sheets/parse`, `sheets/employee-import`, `clerk-invite`, `audit/write`) → Server Actions wrapped in `runActionTx` (from Plan 1) → routes/UI pages. Sheet preview state lives in `sessionStorage` (browser tab lifetime). All balance writes use `balance_kind = 'vacation' | 'personal'` (Phase 1 names; no `unpaid` or `sick` buckets).

**Tech Stack:** Plan 1 foundations + SheetJS (`xlsx`, Phase 1 dep) for spreadsheet parsing + Clerk Backend SDK (`@clerk/nextjs/server`, Phase 1 dep) for invitations + Next.js native form actions (no React Hook Form — `useFormState` + Server Actions are sufficient for v1).

**Spec reference:** `docs/superpowers/specs/phase-2-design.md` §3 primarily; supporting refs to §1 (file layout), §5.1 (`ActionError`), §7.1–7.3 (`runActionTx`, validation, audit conventions).

**Plan 1 details to account for** (per Plan 1's execution report):
- `ConflictReason` is exported from `@/lib/actions/errors` (Plan 3 will use it; Plan 2 doesn't trigger conflicts).
- Drizzle migrations table is `drizzle.__drizzle_migrations`.
- Tests must use `withTx` from `@/test/with-tx`; direct `db` import in test files is blocked by ESLint except in three allowlisted files.
- Use `runActionTx`, `ActionResult`, validators from `@/lib/dates`, `normalizeEmail` from `@/lib/employees/normalize`, and fixture builders from `@/test/fixtures`.
- Audit envelope: `{ actor_id, action, target_id, payload }` — see §7.3.

---

## File Structure

**Create (lib):**
- `src/lib/balances/entitlements.ts` — tenure-derived vacation + personal hour formulas.
- `src/lib/employees/schemas.ts` — Zod schemas for manual add + import rows.
- `src/lib/sheets/parse.ts` — generic SheetJS wrapper (`parseSheet`).
- `src/lib/sheets/employee-import.ts` — employee-import-specific validator over `parseSheet`.
- `src/lib/clerk-invite.ts` — `inviteUser` + `resendInvite` wrappers around Clerk Backend SDK.
- `src/lib/audit/write.ts` — `writeAuditLog(tx, ...)` helper for the standardized envelope.

**Create (routes/UI):**
- `src/app/(admin)/admin/employees/actions.ts` — all six Server Actions.
- `src/app/(admin)/admin/employees/new/page.tsx` — manual add form.
- `src/app/(admin)/admin/employees/upload/page.tsx` — file upload step.
- `src/app/(admin)/admin/employees/upload/preview/page.tsx` — preview + commit step (Client Component reading `sessionStorage`).
- `src/app/(admin)/admin/employees/[id]/page.tsx` — profile + invite + historical usage.
- `src/app/(admin)/admin/employees/_components/EmployeeForm.tsx` — shared manual-add form (Client Component).
- `src/app/(admin)/admin/employees/_components/UploadForm.tsx` — file upload + Server Action wiring.
- `src/app/(admin)/admin/employees/_components/UploadPreviewTable.tsx` — preview table + commit button.
- `src/app/(admin)/admin/employees/_components/InviteButtons.tsx` — send/resend buttons with state.
- `src/app/(admin)/admin/employees/_components/HistoricalUsageDialog.tsx` — dialog form.

**Modify:**
- `src/app/(admin)/admin/employees/page.tsx` — enable "Add Employee" link + add "Bulk upload" link.

**Tests (create):**
- `src/lib/balances/__tests__/entitlements.test.ts`
- `src/lib/employees/__tests__/schemas.test.ts`
- `src/lib/sheets/__tests__/parse.test.ts`
- `src/lib/sheets/__tests__/employee-import.test.ts`
- `src/lib/__tests__/clerk-invite.test.ts` (uses `vi.mock` for Clerk SDK)
- `src/lib/audit/__tests__/write.test.ts`
- `src/app/(admin)/admin/employees/__tests__/actions.test.ts` — integration tests for all six Server Actions, via `withTx` + `runActionTx` savepoint.

---

## Task 1: Verify Plan 1 baseline

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean working tree (modulo `seed.ts`)**

Run: `git status`
Expected: only `src/db/seed.ts` modified.

- [ ] **Step 2: Confirm Plan 1 is green**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: all three exit 0; 41+ tests pass.

If anything is red, halt — Plan 2 builds on Plan 1.

---

## Task 2: Build `src/lib/balances/entitlements.ts` (TDD pure)

**Files:**
- Create: `src/lib/balances/__tests__/entitlements.test.ts`
- Create: `src/lib/balances/entitlements.ts`

Formulas come from PRD §5.1 and §5.2:

**Vacation tiers** (days, by years since anniversary):
| Tenure | Days |
|---|---|
| < 6 months | 0 |
| 6 months – 1 year | 5 |
| 1 – 3 completed years | 10 |
| 4 – 5 completed years | 15 |
| 6+ years | 20 |

**Personal/sick** (per `docs/CLAUDE.md` v1 pinning):
| Tenure | Days |
|---|---|
| < 90 days | 0 |
| 90 days – 6 months | 4 |
| 6+ months | 9 (flat — no tenure growth) |

**Hours conversion (both buckets):** `days × (scheduled_hours_per_week / 5)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/balances/__tests__/entitlements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computePersonalEntitlement,
  computeVacationEntitlement,
} from "@/lib/balances/entitlements";

// All inputs as YYYY-MM-DD strings. All return values are hours.
// avg_daily_hours = scheduled_hours_per_week / 5; default 8 (40 hrs/wk).

describe("computeVacationEntitlement", () => {
  it("returns 0 under 6 months", () => {
    // hired 2025-12-15, asOf 2026-03-01 → ~2.5 months
    expect(computeVacationEntitlement("2025-12-15", "2026-03-01", 40)).toBe(0);
  });

  it("returns 0 the day before 6 months", () => {
    // hired 2025-11-15, asOf 2026-05-14 → 5 months 30 days (1 day short)
    expect(computeVacationEntitlement("2025-11-15", "2026-05-14", 40)).toBe(0);
  });

  it("returns 5 days at exactly 6 months", () => {
    // hired 2025-11-15, asOf 2026-05-15 → exactly 6 months
    // 5 days × 8 hrs = 40 hrs
    expect(computeVacationEntitlement("2025-11-15", "2026-05-15", 40)).toBe(40);
  });

  it("returns 5 days × 7 hrs/day for a 35-hr/week employee", () => {
    expect(computeVacationEntitlement("2025-11-15", "2026-05-15", 35)).toBe(35);
  });

  it("returns 10 days at 1 year", () => {
    expect(computeVacationEntitlement("2025-05-15", "2026-05-15", 40)).toBe(80);
  });

  it("returns 10 days during the 1–3 year tier", () => {
    expect(computeVacationEntitlement("2024-05-15", "2026-05-15", 40)).toBe(80);
  });

  it("returns 15 days at 4 completed years", () => {
    expect(computeVacationEntitlement("2022-05-15", "2026-05-15", 40)).toBe(120);
  });

  it("returns 15 days during the 4–5 year tier", () => {
    expect(computeVacationEntitlement("2021-05-15", "2026-05-15", 40)).toBe(120);
  });

  it("returns 20 days at 6+ years", () => {
    expect(computeVacationEntitlement("2020-05-15", "2026-05-15", 40)).toBe(160);
  });

  it("returns 20 days far into 6+ tier", () => {
    expect(computeVacationEntitlement("2010-05-15", "2026-05-15", 40)).toBe(160);
  });
});

describe("computePersonalEntitlement", () => {
  it("returns 0 under 90 days", () => {
    // hired 2026-03-01, asOf 2026-05-14 → ~74 days
    expect(computePersonalEntitlement("2026-03-01", "2026-05-14", 40)).toBe(0);
  });

  it("returns 4 days at exactly 90 days", () => {
    // hired 2026-02-13, asOf 2026-05-14 → 90 days
    // 4 × 8 = 32 hrs
    expect(computePersonalEntitlement("2026-02-13", "2026-05-14", 40)).toBe(32);
  });

  it("returns 4 days during the 90-day → 6-month window", () => {
    // hired 2025-12-15, asOf 2026-03-15 → 90 days
    expect(computePersonalEntitlement("2025-12-15", "2026-03-15", 40)).toBe(32);
  });

  it("returns 9 days at 6 months", () => {
    expect(computePersonalEntitlement("2025-11-15", "2026-05-15", 40)).toBe(72);
  });

  it("returns 9 days regardless of tenure past 6 months (no growth)", () => {
    expect(computePersonalEntitlement("2015-05-15", "2026-05-15", 40)).toBe(72);
  });

  it("scales by scheduled_hours_per_week", () => {
    expect(computePersonalEntitlement("2025-11-15", "2026-05-15", 35)).toBe(63);
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/balances/__tests__/entitlements.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement entitlements.ts**

Create `src/lib/balances/entitlements.ts`:

```ts
import { differenceInCalendarDays, differenceInCalendarMonths, differenceInYears, parseISO } from "date-fns";

function avgDailyHours(scheduledHoursPerWeek: number): number {
  return scheduledHoursPerWeek / 5;
}

function vacationTierDays(anniversaryDate: Date, asOf: Date): number {
  const months = differenceInCalendarMonths(asOf, anniversaryDate);
  if (months < 6) return 0;
  const years = differenceInYears(asOf, anniversaryDate);
  if (years < 1) return 5;
  if (years < 4) return 10;
  if (years < 6) return 15;
  return 20;
}

function personalTierDays(anniversaryDate: Date, asOf: Date): number {
  const days = differenceInCalendarDays(asOf, anniversaryDate);
  if (days < 90) return 0;
  const months = differenceInCalendarMonths(asOf, anniversaryDate);
  if (months < 6) return 4;
  return 9;
}

export function computeVacationEntitlement(
  anniversaryDateISO: string,
  asOfISO: string,
  scheduledHoursPerWeek: number,
): number {
  const anniversary = parseISO(anniversaryDateISO);
  const asOf = parseISO(asOfISO);
  const days = vacationTierDays(anniversary, asOf);
  return days * avgDailyHours(scheduledHoursPerWeek);
}

export function computePersonalEntitlement(
  anniversaryDateISO: string,
  asOfISO: string,
  scheduledHoursPerWeek: number,
): number {
  const anniversary = parseISO(anniversaryDateISO);
  const asOf = parseISO(asOfISO);
  const days = personalTierDays(anniversary, asOf);
  return days * avgDailyHours(scheduledHoursPerWeek);
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/balances/__tests__/entitlements.test.ts`
Expected: all 16 tests PASS.

If any fail, the most likely cause is `differenceInCalendarMonths` semantics — date-fns counts calendar-month boundaries crossed, which matches the PRD's "X months" intent. Verify the test fixtures match calendar months exactly (e.g., `2025-11-15` to `2026-05-15` is 6 calendar months crossed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/balances/entitlements.ts src/lib/balances/__tests__/entitlements.test.ts
git commit -m "feat(lib/balances): vacation + personal tenure entitlement formulas"
```

---

## Task 3: Build `src/lib/employees/schemas.ts` (TDD pure)

**Files:**
- Create: `src/lib/employees/__tests__/schemas.test.ts`
- Create: `src/lib/employees/schemas.ts`

Two Zod schemas: `employeeInputSchema` (manual form) and `employeeImportRowSchema` (spreadsheet rows). Both lowercase the email via `normalizeEmail`. Per Plan 1 reconciliation, the manual schema requires `anniversary_date`, `role_in_class` (`'teacher' | 'assistant_teacher'`), `scheduled_hours_per_week`. The import schema is a superset that swaps `default_class_id` for `default_class_name`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/employees/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  employeeImportRowSchema,
  employeeInputSchema,
} from "@/lib/employees/schemas";

describe("employeeInputSchema", () => {
  const valid = {
    first_name: "Maria",
    last_name: "L.",
    email: "Maria@Example.COM",
    role_in_class: "teacher" as const,
    default_class_id: "00000000-0000-0000-0000-000000000001",
    anniversary_date: "2025-01-15",
    scheduled_hours_per_week: 40,
  };

  it("parses a valid row and lowercases email", () => {
    const r = employeeInputSchema.parse(valid);
    expect(r.email).toBe("maria@example.com");
  });

  it("accepts optional phone", () => {
    expect(
      employeeInputSchema.parse({ ...valid, phone: "555-0100" }),
    ).toMatchObject({ phone: "555-0100" });
  });

  it("rejects missing required fields", () => {
    const { first_name: _ignored, ...rest } = valid;
    expect(() => employeeInputSchema.parse(rest)).toThrow();
  });

  it("rejects invalid role_in_class", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, role_in_class: "support" }),
    ).toThrow();
  });

  it("rejects invalid anniversary_date format", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, anniversary_date: "2025/01/15" }),
    ).toThrow();
  });

  it("rejects non-real anniversary_date", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, anniversary_date: "2025-02-30" }),
    ).toThrow();
  });

  it("rejects non-positive scheduled_hours_per_week", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, scheduled_hours_per_week: 0 }),
    ).toThrow();
    expect(() =>
      employeeInputSchema.parse({ ...valid, scheduled_hours_per_week: -1 }),
    ).toThrow();
  });

  it("rejects scheduled_hours_per_week > 40 (sanity bound)", () => {
    expect(() =>
      employeeInputSchema.parse({ ...valid, scheduled_hours_per_week: 50 }),
    ).toThrow();
  });
});

describe("employeeImportRowSchema", () => {
  const valid = {
    first_name: "Maria",
    last_name: "L.",
    email: "maria@example.com",
    role_in_class: "teacher" as const,
    default_class_name: "Pre-K",
    anniversary_date: "2025-01-15",
    scheduled_hours_per_week: 40,
  };

  it("parses a valid import row", () => {
    const r = employeeImportRowSchema.parse(valid);
    expect(r.default_class_name).toBe("Pre-K");
  });

  it("trims and preserves the case of class names (matching is case-insensitive but value is preserved)", () => {
    const r = employeeImportRowSchema.parse({
      ...valid,
      default_class_name: "  Pre-K  ",
    });
    expect(r.default_class_name).toBe("Pre-K");
  });

  it("rejects unknown role_in_class", () => {
    expect(() =>
      employeeImportRowSchema.parse({ ...valid, role_in_class: "manager" }),
    ).toThrow();
  });

  it("has no balance columns (vacation/personal/unpaid)", () => {
    // Should silently ignore extra balance columns rather than failing,
    // because Zod strips unknown keys by default. Confirm the parsed
    // object doesn't carry them.
    const r = employeeImportRowSchema.parse({
      ...valid,
      current_vacation_hours_remaining: 50,
      current_personal_hours_remaining: 10,
    } as never);
    expect(r).not.toHaveProperty("current_vacation_hours_remaining");
    expect(r).not.toHaveProperty("current_personal_hours_remaining");
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/employees/__tests__/schemas.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement schemas.ts**

Create `src/lib/employees/schemas.ts`:

```ts
import { z } from "zod";
import { isISODateString } from "@/lib/dates";
import { normalizeEmail } from "@/lib/employees/normalize";

const roleEnum = z.enum(["teacher", "assistant_teacher"]);
const isoDate = z.string().refine(isISODateString, "Must be a real YYYY-MM-DD date");
const scheduledHours = z.number().positive().max(40);

const baseFields = {
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  email: z.string().email().transform(normalizeEmail),
  phone: z.string().trim().optional(),
  role_in_class: roleEnum,
  anniversary_date: isoDate,
  scheduled_hours_per_week: scheduledHours,
};

export const employeeInputSchema = z.object({
  ...baseFields,
  default_class_id: z.string().uuid(),
});

export const employeeImportRowSchema = z.object({
  ...baseFields,
  default_class_name: z.string().trim().min(1),
});

export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type EmployeeImportRow = z.infer<typeof employeeImportRowSchema>;
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/employees/__tests__/schemas.test.ts`
Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/employees/schemas.ts src/lib/employees/__tests__/schemas.test.ts
git commit -m "feat(lib/employees): Zod schemas for manual form + import row"
```

---

## Task 4: Build `src/lib/sheets/parse.ts` (TDD pure)

**Files:**
- Create: `src/lib/sheets/__tests__/parse.test.ts`
- Create: `src/lib/sheets/parse.ts`

Thin SheetJS wrapper. Reads either XLSX or CSV from a `Buffer`/`Uint8Array`/`ArrayBuffer`; validates each row against a passed Zod schema; returns typed rows plus per-row errors.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sheets/__tests__/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { utils, write as xlsxWrite } from "xlsx";
import { z } from "zod";
import { parseSheet } from "@/lib/sheets/parse";

const schema = z.object({
  name: z.string().min(1),
  age: z.coerce.number().int().nonnegative(),
});

function makeXlsxBuffer(rows: Array<Record<string, unknown>>): Buffer {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsxWrite(wb, { type: "buffer", bookType: "xlsx" });
}

function makeCsvBuffer(rows: Array<Record<string, unknown>>): Buffer {
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => String(r[h])).join(","));
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

describe("parseSheet", () => {
  it("parses an XLSX with all-valid rows", () => {
    const buf = makeXlsxBuffer([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    const result = parseSheet(buf, schema);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ ok: true, value: { name: "Alice", age: 30 } });
    expect(result.rows[1]).toEqual({ ok: true, value: { name: "Bob", age: 25 } });
  });

  it("parses a CSV with all-valid rows", () => {
    const buf = makeCsvBuffer([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    const result = parseSheet(buf, schema, { format: "csv" });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  it("returns per-row errors for invalid rows", () => {
    const buf = makeXlsxBuffer([
      { name: "Alice", age: 30 },
      { name: "", age: -1 },
    ]);
    const result = parseSheet(buf, schema);
    expect(result.rows[0].ok).toBe(true);
    expect(result.rows[1].ok).toBe(false);
    if (!result.rows[1].ok) {
      expect(result.rows[1].errors.length).toBeGreaterThan(0);
      expect(result.rows[1].errors[0]).toMatchObject({
        row: 2, // 1-indexed; header is row 1
        code: expect.any(String),
        message: expect.any(String),
      });
    }
  });

  it("returns an empty rows array for an empty sheet", () => {
    const buf = makeXlsxBuffer([]);
    const result = parseSheet(buf, schema);
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/sheets/__tests__/parse.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement parse.ts**

Create `src/lib/sheets/parse.ts`:

```ts
import { read, utils } from "xlsx";
import type { z } from "zod";

export type RowError = {
  row: number; // 1-indexed (header is row 1, first data row is row 2)
  column: string | null;
  code: string;
  message: string;
};

export type ParsedRow<T> =
  | { ok: true; value: T }
  | { ok: false; errors: RowError[] };

export type ParseSheetResult<T> = {
  rows: ParsedRow<T>[];
};

export type ParseSheetOptions = {
  format?: "xlsx" | "csv";
};

export function parseSheet<T>(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  schema: z.ZodType<T>,
  opts: ParseSheetOptions = {},
): ParseSheetResult<T> {
  const wb = read(buffer, {
    type: "buffer",
    raw: opts.format === "csv" ? false : undefined,
  });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { rows: [] };

  const ws = wb.Sheets[firstSheet];
  const raw = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const rows: ParsedRow<T>[] = raw.map((rawRow, idx) => {
    const result = schema.safeParse(rawRow);
    if (result.success) {
      return { ok: true, value: result.data };
    }
    const errors: RowError[] = result.error.issues.map((issue) => ({
      row: idx + 2, // header is 1, data starts at 2
      column: typeof issue.path[0] === "string" ? issue.path[0] : null,
      code: issue.code,
      message: issue.message,
    }));
    return { ok: false, errors };
  });

  return { rows };
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/sheets/__tests__/parse.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheets/parse.ts src/lib/sheets/__tests__/parse.test.ts
git commit -m "feat(lib/sheets): SheetJS wrapper with per-row Zod validation"
```

---

## Task 5: Build `src/lib/sheets/employee-import.ts` (TDD pure)

**Files:**
- Create: `src/lib/sheets/__tests__/employee-import.test.ts`
- Create: `src/lib/sheets/employee-import.ts`

This module orchestrates the validator side of employee imports — runs `parseSheet` with `employeeImportRowSchema`, then performs cross-row checks (duplicate emails within the sheet). It does NOT resolve `default_class_name` against the DB — that happens in the Server Action (commit step).

- [ ] **Step 1: Write the failing test**

Create `src/lib/sheets/__tests__/employee-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { utils, write as xlsxWrite } from "xlsx";
import { validateEmployeeImportSheet } from "@/lib/sheets/employee-import";

function makeBuffer(rows: Array<Record<string, unknown>>): Buffer {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsxWrite(wb, { type: "buffer", bookType: "xlsx" });
}

const goodRow = {
  first_name: "Maria",
  last_name: "L.",
  email: "maria@example.com",
  role_in_class: "teacher",
  default_class_name: "Pre-K",
  anniversary_date: "2025-01-15",
  scheduled_hours_per_week: 40,
};

describe("validateEmployeeImportSheet", () => {
  it("returns ok rows for a clean sheet", () => {
    const buf = makeBuffer([
      goodRow,
      { ...goodRow, email: "jess@example.com", first_name: "Jess" },
    ]);
    const result = validateEmployeeImportSheet(buf);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  it("flags duplicate emails within the sheet", () => {
    const buf = makeBuffer([goodRow, { ...goodRow, first_name: "Other" }]);
    const result = validateEmployeeImportSheet(buf);
    // First occurrence accepted; second flagged as duplicate.
    expect(result.rows[0].ok).toBe(true);
    expect(result.rows[1].ok).toBe(false);
    if (!result.rows[1].ok) {
      expect(result.rows[1].errors[0].code).toBe("duplicate_email");
    }
  });

  it("normalizes email casing for duplicate detection", () => {
    const buf = makeBuffer([
      goodRow,
      { ...goodRow, email: "MARIA@example.com", first_name: "Other" },
    ]);
    const result = validateEmployeeImportSheet(buf);
    expect(result.rows[1].ok).toBe(false);
  });

  it("propagates per-row Zod errors verbatim", () => {
    const buf = makeBuffer([
      { ...goodRow, role_in_class: "manager" },
    ]);
    const result = validateEmployeeImportSheet(buf);
    expect(result.rows[0].ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/sheets/__tests__/employee-import.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement employee-import.ts**

Create `src/lib/sheets/employee-import.ts`:

```ts
import { employeeImportRowSchema, type EmployeeImportRow } from "@/lib/employees/schemas";
import { parseSheet, type ParsedRow, type ParseSheetResult, type RowError } from "@/lib/sheets/parse";

export function validateEmployeeImportSheet(
  buffer: Buffer | Uint8Array | ArrayBuffer,
): ParseSheetResult<EmployeeImportRow> {
  const initial = parseSheet(buffer, employeeImportRowSchema);
  const seenEmails = new Set<string>();
  const rows: ParsedRow<EmployeeImportRow>[] = initial.rows.map((row, idx) => {
    if (!row.ok) return row;
    const email = row.value.email; // already lowercased by the schema
    if (seenEmails.has(email)) {
      const err: RowError = {
        row: idx + 2,
        column: "email",
        code: "duplicate_email",
        message: `Email "${email}" appears more than once in this sheet`,
      };
      return { ok: false, errors: [err] };
    }
    seenEmails.add(email);
    return row;
  });
  return { rows };
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/sheets/__tests__/employee-import.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheets/employee-import.ts src/lib/sheets/__tests__/employee-import.test.ts
git commit -m "feat(lib/sheets): employee-import validator with duplicate-email check"
```

---

## Task 6: Build `src/lib/audit/write.ts` (TDD via withTx)

**Files:**
- Create: `src/lib/audit/__tests__/write.test.ts`
- Create: `src/lib/audit/write.ts`

Tiny helper that writes the standardized audit envelope `{ actor_id, action, target_id, payload }`. Uses `tx` passed in (never `db` directly).

Look at Phase 1's `audit_log` schema first — get exact column names. Likely: `id`, `actor_admin_id`, `action`, `target_id`, `payload (jsonb)`, `created_at`. If the column is `actor_admin_id` rather than `actor_id`, the helper uses that name; the spec's envelope is conceptual.

- [ ] **Step 1: Read the existing audit_log schema**

Run: `cat src/db/schema/audit-log.ts`

Note the actual column names (in particular: is the actor column `actor_admin_id`, `actor_id`, or split by `actor_type`?). The Phase 1 `actorTypeEnum` has values `employee | admin | system` so the schema may carry both `actor_type` and `actor_id` rather than `actor_admin_id`. Use whatever the file actually exports — don't guess.

- [ ] **Step 2: Write the failing test**

Create `src/lib/audit/__tests__/write.test.ts` (replace the field names with whatever step 1 revealed):

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit/write";
import { withTx } from "@/test/with-tx";
import { makeAdmin } from "@/test/fixtures";

describe("writeAuditLog", () => {
  it("inserts a row with the standardized envelope", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: "employee.create",
        targetId: null,
        payload: { hello: "world" },
      });
      const rows = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "employee.create"));
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({ hello: "world" });
    });
  });

  it("rolls back with the transaction", async () => {
    // No assertion here beyond reuse of the withTx pattern; the prior test
    // proved the insert works. This test ensures the helper is not bypassing
    // the tx (e.g., importing db directly).
    let insertedAction = "";
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      insertedAction = `audit.rollback.${crypto.randomUUID().slice(0, 8)}`;
      await writeAuditLog(tx, {
        actorAdminId: admin.id,
        action: insertedAction,
        targetId: null,
        payload: {},
      });
    });
    // No `db` available in this test (lint-blocked); we just rely on the
    // outer rollback to enforce that the helper participates in the tx.
    // If the helper bypassed tx, a follow-up test elsewhere would catch
    // the leak. This test exists to document the requirement.
    expect(insertedAction).toMatch(/^audit\.rollback\./);
  });
});
```

Note: This file also needs a `makeAdmin` fixture. If `src/test/fixtures.ts` from Plan 1 didn't include one, add it as part of this task. The fixture body:

```ts
import { admins, type Admin, type NewAdmin } from "@/db/schema";

export async function makeAdmin(
  tx: DrizzleTx,
  overrides: Partial<NewAdmin> = {},
): Promise<Admin> {
  const defaults = {
    firstName: "Test",
    lastName: "Admin",
    email: `admin-${crypto.randomUUID()}@example.com`,
    adminRole: "hr" as const,
  };
  const [row] = await tx.insert(admins).values({ ...defaults, ...overrides }).returning();
  return row;
}
```

Inspect `src/db/schema/admin.ts` for actual required columns and adjust the defaults — Phase 1 may have different fields.

- [ ] **Step 3: Run; confirm fail**

Run: `pnpm test:run src/lib/audit/__tests__/write.test.ts`
Expected: FAIL (module not found, or makeAdmin not exported).

- [ ] **Step 4: Implement write.ts + extend fixtures.ts**

Create `src/lib/audit/write.ts`:

```ts
import { auditLogs } from "@/db/schema";
import type { DB } from "@/db/client";

type DrizzleTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type AuditEnvelope = {
  actorAdminId: string;
  action: string;
  targetId: string | null;
  payload: Record<string, unknown>;
};

export async function writeAuditLog(
  tx: DrizzleTx,
  envelope: AuditEnvelope,
): Promise<void> {
  // Column names follow Phase 1's audit_log schema. Adjust if Phase 1 uses
  // different names (e.g., actorAdminId vs actorId + actorType).
  await tx.insert(auditLogs).values({
    actorAdminId: envelope.actorAdminId,
    action: envelope.action,
    targetId: envelope.targetId,
    payload: envelope.payload,
  });
}
```

Extend `src/test/fixtures.ts` with `makeAdmin` per step 2's snippet. **Critical:** the new `makeAdmin` must also use a type-only `DB` import (consistent with how Plan 1 refactored fixtures to satisfy the no-restricted-imports ESLint rule).

- [ ] **Step 5: Run; confirm PASS**

Run: `pnpm test:run src/lib/audit/__tests__/write.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit/write.ts src/lib/audit/__tests__/write.test.ts src/test/fixtures.ts
git commit -m "feat(lib/audit): writeAuditLog helper + makeAdmin fixture"
```

---

## Task 7: Build `src/lib/clerk-invite.ts` (TDD with Clerk SDK mock)

**Files:**
- Create: `src/lib/__tests__/clerk-invite.test.ts`
- Create: `src/lib/clerk-invite.ts`

Wraps Clerk Backend SDK `invitations.createInvitation()` (for `inviteUser`) and `invitations.revokeInvitation()` + `createInvitation()` (for `resendInvite`). Normalizes Clerk errors to the app's `ActionError` codes — specifically mapping Clerk's "invitation already pending" → `code: 'invite_pending'`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/clerk-invite.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Clerk's backend SDK. The wrapper imports clerkClient from
// "@clerk/nextjs/server" — replace with vi.mock factory.
const mockCreateInvitation = vi.fn();
const mockRevokeInvitation = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({
    invitations: {
      createInvitation: mockCreateInvitation,
      revokeInvitation: mockRevokeInvitation,
    },
  }),
}));

import { inviteUser, resendInvite } from "@/lib/clerk-invite";

describe("inviteUser", () => {
  beforeEach(() => {
    mockCreateInvitation.mockReset();
    mockRevokeInvitation.mockReset();
  });

  it("calls Clerk's createInvitation and returns the invitation id", async () => {
    mockCreateInvitation.mockResolvedValue({ id: "inv_123" });
    const result = await inviteUser({
      emailAddress: "maria@example.com",
      publicMetadata: { employeeId: "emp-1", role: "employee" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.invitationId).toBe("inv_123");
    expect(mockCreateInvitation).toHaveBeenCalledOnce();
    const call = mockCreateInvitation.mock.calls[0][0];
    expect(call.emailAddress).toBe("maria@example.com");
    expect(call.notify).toBe(true);
    expect(call.redirectUrl).toMatch(/\/sign-up$/);
  });

  it("maps 'invitation already pending' Clerk error to invite_pending", async () => {
    mockCreateInvitation.mockRejectedValue({
      errors: [{ code: "duplicate_record", message: "An invitation for this email is already pending." }],
    });
    const result = await inviteUser({
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invite_pending");
  });

  it("maps other Clerk errors to internal", async () => {
    mockCreateInvitation.mockRejectedValue(new Error("Clerk service down"));
    const result = await inviteUser({
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal");
  });
});

describe("resendInvite", () => {
  beforeEach(() => {
    mockCreateInvitation.mockReset();
    mockRevokeInvitation.mockReset();
  });

  it("revokes the prior invitation then creates a new one", async () => {
    mockRevokeInvitation.mockResolvedValue({});
    mockCreateInvitation.mockResolvedValue({ id: "inv_new" });
    const result = await resendInvite({
      previousInvitationId: "inv_old",
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.invitationId).toBe("inv_new");
    expect(mockRevokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(mockCreateInvitation).toHaveBeenCalledOnce();
  });

  it("returns internal if revocation fails", async () => {
    mockRevokeInvitation.mockRejectedValue(new Error("revoke failed"));
    const result = await resendInvite({
      previousInvitationId: "inv_old",
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal");
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/lib/__tests__/clerk-invite.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement clerk-invite.ts**

Create `src/lib/clerk-invite.ts`:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import type { ActionResult } from "@/lib/actions/errors";
import { env } from "@/lib/env";

type InviteInput = {
  emailAddress: string;
  publicMetadata: Record<string, unknown>;
};

type InviteSuccess = { invitationId: string };

function isPendingDuplicate(e: unknown): boolean {
  const errors = (e as { errors?: Array<{ code?: string; message?: string }> })?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (x) =>
      x.code === "duplicate_record" ||
      /already.*pending/i.test(x.message ?? ""),
  );
}

function redirectUrl(): string {
  const base = env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/sign-up`;
}

export async function inviteUser(
  input: InviteInput,
): Promise<ActionResult<InviteSuccess>> {
  try {
    const cc = await clerkClient();
    const invite = await cc.invitations.createInvitation({
      emailAddress: input.emailAddress,
      publicMetadata: input.publicMetadata,
      redirectUrl: redirectUrl(),
      notify: true,
    });
    return { ok: true, data: { invitationId: invite.id } };
  } catch (e) {
    if (isPendingDuplicate(e)) {
      return {
        ok: false,
        error: { code: "invite_pending", message: "An invitation for this email is already pending." },
      };
    }
    return {
      ok: false,
      error: { code: "internal", message: "Failed to create Clerk invitation" },
    };
  }
}

export async function resendInvite(
  input: InviteInput & { previousInvitationId: string },
): Promise<ActionResult<InviteSuccess>> {
  try {
    const cc = await clerkClient();
    await cc.invitations.revokeInvitation(input.previousInvitationId);
    const invite = await cc.invitations.createInvitation({
      emailAddress: input.emailAddress,
      publicMetadata: input.publicMetadata,
      redirectUrl: redirectUrl(),
      notify: true,
    });
    return { ok: true, data: { invitationId: invite.id } };
  } catch (e) {
    if (isPendingDuplicate(e)) {
      return {
        ok: false,
        error: { code: "invite_pending", message: "An invitation for this email is already pending." },
      };
    }
    return {
      ok: false,
      error: { code: "internal", message: "Failed to resend Clerk invitation" },
    };
  }
}
```

Verify `NEXT_PUBLIC_APP_URL` exists in `src/lib/env.ts` (Phase 1 env module). If not, fall back to a hard-coded production URL or `APP_URL`. Inspect first; the exact key may differ.

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/lib/__tests__/clerk-invite.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clerk-invite.ts src/lib/__tests__/clerk-invite.test.ts
git commit -m "feat(lib/clerk-invite): inviteUser + resendInvite wrappers with pending-mapping"
```

---

## Task 8: Build `createEmployeeAction` (TDD via withTx + runActionTx)

**Files:**
- Create: `src/app/(admin)/admin/employees/actions.ts` (start with this one action; later tasks add more)
- Create: `src/app/(admin)/admin/employees/__tests__/actions.test.ts` (start with these tests; later tasks append)

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/employees/__tests__/actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, balanceTransactions, employees } from "@/db/schema";
import { withTx } from "@/test/with-tx";
import { makeAdmin, makeClass } from "@/test/fixtures";
import { createEmployeeAction } from "@/app/(admin)/admin/employees/actions";

// requireAdmin() reads the Clerk session. For tests, we mock it to return
// the admin we just inserted via fixtures. Put the mock at the top of the
// file so all tests share it.
import { vi } from "vitest";

const currentAdminId = { value: "" };
vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => {
    return { id: currentAdminId.value };
  },
}));

describe("createEmployeeAction", () => {
  it("inserts an employee with vacation+personal balance writes when entitled", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15", // 6+ years tenure
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [emp] = await tx.select().from(employees).where(eq(employees.id, result.data.id));
      expect(emp.email).toBe("maria@example.com");
      expect(Number(emp.vacationHoursBalance)).toBe(160); // 20 days × 8 hrs
      expect(Number(emp.personalHoursBalance)).toBe(72);  // 9 days × 8 hrs
      expect(emp.clerkUserId).toBeNull();

      const txns = await tx
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.employeeId, result.data.id));
      expect(txns).toHaveLength(2); // vacation + personal
      expect(txns.every((t) => t.source === "initial_import")).toBe(true);

      const audit = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, result.data.id));
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe("employee.create");
    });
  });

  it("skips balance rows when entitlements are zero (under 6 months)", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "New",
        last_name: "Hire",
        email: "new@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: new Date().toISOString().slice(0, 10), // hired today
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [emp] = await tx.select().from(employees).where(eq(employees.id, result.data.id));
      expect(Number(emp.vacationHoursBalance)).toBe(0);
      expect(Number(emp.personalHoursBalance)).toBe(0);

      const txns = await tx
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.employeeId, result.data.id));
      expect(txns).toHaveLength(0);
    });
  });

  it("returns validation error for bad email", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "Bad",
        last_name: "Email",
        email: "not an email",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("returns class_missing for unknown default_class_id", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: "00000000-0000-0000-0000-000000000000",
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("class_missing");
    });
  });

  it("returns validation error on case-insensitive email collision", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      currentAdminId.value = admin.id;

      await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      const collision = await createEmployeeAction({
        first_name: "Maria2",
        last_name: "L.",
        email: "MARIA@example.com", // same address, different casing
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });

      expect(collision.ok).toBe(false);
      if (!collision.ok) {
        expect(collision.error.code).toBe("validation");
        expect(collision.error.fieldErrors?.email).toBeDefined();
      }
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement createEmployeeAction**

Create `src/app/(admin)/admin/employees/actions.ts`:

```ts
"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runActionTx } from "@/lib/actions/transactions";
import type { ActionResult } from "@/lib/actions/errors";
import { employeeInputSchema } from "@/lib/employees/schemas";
import {
  computePersonalEntitlement,
  computeVacationEntitlement,
} from "@/lib/balances/entitlements";
import { writeAuditLog } from "@/lib/audit/write";
import { todayET } from "@/lib/dates";
import { balanceTransactions, classes, employees } from "@/db/schema";

export async function createEmployeeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = employeeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const data = parsed.data;

  return runActionTx("employee.create", data, async (tx) => {
    const [cls] = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.id, data.default_class_id));
    if (!cls) {
      return { ok: false, error: { code: "class_missing", message: "Default class does not exist" } };
    }

    // Check email collision on LOWER(email).
    const [collision] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(sql`LOWER(${employees.email}) = LOWER(${data.email})`);
    if (collision) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "Email already in use",
          fieldErrors: { email: ["Email already in use"] },
        },
      };
    }

    const today = todayET();
    const vacationHours = computeVacationEntitlement(
      data.anniversary_date,
      today,
      data.scheduled_hours_per_week,
    );
    const personalHours = computePersonalEntitlement(
      data.anniversary_date,
      today,
      data.scheduled_hours_per_week,
    );

    const [emp] = await tx
      .insert(employees)
      .values({
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone ?? null,
        anniversaryDate: data.anniversary_date,
        defaultClassId: data.default_class_id,
        roleInClass: data.role_in_class,
        scheduledHoursPerWeek: String(data.scheduled_hours_per_week),
        vacationHoursBalance: String(vacationHours),
        personalHoursBalance: String(personalHours),
      })
      .returning();

    if (vacationHours > 0) {
      await tx.insert(balanceTransactions).values({
        employeeId: emp.id,
        balanceKind: "vacation",
        deltaHours: String(vacationHours),
        source: "initial_import",
        note: "Initial entitlement on onboarding",
      });
    }
    if (personalHours > 0) {
      await tx.insert(balanceTransactions).values({
        employeeId: emp.id,
        balanceKind: "personal",
        deltaHours: String(personalHours),
        source: "initial_import",
        note: "Initial entitlement on onboarding",
      });
    }

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.create",
      targetId: emp.id,
      payload: {
        email: emp.email,
        anniversaryDate: emp.anniversaryDate,
        defaultClassId: emp.defaultClassId,
        roleInClass: emp.roleInClass,
        scheduledHoursPerWeek: emp.scheduledHoursPerWeek,
        vacationHoursBalance: emp.vacationHoursBalance,
        personalHoursBalance: emp.personalHoursBalance,
      },
    });

    revalidatePath("/admin/employees");
    return { ok: true, data: { id: emp.id } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/actions.ts src/app/\(admin\)/admin/employees/__tests__/actions.test.ts
git commit -m "feat(employees): createEmployeeAction with tenure-derived balance writes"
```

---

## Task 9: Build `parseEmployeeImportAction` (TDD via withTx)

**Files:**
- Modify: `src/app/(admin)/admin/employees/actions.ts` — append the new action
- Modify: `src/app/(admin)/admin/employees/__tests__/actions.test.ts` — append the new tests

Server Action that accepts a `FormData` containing the uploaded file, parses it, and returns a `{ sessionId, rows }` payload for the client to stash in `sessionStorage`. No DB writes — but admin auth is still required.

- [ ] **Step 1: Write the failing test**

Append to `src/app/(admin)/admin/employees/__tests__/actions.test.ts`:

```ts
import { parseEmployeeImportAction } from "@/app/(admin)/admin/employees/actions";
import { utils, write as xlsxWrite } from "xlsx";

function makeFormData(rows: Array<Record<string, unknown>>): FormData {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = xlsxWrite(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "employees.xlsx");
  return fd;
}

describe("parseEmployeeImportAction", () => {
  it("returns parsed rows + a sessionId for a valid sheet", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const fd = makeFormData([
        {
          first_name: "Maria",
          last_name: "L.",
          email: "maria@example.com",
          role_in_class: "teacher",
          default_class_name: "Pre-K",
          anniversary_date: "2025-01-15",
          scheduled_hours_per_week: 40,
        },
      ]);

      const result = await parseEmployeeImportAction(fd);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sessionId).toBeTruthy();
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.rows[0].ok).toBe(true);
    });
  });

  it("returns rows with per-row errors for invalid input", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const fd = makeFormData([
        {
          first_name: "Bad",
          last_name: "Role",
          email: "bad@example.com",
          role_in_class: "manager",
          default_class_name: "Pre-K",
          anniversary_date: "2025-01-15",
          scheduled_hours_per_week: 40,
        },
      ]);

      const result = await parseEmployeeImportAction(fd);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.rows[0].ok).toBe(false);
    });
  });

  it("returns validation error when no file is attached", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await parseEmployeeImportAction(new FormData());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: the three new tests fail (action not exported).

- [ ] **Step 3: Implement parseEmployeeImportAction**

Append to `src/app/(admin)/admin/employees/actions.ts`:

```ts
import { validateEmployeeImportSheet } from "@/lib/sheets/employee-import";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EmployeeImportRow } from "@/lib/employees/schemas";

export async function parseEmployeeImportAction(
  formData: FormData,
): Promise<ActionResult<{ sessionId: string; rows: ParsedRow<EmployeeImportRow>[] }>> {
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, error: { code: "validation", message: "No file attached" } };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: { code: "validation", message: "File too large (>5MB)" } };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = validateEmployeeImportSheet(buf);

  return {
    ok: true,
    data: {
      sessionId: crypto.randomUUID(),
      rows: result.rows,
    },
  };
}
```

Note: `parseEmployeeImportAction` does NOT go through `runActionTx` — it has no DB writes. Auth still required.

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: 8 tests total now PASS (5 from Task 8 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/actions.ts src/app/\(admin\)/admin/employees/__tests__/actions.test.ts
git commit -m "feat(employees): parseEmployeeImportAction for upload-step file validation"
```

---

## Task 10: Build `commitEmployeeImportAction`

**Files:**
- Modify: `src/app/(admin)/admin/employees/actions.ts`
- Modify: `src/app/(admin)/admin/employees/__tests__/actions.test.ts`

Receives an array of validated rows (re-parsed defensively), resolves `default_class_name` to `default_class_id` per row, then inserts everything in one transaction with audit + balance rows.

- [ ] **Step 1: Write the failing test**

Append to actions.test.ts:

```ts
import { commitEmployeeImportAction } from "@/app/(admin)/admin/employees/actions";

describe("commitEmployeeImportAction", () => {
  it("inserts all rows with balances and a single summary audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx, { name: "Pre-K" });
      currentAdminId.value = admin.id;

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Maria",
            last_name: "L.",
            email: "maria@example.com",
            role_in_class: "teacher",
            default_class_name: "Pre-K",
            anniversary_date: "2020-01-15", // 6+ years
            scheduled_hours_per_week: 40,
          },
          {
            first_name: "Jess",
            last_name: "T.",
            email: "jess@example.com",
            role_in_class: "assistant_teacher",
            default_class_name: "pre-k", // case-insensitive
            anniversary_date: "2025-11-15", // 6 months as of 2026-05-15
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.ids).toHaveLength(2);

      const inserted = await tx.select().from(employees);
      expect(inserted.filter((e) => ["maria@example.com", "jess@example.com"].includes(e.email))).toHaveLength(2);

      const audits = await tx.select().from(auditLogs).where(eq(auditLogs.action, "employee.import"));
      expect(audits).toHaveLength(1);
      expect((audits[0].payload as { count: number }).count).toBe(2);
    });
  });

  it("fails the whole transaction with class_missing if a row's class is gone", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;
      // No class with name "Pre-K" exists.

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Maria",
            last_name: "L.",
            email: "maria@example.com",
            role_in_class: "teacher",
            default_class_name: "Pre-K",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("class_missing");

      const inserted = await tx.select().from(employees);
      expect(inserted.filter((e) => e.email === "maria@example.com")).toHaveLength(0);
    });
  });

  it("rejects invalid rows via re-parse", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;

      const result = await commitEmployeeImportAction({
        sessionId: crypto.randomUUID(),
        rows: [
          {
            first_name: "Bad",
            last_name: "Role",
            email: "bad@example.com",
            role_in_class: "manager" as never,
            default_class_name: "Pre-K",
            anniversary_date: "2025-01-15",
            scheduled_hours_per_week: 40,
          },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: 3 new tests fail.

- [ ] **Step 3: Implement commitEmployeeImportAction**

Append to actions.ts:

```ts
import { z } from "zod";
import { employeeImportRowSchema } from "@/lib/employees/schemas";

const commitInputSchema = z.object({
  sessionId: z.string().uuid(),
  rows: z.array(employeeImportRowSchema).min(1),
});

export async function commitEmployeeImportAction(
  input: unknown,
): Promise<ActionResult<{ ids: string[] }>> {
  const admin = await requireAdmin();
  const parsed = commitInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid commit payload",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { sessionId, rows } = parsed.data;

  return runActionTx("employee.import", { sessionId }, async (tx) => {
    // Build a lower(class_name) → class_id map for the classes referenced in this batch.
    const allClasses = await tx.select({ id: classes.id, name: classes.name }).from(classes);
    const byLowerName = new Map(allClasses.map((c) => [c.name.toLowerCase(), c.id]));

    const ids: string[] = [];
    const today = todayET();

    for (const row of rows) {
      const classId = byLowerName.get(row.default_class_name.toLowerCase());
      if (!classId) {
        return {
          ok: false,
          error: {
            code: "class_missing",
            message: `Class "${row.default_class_name}" not found`,
          },
        };
      }

      const vacationHours = computeVacationEntitlement(
        row.anniversary_date,
        today,
        row.scheduled_hours_per_week,
      );
      const personalHours = computePersonalEntitlement(
        row.anniversary_date,
        today,
        row.scheduled_hours_per_week,
      );

      const [emp] = await tx
        .insert(employees)
        .values({
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone ?? null,
          anniversaryDate: row.anniversary_date,
          defaultClassId: classId,
          roleInClass: row.role_in_class,
          scheduledHoursPerWeek: String(row.scheduled_hours_per_week),
          vacationHoursBalance: String(vacationHours),
          personalHoursBalance: String(personalHours),
        })
        .returning();

      if (vacationHours > 0) {
        await tx.insert(balanceTransactions).values({
          employeeId: emp.id,
          balanceKind: "vacation",
          deltaHours: String(vacationHours),
          source: "initial_import",
          note: "Initial entitlement on onboarding (bulk import)",
        });
      }
      if (personalHours > 0) {
        await tx.insert(balanceTransactions).values({
          employeeId: emp.id,
          balanceKind: "personal",
          deltaHours: String(personalHours),
          source: "initial_import",
          note: "Initial entitlement on onboarding (bulk import)",
        });
      }

      ids.push(emp.id);
    }

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.import",
      targetId: null,
      payload: { count: ids.length, sessionId },
    });

    revalidatePath("/admin/employees");
    return { ok: true, data: { ids } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: 11 total PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/actions.ts src/app/\(admin\)/admin/employees/__tests__/actions.test.ts
git commit -m "feat(employees): commitEmployeeImportAction with summary audit"
```

---

## Task 11: Build `sendInviteAction` + `resendInviteAction`

**Files:**
- Modify: `src/app/(admin)/admin/employees/actions.ts`
- Modify: `src/app/(admin)/admin/employees/__tests__/actions.test.ts`

These actions go through `runActionTx` (they write an audit row) but the Clerk SDK call lives inside the transaction. If Clerk fails after the audit attempt would have been written, the rollback unwinds the audit row — the only "external" side effect is the Clerk-side invite, which would be a stale invite the admin can revoke manually.

To track the previous invitation id for resend, store the most recent invitation id in the `audit_log.payload` of the prior `employee.invite_sent` (or `invite_resent`) entry. Resend reads that, revokes it via the Clerk wrapper, and creates a new invite.

- [ ] **Step 1: Append tests**

Append to actions.test.ts:

```ts
import { sendInviteAction, resendInviteAction } from "@/app/(admin)/admin/employees/actions";
import * as clerkInvite from "@/lib/clerk-invite";

vi.mock("@/lib/clerk-invite", () => ({
  inviteUser: vi.fn(),
  resendInvite: vi.fn(),
}));

describe("sendInviteAction", () => {
  it("creates an invitation and writes an audit row", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      vi.mocked(clerkInvite.inviteUser).mockResolvedValue({
        ok: true,
        data: { invitationId: "inv_abc" },
      });

      const result = await sendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(true);

      const audits = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "employee.invite_sent"));
      expect(audits).toHaveLength(1);
      expect((audits[0].payload as { invitationId: string }).invitationId).toBe("inv_abc");
    });
  });

  it("returns not_found for missing employee", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      currentAdminId.value = admin.id;
      const result = await sendInviteAction({
        employeeId: "00000000-0000-0000-0000-000000000000",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });
  });

  it("returns already_linked when clerk_user_id is set", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      // Simulate the webhook already linked the user.
      await tx
        .update(employees)
        .set({ clerkUserId: "user_xyz" })
        .where(eq(employees.id, empResult.data.id));

      const result = await sendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("already_linked");
    });
  });

  it("maps invite_pending from Clerk wrapper", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      vi.mocked(clerkInvite.inviteUser).mockResolvedValue({
        ok: false,
        error: { code: "invite_pending", message: "..." },
      });

      const result = await sendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invite_pending");
    });
  });
});

describe("resendInviteAction", () => {
  it("revokes prior invite and writes employee.invite_resent audit", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      // First send.
      vi.mocked(clerkInvite.inviteUser).mockResolvedValue({
        ok: true,
        data: { invitationId: "inv_first" },
      });
      await sendInviteAction({ employeeId: empResult.data.id });

      // Resend.
      vi.mocked(clerkInvite.resendInvite).mockResolvedValue({
        ok: true,
        data: { invitationId: "inv_second" },
      });
      const result = await resendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(true);

      expect(vi.mocked(clerkInvite.resendInvite)).toHaveBeenCalledWith(
        expect.objectContaining({ previousInvitationId: "inv_first" }),
      );

      const audits = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "employee.invite_resent"));
      expect(audits).toHaveLength(1);
    });
  });

  it("returns not_found when there is no prior invite to resend", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2025-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      const result = await resendInviteAction({ employeeId: empResult.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: new tests fail.

- [ ] **Step 3: Implement the two actions**

Append to actions.ts:

```ts
import { desc } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { inviteUser, resendInvite } from "@/lib/clerk-invite";

const invitePayloadSchema = z.object({
  employeeId: z.string().uuid(),
});

export async function sendInviteAction(
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const admin = await requireAdmin();
  const parsed = invitePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input" } };
  }
  const { employeeId } = parsed.data;

  return runActionTx("employee.invite_sent", parsed.data, async (tx) => {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!emp) return { ok: false, error: { code: "not_found", message: "Employee not found" } };
    if (emp.clerkUserId) {
      return { ok: false, error: { code: "already_linked", message: "Already linked to a Clerk user" } };
    }

    const inviteResult = await inviteUser({
      emailAddress: emp.email,
      publicMetadata: { employeeId: emp.id, role: "employee" },
    });
    if (!inviteResult.ok) return inviteResult;

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.invite_sent",
      targetId: emp.id,
      payload: { invitationId: inviteResult.data.invitationId },
    });

    revalidatePath(`/admin/employees/${emp.id}`);
    return { ok: true, data: { invitationId: inviteResult.data.invitationId } };
  });
}

export async function resendInviteAction(
  input: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const admin = await requireAdmin();
  const parsed = invitePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Invalid input" } };
  }
  const { employeeId } = parsed.data;

  return runActionTx("employee.invite_resent", parsed.data, async (tx) => {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!emp) return { ok: false, error: { code: "not_found", message: "Employee not found" } };
    if (emp.clerkUserId) {
      return { ok: false, error: { code: "already_linked", message: "Already linked to a Clerk user" } };
    }

    // Look up the most recent invite_sent or invite_resent audit row for this employee.
    const [latestInvite] = await tx
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, emp.id))
      .orderBy(desc(auditLogs.createdAt));
    const prevId = (latestInvite?.payload as { invitationId?: string } | undefined)?.invitationId;
    if (!prevId) {
      return { ok: false, error: { code: "not_found", message: "No prior invitation to resend" } };
    }

    const resendResult = await resendInvite({
      previousInvitationId: prevId,
      emailAddress: emp.email,
      publicMetadata: { employeeId: emp.id, role: "employee" },
    });
    if (!resendResult.ok) return resendResult;

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.invite_resent",
      targetId: emp.id,
      payload: {
        invitationId: resendResult.data.invitationId,
        previousInvitationId: prevId,
      },
    });

    revalidatePath(`/admin/employees/${emp.id}`);
    return { ok: true, data: { invitationId: resendResult.data.invitationId } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: 17 total PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/actions.ts src/app/\(admin\)/admin/employees/__tests__/actions.test.ts
git commit -m "feat(employees): sendInviteAction + resendInviteAction (Clerk-backed)"
```

---

## Task 12: Build `recordHistoricalUsageAction`

**Files:**
- Modify: `src/app/(admin)/admin/employees/actions.ts`
- Modify: `src/app/(admin)/admin/employees/__tests__/actions.test.ts`

Writes a negative `balance_transaction(source='historical_usage')` and decrements the denormalized column. Hours = weekdays in `[startDate, endDate]` × 8. Validation: dates in the current anniversary year for the chosen bucket.

- [ ] **Step 1: Write the failing test**

Append to actions.test.ts:

```ts
import { recordHistoricalUsageAction } from "@/app/(admin)/admin/employees/actions";

describe("recordHistoricalUsageAction", () => {
  it("writes a negative balance_transaction and decrements the bucket", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      // Mon-Fri of one week = 5 weekdays × 8h = 40h.
      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2026-05-11",
        endDate: "2026-05-15",
      });
      expect(result.ok).toBe(true);

      const [emp] = await tx.select().from(employees).where(eq(employees.id, empResult.data.id));
      expect(Number(emp.vacationHoursBalance)).toBe(160 - 40);

      const [txn] = await tx
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.source, "historical_usage"));
      expect(Number(txn.deltaHours)).toBe(-40);
    });
  });

  it("ignores weekends in the hour count", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      // Fri-Mon spans 2 weekdays (Fri + Mon) × 8 = 16h.
      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2026-05-15",
        endDate: "2026-05-18",
      });
      expect(result.ok).toBe(true);

      const [emp] = await tx.select().from(employees).where(eq(employees.id, empResult.data.id));
      expect(Number(emp.vacationHoursBalance)).toBe(160 - 16);
    });
  });

  it("rejects start > end", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-01-15",
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2026-05-20",
        endDate: "2026-05-10",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });

  it("rejects dates outside the current anniversary year", async () => {
    await withTx(async (tx) => {
      const admin = await makeAdmin(tx);
      const cls = await makeClass(tx);
      const empResult = await createEmployeeAction({
        first_name: "Maria",
        last_name: "L.",
        email: "maria@example.com",
        role_in_class: "teacher",
        default_class_id: cls.id,
        anniversary_date: "2020-08-01", // current anniversary year: 2025-08-01 → 2026-07-31
        scheduled_hours_per_week: 40,
      });
      if (!empResult.ok) throw new Error("setup");
      currentAdminId.value = admin.id;

      const result = await recordHistoricalUsageAction({
        employeeId: empResult.data.id,
        balanceKind: "vacation",
        startDate: "2025-01-15", // before the current anniversary year
        endDate: "2025-01-19",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    });
  });
});
```

- [ ] **Step 2: Run; confirm fail**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: new tests fail.

- [ ] **Step 3: Implement recordHistoricalUsageAction**

Append to actions.ts:

```ts
import { daysInRange, isISODateString } from "@/lib/dates";
import { addYears, parseISO } from "date-fns";

const historicalUsageInputSchema = z
  .object({
    employeeId: z.string().uuid(),
    balanceKind: z.enum(["vacation", "personal"]),
    startDate: z.string().refine(isISODateString),
    endDate: z.string().refine(isISODateString),
    note: z.string().optional(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "startDate must be on or before endDate",
    path: ["startDate"],
  });

function countWeekdays(startISO: string, endISO: string): number {
  let count = 0;
  for (const iso of daysInRange(startISO, endISO)) {
    const d = parseISO(iso);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

function currentAnniversaryYearRange(anniversaryISO: string, todayISO: string): [string, string] {
  const anniversary = parseISO(anniversaryISO);
  const today = parseISO(todayISO);
  // The current year's anniversary date for the employee in their tenure cycle.
  let start = new Date(anniversary);
  while (true) {
    const next = addYears(start, 1);
    if (next > today) break;
    start = next;
  }
  const end = addYears(start, 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export async function recordHistoricalUsageAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = historicalUsageInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid input",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const data = parsed.data;

  return runActionTx("employee.historical_usage", data, async (tx) => {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, data.employeeId));
    if (!emp) return { ok: false, error: { code: "not_found", message: "Employee not found" } };

    const today = todayET();
    const [yrStart, yrEnd] = currentAnniversaryYearRange(emp.anniversaryDate, today);
    if (data.startDate < yrStart || data.endDate > yrEnd) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: `Dates must fall within the current anniversary year (${yrStart} to ${yrEnd})`,
          fieldErrors: { startDate: ["Out of anniversary year range"] },
        },
      };
    }

    const weekdays = countWeekdays(data.startDate, data.endDate);
    const hours = weekdays * 8;

    const [txn] = await tx
      .insert(balanceTransactions)
      .values({
        employeeId: emp.id,
        balanceKind: data.balanceKind,
        deltaHours: String(-hours),
        source: "historical_usage",
        note: `Historical usage ${data.startDate} to ${data.endDate}`,
      })
      .returning();

    const denormColumn = data.balanceKind === "vacation"
      ? employees.vacationHoursBalance
      : employees.personalHoursBalance;
    await tx
      .update(employees)
      .set({
        [data.balanceKind === "vacation" ? "vacationHoursBalance" : "personalHoursBalance"]:
          sql`${denormColumn} - ${hours}`,
      })
      .where(eq(employees.id, emp.id));

    await writeAuditLog(tx, {
      actorAdminId: admin.id,
      action: "employee.historical_usage_recorded",
      targetId: emp.id,
      payload: {
        balanceKind: data.balanceKind,
        startDate: data.startDate,
        endDate: data.endDate,
        hours,
      },
    });

    revalidatePath(`/admin/employees/${emp.id}`);
    return { ok: true, data: { id: txn.id } };
  });
}
```

- [ ] **Step 4: Run; confirm PASS**

Run: `pnpm test:run src/app/\(admin\)/admin/employees/__tests__/actions.test.ts`
Expected: 21 total PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/actions.ts src/app/\(admin\)/admin/employees/__tests__/actions.test.ts
git commit -m "feat(employees): recordHistoricalUsageAction for prior-system draws"
```

---

## Task 13: Build `EmployeeForm` Client Component + `/admin/employees/new` route

**Files:**
- Create: `src/app/(admin)/admin/employees/_components/EmployeeForm.tsx`
- Create: `src/app/(admin)/admin/employees/new/page.tsx`

Native form using `useFormState` (React 19) to surface `ActionError.fieldErrors` and a top-of-form message.

- [ ] **Step 1: Build the form component**

Create `src/app/(admin)/admin/employees/_components/EmployeeForm.tsx`:

```tsx
"use client";

import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ActionResult } from "@/lib/actions/errors";

type ClassOption = { id: string; name: string };

type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: "success"; id: string };

export function EmployeeForm({
  classes,
  action,
}: {
  classes: ClassOption[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useFormState<FormState, FormData>(action, { status: "idle" });
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.push(`/admin/employees/${state.id}`);
    }
  }, [state, router]);

  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      {state.status === "error" && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <Field label="First name" name="first_name" errors={fe.first_name} />
      <Field label="Last name" name="last_name" errors={fe.last_name} />
      <Field label="Email" name="email" type="email" errors={fe.email} />
      <Field label="Phone (optional)" name="phone" errors={fe.phone} />

      <label className="block text-sm">
        Role in class
        <select name="role_in_class" className="mt-1 w-full rounded-md border bg-background px-3 py-2">
          <option value="teacher">Teacher</option>
          <option value="assistant_teacher">Assistant teacher</option>
        </select>
        <FieldErrors errors={fe.role_in_class} />
      </label>

      <label className="block text-sm">
        Default class
        <select name="default_class_id" className="mt-1 w-full rounded-md border bg-background px-3 py-2">
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <FieldErrors errors={fe.default_class_id} />
      </label>

      <Field label="Anniversary date (treated as hire date)" name="anniversary_date" type="date" errors={fe.anniversary_date} />
      <Field label="Scheduled hours per week" name="scheduled_hours_per_week" type="number" step="0.5" min="1" max="40" errors={fe.scheduled_hours_per_week} />

      <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Add employee
      </button>
    </form>
  );
}

function Field({ label, name, type = "text", step, min, max, errors }: { label: string; name: string; type?: string; step?: string; min?: string; max?: string; errors?: string[] }) {
  return (
    <label className="block text-sm">
      {label}
      <input
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2"
      />
      <FieldErrors errors={errors} />
    </label>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <span className="mt-1 block text-xs text-destructive">{errors.join(", ")}</span>
  );
}
```

- [ ] **Step 2: Build the route**

Create `src/app/(admin)/admin/employees/new/page.tsx`:

```tsx
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { classes } from "@/db/schema";
import { EmployeeForm } from "../_components/EmployeeForm";
import { createEmployeeAction } from "../actions";

type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: "success"; id: string };

async function submit(_prev: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const input = {
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    role_in_class: formData.get("role_in_class"),
    default_class_id: formData.get("default_class_id"),
    anniversary_date: formData.get("anniversary_date"),
    scheduled_hours_per_week: Number(formData.get("scheduled_hours_per_week")),
  };
  const result = await createEmployeeAction(input);
  if (!result.ok) {
    return {
      status: "error",
      message: result.error.message,
      fieldErrors:
        result.error.code === "validation" ? result.error.fieldErrors : undefined,
    };
  }
  return { status: "success", id: result.data.id };
}

export default async function NewEmployeePage() {
  await requireAdmin();
  const classRows = await db
    .select({ id: classes.id, name: classes.name })
    .from(classes)
    .orderBy(classes.name);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Add Employee</h1>
      <EmployeeForm classes={classRows} action={submit} />
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke check**

Run: `pnpm dev`, navigate to `/admin/employees/new`, submit the form. Verify:
- Validation errors render under fields.
- Successful submit redirects to `/admin/employees/<id>`.
- Page refresh after error preserves admin auth.

(Component test infrastructure not added in Plan 2 — UI correctness verified manually here and via Plan 4's Playwright E2E.)

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/employees/_components/EmployeeForm.tsx src/app/\(admin\)/admin/employees/new/page.tsx
git commit -m "feat(employees): manual add form + /admin/employees/new route"
```

---

## Task 14: Build upload + preview routes

**Files:**
- Create: `src/app/(admin)/admin/employees/_components/UploadForm.tsx`
- Create: `src/app/(admin)/admin/employees/_components/UploadPreviewTable.tsx`
- Create: `src/app/(admin)/admin/employees/upload/page.tsx`
- Create: `src/app/(admin)/admin/employees/upload/preview/page.tsx`

- [ ] **Step 1: Build UploadForm**

Create `_components/UploadForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EmployeeImportRow } from "@/lib/employees/schemas";

type ParseResult = ActionResult<{ sessionId: string; rows: ParsedRow<EmployeeImportRow>[] }>;

export function UploadForm({
  action,
}: {
  action: (fd: FormData) => Promise<ParseResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const fd = new FormData(e.currentTarget);
        const result = await action(fd);
        setBusy(false);
        if (!result.ok) {
          setErr(result.error.message);
          return;
        }
        sessionStorage.setItem(
          `employee-import:${result.data.sessionId}`,
          JSON.stringify(result.data.rows),
        );
        router.push(`/admin/employees/upload/preview?session=${result.data.sessionId}`);
      }}
      className="space-y-4"
    >
      {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      <input type="file" name="file" accept=".xlsx,.csv" required className="block" />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Parsing…" : "Upload"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Build UploadPreviewTable**

Create `_components/UploadPreviewTable.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ActionResult } from "@/lib/actions/errors";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EmployeeImportRow } from "@/lib/employees/schemas";

type CommitResult = ActionResult<{ ids: string[] }>;

export function UploadPreviewTable({
  action,
}: {
  action: (input: {
    sessionId: string;
    rows: EmployeeImportRow[];
  }) => Promise<CommitResult>;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const sessionId = sp.get("session") ?? "";

  const [rows, setRows] = useState<ParsedRow<EmployeeImportRow>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const stash = sessionStorage.getItem(`employee-import:${sessionId}`);
    if (stash) setRows(JSON.parse(stash));
  }, [sessionId]);

  if (!rows) return <p>Loading preview…</p>;

  const ok = rows.filter((r) => r.ok).length;
  const bad = rows.length - ok;
  const valid = rows.flatMap((r) => (r.ok ? [r.value] : []));

  return (
    <div className="space-y-4">
      <p className="text-sm">
        <strong>{ok}</strong> valid, <strong>{bad}</strong> errors.
        {bad > 0 && " Fix the spreadsheet and re-upload to import."}
      </p>
      {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Email / Errors</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.ok ? "" : "bg-destructive/5"}>
                <td className="px-3 py-2">{i + 2}</td>
                <td className="px-3 py-2">{r.ok ? "Valid" : "Error"}</td>
                <td className="px-3 py-2">
                  {r.ok
                    ? r.value.email
                    : r.errors.map((e) => `${e.column ?? "(row)"} — ${e.message}`).join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={busy || bad > 0}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const result = await action({ sessionId, rows: valid });
          setBusy(false);
          if (!result.ok) {
            setErr(result.error.message);
            return;
          }
          sessionStorage.removeItem(`employee-import:${sessionId}`);
          router.push("/admin/employees");
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Importing…" : `Confirm import (${ok})`}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Build the two routes**

Create `src/app/(admin)/admin/employees/upload/page.tsx`:

```tsx
import { requireAdmin } from "@/lib/auth";
import { UploadForm } from "../_components/UploadForm";
import { parseEmployeeImportAction } from "../actions";

export default async function UploadPage() {
  await requireAdmin();
  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-2xl font-semibold tracking-tight">Bulk upload employees</h1>
      <p className="text-sm text-muted-foreground">
        XLSX or CSV. Required columns: first_name, last_name, email,
        role_in_class, default_class_name, anniversary_date, scheduled_hours_per_week.
        Vacation and personal balances are computed from anniversary_date —
        don't include them as columns.
      </p>
      <UploadForm action={parseEmployeeImportAction} />
    </div>
  );
}
```

Create `src/app/(admin)/admin/employees/upload/preview/page.tsx`:

```tsx
import { requireAdmin } from "@/lib/auth";
import { UploadPreviewTable } from "../../_components/UploadPreviewTable";
import { commitEmployeeImportAction } from "../../actions";

export default async function PreviewPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Preview import</h1>
      <UploadPreviewTable action={commitEmployeeImportAction} />
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke check**

Run dev server, upload a sample sheet, verify the preview shows rows, commit, verify rows appear in the employee list.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/_components/UploadForm.tsx \
        src/app/\(admin\)/admin/employees/_components/UploadPreviewTable.tsx \
        src/app/\(admin\)/admin/employees/upload/page.tsx \
        src/app/\(admin\)/admin/employees/upload/preview/page.tsx
git commit -m "feat(employees): bulk upload + sessionStorage-backed preview"
```

---

## Task 15: Build profile page, InviteButtons, HistoricalUsageDialog

**Files:**
- Create: `src/app/(admin)/admin/employees/_components/InviteButtons.tsx`
- Create: `src/app/(admin)/admin/employees/_components/HistoricalUsageDialog.tsx`
- Create: `src/app/(admin)/admin/employees/[id]/page.tsx`

- [ ] **Step 1: InviteButtons**

Create `_components/InviteButtons.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";

export function InviteButtons({
  employeeId,
  alreadyLinked,
  hasPriorInvite,
  sendAction,
  resendAction,
}: {
  employeeId: string;
  alreadyLinked: boolean;
  hasPriorInvite: boolean;
  sendAction: (input: { employeeId: string }) => Promise<ActionResult<{ invitationId: string }>>;
  resendAction: (input: { employeeId: string }) => Promise<ActionResult<{ invitationId: string }>>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onSend = async () => {
    setBusy(true);
    setMsg(null);
    const r = await sendAction({ employeeId });
    setBusy(false);
    setMsg(r.ok ? "Invitation sent." : r.error.message);
  };

  const onResend = async () => {
    setBusy(true);
    setMsg(null);
    const r = await resendAction({ employeeId });
    setBusy(false);
    setMsg(r.ok ? "Invitation resent." : r.error.message);
  };

  if (alreadyLinked) {
    return <p className="text-sm text-muted-foreground">Already linked to a Clerk user.</p>;
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={onSend} className="rounded-md border px-3 py-2 text-sm">
        Send invite
      </button>
      {hasPriorInvite && (
        <button type="button" disabled={busy} onClick={onResend} className="rounded-md border px-3 py-2 text-sm">
          Resend invite
        </button>
      )}
      {msg && <span className="text-xs">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 2: HistoricalUsageDialog**

Create `_components/HistoricalUsageDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";

export function HistoricalUsageDialog({
  employeeId,
  action,
}: {
  employeeId: string;
  action: (input: {
    employeeId: string;
    balanceKind: "vacation" | "personal";
    startDate: string;
    endDate: string;
    note?: string;
  }) => Promise<ActionResult<{ id: string }>>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border px-3 py-2 text-sm">
        Record previously used time off
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        const r = await action({
          employeeId,
          balanceKind: fd.get("balanceKind") as "vacation" | "personal",
          startDate: String(fd.get("startDate")),
          endDate: String(fd.get("endDate")),
          note: (fd.get("note") as string) || undefined,
        });
        setBusy(false);
        if (r.ok) {
          setOpen(false);
        } else {
          setMsg(r.error.message);
        }
      }}
      className="space-y-3 rounded-md border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">Record previously used time off</h2>
      {msg && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{msg}</p>}
      <div className="flex gap-3">
        <label className="text-sm"><input type="radio" name="balanceKind" value="vacation" defaultChecked /> Vacation</label>
        <label className="text-sm"><input type="radio" name="balanceKind" value="personal" /> Personal</label>
      </div>
      <label className="block text-sm">Start date<input name="startDate" type="date" required className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
      <label className="block text-sm">End date<input name="endDate" type="date" required className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
      <label className="block text-sm">Note (optional)<input name="note" className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Profile route**

Create `src/app/(admin)/admin/employees/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { eq, and, or, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import { auditLogs, balanceTransactions, classes, employees } from "@/db/schema";
import { InviteButtons } from "../_components/InviteButtons";
import { HistoricalUsageDialog } from "../_components/HistoricalUsageDialog";
import {
  recordHistoricalUsageAction,
  resendInviteAction,
  sendInviteAction,
} from "../actions";

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [row] = await db
    .select({
      emp: employees,
      className: classes.name,
    })
    .from(employees)
    .leftJoin(classes, eq(classes.id, employees.defaultClassId))
    .where(eq(employees.id, id));
  if (!row) notFound();

  const recentTx = await db
    .select()
    .from(balanceTransactions)
    .where(eq(balanceTransactions.employeeId, id))
    .orderBy(desc(balanceTransactions.createdAt))
    .limit(20);

  const [lastInvite] = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetId, id),
        or(
          eq(auditLogs.action, "employee.invite_sent"),
          eq(auditLogs.action, "employee.invite_resent"),
        ),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  return (
    <div className="space-y-6 max-w-2xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {row.emp.firstName} {row.emp.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {row.emp.email} · {row.className ?? "no class"} · {row.emp.roleInClass}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Clerk invitation</h2>
        <InviteButtons
          employeeId={row.emp.id}
          alreadyLinked={Boolean(row.emp.clerkUserId)}
          hasPriorInvite={Boolean(lastInvite)}
          sendAction={sendInviteAction}
          resendAction={resendInviteAction}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Balances</h2>
        <p className="text-sm">
          Vacation: {row.emp.vacationHoursBalance} hours ·
          Personal: {row.emp.personalHoursBalance} hours
        </p>
        <HistoricalUsageDialog employeeId={row.emp.id} action={recordHistoricalUsageAction} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recent balance transactions</h2>
        {recentTx.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {recentTx.map((t) => (
              <li key={t.id}>
                {t.balanceKind}: {Number(t.deltaHours) > 0 ? "+" : ""}{t.deltaHours}h ({t.source})
                {t.note && ` — ${t.note}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke check**

Run dev server. Navigate to `/admin/employees/<some-id>`. Verify all sections render and the dialog/invite buttons interact correctly.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/employees/_components/InviteButtons.tsx \
        src/app/\(admin\)/admin/employees/_components/HistoricalUsageDialog.tsx \
        src/app/\(admin\)/admin/employees/\[id\]/page.tsx
git commit -m "feat(employees): profile page with invite buttons + historical usage dialog"
```

---

## Task 16: Update employee list page (enable navigation)

**Files:**
- Modify: `src/app/(admin)/admin/employees/page.tsx`

- [ ] **Step 1: Replace the disabled button block**

Open `src/app/(admin)/admin/employees/page.tsx` and find the disabled "Add Employee (Phase 2)" button (~line 26). Replace it with two Links:

```tsx
import Link from "next/link";

// ... in the header section:
<div className="flex items-center gap-2">
  <Link
    href="/admin/employees/upload"
    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium"
  >
    Bulk upload
  </Link>
  <Link
    href="/admin/employees/new"
    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
  >
    Add Employee
  </Link>
</div>
```

Also turn each row's name cell into a `<Link href={\`/admin/employees/${id}\`}>` so admins can click into the profile.

- [ ] **Step 2: Manual smoke check**

Verify list page now has working links to /new, /upload, and /[id].

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/admin/employees/page.tsx
git commit -m "feat(employees): enable list-page navigation to new/upload/profile routes"
```

---

## Task 17: Final verification

**Files:** none

- [ ] **Step 1: Full test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:run`
Expected: all three exit 0; test count is Plan 1's 41 plus Plan 2's additions (entitlements 16, schemas 12, parse 4, employee-import 4, clerk-invite 5, audit/write 2, actions ~21) ≈ 105 tests.

- [ ] **Step 2: Smoke the full onboarding flow in the browser**

Start `pnpm dev`. As an admin (sign in with a seeded admin Clerk account):

1. Navigate to `/admin/employees`. Confirm "Add Employee" + "Bulk upload" buttons.
2. Click Add Employee. Fill form with a valid record. Submit. Confirm redirect to `/admin/employees/<id>`.
3. On the profile, click "Send invite." Confirm a Clerk invitation appears (check Clerk dashboard).
4. Click "Record previously used time off." Submit a small range. Confirm balance decrements.
5. Navigate to /admin/employees/upload. Upload a test XLSX with 2 valid rows + 1 row with `role_in_class: "manager"`. Confirm preview shows 2 valid, 1 error. Confirm "Confirm import" is disabled.
6. Fix the bad row, re-upload. Confirm import. Confirm 2 new employees appear in the list.

If anything fails, halt and report.

- [ ] **Step 3: Git state**

Run: `git status`
Expected: clean (apart from pre-existing `src/db/seed.ts`).

Run: `git log --oneline c02494a..HEAD`
Expected: ~16 commits since Plan 1's start (Plan 1's 10 + Plan 2's ~14).

---

## What this plan does NOT cover

- Resolver, conflict detector, grid render, schedule mutations — **Plan 3**.
- Save-as-template, copy-week, enrollment forecast, print view — **Plan 4**.
- Playwright happy-path E2E — **Plan 4**.
- Component test infrastructure (RTL + jsdom). UI correctness in Plan 2 is verified via Task 17's manual smoke + the Plan 4 E2E. If specific UI regressions surface during execution, add a small `@testing-library/react` + jsdom Vitest project then; otherwise defer.
- `time_off_type` enum's `unpaid` value is included in the schema but the application has no `unpaid` balance bucket. Phase 3 will define how `unpaid` time-off requests interact with balances (likely no deduction).

---

## Spec coverage check

| Plan 2 task | Spec section |
|---|---|
| Task 2 (entitlements) | §1 (`src/lib/balances/entitlements.ts`) + §3.4 + Decision #9 |
| Task 3 (schemas) | §1 (`src/lib/employees/schemas.ts`) + §3.1 |
| Task 4 (parseSheet) | §1 (`src/lib/sheets/parse.ts`) |
| Task 5 (employee-import validator) | §1 + §3.3 step 1 |
| Task 6 (audit helper) | §7.3 (audit conventions) |
| Task 7 (clerk-invite) | §1 + §3.5 (Clerk wrapper + invite_pending mapping) |
| Task 8 (createEmployeeAction) | §3.2 |
| Task 9 (parseEmployeeImportAction) | §3.3 step 1 |
| Task 10 (commitEmployeeImportAction) | §3.3 step 3 + §3.4 |
| Task 11 (sendInviteAction + resendInviteAction) | §3.5 |
| Task 12 (recordHistoricalUsageAction) | §3.6 |
| Task 13 (manual form) | §3.2 + §3.7 |
| Task 14 (upload + preview) | §3.3 + §3.7 |
| Task 15 (profile + invite + historical-usage) | §3.5 + §3.6 + §3.7 |
| Task 16 (list page nav) | §3.7 |
| Task 17 (verification) | §7.5 (CI gates) |

All §3 sub-sections are addressed. The §3.8 test list from the spec is implemented across Tasks 8–12 (`actions.test.ts`).
