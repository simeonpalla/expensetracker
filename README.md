# Personal OS — Expense · Time · Workout Tracker

> A personal finance tracker that thinks in **salary cycles**, not calendar
> months — plus time tracking and a Hevy-paste workout tracker.
> Vanilla JS + Vite, Supabase (Postgres + Auth), Netlify Functions as a BFF.
> The insights engine runs entirely locally — no external AI APIs.

## Features

### Money
- Log income/expenses with categories, payment sources (UPI, credit/debit
  card, cash), bank/card details, descriptions, and recurring flags
- Salary-aware form — a salary transaction auto-locks to your configured
  salary account
- **Salary-cycle dashboard**: cycles derive automatically from salary
  transaction dates; switch between historical cycles; per-cycle income,
  expenses, remaining budget, and no-spend streaks
- **Pattern-aware run-rate projection**: with ≥10 historical expenses, each
  remaining cycle day is projected from that day-of-cycle's historical
  average; otherwise a recency-weighted burn rate (last 7 days × 0.6 +
  earlier × 0.4). Cycle length is the median gap between your salaries
- Daily spend line chart with a least-squares trend line; payment-source
  donut with category drill-down; budget limits with 80% warnings;
  recurring-transaction suggestions; CSV export
- **7-point insights audit**: category variance vs your historical baseline,
  corrective limits, run-rate status, biggest leak, savings rate + Pareto
  concentration, weekend vs weekday patterns, cycle-over-cycle trend

### Time & Workouts
- One-tap and custom timers (state survives reloads and devices via an
  active-timer table), manual back-dated entries, 24-hour timeline, weekly
  stacked chart, productivity score
- Paste a workout from Hevy → parsed into exercises/sets → progression
  charts per exercise, weekly counts and streaks; saving a workout
  auto-logs a Health time entry
- **Life report**: overwork detection, sleep rolling average, money–time
  correlation, 4-week productivity trend

## Architecture

```
Browser (Vite-built ES modules, installable PWA)
  src/main.js          app controller + auth + dashboard rendering
  src/engine/          PURE logic: dates, salary cycles, projections (tested)
  src/api.js           BFF client (HttpOnly-cookie session, auto-refresh)
  src/timetracker.js   time tracking UI
  src/workouttracker.js workout parsing + UI
  charts               Chart.js, lazy-loaded as its own chunk
        │  fetch /.netlify/functions/* (cookies, same-origin)
        ▼
Netlify Functions (BFF) — netlify/functions/
  login/signup/refresh/logout/me   session management (HttpOnly cookies)
  transactions/categories          money data (validated, whitelisted)
  timelogs/workouts/activetimer    time + workout data
  _lib.js                          shared: cookies, validation, rate limits
        ▼
Supabase (Postgres + Auth) — Row Level Security enforces per-user access
```

**Security model**: tokens never reach JavaScript. Sessions live in HttpOnly,
Secure, SameSite=Strict cookies scoped to the functions path. Every function
uses the **anon key + the caller's JWT**, so Postgres RLS is the actual
authorization boundary (the service-role key is not used at all). All inputs
are validated and whitelisted server-side; login/signup/refresh are
rate-limited per IP; CSP allows scripts from this origin only. See
`netlify.toml` for headers and `supabase/migrations/` for RLS policies.

## Getting started

### Prerequisites
- Node.js ≥ 20 (Node 22 recommended — CI uses 22)
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [Netlify](https://netlify.com) site linked to your fork (for deploys)

### Setup
```bash
npm ci
cp .env.example .env      # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm run dev               # netlify dev: Vite + functions on http://localhost:8888
```

Database: follow [docs/supabase-setup.md](docs/supabase-setup.md) — it
contains the table reference and the RLS policy migration
(`supabase/migrations/0001_rls_policies.sql`) that **must** be applied.

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | Netlify env + local `.env` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Netlify env + local `.env` | Public anon key (RLS enforced) |

The service-role key is intentionally **not** used by this app.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Netlify dev: Vite dev server + functions, one origin |
| `npm run build` | Production build to `dist/` (hashed assets + PWA service worker) |
| `npm test` | Vitest: engine unit tests + function integration tests |
| `npm run test:e2e` | Playwright browser flows against the built app (stubbed BFF) |
| `npm run lint` / `format` | ESLint / Prettier |

## Testing

- `tests/engine/` — the projection/cycle/date logic, including edge cases:
  empty data, no salary, first cycle, <10 transactions, timezone boundaries,
  non-30-day cycles
- `tests/functions/` — handler-level tests with a stubbed Supabase client:
  auth paths, validation rejections, mass-assignment stripping, rate limits
- `tests/e2e/` — Playwright: login flow and add-transaction → dashboard.
  The BFF is stubbed via route interception, so no credentials are needed
  (this is what lets E2E run in CI)

CI (GitHub Actions) runs lint → format check → tests → build → E2E on every
PR; Netlify builds a deploy preview for every PR via its Git integration.

## Deployment

Pushing to `main` triggers Netlify: `npm run build`, publish `dist/`,
functions from `netlify/functions/`. Security headers and caching rules are
in `netlify.toml`. The PWA service worker auto-updates clients on deploy.

## Insights engine — how projections work

**Pattern-aware mode** (≥10 historical expenses): each past expense maps to
its day-of-cycle number (day 1 = salary day). Each remaining day of the
current cycle is projected from that day number's historical average —
capturing patterns like "groceries land on day 3" or "day 28 is near-zero."

**Weighted-recency mode** (thin history): burn rate = last-7-days rate × 0.6
+ earlier-in-cycle rate × 0.4, times the remaining days — biased toward
recent momentum, which is more predictive when habits shift mid-cycle.

The expected cycle length is the **median gap between salary dates**
(clamped 20–45, default 30), so 31-day cycles project all the way out.
This logic lives in `src/engine/` as pure functions with full test coverage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
