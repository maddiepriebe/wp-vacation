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
