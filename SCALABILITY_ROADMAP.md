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
| Backend | 1. Module boundaries | Superseded — merged into Phase 2 |
| Backend | 2. Service/repository layer | Not started (now includes former Phase 1's goal) |
| Backend | 3. Observability | Code complete — needs Simeon's manual Sentry DSN setup + a PR |
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
**Status: Superseded — merged into Phase 2 (see 2026-09-22 note)**

Original plan: reorganize `netlify/functions/*` into domain folders
(expenses, budgets, accounts, auth). **Confirmed not viable as originally
scoped**: Netlify only treats a subdirectory as a function when its entry
file is named `index` or matches the subdirectory name exactly (one
function per directory — e.g. `functions/login/login.js`, not
`functions/auth/login.js` grouped with other auth functions). Verified via
Netlify's own docs on 2026-09-22, not just inferred — a naive multi-function
subfolder move would have silently broken deployed routes.

**Revised approach**: domain boundaries are expressed as shared
repository/service modules (e.g. `netlify/functions/lib/transactions-repo.js`)
imported by the existing flat, top-level handler files — same clarity goal,
zero routing risk, and it's the same work Phase 2 needed anyway. Phase 1 is
retired as a separate phase; its goal is now folded into Phase 2 below.

- [x] Confirm Netlify subfolder routing behavior — confirmed not usable for
      multi-function domain grouping (2026-09-22)
- [x] Decide revised approach — merge into Phase 2 (repository modules,
      not directory moves)

### Phase 2 — Service/repository layer
**Status: Not started** (absorbs former Phase 1's goal — see above)

Extract each domain's Supabase queries into a repository module under
`netlify/functions/lib/` (e.g. `lib/transactions-repo.js`,
`lib/accounts-repo.js`, `lib/categories-repo.js`), leaving the existing
top-level handler files (`transactions.js`, `accounts.js`, etc. — unchanged
locations/names, so routing is untouched) to do auth/validation/response
shaping and call the repository. Highest regression risk of the backend
phases — do not start until handler tests cover current behavior.

- [ ] Confirm handler test coverage per domain before touching code
      (transactions.test.js, accounts.test.js, login.test.js, lib.test.js
      already exist — check categories/signup/refresh/logout/me coverage)
- [ ] Extract one domain's repository module at a time, verify tests after
      each (start with transactions.js — largest, most logic)
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
- [x] Wire `withLogging` into the remaining 8 functions (login, logout, me,
      refresh, signup, categories, accounts, transactions) — all 93 tests
      pass unchanged, confirming the wrapper is transparent to existing
      handler behavior.
- [x] Wire an error-tracking service — Simeon chose Sentry. Added
      `@sentry/node` (prod dependency, 0 vulnerabilities per
      `npm audit --omit=dev`, `npm ci` verified fresh-clone-safe).
      `reportError()` in `_lib.js` is gated entirely by `SENTRY_DSN` (unset
      in dev/CI, so the test suite never contacts Sentry) and only ever
      attaches `fn`/`requestId`/`method` — never raw request bodies — to
      respect the app's no-third-party-data-leak posture. Best-effort:
      Sentry failures are caught and logged, never affect the response
      already sent. 3 new tests using the same require.cache stub pattern
      as the Supabase stubs. Documented in README's env var table.
- [ ] **Manual checklist item for Simeon**: create a Sentry account/project,
      add `SENTRY_DSN` to Netlify env vars (not committed anywhere —
      Netlify env only, per README).
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
