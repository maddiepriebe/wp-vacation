# Handoff — Phase 2 Design Brainstorm

**Date paused:** 2026-05-13
**Project phase:** Phase 1 (Foundations) scaffold complete; Phase 2 (Setup & Schedule) in design.

---

## Where we are in the design process

Brainstorming flow (`superpowers:brainstorming`). Sections 1–2 of the design doc are approved and written. Section 3 is next.

| # | Step | State |
|---|---|---|
| 1 | Explore project context | done |
| 2 | Ask clarifying questions | done |
| 3 | Propose approach (A/B/C) — Approach A picked | done |
| 4 | Present design sections, approve per section | **in progress — through Section 2** |
| 5 | Write design doc to `docs/superpowers/specs/` | partial — Sections 1–2 written |
| 6 | Self-review spec | pending |
| 7 | User reviews written spec | pending |
| 8 | Transition to `superpowers:writing-plans` | pending |

**Spec location:** `docs/superpowers/specs/phase-2-design.md` (not the date-prefixed default — user requested this name).

**Sections remaining to draft:**

- Section 3 — **Onboarding pipeline** (manual add Server Action, bulk upload pipeline, initial balance writes, admin-triggered Clerk invite). *Next up.*
- Section 4 — Schedule resolver (`resolveWeek`) and the grid render path.
- Section 5 — Shift mutation Server Actions (create / update / delete) implementing the four overlap rules and the template closure rule.
- Section 6 — Save-as-template, copy-week, enrollment forecast, print view.
- Section 7 — Error handling, validation, testing strategy (transactional rollback).

---

## Decisions made this session (all captured in the spec)

Captured in the spec's "Decisions that override or extend prior docs" section plus Sections 1–2. Listed here for resume-readability:

**Architecture / approach:**

1. **Approach A** — schedule resolution is a server-side `resolveWeek(classId, weekStart)` async function. No DB views, no pre-materialization.
2. **Resolver caching** — wrapped in `React.cache()`. No `unstable_cache`.
3. **Resolver shape** — plain async function (no `'use server'`). Imported from Server Components and Server Actions alike.
4. **Schedule grid server/client split** — page is a Server Component; calls `resolveWeek()`; passes `ResolvedShift[]` to client tree. Mutations via Server Actions.

**Schema (migration #2):**

5. **Tables added now:** `enrollment_forecast`, `time_off_request`, `time_off_request_day`. The time-off tables ship empty in Phase 2; Phase 3 wires writes.
6. **`schedule_shift_template.effective_from` tightened to NOT NULL.** Table is empty in Phase 1 seed, safe ALTER.
7. **CHECK constraints** added at table-creation time for time-off model invariants (bereavement-iff-relation, decision-iff-decided, partial-day-needs-range).
8. **Indexes added** ahead of Phase 2 workload: `schedule_shift_template(class_id, effective_from)`, `schedule_shift(class_id, date)`, `schedule_shift(employee_id, date)`.

**Onboarding behavior:**

9. **Sheet parsing:** SheetJS, accepts XLSX and CSV.
10. **Unknown `default_class` on bulk upload = blocking row error** (overrides PRD §6.2 "create new class" prompt; already noted in `docs/CLAUDE.md`).
11. **Upload preview state** lives client-side in `sessionStorage`, keyed by upload session id. No server-side draft table.
12. **Initial balance import** writes `balance_transaction(source='initial_import')` rows *and* sets denormalized `employee.*_hours_balance`. Live balance = SUM of transactions (Phase 3 maintains it from there).
13. **Clerk invite is admin-triggered**, not auto on create. `sendInviteAction` requires an existing row with `clerk_user_id IS NULL`; fails fast otherwise.
14. **`src/lib/clerk-invite.ts` is kept** as a thin wrapper that normalizes Clerk error shapes and centralizes the redirect URL + email template config.

**Scheduling behavior:**

15. **Shift editing UX = hybrid:** click-to-create / click-to-edit modal at 15-min granularity; drag-to-move on existing shifts; resize via modal (no resize handles).
16. **Overlap rules (four):**
    - (a) Same employee, two classes, overlapping times → block.
    - (b) Same time slot, same class, two employees → allow.
    - (c) Same employee, same class, overlapping templates with different times → block.
    - (d) Same employee, same class, same time (duplicate) → block.
17. **`detectShiftConflicts` is pure** (no DB). Server Actions fetch the relevant week's resolved shifts and pass them in.
18. **Delete semantics:** templates are the only place to remove a recurring shift. Week mode can edit (writes a `schedule_shift` override) but not delete a template-derived slot. `deleteShiftAction` only operates on existing `schedule_shift` rows; deleting reverts to template-derived. Single-week absences are handled by time-off requests in Phase 3, not negative-space tombstones.
19. **Save-as-template UX:** confirmation dialog listing every shift in the resolved week with its source. Template-derived rows checked by default; override rows unchecked by default with a one-line label. Admin reviews before confirming.
20. **Template closure rule:** one active template per class. New save with `effective_from = weekStart` sets `effective_until = weekStart - 1` on every other open template for that class. Enforced in the Server Action, not at the DB layer.
21. **Approved-leave overlay on the grid is deferred to Phase 3** (tables exist now; render hook wired later).

**Layout / conventions:**

22. **`src/lib/dates.ts` is added** — central date utilities (`weekStart`, `weekEnd`, `toEtDate`, `fromEtDate`, `isSameWeek`, `daysInRange`). Used by resolver, save-as-template, copy-week, and Phase 5 cron jobs.
23. **`ModeToggle`** lives at the top level of the grid view.
24. **`_components/`** underscore prefix for non-routed component directories.
25. **Test DB strategy:** transactional rollback against the dev Supabase project. Each integration test opens a Drizzle transaction, runs, asserts, rolls back. No mocks, no separate test project.

---

## Open questions raised in the handoff request but NOT decided this session

These were named in the handoff request but I want to flag clearly: they were **not** discussed or decided in this session. Surfacing as items to address next session if relevant.

### 1. Cancellation vs. withdrawal status

The spec's `time_off_status` enum currently mirrors PRD §4.6: `pending | approved | rejected | cancelled`. No `withdrawn`.

PRD §5.5 distinguishes two events:

- **Cancel** — employee drops a *pending* request before decision.
- **Withdraw** — employee revokes an *approved* request; hours return to balance.

`docs/CLAUDE.md` further specifies that withdraw is blocked if any day in the range is in the past.

**Open:** are these one terminal state (`cancelled`) with the distinction recorded elsewhere (audit log, `decision_at`/`decision_by` set or unset), or two terminal states (`cancelled` and `withdrawn`)? Phase 3 needs this resolved before request lifecycle logic ships. Not blocking for Phase 2 schema work, but the enum will be touched in Phase 3 either way.

### 2. Bereavement enum expansion

`bereavement_relation` enum in the spec uses the PRD §4.6 list: `parent | sibling | spouse | child | grandparent`. The handoff request implied this should be expanded but no expansion was discussed. Common candidates would be `step-parent`, `step-sibling`, `domestic_partner`, `in-law`, `aunt_uncle`, `other`. **Decide before Phase 3.**

### 3. Other items not yet addressed in any spec section

- **Audit log writes from Phase 2 actions** — schema is in place; what events get logged (employee create, balance import row, shift edits, save-as-template, copy-week, invite sent) and what payload shape?
- **Server Action error envelope** — Section 1 references an `ActionError` type used by `clerk-invite.ts`. The shape isn't yet defined. Will come up in Section 7 (error handling).
- **Holiday rendering on the schedule grid** — PRD §5.4 says holidays render as closed days. Not yet specified in spec.
- **Print view styling specifics** — Section 1 mentions the route but not what fits on one page or what gets dropped.

---

## Current task-list state (TaskList tool, in-session)

```
#1 [completed] Explore project context (PRD, CLAUDE.md, Phase 1 state)
#2 [completed] Ask clarifying questions about Phase 2 scope
#3 [completed] Propose 2-3 implementation approaches with tradeoffs
#4 [in_progress] Present design sections, get user approval per section
#5 [pending]    Write design doc to docs/superpowers/specs/
#6 [pending]    Self-review spec for placeholders/contradictions/scope/ambiguity
#7 [pending]    User reviews written spec
#8 [pending]    Transition to writing-plans skill for implementation plan
```

Task #5 is technically partial: Sections 1–2 are written, Sections 3–7 remain. Treat #5 as "in progress when resumed."

---

## Local repo state

**Branch:** `main` (up to date with `origin/main`).

**Staged but uncommitted:**

```
new file:   docs/superpowers/specs/phase-2-design.md   (+214 lines)
```

**Unstaged / untracked:**

`docs/handoff.md` will be added when this file is written. Not yet committed.

**Phase 1 commit state:** the only commit on `main` is `7bf19d9 Phase 1 foundations: scaffold, schema, auth, shells`.

**Recommendation when resuming:** decide whether to commit the partial spec + handoff as a single "Phase 2 design WIP" commit before continuing, or leave staged and amend at end of brainstorm. The user has not authorized either; ask first.

---

## Resume prompt

Paste this verbatim to pick up where we left off:

> Resuming the Phase 2 design brainstorm for wp-vacation. The current spec is at `docs/superpowers/specs/phase-2-design.md` (Sections 1–2 approved). Handoff context is at `docs/handoff.md` — read it first.
>
> Next step: draft Section 3 (onboarding pipeline) of the spec. Cover: (a) manual "Add Employee" Server Action and the form fields/validation; (b) bulk upload pipeline — SheetJS parser, validator, preview state in sessionStorage, commit Server Action; (c) initial balance writes — `balance_transaction(source='initial_import')` rows plus denormalized `employee.*_hours_balance`; (d) admin-triggered `sendInviteAction` with the `clerk_user_id IS NULL` precondition and the `src/lib/clerk-invite.ts` wrapper.
>
> Present Section 3 in the chat for approval before writing it into the spec file. Don't draft Sections 4–7 yet.

---

## Useful reference paths

- Spec (in progress): `docs/superpowers/specs/phase-2-design.md`
- This handoff: `docs/handoff.md`
- Phase 2 scope source: `docs/PRD.md` §10 (Phase 2), §6.2 (admin pages), §4 (data models)
- Architecture decisions: `docs/CLAUDE.md`
- Phase 1 status: `tasks/todo.md`
- Lessons file (still empty): `tasks/lessons.md`
- Existing Phase 1 schema: `src/db/schema/*` (10 tables)
- Existing migration: `drizzle/0000_secret_white_tiger.sql`
