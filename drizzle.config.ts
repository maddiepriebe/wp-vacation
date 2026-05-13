import { defineConfig } from "drizzle-kit";

// `generate` doesn't need a connection; only `migrate`/`push`/`studio` do.
// We let the URL fall back to empty so generate works offline, and drizzle-kit
// itself surfaces a clearer error if a connection is actually needed.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
