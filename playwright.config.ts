import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  webServer: {
    command: "pnpm dev",
    // `/` returns 404 (no root route — app lives under /admin, /dashboard, etc.),
    // and Playwright's readiness probe sometimes won't reuse a server that 404s.
    // `/sign-in` is unauthenticated + always 200, so it's the safe readiness URL.
    url: "http://localhost:3000/sign-in",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "e2e",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
});
