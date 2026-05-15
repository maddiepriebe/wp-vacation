"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";

export function HistoricalUsageDialog({
  employeeId,
  action,
}: {
  employeeId: string;
  action: (input: {
    employeeId: string;
    balanceKind: "vacation" | "personal";
    startDate: string;
    endDate: string;
    note?: string;
  }) => Promise<ActionResult<{ id: string }>>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-2 text-sm"
      >
        Record previously used time off
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        const r = await action({
          employeeId,
          balanceKind: fd.get("balanceKind") as "vacation" | "personal",
          startDate: String(fd.get("startDate")),
          endDate: String(fd.get("endDate")),
          note: (fd.get("note") as string) || undefined,
        });
        setBusy(false);
        if (r.ok) {
          setOpen(false);
        } else {
          setMsg(r.error.message);
        }
      }}
      className="space-y-3 rounded-md border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">Record previously used time off</h2>
      {msg && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {msg}
        </p>
      )}
      <div className="flex gap-3">
        <label className="text-sm">
          <input
            type="radio"
            name="balanceKind"
            value="vacation"
            defaultChecked
          />{" "}
          Vacation
        </label>
        <label className="text-sm">
          <input type="radio" name="balanceKind" value="personal" /> Personal
        </label>
      </div>
      <label className="block text-sm">
        Start date
        <input
          name="startDate"
          type="date"
          required
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        End date
        <input
          name="endDate"
          type="date"
          required
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Note (optional)
        <input
          name="note"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
