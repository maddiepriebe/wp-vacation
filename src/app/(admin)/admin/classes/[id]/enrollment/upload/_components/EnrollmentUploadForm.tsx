"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";
import type { ParsedRow } from "@/lib/sheets/parse";
import type { EnrollmentImportRow } from "@/lib/schedule/schemas";

type ParseResult = ActionResult<{ sessionId: string; rows: ParsedRow<EnrollmentImportRow>[] }>;

export function EnrollmentUploadForm({
  classId,
  action,
}: {
  classId: string;
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
          `enrollment-import:${result.data.sessionId}`,
          JSON.stringify(result.data.rows),
        );
        router.push(
          `/admin/classes/${classId}/enrollment/upload/preview?session=${result.data.sessionId}` as Route,
        );
      }}
      className="space-y-4"
    >
      {err && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
      )}
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
