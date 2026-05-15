"use client";

import type { ScheduleMode } from "@/lib/schedule/types";

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: ScheduleMode;
  onChange: (m: ScheduleMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5">
      {(["week", "template"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            mode === m
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground"
          }`}
        >
          {m === "week" ? "Week" : "Template"}
        </button>
      ))}
    </div>
  );
}
