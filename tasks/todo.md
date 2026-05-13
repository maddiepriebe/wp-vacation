# Phase 1 — Foundations

**Status:** scaffold complete; smoke test blocked on Supabase + Clerk keys.

---

## Pre-flight
- [x] PRD reviewed
- [x] Architecture decisions captured in `docs/CLAUDE.md`
- [ ] Supabase project — waiting on `DATABASE_URL` + `DIRECT_URL`
- [ ] Clerk app — waiting on publishable + secret keys + webhook secret
- [ ] GitHub repo — waiting on URL

## 1. Repo + tooling
- [x] `.gitignore`, `.nvmrc` (22)
- [x] `package.json` with pinned deps + `pnpm.onlyBuiltDependencies`
- [x] `tsconfig.json`
- [x] `pnpm install` + postinstall scripts approved
- [x] `git init` (not yet committed — awaiting user signoff)

## 2. Next.js + Tailwind + shadcn
- [x] `next.config.ts` (Sentry-wrapped only when DSN set)
- [x] `postcss.config.mjs` (Tailwind 4)
- [x] `src/app/globals.css` with shadcn neutral palette + `@theme inline`
- [x] `components.json` (shadcn, neutral, new-york, RSC)
- [ ] shadcn add: button/card/etc. — deferred to Phase 2 (Phase 1 stubs use plain Tailwind)

## 3. Env validation
- [x] `src/lib/env.ts` (zod, server + client schemas, `SKIP_ENV_VALIDATION` escape hatch)
- [x] `.env.example` documenting every key

## 4. Drizzle + schema
- [x] `drizzle.config.ts`
- [x] `src/db/client.ts` (postgres.js, dev-mode singleton)
- [x] All 10 schema tables:
  - employee (incl. `last_low_balance_notified_at`)
  - admin
  - class
  - holiday
  - settings (singleton CHECK)
  - notification
  - balance_transaction
  - audit_log
  - schedule_shift_template
  - schedule_shift
- [x] `src/db/schema/index.ts` re-exports
- [x] `pnpm db:generate` → `0000_secret_white_tiger.sql`
- [ ] `pnpm db:migrate` against Supabase **(blocked on DATABASE_URL)**

## 5. Seed
- [x] `src/db/seed.ts`: 3 admins, 9 classes, 5 employees, 9 sample 2026 holidays, default settings
- [ ] Run seed **(blocked on DATABASE_URL)**

## 6. Clerk auth
- [x] `ClerkProvider` in `src/app/layout.tsx`
- [x] `middleware.ts` — `clerkMiddleware` + public-route matcher
- [x] `src/app/sign-in/[[...sign-in]]/page.tsx`
- [x] `src/app/sign-up/[[...sign-up]]/page.tsx`
- [x] `src/app/api/webhooks/clerk/route.ts` — svix-verified, links `clerk_user_id`
- [ ] Webhook smoke test via ngrok **(blocked on Clerk keys)**

## 7. Auth helpers + /api/me
- [x] `src/lib/auth.ts` — `getCurrentUser`, `requireEmployee`, `requireAdmin`, `requireAdminApi`
- [x] `src/app/api/me/route.ts`

## 8. Role-aware routing
- [x] `src/app/page.tsx` redirects employee → `/dashboard`, admin → `/admin`

## 9. Admin shell (desktop-first)
- [x] `(admin)/layout.tsx` with sidebar + UserButton
- [x] `admin/page.tsx` — KPI placeholders
- [x] `admin/employees/page.tsx` — live list from DB
- [x] `admin/classes/page.tsx` — live list from DB
- [x] `admin/holidays/page.tsx` — live list from DB
- [x] `admin/settings/page.tsx` — live read of singleton

## 10. Employee shell (mobile-first PWA)
- [x] `(employee)/layout.tsx` — bottom nav + UserButton
- [x] `(employee)/dashboard/page.tsx` — mocked balance bars, structure of upcoming/pending
- [x] `(employee)/schedule/page.tsx` (stub)
- [x] `(employee)/notifications/page.tsx` (stub)

## 11. PWA shell (manifest + no-op SW)
- [x] `public/manifest.webmanifest`
- [x] `public/sw.js` (no-op)
- [x] `src/components/pwa/service-worker-registrar.tsx` (production-only)
- [x] manifest + apple-touch link in root layout
- [ ] Real PNG icons — placeholder README in `public/icons/` flagging this

## 12. Sentry stubs
- [x] `@sentry/nextjs` installed
- [x] `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` (all gated on DSN)
- [x] `instrumentation.ts` registers config + exports `onRequestError`
- [x] `next.config.ts` wraps with `withSentryConfig` only when DSN set
- [x] `SENTRY_DSN` documented as optional in `.env.example`

## 13. Vitest
- [x] `vitest.config.ts`
- [x] `src/lib/__tests__/time.test.ts` smoke test (passes 2/2)

## 14. README
- [x] Setup, env, migration, seed, run instructions

## 15. Smoke test **(blocked on keys)**
End-to-end walk, in this order:
- [ ] `pnpm db:migrate` against Supabase
- [ ] **Empty-DB render check (after migrate, before seed):** start `pnpm dev`, manually hit `/admin`, `/admin/employees`, `/admin/classes`, `/admin/holidays`, `/admin/settings`. All five must render with explicit empty-state copy (no thrown errors, no silent blank tables). Verifies the DB-read pages are defensive.
- [ ] `pnpm db:seed`
- [ ] Sign in as seeded admin → lands on `/admin`, all admin pages now show real rows
- [ ] Sign in as seeded employee → lands on `/dashboard`, mocked balance bars render
- [ ] Webhook receives `user.created` for a seeded email and links `clerk_user_id` (verify in DB)
- [ ] Webhook receives `user.created` for an **un**seeded email and:
  - returns 200 with `{ deleted: <clerkUserId> }`
  - the Clerk user is gone from the Clerk dashboard
  - no orphan rows in DB

---

## Before deploy
- [ ] Replace placeholder icons in `public/icons/` — `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.ico`. Without these the install prompt works but renders a broken icon to real users.
- [ ] All Phase 1 keys mirrored to Vercel env (Production + Preview)
- [ ] Clerk production instance configured (separate from dev) with sign-up disabled
- [ ] Clerk webhook endpoint pointed at the Vercel deploy URL, not localhost/ngrok
- [ ] Real `SENTRY_DSN` set if observability is wanted in prod

---

## Verification ran
- [x] `pnpm typecheck` — clean
- [x] `pnpm test:run` — 2/2 passing
- [x] `pnpm db:generate` — 10 tables, 8 FKs, singleton CHECK, all uniques

## Review

**What shipped without keys.** Full Phase 1 scaffold: 10-table schema with first migration, role-aware Clerk auth wiring, Server Action / Route Handler split as documented, admin & employee shells (admin pages do live DB reads; employee dashboard uses mocked balance bars per PRD §10), Sentry & PWA plumbing both gated so they're no-ops in dev. Typecheck and the one Vitest smoke test pass.

**Architectural decisions written down** in `docs/CLAUDE.md` so they read as deliberate choices, not oversights: no Supabase RLS, mutations via Server Actions, UTC store / ET display / ET cron, schedule split into template + instance tables (no `is_template` flag), v1 admin lifecycle is seed-only, all the v1 behavior decisions you pinned (personal/sick cliff at 6 months, holiday-burn during the 90-day window, withdraw blocked once any day is in the past, sick past-date cap of 30 days, `initial_import` BalanceTransaction source for spreadsheet onboarding, block-on-unknown-class for spreadsheet imports).

**Two deviations from your stated stack worth flagging:**
1. **Tailwind 4** instead of unspecified Tailwind version — shadcn's current setup uses Tailwind 4 (CSS-first config, no `tailwind.config.ts`). Easy to revert if you'd rather pin Tailwind 3.
2. **Node 22** in `.nvmrc` instead of Node 20 — your local Node 24 satisfies it; Node 22 is the right LTS to pin in mid-2026 (active LTS through Oct 2026, then maintenance through Apr 2027). `engines.node` is `>=20`, so anything 20+ runs.

**What's blocked on you.** Migration apply, seed run, and the end-to-end smoke test all need `DATABASE_URL` + Clerk keys. Webhook test additionally needs ngrok or equivalent.

**Initial commit not made.** Repo is `git init`'d and everything staged; awaiting your signoff to commit (or to wait for a remote and commit + push together).
