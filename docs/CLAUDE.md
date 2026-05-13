## Project Context
This is a time-off and scheduling system for a preschool/daycare.
Full PRD lives at `docs/PRD.md`. Read it before starting any new feature.
Currently building: **Phase 1 (Foundations).**

## Architecture Decisions

Deliberate choices, recorded so they read as decisions, not oversights.

### Authorization: no Supabase RLS
Single-tenant app, ~38 users. RLS adds Clerk-JWT → Supabase-auth bridging complexity for no security benefit at this scale. Authorization is enforced **server-side in Server Actions and Route Handlers** via Clerk role lookup. Postgres is accessed via service-role connection only.

### Mutations: Server Actions, not Route Handlers
In-app form mutations are Server Actions. Route Handlers under `/api` are reserved for **external/public surface only**: Clerk webhooks, Vercel cron jobs, CSV exports, anything called from outside the app. The PRD §7 list is mostly descriptive, not prescriptive — many of those operations are implemented as Server Actions in v1.

### Timezones: UTC store, ET display, ET cron
- All timestamps stored in **UTC** (Postgres `timestamptz`).
- UI renders in **America/New_York** via `date-fns-tz`.
- Cron jobs (anniversary reset, Monday digest, day-before reminder) run on ET wall-clock times.
- Never store local time. Never display UTC.

### Schedule: two tables, no `is_template` flag
PRD §4.5 conflated template and instance shifts. Split into:
- `schedule_shift_template` — recurring weekly. Columns: `class_id`, `employee_id`, `day_of_week` (0=Mon…4=Fri), `start_time` (time), `end_time` (time), `effective_from`, `effective_until`.
- `schedule_shift` — concrete instance. Columns: `class_id`, `employee_id`, `date`, `start_time` (time), `end_time` (time), `source_template_id` (nullable fk).

A week's schedule = templates resolved for that week, minus any concrete shifts that override the same `(employee, date)`.

### Admin lifecycle: hard-coded seed only in v1
Three admins are created by the seed script. No add-admin UI in v1.

### Routing: cast Clerk catch-all paths to `Route`
`next.config.ts` enables `typedRoutes: true`. Clerk's auth pages live at `/sign-in/[[...sign-in]]/page.tsx` and `/sign-up/[[...sign-up]]/page.tsx`. The optional catch-all means the bare paths `/sign-in` and `/sign-up` are valid at runtime but **not** emitted in the generated `Route` union. Anywhere you redirect or link to those paths, cast the literal — otherwise the build fails type-checking:

```ts
import type { Route } from "next";
redirect("/sign-in" as Route);
<Link href={"/sign-up" as Route}>Create account</Link>
```

Static routes (`/admin`, `/dashboard`, etc.) don't need the cast. Clerk's own props like `<UserButton afterSignOutUrl="/sign-in" />` take plain `string` and also don't need the cast.

### v1 behavior pinned (resolves PRD open questions)
- **Personal/sick:** 4 days at 90 days + 5 more at 6 months → 9 days/year flat. No tenure growth.
- **Vacation under 6 months:** 0 hours.
- **Holiday inside vacation, 90-day ineligible window:** ineligible employee burns vacation on that day.
- **Withdraw approved request:** server blocks if any day in the range is in the past. No completion cron.
- **Sick day past-date logging:** allowed, capped at 30 days back.
- **Bulk-upload `current_*_hours_remaining`:** writes `BalanceTransaction` with `source = 'initial_import'`. Anniversary cron takes over after that.
- **Spreadsheet onboarding with unknown `default_class`:** block. Don't auto-create classes — `age_group`/`ratio`/`max_group_size` need real values.



## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes -- don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -- then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to tasks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to tasks/todo.md
6. **Capture Lessons**: Update tasks/lessons.md after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.