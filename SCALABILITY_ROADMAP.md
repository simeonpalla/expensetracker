# Scalability Roadmap — Progress Tracker

Living document. Update this whenever a step starts, finishes, or changes —
this is the durable record of the modular-monolith backend migration and the
React/TypeScript frontend migration, kept in git so nothing is lost between
sessions or to a crash. See also `production-hardening-plan` in project
memory for the earlier 5-phase hardening work this builds on.

Last updated: 2026-09-22 (structured logging landed, see Phase 3 below)

## Goal

Prepare Personal OS for real growth (more usage, not just cleanup at the same
scale): a modular-monolith backend + a React/TypeScript frontend, migrated
incrementally without breaking the live app. Decided 2026-09-22.

## Status at a glance

| Track | Phase | Status |
|---|---|---|
| Backend | 1. Module boundaries | Not started |
| Backend | 2. Service/repository layer | Not started |
| Backend | 3. Observability | In progress — logging infra landed, error tracking + rollout remain |
| Backend | 4. Data-layer scaling readiness | Not started |
| Backend | 5. Staging environment | Not started |
| Frontend | React + TS scaffolding | Not started |
| Frontend | Page port: Dashboard | Not started |
| Frontend | Page port: Budgets | Not started |
| Frontend | Page port: Accounts | Not started |
| Frontend | Page port: Insights | Not started |
| Frontend | Page port: Auth/forms | Not started |

---

## Backend track — modular monolith

Order chosen by risk (each phase leaves the app fully working/testable on
its own): module boundaries → service/repository layer → observability →
data-layer readiness → staging environment.

### Phase 1 — Module boundaries
**Status: Not started**

Reorganize `netlify/functions/*` and `src/api.js` into domain folders
(expenses, budgets, accounts, auth) around the shared `_lib.js` kernel.
Behavior-preserving; existing vitest/Playwright suites verify it.

**2026-09-22 note**: nesting function files into subfolders
(`functions/auth/login.js`) is riskier than it looks — Netlify's default
bundler resolves endpoint routes from top-level files in the functions
directory, so a naive move can silently break deployed routes. Verify
Netlify's directory-as-function convention (or add explicit redirects)
*before* moving files, and test on a deploy preview before merging. Given
this, the fast win done instead this session was Phase 3 (logging), which
has no routing risk. Only 9 function files / 643 lines total exist today, so
this phase is small in scope once the routing approach is confirmed.

- [ ] Confirm Netlify subfolder routing behavior (test on a deploy preview)
- [ ] Inventory current functions and their domains
- [ ] Move functions into domain folders, update imports
- [ ] Reorganize `src/api.js` to mirror domains
- [ ] `npm run lint && npm test && npm run build` green
- [ ] PR opened, CI green, merged

### Phase 2 — Service/repository layer
**Status: Not started** (blocked on: handler tests existing first)

Split each domain's HTTP handler (auth/validation/response shaping) from its
Supabase queries (repository module). Highest regression risk of the 5
backend phases — do not start until handler tests cover current behavior.

- [ ] Confirm handler test coverage per domain before touching code
- [ ] Split one domain at a time, verify tests after each
- [ ] PR(s) opened, CI green, merged

### Phase 3 — Observability
**Status: In progress**

Structured logging (request ID, user ID, duration, status) via `_lib.js`,
plus error tracking (e.g. Sentry) so production failures surface without
manual noticing. Cheap, high payoff — pulled forward as the first
implementation step (2026-09-22) since Phase 1 turned out to have a routing
risk worth de-risking first (see note above).

- [x] Add request-ID + structured log fields to `_lib.js` — `requestId()` +
      `withLogging(name, handler)`, one JSON line per request via
      console.log/error (fn, requestId, method, statusCode, durationMs;
      errors logged with stack and rethrown so behavior is unchanged).
      Tests in `tests/functions/lib.test.js`. Landed on branch
      `chore/scalability-roadmap-tracking`, not yet merged.
- [x] Proof-of-concept wiring: `health.js` wrapped with `withLogging`
- [ ] Wire `withLogging` into the remaining 8 functions (login, logout, me,
      refresh, signup, categories, accounts, transactions)
- [ ] Wire an error-tracking service (decide: Sentry vs alternative)
- [ ] Manual checklist item: add DSN/secret to Netlify env
- [ ] PR opened, CI green, merged

### Phase 4 — Data-layer scaling readiness
**Status: Not started**

- [ ] Review query patterns (cycle date ranges, category filters) for
      missing indexes
- [ ] Add pagination to list endpoints that currently return everything
- [ ] Verify Supabase connection pooler mode (transaction vs session) is
      correct for serverless functions — manual check in Supabase dashboard
- [ ] PR opened (code changes), CI green, merged

### Phase 5 — Staging environment
**Status: Not started**

- [ ] Create second Supabase project mirroring schema/RLS
- [ ] Wire to a Netlify branch/preview deploy
- [ ] Document migration workflow: staging first, then prod
- [ ] Manual verification, no PR needed (infra only)

---

## Frontend track — React + TypeScript migration

Fully separate from the backend track (disjoint files) — can interleave
freely. Page-by-page, each its own branch/PR, vanilla JS and React coexist
during the transition. TypeScript adopted from the start, not deferred.

`src/main.js` (1774 lines) is the real migration effort — `src/engine/*`,
CSS tokens, CSP, and the PWA setup carry over largely unchanged.

### Scaffolding
**Status: Not started**

- [ ] Add React + TypeScript to the Vite build
- [ ] Decide TS strictness/config, confirm vitest + Playwright still run
- [ ] Confirm CSP (`script-src 'self'`) unaffected by React build output
- [ ] One trivial React component rendered live as a smoke test

### Page ports
Each ported page: own branch/PR, Playwright passing (including axe-core
a11y gate — must not regress WCAG AA), reviewed against the vanilla version
before merge.

- [ ] Dashboard — highest value, highest complexity (projections, charts)
- [ ] Budgets
- [ ] Accounts
- [ ] Insights
- [ ] Auth/forms

---

## How to use this file

- Check a box and update the phase's Status line the moment work starts or
  lands — don't batch it at the end of a session.
- Add a dated note under a phase if a decision deviates from the plan
  (e.g. "2026-10-01: skipped pagination on accounts list, dataset too small
  to matter").
- This file is the source of truth for *what's left*; project memory
  (`scalability_roadmap.md`) holds the *why* behind the original decisions.
