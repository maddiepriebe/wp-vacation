"use client";

import type { ConflictReason } from "@/lib/actions/errors";

export function ConflictModal({
  conflicts,
  onClose,
}: {
  conflicts: ConflictReason[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="rounded-lg bg-background p-6 shadow max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Schedule conflicts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The change wasn&apos;t saved. Resolve these conflicts and try again.
        </p>
        <ul className="mt-3 list-disc pl-5 text-sm space-y-1">
          {conflicts.map((c, i) => (
            <li key={i}>{describe(c)}</li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function describe(c: ConflictReason): string {
  if (c.rule === "a") {
    return `Cross-class overlap with another shift (${c.otherWindow.start}–${c.otherWindow.end}) in a different class.`;
  }
  if (c.rule === "c") {
    return `Overlaps an existing template in this class (${c.otherWindow.start}–${c.otherWindow.end}).`;
  }
  return `A template with identical times already exists for this employee on this day.`;
}
