"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysISO, weekStartOf } from "@/lib/dates";
import {
  copyWeekAction,
  countTargetWeekShiftsAction,
} from "@/app/(admin)/admin/classes/[id]/actions";

export function CopyWeekDialog({
  classId,
  sourceWeekStartISO,
  visibleShiftCount,
  onClose,
}: {
  classId: string;
  sourceWeekStartISO: string;
  visibleShiftCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [targetWeekStartISO, setTargetWeekStartISO] = useState(
    addDaysISO(sourceWeekStartISO, 7),
  );
  const [targetShiftCount, setTargetShiftCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    countTargetWeekShiftsAction({ classId, targetWeekStartISO }).then((r) => {
      if (cancelled) return;
      if (r.ok) setTargetShiftCount(r.data.count);
    });
    return () => {
      cancelled = true;
    };
  }, [classId, targetWeekStartISO]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const result = await copyWeekAction({
      classId,
      sourceWeekStartISO,
      targetWeekStartISO,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      onClose();
    } else {
      setErr(result.error.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Copy week</h2>
        {err && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
        )}
        <label className="mt-4 block text-sm">
          Target week (Monday)
          <input
            type="date"
            value={targetWeekStartISO}
            onChange={(e) => setTargetWeekStartISO(weekStartOf(e.target.value))}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1"
          />
        </label>
        <p className="mt-4 text-sm">
          Copy {visibleShiftCount} shift{visibleShiftCount === 1 ? "" : "s"} from week of{" "}
          {sourceWeekStartISO} to week of {targetWeekStartISO}?
        </p>
        {targetShiftCount !== null && targetShiftCount > 0 && (
          <p className="mt-2 rounded-md bg-amber-100/40 px-3 py-2 text-sm">
            This will delete {targetShiftCount} existing shift{targetShiftCount === 1 ? "" : "s"} in the target week.
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy || sourceWeekStartISO === targetWeekStartISO}
            onClick={submit}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Copying…" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
