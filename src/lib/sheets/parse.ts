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
