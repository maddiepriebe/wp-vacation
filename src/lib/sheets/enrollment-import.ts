import {
  enrollmentImportRowSchema,
  type EnrollmentImportRow,
} from "@/lib/schedule/schemas";
import {
  parseSheet,
  type ParsedRow,
  type ParseSheetResult,
  type RowError,
} from "@/lib/sheets/parse";

export function validateEnrollmentImportSheet(
  buffer: Buffer | Uint8Array | ArrayBuffer,
): ParseSheetResult<EnrollmentImportRow> {
  const initial = parseSheet(buffer, enrollmentImportRowSchema);
  const seenDates = new Set<string>();
  const rows: ParsedRow<EnrollmentImportRow>[] = initial.rows.map((row, idx) => {
    if (!row.ok) return row;
    if (seenDates.has(row.value.date)) {
      const err: RowError = {
        row: idx + 2,
        column: "date",
        code: "duplicate_date",
        message: `Date "${row.value.date}" appears more than once in this sheet`,
      };
      return { ok: false, errors: [err] };
    }
    seenDates.add(row.value.date);
    return row;
  });
  return { rows };
}
