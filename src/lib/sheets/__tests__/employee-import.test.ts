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
