import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

const SKIP = process.env.SKIP_ENV_VALIDATION === "1";

function parseServer(): ServerEnv {
  if (SKIP) return process.env as unknown as ServerEnv;
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      "Invalid server environment variables:",
      result.error.flatten().fieldErrors,
    );
    throw new Error("Invalid server environment variables");
  }
  return result.data;
}

function parseClient(): ClientEnv {
  const raw = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };
  if (SKIP) return raw as unknown as ClientEnv;
  const result = clientSchema.safeParse(raw);
  if (!result.success) {
    console.error(
      "Invalid client environment variables:",
      result.error.flatten().fieldErrors,
    );
    throw new Error("Invalid client environment variables");
  }
  return result.data;
}

export const env = {
  ...(typeof window === "undefined" ? parseServer() : ({} as ServerEnv)),
  ...parseClient(),
};
