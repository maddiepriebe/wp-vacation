# wp-vacation

Time-off and staff scheduling for a single-location preschool. ~35 employees, 3 admins, mobile PWA for staff and desktop-first admin app.

Full PRD: [`docs/PRD.md`](docs/PRD.md)
Architecture decisions: [`docs/CLAUDE.md`](docs/CLAUDE.md)
Phase tracker: [`tasks/todo.md`](tasks/todo.md)

## Tech stack

- **Framework:** Next.js 15 App Router · React 19 · TypeScript
- **Styling:** Tailwind CSS 4 · shadcn/ui (new-york, neutral)
- **Database:** Postgres on Supabase · Drizzle ORM · postgres.js driver
- **Auth:** Clerk (Email auth, invite-only)
- **Mutations:** Server Actions for in-app forms; Route Handlers under `/api` for cron / webhooks / exports
- **Hosting:** Vercel
- **Email:** Resend (Phase 5)
- **Observability:** Sentry (gated on `SENTRY_DSN`)
- **Dates:** date-fns + date-fns-tz · UTC store · America/New_York display
- **Testing:** Vitest

## Setup

1. **Install Node 22+ and pnpm 10+**
   ```sh
   nvm use            # honors .nvmrc
   corepack enable    # if pnpm isn't on PATH
   ```

2. **Install deps**
   ```sh
   pnpm install
   ```

3. **Provision external services**
   - Supabase project — get `DATABASE_URL` (pooled, port 6543) and `DIRECT_URL` (port 5432) from Project Settings → Database.
   - Clerk app — disable self-serve sign-up. Get `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`. Set up a webhook endpoint pointing at `/api/webhooks/clerk` and copy the signing secret to `CLERK_WEBHOOK_SECRET`.
   - (Optional Phase 1) Sentry project for `SENTRY_DSN`.

4. **Configure env**
   ```sh
   cp .env.example .env.local
   # fill in real values
   ```

5. **Run migrations**
   ```sh
   pnpm db:migrate
   ```

6. **Seed**
   ```sh
   pnpm db:seed
   ```
   Creates 9 classes, 3 admins, 5 sample employees, 9 sample 2026 holidays, default settings row.

7. **Run**
   ```sh
   pnpm dev
   ```

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | Next dev server (turbopack) |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `pnpm test:run` | Vitest watch / run-once |
| `pnpm db:generate` | Generate a migration from schema diff |
| `pnpm db:migrate` | Apply migrations to the database |
| `pnpm db:push` | Push schema directly (dev only) |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:seed` | Run the seed script |

## Auth flow

- Self-serve sign-up is **disabled** in Clerk.
- Admins are seeded; they sign in with the email already in the `admin` table.
- Employees are invited via Clerk; their `email` matches a pre-seeded `employee` row.
- The Clerk webhook (`/api/webhooks/clerk`) listens for `user.created` / `user.updated` and writes `clerk_user_id` onto the matching row. Unmatched emails are logged and rejected.
- `getCurrentUser()` in `src/lib/auth.ts` resolves the Clerk session to either an Admin or Employee row and is the canonical authorization helper.

## Adding shadcn components

Components are added on demand:

```sh
pnpm dlx shadcn@latest add button card dialog sheet table input label badge progress separator dropdown-menu sonner skeleton
```

## Conventions

- All timestamps are stored in UTC (`timestamptz`); render with `formatInAppTz` from `src/lib/time.ts`.
- Mutations are Server Actions unless they need to be called from outside the app.
- Server-side authorization runs in every Server Action and Route Handler via `requireEmployee` / `requireAdmin`. There is no Supabase RLS — see `docs/CLAUDE.md`.

## Phase status

Phase 1 — Foundations.
