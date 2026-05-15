"use client";

import { addDaysISO } from "@/lib/dates";

export function WeekNavigator({
  weekStartISO,
  onChange,
}: {
  weekStartISO: string;
  onChange: (iso: string) => void;
}) {
  return (
    <div className="flex gap-1">
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={() => onChange(addDaysISO(weekStartISO, -7))}
      >
        ‹
      </button>
      <span className="text-xs">{weekStartISO}</span>
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={() => onChange(addDaysISO(weekStartISO, 7))}
      >
        ›
      </button>
    </div>
  );
}
