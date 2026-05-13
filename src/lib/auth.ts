import type { Route } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { admins, employees } from "@/db/schema";
import type { Admin, Employee } from "@/db/schema";

// `/sign-in` and `/sign-up` are Clerk catch-all routes (`[[...sign-in]]`,
// `[[...sign-up]]`). typedRoutes doesn't emit the bare paths in its Route
// union, so we cast at the call sites. See docs/CLAUDE.md.

export type CurrentUser =
  | { kind: "employee"; employee: Employee }
  | { kind: "admin"; admin: Admin }
  | null;

export async function getCurrentUser(): Promise<CurrentUser> {
  const { userId } = await auth();
  if (!userId) return null;

  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.clerkUserId, userId))
    .limit(1);
  if (admin) return { kind: "admin", admin };

  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.clerkUserId, userId))
    .limit(1);
  if (employee) return { kind: "employee", employee };

  return null;
}

export async function requireEmployee(): Promise<Employee> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in" as Route);
  if (user.kind !== "employee") redirect("/admin");
  return user.employee;
}

export async function requireAdmin(): Promise<Admin> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in" as Route);
  if (user.kind !== "admin") redirect("/dashboard");
  return user.admin;
}

// For webhooks / cron / API routes where redirect isn't appropriate.
export async function requireAdminApi(): Promise<Admin> {
  const user = await getCurrentUser();
  if (!user || user.kind !== "admin") {
    throw new Response("Unauthorized", { status: 403 });
  }
  return user.admin;
}

export async function getClerkEmail(): Promise<string | null> {
  const u = await currentUser();
  return u?.primaryEmailAddress?.emailAddress ?? null;
}
