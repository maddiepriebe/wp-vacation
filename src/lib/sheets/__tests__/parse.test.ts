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
        row: 3, // 1-indexed; header=1, first data row=2, second data row=3
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
