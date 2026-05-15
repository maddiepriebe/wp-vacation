import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Clerk's backend SDK. The wrapper imports clerkClient from
// "@clerk/nextjs/server" — replace with vi.mock factory.
const mockCreateInvitation = vi.fn();
const mockRevokeInvitation = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () =>
    Promise.resolve({
      invitations: {
        createInvitation: mockCreateInvitation,
        revokeInvitation: mockRevokeInvitation,
      },
    }),
}));

import { inviteUser, resendInvite } from "@/lib/clerk-invite";

describe("inviteUser", () => {
  beforeEach(() => {
    mockCreateInvitation.mockReset();
    mockRevokeInvitation.mockReset();
  });

  it("calls Clerk's createInvitation and returns the invitation id", async () => {
    mockCreateInvitation.mockResolvedValue({ id: "inv_123" });
    const result = await inviteUser({
      emailAddress: "maria@example.com",
      publicMetadata: { employeeId: "emp-1", role: "employee" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.invitationId).toBe("inv_123");
    expect(mockCreateInvitation).toHaveBeenCalledOnce();
    const call = mockCreateInvitation.mock.calls[0][0];
    expect(call.emailAddress).toBe("maria@example.com");
    expect(call.notify).toBe(true);
    expect(call.redirectUrl).toMatch(/\/sign-up$/);
  });

  it("maps 'invitation already pending' Clerk error to invite_pending", async () => {
    mockCreateInvitation.mockRejectedValue({
      errors: [
        {
          code: "duplicate_record",
          message: "An invitation for this email is already pending.",
        },
      ],
    });
    const result = await inviteUser({
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invite_pending");
  });

  it("maps other Clerk errors to internal", async () => {
    mockCreateInvitation.mockRejectedValue(new Error("Clerk service down"));
    const result = await inviteUser({
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal");
  });
});

describe("resendInvite", () => {
  beforeEach(() => {
    mockCreateInvitation.mockReset();
    mockRevokeInvitation.mockReset();
  });

  it("revokes the prior invitation then creates a new one", async () => {
    mockRevokeInvitation.mockResolvedValue({});
    mockCreateInvitation.mockResolvedValue({ id: "inv_new" });
    const result = await resendInvite({
      previousInvitationId: "inv_old",
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.invitationId).toBe("inv_new");
    expect(mockRevokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(mockCreateInvitation).toHaveBeenCalledOnce();
  });

  it("returns internal if revocation fails", async () => {
    mockRevokeInvitation.mockRejectedValue(new Error("revoke failed"));
    const result = await resendInvite({
      previousInvitationId: "inv_old",
      emailAddress: "maria@example.com",
      publicMetadata: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal");
  });
});
