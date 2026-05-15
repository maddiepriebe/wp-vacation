"use client";

import type { ResolvedShift, ScheduleMode } from "@/lib/schedule/types";
import { addDaysISO } from "@/lib/dates";
import type { DialogTarget } from "./ScheduleClient";
import { ShiftBlock } from "./ShiftBlock";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function WeekGrid({
  weekStartISO,
  mode,
  shifts,
  onBlockClick,
}: {
  weekStartISO: string;
  mode: ScheduleMode;
  shifts: ResolvedShift[];
  onBlockClick: (target: DialogTarget) => void;
}) {
  const employees = Array.from(
    new Map(shifts.map((s) => [s.employee_id, s.employee])).values(),
  ).sort((a, b) => a.last_name.localeCompare(b.last_name));

  const dates = Array.from({ length: 5 }, (_, i) =>
    addDaysISO(weekStartISO, i),
  );

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Employee</th>
            {dates.map((d, i) => (
              <th key={d} className="px-3 py-2 text-left">
                {DAY_LABELS[i]}{" "}
                <span className="text-muted-foreground">{d.slice(5)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className="border-t">
              <td className="px-3 py-2 align-top">
                {emp.first_name} {emp.last_name}
              </td>
              {dates.map((d, i) => {
                const cellShifts = shifts.filter(
                  (s) => s.employee_id === emp.id && s.date === d,
                );
                return (
                  <td
                    key={d}
                    className="px-3 py-2 align-top cursor-pointer hover:bg-muted/40"
                    onClick={() => {
                      if (cellShifts.length === 0) {
                        onBlockClick(
                          mode === "template"
                            ? {
                                kind: "new-template",
                                dayOfWeek: i,
                                employeeId: emp.id,
                              }
                            : {
                                kind: "new-shift",
                                date: d,
                                employeeId: emp.id,
                              },
                        );
                      }
                    }}
                  >
                    {cellShifts.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        + add
                      </span>
                    ) : (
                      cellShifts.map((s) => (
                        <ShiftBlock
                          key={
                            s.source === "template"
                              ? `t:${s.template_id}:${d}`
                              : `o:${s.shift_id}`
                          }
                          shift={s}
                          onClick={(e) => {
                            e.stopPropagation();
                            onBlockClick(
                              s.source === "template"
                                ? { kind: "edit-template", shift: s }
                                : { kind: "edit-shift", shift: s },
                            );
                          }}
                        />
                      ))
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {employees.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-3 py-6 text-center text-muted-foreground text-sm"
              >
                No shifts in this week. Click a cell to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
