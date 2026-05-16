"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResolvedShift } from "@/lib/schedule/types";
import type { ConflictReason } from "@/lib/actions/errors";
import { saveAsTemplateAction } from "@/app/(admin)/admin/classes/[id]/actions";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function SaveAsTemplateDialog({
  classId,
  weekStartISO,
  shifts,
  onClose,
  onConflict,
}: {
  classId: string;
  weekStartISO: string;
  shifts: ResolvedShift[];
  onClose: () => void;
  onConflict: (c: ConflictReason[]) => void;
}) {
  const router = useRouter();
  const initialSelected = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const s of shifts) {
      const id = s.source === "template" ? `t:${s.template_id}` : `o:${s.shift_id}`;
      map.set(id, s.source === "template");
    }
    return map;
  }, [shifts]);

  const [selected, setSelected] = useState(initialSelected);
  const [effectiveFromISO, setEffectiveFromISO] = useState(weekStartISO);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (key: string) => setSelected((prev) => new Map(prev).set(key, !prev.get(key)));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const selectedShifts = shifts
      .filter((s) => selected.get(s.source === "template" ? `t:${s.template_id}` : `o:${s.shift_id}`))
      .map((s) =>
        s.source === "template"
          ? { source: "template" as const, templateId: s.template_id }
          : { source: "override" as const, shiftId: s.shift_id },
      );

    if (selectedShifts.length === 0) {
      const proceed = confirm(
        "This will leave no recurring schedule for this class. Continue?",
      );
      if (!proceed) {
        setBusy(false);
        return;
      }
    }

    const result = await saveAsTemplateAction({
      classId,
      sourceWeekStartISO: weekStartISO,
      effectiveFromISO,
      selectedShifts,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      onClose();
      return;
    }
    if (result.error.code === "conflict") {
      onConflict(result.error.conflicts);
    } else {
      setErr(result.error.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-6 shadow" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Save as template</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose which shifts from the week of {weekStartISO} to bake into the recurring schedule.
        </p>
        {err && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
        )}
        <label className="mt-4 block text-sm">
          Effective from (Monday)
          <input
            type="date"
            value={effectiveFromISO}
            onChange={(e) => setEffectiveFromISO(e.target.value)}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1"
          />
        </label>
        <ul className="mt-4 space-y-1 text-sm">
          {shifts.map((s) => {
            const id = s.source === "template" ? `t:${s.template_id}` : `o:${s.shift_id}`;
            const day = DAY_LABELS[(() => {
              const [y, m, d] = s.date.split("-").map(Number);
              const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
              return js - 1;
            })()];
            const label =
              s.source === "template"
                ? `${s.employee.first_name} ${s.employee.last_name} — ${day} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
                : `override — ${day}, ${s.employee.first_name} ${s.employee.last_name} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
            return (
              <li key={id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.get(id) ?? false}
                  onChange={() => toggle(id)}
                />
                <span className={s.source === "override" ? "italic text-muted-foreground" : ""}>{label}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
