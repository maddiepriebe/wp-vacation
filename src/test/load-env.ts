import { config } from "dotenv";

// Vitest does not auto-load `.env.local`. Load it before any other globalSetup
// runs so DATABASE_URL (and friends) are available for schema checks and tests.
export default function loadEnv(): void {
  config({ path: ".env.local" });
}
