import { clerkClient } from "@clerk/nextjs/server";
import type { ActionResult } from "@/lib/actions/errors";
import { env } from "@/lib/env";

type InviteInput = {
  emailAddress: string;
  publicMetadata: Record<string, unknown>;
};

type InviteSuccess = { invitationId: string };

/**
 * Clerk surfaces "an invitation is already pending" as a `duplicate_record`
 * error with a message that mentions "already pending". We map either signal
 * to our ActionError `invite_pending`. Everything else falls through to
 * `internal`.
 */
function isPendingDuplicate(e: unknown): boolean {
  const errors = (e as { errors?: Array<{ code?: string; message?: string }> })
    ?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (x) =>
      x.code === "duplicate_record" ||
      /already.*pending/i.test(x.message ?? ""),
  );
}

function redirectUrl(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/sign-up`;
}

export async function inviteUser(
  input: InviteInput,
): Promise<ActionResult<InviteSuccess>> {
  try {
    const cc = await clerkClient();
    const invite = await cc.invitations.createInvitation({
      emailAddress: input.emailAddress,
      publicMetadata: input.publicMetadata,
      redirectUrl: redirectUrl(),
      notify: true,
    });
    return { ok: true, data: { invitationId: invite.id } };
  } catch (e) {
    if (isPendingDuplicate(e)) {
      return {
        ok: false,
        error: {
          code: "invite_pending",
          message: "An invitation for this email is already pending.",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "internal",
        message: "Failed to create Clerk invitation",
      },
    };
  }
}

export async function resendInvite(
  input: InviteInput & { previousInvitationId: string },
): Promise<ActionResult<InviteSuccess>> {
  try {
    const cc = await clerkClient();
    await cc.invitations.revokeInvitation(input.previousInvitationId);
    const invite = await cc.invitations.createInvitation({
      emailAddress: input.emailAddress,
      publicMetadata: input.publicMetadata,
      redirectUrl: redirectUrl(),
      notify: true,
    });
    return { ok: true, data: { invitationId: invite.id } };
  } catch (e) {
    if (isPendingDuplicate(e)) {
      return {
        ok: false,
        error: {
          code: "invite_pending",
          message: "An invitation for this email is already pending.",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "internal",
        message: "Failed to resend Clerk invitation",
      },
    };
  }
}
