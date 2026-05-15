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
      {err && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Email / Errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.ok ? "" : "bg-destructive/5"}>
                <td className="px-3 py-2">{i + 2}</td>
                <td className="px-3 py-2">{r.ok ? "Valid" : "Error"}</td>
                <td className="px-3 py-2">
                  {r.ok
                    ? r.value.email
                    : r.errors
                        .map((e) => `${e.column ?? "(row)"} — ${e.message}`)
                        .join("; ")}
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
