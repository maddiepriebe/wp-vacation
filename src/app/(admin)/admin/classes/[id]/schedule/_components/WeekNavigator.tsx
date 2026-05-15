"use client";

import { addDaysISO } from "@/lib/dates";

export function WeekNavigator({
  weekStartISO,
  onChange,
}: {
  weekStartISO: string;
  onChange: (iso: string) => void;
}) {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y.slice(2)}`;
  };
  const endISO = addDaysISO(weekStartISO, 4);
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card px-1 py-0.5">
      <button
        type="button"
        className="rounded px-2 py-1 text-xs"
        onClick={() => onChange(addDaysISO(weekStartISO, -7))}
      >
        ‹
      </button>
      <span className="px-2 text-xs">
        {fmt(weekStartISO)} – {fmt(endISO)}
      </span>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs"
        onClick={() => onChange(addDaysISO(weekStartISO, 7))}
      >
        ›
      </button>
    </div>
  );
}
