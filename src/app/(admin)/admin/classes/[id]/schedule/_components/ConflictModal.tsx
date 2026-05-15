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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="rounded-lg bg-background p-6 shadow max-w-md">
        <h2 className="text-sm font-semibold">Schedule conflicts</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {conflicts.map((c, i) => (
            <li key={i}>Rule {c.rule}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded border px-3 py-1 text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
