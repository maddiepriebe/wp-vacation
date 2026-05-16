/**
 * Project-based Playwright setup for E2E.
 *
 * 1. `clerkSetup()` — obtains a Clerk testing token for this run.
 *    Requires `pk_test_*` / `sk_test_*` keys (dev instance only).
 *
 * 2. Idempotently ensures a Clerk user exists for E2E_ADMIN_EMAIL with
 *    E2E_ADMIN_PASSWORD via Clerk's Backend REST API (find-or-create).
 *
 * 3. Idempotently ensures a matching row exists in the `admin` table linked
 *    to that Clerk user via `clerk_user_id` — required because production
 *    creates this row via webhook, which doesn't fire in tests.
 *
 * Side effects in your **dev** Clerk instance and **dev** DATABASE_URL:
 *   - one Clerk user with the test email
 *   - one row in `admin` with the test email
 *
 * Per spec, this is "clearly isolated test data" (single sentinel email).
 */
import { config as loadEnv } from "dotenv";
import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

setup.describe.configure({ mode: "serial" });

const E2E_ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ?? "admin+clerk_test@example.com";
const E2E_ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "E2E-Admin-Test-Pwd-1!";

setup("clerk + admin user", async () => {
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!publishableKey || !secretKey) {
    throw new Error(
      "E2E setup: missing Clerk keys. Set CLERK_SECRET_KEY and (CLERK_PUBLISHABLE_KEY or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) in .env.local.",
    );
  }
  if (!publishableKey.startsWith("pk_test_")) {
    throw new Error(
      "E2E setup: Clerk publishable key is not a development instance (pk_test_…). Testing tokens only work in dev. Refusing to run.",
    );
  }
  if (!databaseUrl) {
    throw new Error("E2E setup: DATABASE_URL must be set in .env.local.");
  }

  await clerkSetup({ publishableKey, secretKey });

  const clerkUserId = await ensureClerkUser({
    secretKey,
    email: E2E_ADMIN_EMAIL,
    password: E2E_ADMIN_PASSWORD,
  });

  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    await sql`
      INSERT INTO admin (first_name, last_name, email, admin_role, clerk_user_id)
      VALUES ('E2E', 'Admin', ${E2E_ADMIN_EMAIL}, 'owner', ${clerkUserId})
      ON CONFLICT (email)
      DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id,
                    updated_at    = now()
    `;
  } finally {
    await sql.end();
  }
});

async function ensureClerkUser(args: {
  secretKey: string;
  email: string;
  password: string;
}): Promise<string> {
  const { secretKey, email, password } = args;
  const authHeaders = { Authorization: `Bearer ${secretKey}` };

  const listUrl = new URL("https://api.clerk.com/v1/users");
  listUrl.searchParams.set("email_address", email);
  const listRes = await fetch(listUrl, { headers: authHeaders });
  if (!listRes.ok) {
    throw new Error(
      `Clerk list-users failed: ${listRes.status} ${await listRes.text()}`,
    );
  }
  const list = (await listRes.json()) as Array<{ id: string }>;
  if (list.length > 0) return list[0].id;

  // Clerk dev instance for this project requires a phone_number on signup.
  // +1 555-555-0100 is in IANA/NANP's reserved test range; Clerk dev accepts it.
  const createRes = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: [email],
      phone_number: ["+15555550100"],
      password,
      first_name: "E2E",
      last_name: "Admin",
      skip_password_checks: true,
    }),
  });
  if (!createRes.ok) {
    throw new Error(
      `Clerk create-user failed: ${createRes.status} ${await createRes.text()}`,
    );
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}
