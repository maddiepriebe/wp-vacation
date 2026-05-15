"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/actions/errors";

export function InviteButtons({
  employeeId,
  alreadyLinked,
  hasPriorInvite,
  sendAction,
  resendAction,
}: {
  employeeId: string;
  alreadyLinked: boolean;
  hasPriorInvite: boolean;
  sendAction: (input: {
    employeeId: string;
  }) => Promise<ActionResult<{ invitationId: string }>>;
  resendAction: (input: {
    employeeId: string;
  }) => Promise<ActionResult<{ invitationId: string }>>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onSend = async () => {
    setBusy(true);
    setMsg(null);
    const r = await sendAction({ employeeId });
    setBusy(false);
    setMsg(r.ok ? "Invitation sent." : r.error.message);
  };

  const onResend = async () => {
    setBusy(true);
    setMsg(null);
    const r = await resendAction({ employeeId });
    setBusy(false);
    setMsg(r.ok ? "Invitation resent." : r.error.message);
  };

  if (alreadyLinked) {
    return (
      <p className="text-sm text-muted-foreground">
        Already linked to a Clerk user.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onSend}
        className="rounded-md border px-3 py-2 text-sm"
      >
        Send invite
      </button>
      {hasPriorInvite && (
        <button
          type="button"
          disabled={busy}
          onClick={onResend}
          className="rounded-md border px-3 py-2 text-sm"
        >
          Resend invite
        </button>
      )}
      {msg && <span className="text-xs">{msg}</span>}
    </div>
  );
}
