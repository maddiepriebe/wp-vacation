"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConflictReason } from "@/lib/actions/errors";
import {
  createShiftAction,
  createShiftTemplateAction,
  deleteShiftAction,
  deleteShiftTemplateAction,
  updateShiftAction,
  updateShiftTemplateAction,
} from "@/app/(admin)/admin/classes/[id]/actions";
import type { DialogTarget } from "./ScheduleClient";

export function ShiftEditDialog({
  classId,
  mode,
  weekStartISO,
  target,
  onClose,
  onConflict,
}: {
  classId: string;
  mode: "week" | "template";
  weekStartISO: string;
  target: DialogTarget;
  onClose: () => void;
  onConflict: (c: ConflictReason[]) => void;
}) {
  const router = useRouter();
  const initial = initialFromTarget(target, weekStartISO);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isEdit =
    target.kind === "edit-shift" || target.kind === "edit-template";
  const isTemplate = mode === "template" || target.kind.endsWith("template");

  const submit = async () => {
    setBusy(true);
    setErr(null);
    let result;
    if (target.kind === "new-shift") {
      result = await createShiftAction({
        classId,
        employeeId: target.employeeId!,
        date: target.date,
        startTime,
        endTime,
      });
    } else if (target.kind === "edit-shift") {
      result = await updateShiftAction({
        shiftId: target.shift.shift_id,
        startTime,
        endTime,
      });
    } else if (target.kind === "new-template") {
      result = await createShiftTemplateAction({
        classId,
        employeeId: target.employeeId!,
        dayOfWeek: target.dayOfWeek,
        startTime,
        endTime,
        effectiveFromISO: initial.effectiveFromISO!,
      });
    } else {
      result = await updateShiftTemplateAction({
        templateId: target.shift.template_id,
        startTime,
        endTime,
      });
    }
    setBusy(false);
    if (result.ok) {
      router.refresh();
      onClose();
    } else if (result.error.code === "conflict") {
      onConflict(result.error.conflicts);
    } else {
      setErr(result.error.message);
    }
  };

  const onDelete = async () => {
    if (!isEdit) return;
    setBusy(true);
    setErr(null);
    const result =
      target.kind === "edit-shift"
        ? await deleteShiftAction({ shiftId: target.shift.shift_id })
        : await deleteShiftTemplateAction({
            templateId: (
              target as Extract<DialogTarget, { kind: "edit-template" }>
            ).shift.template_id,
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="rounded-lg bg-background p-6 shadow max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold mb-3">
          {isEdit ? "Edit" : "Add"} {isTemplate ? "template" : "shift"}
        </h2>
        {err && (
          <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Start
            <input
              type="time"
              step="900"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1"
            />
          </label>
          <label className="text-sm">
            End
            <input
              type="time"
              step="900"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-between">
          {isEdit && (mode === "template" || target.kind === "edit-shift") ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function initialFromTarget(
  t: DialogTarget,
  weekStartISO: string,
): { startTime: string; endTime: string; effectiveFromISO?: string } {
  if (t.kind === "edit-shift" || t.kind === "edit-template") {
    return {
      startTime: t.shift.start_time.slice(0, 5),
      endTime: t.shift.end_time.slice(0, 5),
    };
  }
  if (t.kind === "new-template") {
    return {
      startTime: "08:00",
      endTime: "12:00",
      effectiveFromISO: t.effectiveFromISO ?? weekStartISO,
    };
  }
  return { startTime: "08:00", endTime: "12:00" };
}
