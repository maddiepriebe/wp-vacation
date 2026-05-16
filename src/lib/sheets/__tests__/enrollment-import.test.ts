import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { validateEnrollmentImportSheet } from "@/lib/sheets/enrollment-import";

function buildXlsx(rows: Record<string, unknown>[]): Buffer {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(write(wb, { bookType: "xlsx", type: "buffer" }));
}

describe("validateEnrollmentImportSheet", () => {
  it("parses a valid sheet", () => {
    const buf = buildXlsx([
      { date: "2026-05-18", expected_students: 18 },
      { date: "2026-05-19", expected_students: 20 },
    ]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  it("flags duplicate dates within the sheet", () => {
    const buf = buildXlsx([
      { date: "2026-05-18", expected_students: 18 },
      { date: "2026-05-18", expected_students: 19 },
    ]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows[0].ok).toBe(true);
    expect(result.rows[1].ok).toBe(false);
    if (!result.rows[1].ok) {
      expect(result.rows[1].errors[0].code).toBe("duplicate_date");
    }
  });

  it("flags rows with negative expected_students", () => {
    const buf = buildXlsx([{ date: "2026-05-18", expected_students: -3 }]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows[0].ok).toBe(false);
  });

  it("flags rows with non-real dates", () => {
    const buf = buildXlsx([{ date: "2026-02-30", expected_students: 12 }]);
    const result = validateEnrollmentImportSheet(buf);
    expect(result.rows[0].ok).toBe(false);
  });
});
