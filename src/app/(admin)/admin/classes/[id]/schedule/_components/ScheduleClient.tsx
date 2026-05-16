"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { ResolvedShift, ScheduleMode } from "@/lib/schedule/types";
import type { ConflictReason } from "@/lib/actions/errors";
import { moveShiftAction } from "@/app/(admin)/admin/classes/[id]/actions";
import { WeekGrid, type DragData } from "./WeekGrid";
import { WeekNavigator } from "./WeekNavigator";
import { ModeToggle } from "./ModeToggle";
import { ShiftEditDialog } from "./ShiftEditDialog";
import { ConflictModal } from "./ConflictModal";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { CopyWeekDialog } from "./CopyWeekDialog";

export type DialogTarget =
  | { kind: "new-shift"; date: string; employeeId: string | null }
  | { kind: "edit-shift"; shift: Extract<ResolvedShift, { source: "override" }> }
  | {
      kind: "new-template";
      dayOfWeek: number;
      employeeId: string | null;
      effectiveFromISO?: string;
    }
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
  enrollment,
}: {
  classId: string;
  className: string;
  weekStartISO: string;
  mode: ScheduleMode;
  initialShifts: ResolvedShift[];
  enrollment: Map<string, number>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [conflicts, setConflicts] = useState<ConflictReason[] | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

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

  const onMove = async (data: DragData, targetDate: string) => {
    const result = await moveShiftAction({
      shiftId: data.shiftId,
      date: targetDate,
      startTime: data.startTime,
      endTime: data.endTime,
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    if (result.error.code === "conflict") {
      setConflicts(result.error.conflicts);
    } else {
      // No toast system yet; log so the failure is visible. The grid is server-rendered
      // and never moved optimistically, so there is nothing to revert.
      console.error("[moveShiftAction]", result.error);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{className}</h1>
        <div className="flex items-center gap-2">
          {mode === "week" && (
            <button
              type="button"
              onClick={() => setSaveDialogOpen(true)}
              className="rounded-md border bg-card px-3 py-1 text-xs"
            >
              Save as template
            </button>
          )}
          {mode === "week" && (
            <button
              type="button"
              onClick={() => setCopyDialogOpen(true)}
              className="rounded-md border bg-card px-3 py-1 text-xs"
            >
              Copy week
            </button>
          )}
          {mode === "week" && (
            <Link
              href={`/admin/classes/${classId}/enrollment/upload` as Route}
              className="rounded-md border bg-card px-3 py-1 text-xs"
            >
              Upload enrollment
            </Link>
          )}
          {mode === "week" && (
            <Link
              href={
                `/admin/classes/${classId}/schedule/print?week=${weekStartISO}` as Route
              }
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border bg-card px-3 py-1 text-xs"
            >
              Print
            </Link>
          )}
          <ModeToggle mode={mode} onChange={switchMode} />
          <WeekNavigator weekStartISO={weekStartISO} onChange={switchWeek} />
        </div>
      </header>

      <WeekGrid
        classId={classId}
        weekStartISO={weekStartISO}
        mode={mode}
        shifts={initialShifts}
        enrollment={enrollment}
        onBlockClick={(t) =>
          setDialog(
            t.kind === "new-template"
              ? { ...t, effectiveFromISO: weekStartISO }
              : t,
          )
        }
        onMove={onMove}
      />

      {dialog && (
        <ShiftEditDialog
          classId={classId}
          mode={mode}
          weekStartISO={weekStartISO}
          target={dialog}
          onClose={() => setDialog(null)}
          onConflict={(c) => {
            setDialog(null);
            setConflicts(c);
          }}
        />
      )}

      {saveDialogOpen && (
        <SaveAsTemplateDialog
          classId={classId}
          weekStartISO={weekStartISO}
          shifts={initialShifts}
          onClose={() => setSaveDialogOpen(false)}
          onConflict={(c) => {
            setSaveDialogOpen(false);
            setConflicts(c);
          }}
        />
      )}

      {copyDialogOpen && (
        <CopyWeekDialog
          classId={classId}
          sourceWeekStartISO={weekStartISO}
          visibleShiftCount={initialShifts.length}
          onClose={() => setCopyDialogOpen(false)}
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
