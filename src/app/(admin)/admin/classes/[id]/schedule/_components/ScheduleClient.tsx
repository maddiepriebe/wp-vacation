"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { ResolvedShift, ScheduleMode } from "@/lib/schedule/types";
import type { ConflictReason } from "@/lib/actions/errors";
import { WeekGrid } from "./WeekGrid";
import { WeekNavigator } from "./WeekNavigator";
import { ModeToggle } from "./ModeToggle";
import { ShiftEditDialog } from "./ShiftEditDialog";
import { ConflictModal } from "./ConflictModal";

export type DialogTarget =
  | { kind: "new-shift"; date: string; employeeId: string | null }
  | { kind: "edit-shift"; shift: Extract<ResolvedShift, { source: "override" }> }
  | { kind: "new-template"; dayOfWeek: number; employeeId: string | null }
  | {
      kind: "edit-template";
      shift: Extract<ResolvedShift, { source: "template" }>;
    };

export function ScheduleClient({
  classId,
  className,
  weekStartISO,
  mode,
  initialShifts,
}: {
  classId: string;
  className: string;
  weekStartISO: string;
  mode: ScheduleMode;
  initialShifts: ResolvedShift[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [conflicts, setConflicts] = useState<ConflictReason[] | null>(null);

  const switchMode = (next: ScheduleMode) => {
    router.push(
      `/admin/classes/${classId}/schedule?week=${weekStartISO}&mode=${next}` as Route,
    );
  };
  const switchWeek = (nextWeekISO: string) => {
    router.push(
      `/admin/classes/${classId}/schedule?week=${nextWeekISO}&mode=${mode}` as Route,
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{className}</h1>
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={switchMode} />
          <WeekNavigator weekStartISO={weekStartISO} onChange={switchWeek} />
        </div>
      </header>

      <WeekGrid
        weekStartISO={weekStartISO}
        mode={mode}
        shifts={initialShifts}
        onBlockClick={(t) => setDialog(t)}
      />

      {dialog && (
        <ShiftEditDialog
          classId={classId}
          mode={mode}
          target={dialog}
          onClose={() => setDialog(null)}
          onConflict={(c) => {
            setDialog(null);
            setConflicts(c);
          }}
        />
      )}

      {conflicts && (
        <ConflictModal
          conflicts={conflicts}
          onClose={() => setConflicts(null)}
        />
      )}
    </div>
  );
}
