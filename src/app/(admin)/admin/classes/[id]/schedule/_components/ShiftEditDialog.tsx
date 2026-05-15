"use client";

import type { ConflictReason } from "@/lib/actions/errors";
import type { DialogTarget } from "./ScheduleClient";

export function ShiftEditDialog(props: {
  classId: string;
  mode: "week" | "template";
  target: DialogTarget;
  onClose: () => void;
  onConflict: (c: ConflictReason[]) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="rounded-lg bg-background p-6 shadow">
        <p className="text-sm">
          Shift edit dialog stub. Target: {props.target.kind}
        </p>
        <button
          type="button"
          onClick={props.onClose}
          className="mt-4 rounded border px-3 py-1 text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
