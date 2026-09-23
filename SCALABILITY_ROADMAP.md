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
| Backend | 3. Observability | Done — Sentry DSN live in Netlify env (2026-09-24) |
| Backend | 4. Data-layer scaling readiness | Done — Simeon confirmed migration run + pooler check (2026-09-24); pagination still just a future option, not urgent |
| Backend | 5. Staging environment | Deprioritized — single-user, infrequent, mostly-additive migrations don't justify the overhead; revisit if that changes |
| Frontend | React + TS scaffolding | Done — proven via test, zero prod bundle cost until first page ports |
| Frontend | Page port: Accounts | Done — proven via unit + E2E/a11y tests |
| Frontend | Page port: Insights | Done — needs Simeon's manual spot-check of the numbers (financial-analysis logic) |
| Frontend | Page port: Categories | Done — also fixed a real pre-existing a11y bug found by properly extending the gate |
| Frontend | Page port: Budgets | Done — caught and fixed a real regression before it shipped |
| Frontend | Page port: Add Transaction | Done — form only, Dashboard stays vanilla (see note) |
| Frontend | Page port: Dashboard | Done (2026-09-23) — React-owned; edit/delete modals + Salary Settings stay vanilla. Adds OLS next-cycle spending forecast |
| Frontend | Page port: Auth/forms | Done (2026-09-23) — AuthPage.tsx, only loaded when signed out; E2E login flow passes |

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
**Status: Done** (2026-09-24 — merged and live, `SENTRY_DSN` set)

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
- [x] Sentry account/project created, `SENTRY_DSN` added to Netlify env
      (Simeon, 2026-09-24)
- [x] PR opened, CI green, merged (PR #22, 2026-09-24)

### Phase 4 — Data-layer scaling readiness
**Status: Done** (2026-09-24 — indexes migration run, pooler mode checked)

- [x] Review query patterns for missing indexes (2026-09-22) — every query
      in `lib/*-repo.js` filters by `user_id` (transactions also sorts by
      `transaction_date`), and none of it was indexed on the live DB.
      `supabase/migrations/0003_indexes.sql` adds all three, idempotent,
      purely additive.
- [x] Simeon ran `0003_indexes.sql` in the Supabase SQL editor (2026-09-24)
- [x] Simeon checked the Supabase connection pooler mode (2026-09-24)
- [ ] **Still just an option, not a decision**: pagination on list
      endpoints. Changes the API response shape and needs matching
      frontend work — revisit only if row count actually starts to matter,
      not preemptively.
- [x] PR opened, CI green, merged (PR #22, 2026-09-24)

### Phase 5 — Staging environment
**Status: Deprioritized** (2026-09-24) — single-user app, infrequent and
mostly-additive migrations (indexes, new tables) don't justify a second
Supabase project + parallel deploy pipeline right now. Revisit if migration
frequency/risk changes (e.g. more users, more destructive schema changes).

---

## Frontend track — React + TypeScript migration

Fully separate from the backend track (disjoint files) — can interleave
freely. Page-by-page, each its own branch/PR, vanilla JS and React coexist
during the transition. TypeScript adopted from the start, not deferred.

`src/main.js` (1774 lines) is the real migration effort — `src/engine/*`,
CSS tokens, CSP, and the PWA setup carry over largely unchanged.

**2026-09-23 finding**: `mountReactIslands()` eagerly mounts all 5 ported
pages at boot (not lazily per-tab), which adds real concurrent work
(5 dynamic imports + 5 React mounts) right when the app becomes
interactive. This caused a real, reproducible E2E flake (`tests/e2e/
a11y.spec.js`'s arrow-key nav test raced the app's own keydown handler
before boot settled — fixed by waiting for the existing `#status-text`
"Connected" readiness signal, same pattern already used elsewhere in that
file). Worth reconsidering before porting more pages: either mount islands
lazily per-tab-visit, or stagger them, rather than mounting all of them
unconditionally on every boot regardless of which tab is active.

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
- [x] **Insights** (2026-09-22) — `src/react/pages/InsightsPage.tsx`, the
      7-section financial report (anomalies, run-rate, leak, macro,
      weekend/weekday, month-over-month) ported field-for-field from
      `generateLocalAIInsights()` — same formulas, same thresholds, same
      `toFixed()` precision, not a rewrite. Read-only (no shared-state
      resync needed, unlike Accounts), but reads the still-vanilla
      Dashboard's cycle-selection state off `window.app` at analyze-time
      — a coupling to revisit once Dashboard is ported. React/react-dom
      now dedupes into one shared chunk across both islands (Vite), so
      this added only ~9KB gzip on top of Accounts.
      **Needs Simeon's manual spot-check**: this is financial-analysis
      logic on live data — green tests (136 total, including the
      existing real-fixture E2E test verifying the giving-floor category
      is never flagged as an anomaly) are necessary but per
      `release-safety` not sufficient on their own for this kind of
      change; please compare a real analysis run against the pre-port
      version once before fully trusting it.
**2026-09-23 correction**: the original 5-page plan missed 2 of the app's 6
actual tabs (`grep -n 'data-page=' index.html`: add-transaction, dashboard,
budgets, categories, accounts, ai-insights) — **Categories** and
**Add Transaction** weren't in it. Adding them here, ordered by risk.

- [x] **Categories** (2026-09-23) — `src/react/pages/CategoriesPage.tsx`,
      list/add only (confirmed no delete in either the vanilla frontend or
      the backend — didn't add capability that wasn't there). Same
      `window.app.loadCategories()` resync pattern as Accounts.
      **Important finding while doing this**: extended
      `tests/e2e/a11y.spec.js`'s general a11y test to actually visit
      accounts/insights/categories — it never had before, so the
      "a11y-gate verified" claims for the Accounts and Insights ports
      earlier in this file were overstated (the gate wasn't actually
      running against them). Doing so caught a real, pre-existing bug:
      the Type `<select>` on both Accounts and Categories forms had no
      accessible name (only the main transaction form's had a proper
      `<label>`) — fixed with `aria-label`. All 3 React pages are now
      genuinely covered by the a11y gate.
- [x] **Budgets** (2026-09-23) — `src/react/pages/BudgetsPage.tsx`, both
      the per-category limit form and the Giving Floor form. This page's
      state is localStorage-only (no backend table), consumed by the
      still-vanilla Dashboard, so saves write the same localStorage keys
      as the original *and* mutate `window.app`'s in-memory copies, then
      call `window.app.updateDashboardStats()` when a cycle is active.
      **Caught a real regression before it shipped**: the giving-floor
      auto-guess used to run unconditionally at app boot (via
      `loadCategories()` → the old `renderBudgetLimitsUI()`), so
      Dashboard's giving-floor warning worked even if Budgets was never
      opened. Removing the old method broke that — the existing E2E test
      ("dashboard warns when the Offering category is under the giving
      floor") caught it failing. Fixed by restoring the guess into
      `loadCategories()` itself. 144 tests (5 new), all 11 E2E/a11y tests
      green after the fix.
- [x] **Add Transaction** (2026-09-23) — `src/react/pages/AddTransactionPage.tsx`,
      the form only. **Scope correction**: originally planned combined with
      Dashboard (they share the edit modal + cycle state), but on reading
      the code the split turned out cleaner than expected — the form
      doesn't need Dashboard's rendering ported, just two bridges:
      `window.app.refreshTransactions()` (new helper, also deduped 2 other
      call sites) for the React form to trigger the vanilla Dashboard's
      refresh after save, and `window.__prefillAddTransactionForm` for the
      Dashboard's "+ Log it" recurring-suggestion button to fill the React
      form (native DOM `.value` assignment can't update React-controlled
      inputs — this replaces that approach). Also added
      `src/react/crossPageSync.ts`, a small pub/sub so this page and
      BudgetsPage (same gap) refetch their independently-fetched
      categories/accounts when Categories/Accounts pages mutate them
      elsewhere — every React island mounts once at boot and stays
      mounted, so without this their data goes stale until a full reload.
      **Caught 2 real bugs via the E2E suite** before shipping: the form
      lost its `id="transaction-form"` (one test referenced it directly),
      and the cross-page staleness gap above (the accounts E2E test
      expected a newly-added account to show up in this form's Bank/Card
      dropdown without a reload). 152 tests (8 new), all 11 E2E/a11y tests
      green.
- [ ] Dashboard — **scoped in full on 2026-09-23, deliberately not started
      this session.** Unlike every other page, Dashboard isn't
      independently addressable: `loadCycleHistory()`/
      `updateDashboardStats()` is the coordination spine every ported
      page's `refreshTransactions()`/`updateDashboardStats()` bridge calls
      into. Porting it means Dashboard becomes the *new owner* of that
      spine — rewiring how the 5 already-shipped pages signal it, on top
      of reimplementing 2 Chart.js charts and the mobile swipe-to-delete
      gesture faithfully (real UX risk given Simeon's iPhone-primary
      usage). This is categorically bigger than any single page done so
      far — closer to a rewrite of the app's coordination layer than a
      page port. Concrete scope for whoever picks this up:
      - Transaction list: can likely reuse the *existing* vanilla
        delegated click listener on `#transactions-list` unchanged (React
        can own the list's rendering while mounting into that same
        container — the listener is on the container, not the children,
        so DOM event bubbling doesn't care who rendered them) — as long
        as rendered items keep the same classNames/`data-id` attributes.
        This means the edit modal and delete-confirm modal likely need
        **zero changes** — worth verifying before assuming otherwise.
      - Swipe-to-delete (`setupSwipeToDelete`): reimplement natively in
        React (onTouchStart/Move/End) rather than bridging into the
        vanilla DOM-transform version — safer long-term, but real gesture
        parity risk; test on an actual phone, not just Playwright.
      - Charts: `loadChart()` (src/charts.js) already lazy-loads Chart.js
        as its own chunk — reuse it, own the canvas via a React ref +
        useEffect, destroy/recreate on data change (matching the
        vanilla `.destroy()` pattern already used).
      - Stats/streak/run-rate/leak/budget-warnings/offering-warnings: pure
        calculations already extracted cleanly in main.js
        (`calculateRunRate`, `findTopLeak`, `checkBudgetWarnings`,
        `checkOfferingFloor`) — portable to React following the same
        "compute pure data, render JSX" pattern as InsightsPage.
      - Cycle selection ownership needs to move to React (or stay
        vanilla-owned with React reading it) — decide explicitly rather
        than accidentally duplicating cycle state.
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

## Production readiness (started 2026-09-24)

Branch `feat/user-settings-onboarding` (stacked on `feat/dashboard-auth-insights-upgrade`).

- [x] Per-user settings in the DB (`user_settings`, migration 0004) replacing
      localStorage budgets / giving floor / salary account. One-time upload of
      legacy local values; falls back to local if the endpoint is unavailable.
- [x] First-run onboarding (default categories + Cash account, idempotent,
      never touches existing users).
- [x] Password reset (`forgot-password`, `reset-password`, recovery-link flow).
- [x] Data rights: JSON export and self-service deletion (`delete_my_account()`
      SECURITY DEFINER SQL function — no service-role key), Account & privacy page.
- [x] Privacy Policy / Terms drafts (`public/privacy.html`, `terms.html`) —
      **placeholders must be filled and lawyer-reviewed before launch.**
- [x] Dashboard financial-health view (`src/engine/health.js`), Manrope headings.
- [x] On-device bill scanning (Tesseract WASM, self-hosted, CSP-compatible).
- [x] Documentation: README, `docs/` (deployment, health, scanning, account & privacy).
- [ ] Billing + plan enforcement, landing/pricing page, staging env, backups/PITR
      (checklist in `docs/deployment.md`).

**Outside-the-repo steps for this deploy (in order):**
1. Run `supabase/migrations/0004_user_settings_and_account.sql` in the Supabase SQL editor.
2. Supabase Dashboard → Authentication → URL Configuration: set Site URL to the
   production URL and add it to Redirect URLs (password-reset links land there).
3. Optional: set `SITE_URL` in Netlify env (falls back to Netlify's `URL`).
4. Configure a real SMTP provider in Supabase (the built-in mailer is rate-limited).
5. Fill the `[PLACEHOLDERS]` in `public/privacy.html` and `public/terms.html`.
