import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { clerkClient, type WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/db/client";
import { admins, employees } from "@/db/schema";
import { env } from "@/lib/env";

// Clerk webhook. Verifies signature via svix, then links the Clerk user id
// onto the existing Employee or Admin row matched by email.
//
// Self-serve sign-up is disabled. Users may only exist in Clerk if they were
// invited (matches an Employee row) or seeded (matches an Admin row). If a
// `user.created` arrives with no matching DB row, we actively delete the
// Clerk user to avoid leaving a dangling auth identity that can't sign in
// to anything useful. `user.updated` events are not aggressive — an existing
// link stays even if Clerk's primary email changes.
export async function POST(req: Request) {
  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing svix headers", { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);

  let evt: WebhookEvent;
  try {
    evt = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Clerk webhook verification failed", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  if (evt.type !== "user.created" && evt.type !== "user.updated") {
    return NextResponse.json({ ok: true });
  }

  const clerkUserId = evt.data.id;
  const email = evt.data.email_addresses?.[0]?.email_address?.toLowerCase();
  if (!clerkUserId || !email) {
    return NextResponse.json({ ok: true, skipped: "missing fields" });
  }

  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email))
    .limit(1);
  if (admin) {
    await db
      .update(admins)
      .set({ clerkUserId, updatedAt: new Date() })
      .where(eq(admins.id, admin.id));
    return NextResponse.json({ ok: true, linked: "admin" });
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.email, email))
    .limit(1);
  if (employee) {
    await db
      .update(employees)
      .set({ clerkUserId, updatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    return NextResponse.json({ ok: true, linked: "employee" });
  }

  // No match. On created, hard-reject by deleting the Clerk user so the
  // identity doesn't sit around half-broken. On updated, leave it alone — an
  // already-linked row could be valid even if Clerk's email no longer matches.
  if (evt.type === "user.updated") {
    console.warn(
      `Clerk user.updated for ${clerkUserId} (${email}) has no matching DB row; leaving existing links intact`,
    );
    return NextResponse.json({ ok: true, skipped: "updated-no-match" });
  }

  console.warn(
    `Clerk user.created for ${clerkUserId} (${email}) has no matching DB row; deleting`,
  );
  try {
    const client = await clerkClient();
    await client.users.deleteUser(clerkUserId);
    return NextResponse.json({ ok: true, deleted: clerkUserId });
  } catch (err) {
    // Returning 500 lets Clerk retry the webhook; if Clerk ultimately fails
    // to deliver, the orphan still shows up in their dashboard for manual cleanup.
    console.error("Failed to delete unmatched Clerk user", err);
    return new NextResponse("Failed to delete unmatched user", { status: 500 });
  }
}
