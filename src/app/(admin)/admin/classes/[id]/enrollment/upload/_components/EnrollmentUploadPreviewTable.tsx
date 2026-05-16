"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EnrollmentImportRow } from "@/lib/schedule/schemas";

export function EnrollmentUploadPreviewTable({
  classId,
  sessionId,
  action,
}: {
  classId: string;
  sessionId: string;
  action: (input: {
    classId: string;
    sessionId: string;
    rows: EnrollmentImportRow[];
  }) => Promise<ActionResult<{ classId: string; count: number }>>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ParsedRow<EnrollmentImportRow>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const stash = sessionStorage.getItem(`enrollment-import:${sessionId}`);
    if (stash) setRows(JSON.parse(stash) as ParsedRow<EnrollmentImportRow>[]);
  }, [sessionId]);

  if (!rows) return <p className="text-sm text-muted-foreground">Loading preview…</p>;

  const valid = rows.filter((r): r is { ok: true; value: EnrollmentImportRow } => r.ok);
  const errors = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
      )}
      {errors.length > 0 && (
        <div>
          <h2 className="text-sm font-medium">{errors.length} row(s) with errors</h2>
          <ul className="mt-2 text-xs text-destructive">
            {errors.map((r, i) => (
              <li key={i}>
                {!r.ok &&
                  r.errors.map((e) => `Row ${e.row} (${e.column ?? "—"}): ${e.message}`).join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr><th className="text-left">Date</th><th className="text-left">Expected students</th></tr>
        </thead>
        <tbody>
          {valid.map((r, i) => (
            <tr key={i} className="border-t"><td>{r.value.date}</td><td>{r.value.expected_students}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || valid.length === 0}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const result = await action({
              classId,
              sessionId,
              rows: valid.map((r) => r.value),
            });
            setBusy(false);
            if (result.ok) {
              sessionStorage.removeItem(`enrollment-import:${sessionId}`);
              router.push(`/admin/classes/${classId}/schedule` as Route);
            } else {
              setErr(result.error.message);
            }
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Importing…" : `Import ${valid.length} row(s)`}
        </button>
      </div>
    </div>
  );
}
