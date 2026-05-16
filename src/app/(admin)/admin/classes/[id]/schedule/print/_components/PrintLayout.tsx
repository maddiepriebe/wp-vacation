import type { ResolvedShift } from "@/lib/schedule/types";
import { addDaysISO } from "@/lib/dates";
import { PrintButton } from "./PrintButton";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function PrintLayout({
  className,
  weekStartISO,
  shifts,
  enrollment,
}: {
  className: string;
  weekStartISO: string;
  shifts: ResolvedShift[];
  enrollment: Map<string, number>;
}) {
  const dates = Array.from({ length: 5 }, (_, i) =>
    addDaysISO(weekStartISO, i),
  );
  const employees = Array.from(
    new Map(shifts.map((s) => [s.employee_id, s.employee])).values(),
  ).sort((a, b) => a.last_name.localeCompare(b.last_name));

  return (
    <div className="p-6 print:p-0">
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 0.5in; }
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>
      <div className="no-print mb-4">
        <PrintButton />
      </div>
      <h1 className="text-xl font-semibold">
        {className} — Week of {weekStartISO}
      </h1>
      <p className="mt-1 text-sm">
        Expected students:{" "}
        {dates
          .map((d, i) => `${DAY_LABELS[i]}: ${enrollment.get(d) ?? "—"}`)
          .join("    ")}
      </p>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border px-2 py-1 text-left">Employee</th>
            {DAY_LABELS.map((d, i) => (
              <th key={d} className="border px-2 py-1 text-left">
                {d} {dates[i].slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id}>
              <td className="border px-2 py-1">
                {emp.first_name} {emp.last_name}
              </td>
              {dates.map((d) => {
                const cell = shifts.filter(
                  (s) => s.employee_id === emp.id && s.date === d,
                );
                return (
                  <td key={d} className="border px-2 py-1 align-top">
                    {cell.map((s, i) => (
                      <div key={i}>
                        {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
