"use client";

import { addDaysISO } from "@/lib/dates";
import { EnrollmentCell } from "./EnrollmentCell";

export function EnrollmentRow({
  classId,
  weekStartISO,
  enrollment,
}: {
  classId: string;
  weekStartISO: string;
  enrollment: Map<string, number>;
}) {
  const dates = Array.from({ length: 5 }, (_, i) => addDaysISO(weekStartISO, i));
  return (
    <tr className="border-t bg-muted/30 text-xs">
      <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-muted-foreground">
        Expected students
      </th>
      {dates.map((d) => (
        <td key={d} className="px-3 py-2 align-top">
          <EnrollmentCell classId={classId} date={d} initialValue={enrollment.get(d) ?? null} />
        </td>
      ))}
    </tr>
  );
}
