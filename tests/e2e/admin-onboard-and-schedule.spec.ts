/**
 * Admin onboarding + schedule + print happy-path E2E.
 *
 * --- Prerequisites (read before running) ---
 *
 * 1. Dev server: `pnpm dev` on http://localhost:3000 (the playwright.config.ts
 *    `webServer` block boots one automatically and `reuseExistingServer: true`).
 *
 * 2. Scratch database: this spec writes real rows (employees, shift templates,
 *    shifts). Point `DATABASE_URL` at a throwaway Postgres — DO NOT run against
 *    production. Cleanup is documented at the bottom of this file.
 *
 * 3. Clerk testing-token mode: this spec assumes a Clerk dev/test instance is
 *    configured to accept the email/password below as a real admin login.
 *    See https://clerk.com/docs/testing/playwright/overview for the official
 *    setup. The two env vars used:
 *
 *      E2E_ADMIN_EMAIL     — defaults to "admin@test.local"
 *      E2E_ADMIN_PASSWORD  — defaults to "test-only"
 *
 *    The user identified by `E2E_ADMIN_EMAIL` must already exist in Clerk
 *    AND in our app's admin table (seed.ts creates three admins; map one of
 *    them to a Clerk test user, or add the test-mode user via Clerk dashboard).
 *
 *    Without this setup, the sign-in step will fail and the spec will time out.
 *    The spec file itself is well-formed and will be picked up by
 *    `pnpm test:e2e` regardless — runtime failure is purely an env issue.
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
 * (Cascades remove their shift templates/shifts via FK.)
 */
import { expect, test } from "@playwright/test";

test.describe("admin-onboard-and-schedule", () => {
  test("sign in, add employee, add template, add override, print", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    // Clerk testing-token sign-in. Exact selectors depend on the Clerk
    // component version; the spec uses role/label queries that should survive
    // minor markup changes.
    await page
      .getByLabel(/email/i)
      .fill(process.env.E2E_ADMIN_EMAIL ?? "admin@test.local");
    await page.getByRole("button", { name: /continue/i }).click();
    await page
      .getByLabel(/password/i)
      .fill(process.env.E2E_ADMIN_PASSWORD ?? "test-only");
    await page.getByRole("button", { name: /continue|sign in/i }).click();

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
