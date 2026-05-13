import type { Route } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function RootPage() {
  const user = await getCurrentUser();
  // `/sign-in` is a Clerk catch-all (`[[...sign-in]]`) — typedRoutes doesn't
  // emit the bare path in its Route union, so we cast. See docs/CLAUDE.md.
  if (!user) redirect("/sign-in" as Route);
  if (user.kind === "orphaned") redirect("/account/unlinked");
  if (user.kind === "admin") redirect("/admin");
  redirect("/dashboard");
}
