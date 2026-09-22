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
| Backend | 2. Service/repository layer | Core CRUD domains done (transactions, accounts, categories); auth domain deprioritized |
| Backend | 3. Observability | Code complete — needs Simeon's manual Sentry DSN setup + a PR |
| Backend | 4. Data-layer scaling readiness | Indexes added, need Simeon to run migration; pagination needs a decision; pooler mode needs a manual check |
| Backend | 5. Staging environment | Not started |
| Frontend | React + TS scaffolding | Done — proven via test, zero prod bundle cost until first page ports |
| Frontend | Page port: Accounts | Done — proven via unit + E2E/a11y tests |
| Frontend | Page port: Insights | Not started |
| Frontend | Page port: Budgets | Not started |
| Frontend | Page port: Dashboard | Not started |
| Frontend | Page port: Auth/forms | Not started — do last, highest risk |

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

- [x] `transactions.js` → `lib/transactions-repo.js` (2026-09-22) — had
      full test coverage already; all 96 tests pass unchanged, same
      Supabase call chain/args preserved
- [x] `accounts.js` → `lib/accounts-repo.js` (2026-09-22) — same pattern,
      same result
- [x] `categories.js` — had no handler tests; added 11 (auth, GET scoping,
      POST validation/mass-assignment/icon default, method rejection,
      error masking), then extracted `lib/categories-repo.js` (2026-09-22)
- [ ] **Deliberately deprioritized**: auth domain (login/signup/refresh/
      logout/me) repository extraction. These wrap Supabase Auth calls
      (signInWithPassword/signUp/refreshSession/signOut), not table
      queries, so the "repository" extraction here is thinner value.
      `requireUser`/`anonClient` in `_lib.js` already serve as the shared
      auth layer — revisit if/when this actually matters.
- [x] Handler tests for `me`/`logout`/`refresh`/`signup` (2026-09-22) — 21
      new tests (129 total), closing the coverage gap independently of
      the repository-extraction question above (only `login.js` had tests
      before this). Covers method rejection, auth/token validation, rate
      limiting, cookie set/clear behavior, and the uniform-error-message
      invariant (never revealing whether an email is registered).
- [ ] Verify `netlify/functions/lib/` subfolder doesn't get misdetected as
      functions by Netlify's bundler — **not yet confirmed on a real
      deploy**, only inferred from `_lib.js`'s existing precedent (a
      non-handler top-level file that doesn't become a spurious endpoint).
      Add to Simeon's manual checklist: check a deploy preview.
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
**Status: In progress**

- [x] Review query patterns for missing indexes (2026-09-22) — every query
      in `lib/*-repo.js` filters by `user_id` (transactions also sorts by
      `transaction_date`), and none of it was indexed on the live DB.
      `supabase/migrations/0003_indexes.sql` adds all three, idempotent,
      purely additive. **Needs Simeon to run it manually** (see checklist).
- [ ] **Needs a decision before implementing**: pagination on list
      endpoints. Unlike the index migration, this changes the API
      response shape (`transactions`/`categories`/`accounts` currently
      return a full array) and requires matching frontend changes in
      `src/main.js` (or the React port, once that endpoint's page is
      ported) — not a safe drop-in change to make unilaterally on a live
      app. Also worth weighing urgency: this is a single-user app: growth
      here likely means more of Simeon's own transactions accumulating
      over years, not concurrent users, so the real question is at what
      row count this actually starts to matter (revisit with real numbers
      rather than guessing).
- [ ] Verify Supabase connection pooler mode (transaction vs session) is
      correct for serverless functions — **manual check only Simeon can
      do**, in the Supabase dashboard (Project Settings → Database →
      Connection pooling). Netlify Functions are ephemeral/concurrent, so
      the wrong pooler mode is a real (if currently low-probability)
      outage mode as usage grows.
- [ ] PR opened (0003_indexes.sql + docs), CI green, merged

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
**Status: Done** (2026-09-22)

- [x] Add React + TypeScript to the Vite build — react/react-dom 19,
      typescript 5.9, `@vitejs/plugin-react` pinned to 5.2.0 (latest v6
      needs Vite 8; this repo is pinned to Vite 6), typescript-eslint.
      `vite.config.js`/`vitest.config.js` renamed to `.mjs`/`.mts` — Vite's
      CJS config loader can't `require()` the ESM-only plugin-react
      package, and this repo can't flip to `"type": "module"` globally
      (would break the CJS Netlify functions).
- [x] Decide TS strictness/config — strict mode, bundler resolution,
      `react-jsx`, `tsconfig.json` at repo root, `npm run typecheck`
      script added (not yet wired into CI — follow-up decision, noted
      below). Confirmed vitest + Playwright still run (108 tests, 11 E2E).
- [x] Confirm CSP (`script-src 'self'`) unaffected — self-hosted via Vite,
      no CDN, same as the existing Chart.js/fonts pattern.
- [x] Toolchain proof — **not** a live production mount. First attempt
      mounted a no-op `SmokeTest` component into `index.html` and it
      shipped React+ReactDOM to every real page load (~16KB → ~85KB
      gzip) for zero user value — wrong tradeoff on a mobile-first app.
      Reverted; proved instead via a Vitest component test
      (`tests/react/SmokeTest.test.tsx`, jsdom environment — jsdom pinned
      to v26, v30's `html-encoding-sniffer` dep is ESM-only and breaks
      under `require()`). Confirmed via `npm run build` the production
      bundle is byte-identical (`index-B2Bp6YsJ.js`, 16.03 kB gzip) to
      before this change — React ships zero bytes until a real page
      imports it.
- [x] Wire `npm run typecheck` into CI (2026-09-22) — added as its own
      step in `.github/workflows/ci.yml` right after lint; README and the
      local `codebase-map` skill doc updated to match

### Page ports
Each ported page: Playwright passing (including axe-core a11y gate — must
not regress WCAG AA), reviewed against the vanilla version before merge.

**2026-09-22 deviation from the original plan**: Simeon asked to work
through all pages rather than one branch/PR per page — continuing on
`chore/scalability-roadmap-tracking` instead of a fresh branch per page,
verified/committed incrementally as each page completes.

- [x] **Accounts** (2026-09-22) — `src/react/pages/AccountsPage.tsx`,
      mounted into `#accounts-react-root` via a dynamic import (React only
      downloads after auth succeeds; confirmed the login-screen bundle is
      untouched). Removed the vanilla `renderAccountsUI`/
      `handleAccountSubmit`/`deleteAccount`; `loadAccounts()` stays (other
      pages' dropdowns depend on the `paymentSources` it builds) and the
      React component calls `window.app.loadAccounts()` after add/delete
      to keep those in sync — proven by the existing E2E test (updated to
      accessible-name locators), which specifically checks a newly-added
      account appears back on the still-vanilla transaction form. 133
      tests (5 new), all 11 E2E/a11y tests, lint/typecheck/build all
      green. Also fixed React Testing Library's auto-cleanup silently
      no-op'ing (needs vitest's `afterEach` as a true global, which this
      repo doesn't enable) via `tests/react/setup.ts`.
- [ ] Insights — read-only, no forms, but renders the engine's projection
      output
- [ ] Budgets
- [ ] Dashboard — highest value, highest complexity (projections, charts,
      giving-floor warnings)
- [ ] Auth/forms — highest risk per `release-safety`: a broken login
      screen locks Simeon out of his own app; do this one carefully and
      last, once the pattern is well-proven elsewhere

---

## How to use this file

- Check a box and update the phase's Status line the moment work starts or
  lands — don't batch it at the end of a session.
- Add a dated note under a phase if a decision deviates from the plan
  (e.g. "2026-10-01: skipped pagination on accounts list, dataset too small
  to matter").
- This file is the source of truth for *what's left*; project memory
  (`scalability_roadmap.md`) holds the *why* behind the original decisions.
