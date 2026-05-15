"use client";

import type { MouseEvent } from "react";
import type { ResolvedShift } from "@/lib/schedule/types";

export function ShiftBlock({
  shift,
  onClick,
}: {
  shift: ResolvedShift;
  onClick: (e: MouseEvent) => void;
}) {
  const styles =
    shift.source === "override"
      ? "border-dashed bg-amber-100/40"
      : "border-solid bg-card";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 block w-full rounded border ${styles} px-2 py-1 text-left text-xs`}
    >
      {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
    </button>
  );
}
