import type { Route } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { getCurrentUser } from "@/lib/auth";

// Landing page for the orphan state: Clerk session exists but no matching
// Employee or Admin row. Reachable any time the webhook hasn't yet linked
// `clerk_user_id` (or was bypassed). Crucially, this page DOES NOT redirect
// orphans back to /sign-in — that would loop because Clerk would just send
// the already-authenticated user back here.
export default async function UnlinkedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in" as Route);
  if (user.kind === "admin") redirect("/admin");
  if (user.kind === "employee") redirect("/dashboard");
  // user.kind === "orphaned" — render.

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold">Account not linked</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in, but your account isn&apos;t connected to a
          profile in this system yet. This usually means your invite is still
          being processed — try again in a minute, or contact an administrator
          if it persists.
        </p>
        <SignOutButton>
          <button
            type="button"
            className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
