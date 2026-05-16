"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteEnrollmentForecastAction,
  upsertEnrollmentForecastAction,
} from "@/app/(admin)/admin/classes/[id]/actions";

export function EnrollmentCell({
  classId,
  date,
  initialValue,
}: {
  classId: string;
  date: string;
  initialValue: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialValue !== null ? String(initialValue) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const commit = async () => {
    setBusy(true);
    setErr(null);
    const trimmed = draft.trim();
    let result;
    if (trimmed === "") {
      result = await deleteEnrollmentForecastAction({ classId, date });
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0) {
        setErr("Enter a non-negative integer");
        setBusy(false);
        return;
      }
      result = await upsertEnrollmentForecastAction({ classId, date, expectedStudents: n });
    }
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setErr(result.error.message);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="block w-full px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setEditing(true)}
      >
        {initialValue !== null ? `${initialValue} students` : "—"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="number"
        min={0}
        autoFocus
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(initialValue !== null ? String(initialValue) : "");
            setErr(null);
          }
        }}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
      />
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </div>
  );
}
