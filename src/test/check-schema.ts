import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

function highestMigrationFile(): string {
  const dir = join(process.cwd(), "src/db/migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error("No migration files found under src/db/migrations/");
  }
  return files[files.length - 1].replace(/\.sql$/, "");
}

async function highestAppliedMigration(): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL not set");
  }
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    // Drizzle's migration table is at `drizzle.__drizzle_migrations` by default.
    const rows = await client<{ hash: string; created_at: string }[]>`
      SELECT hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].hash;
  } finally {
    await client.end();
  }
}

export default async function checkSchema(): Promise<void> {
  const expected = highestMigrationFile();
  const applied = await highestAppliedMigration();
  if (applied === null) {
    throw new Error(
      "Test DB has no applied migrations. Run `pnpm db:migrate` and retry.",
    );
  }
  // Drizzle's "hash" is a content hash, not the file name. We can't compare
  // file names directly. Instead compare counts: number of rows in
  // __drizzle_migrations should equal number of .sql files. This is a coarse
  // check that catches the "DB is N behind" case without parsing snapshots.
  // `expected` is kept for context in any future failure message.
  void expected;
  const url = process.env.DATABASE_URL!;
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    const [{ count }] = await client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    const fileCount = readdirSync(
      join(process.cwd(), "src/db/migrations"),
    ).filter((f) => /^\d{4}_.*\.sql$/.test(f)).length;
    if (count !== fileCount) {
      throw new Error(
        `DB has ${count} applied migrations but ${fileCount} migration files exist. Run \`pnpm db:migrate\`.`,
      );
    }
  } finally {
    await client.end();
  }
}
