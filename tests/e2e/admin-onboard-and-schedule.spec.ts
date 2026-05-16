/**
 * Admin onboarding + schedule + print happy-path E2E.
 *
 * --- Prerequisites (read before running) ---
 *
 * 1. Dev server: `pnpm dev` on http://localhost:3000 (the playwright.config.ts
 *    `webServer` block boots one automatically and `reuseExistingServer: true`).
 *
 * 2. Database: this spec and its global setup write real rows (employees,
 *    shift templates, shifts, plus one admin row). Point `DATABASE_URL` at a
 *    dev/scratch Postgres — DO NOT run against production. Cleanup is
 *    documented at the bottom of this file.
 *
 * 3. Clerk testing-token mode: `tests/e2e/global.setup.ts` runs first and:
 *      - calls `clerkSetup()` against the project's Clerk dev instance
 *        (requires `pk_test_*` / `sk_test_*` — refuses live keys)
 *      - idempotently creates a Clerk user with the email/password below
 *      - idempotently inserts a matching admin row (`admin_role = 'owner'`)
 *    Each test then calls `setupClerkTestingToken({ page })` to bypass
 *    Clerk's bot detection.
 *
 *    Env vars (all optional — defaults are wired):
 *      E2E_ADMIN_EMAIL     — default "admin+clerk_test@example.com"
 *      E2E_ADMIN_PASSWORD  — default "E2E-Admin-Test-Pwd-1!"
 *
 *    Set explicit values in `.env.local` if you want different credentials;
 *    do NOT commit them.
 *
 * --- How to run ---
 *
 *   pnpm test:e2e --reporter=line
 *   pnpm test:e2e:ui   # interactive
 *
 * --- Cleanup ---
 *
 * The spec creates employees with email pattern `e2e-<timestamp>@example.com`.
 * To wipe between runs:
 *
 *   DELETE FROM employees WHERE email LIKE 'e2e-%@example.com';
 *
 * (Cascades remove their shift templates/shifts via FK.) The single admin row
 * created by global.setup.ts is idempotent and can be left in place.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

const ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ?? "admin+clerk_test@example.com";
const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "E2E-Admin-Test-Pwd-1!";

test.describe("admin-onboard-and-schedule", () => {
  test("sign in, add employee, add template, add override, print", async ({
    page,
  }) => {
    await setupClerkTestingToken({ page });

    await page.goto("/sign-in");
    // Clerk's sign-in component renders social-provider buttons whose accessible
    // names contain "Continue" (e.g. "Sign in with Google Continue"). Use the
    // exact "Continue" label so we hit the form-submit button only.
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // "password" matches both the input AND a "Show password" toggle button —
    // pin to the textbox role.
    await page
      .getByRole("textbox", { name: /password/i })
      .fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.waitForURL(/\/admin/);

    // Add an employee.
    const timestamp = Date.now();
    await page.goto("/admin/employees/new");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/last name/i).fill(`User-${timestamp}`);
    await page.getByLabel(/email/i).fill(`e2e-${timestamp}@example.com`);
    // Additional required fields (role_in_class, default_class, etc.) per
    // Plan 2's createEmployee form — fill as needed for the form to validate.
    await page.getByRole("button", { name: /save/i }).click();
    await page.waitForURL(/\/admin\/employees/);

    // Land on the first class's schedule.
    await page.goto("/admin/classes");
    await page.getByRole("link", { name: /.+/ }).first().click();
    await page.waitForURL(/\/schedule/);

    // Add a template (template mode).
    await page.getByRole("button", { name: /template/i }).click();
    await page.locator("text=+ add").first().click();
    await page.getByLabel(/start/i).fill("08:00");
    await page.getByLabel(/end/i).fill("12:00");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.locator("text=08:00–12:00")).toBeVisible();

    // Switch back to week mode; click the template-derived shift and override it.
    await page.getByRole("button", { name: /week/i }).click();
    await page.locator("text=08:00–12:00").first().click();
    await page.getByLabel(/start/i).fill("09:00");
    await page.getByLabel(/end/i).fill("11:00");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.locator("text=09:00–11:00")).toBeVisible();

    // Visit the print view (opens in a new tab via target="_blank").
    const [printPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("link", { name: /print/i }).click(),
    ]);
    await printPage.waitForLoadState();
    await expect(
      printPage.getByRole("button", { name: /^print$/i }),
    ).toBeVisible();
    await expect(printPage.locator("text=09:00–11:00")).toBeVisible();
  });
});
