import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // typedRoutes was tried but conflicts with Clerk's optional catch-all
  // `/sign-in/[[...sign-in]]` — Next's generated union doesn't include the
  // bare `/sign-in` path, so redirect("/sign-in") fails type checking.
  // Not worth working around for the type-safety gain.
};

const sentryEnabled = !!process.env.SENTRY_DSN;

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
      disableLogger: true,
      automaticVercelMonitors: true,
    })
  : nextConfig;
