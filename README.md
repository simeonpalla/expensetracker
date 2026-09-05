# Personal OS — Salary-Cycle Expense Tracker

> A personal finance tracker that thinks in **salary cycles**, not calendar
> months. Vanilla JS + Vite, Supabase (Postgres + Auth), Netlify Functions
> as a BFF. The insights/projection engine runs entirely locally — no
> external AI APIs.

## Features

- Log income/expenses with categories, payment sources (UPI, credit/debit
  card, cash), your own bank/card list, descriptions, and recurring flags
- Salary-aware form — a salary transaction auto-locks to your configured
  salary account
- **Manage Accounts**: banks, UPI IDs, and cards are your own data (not a
  hardcoded list) — add a new credit card the day you get it
- **Salary-cycle dashboard**: cycles derive automatically from salary
  transaction dates; switch between historical cycles; per-cycle income,
  expenses, remaining budget, and no-spend streaks
- **Predictive, not just analytical**: the Projected Month-End card names
  what to actually do about it — the daily spend that would break even or
  keep a safety margin, and which category is running ahead of its usual
  pace — instead of only reporting a number
- **Pattern-aware run-rate projection**: with ≥10 historical expenses, each
  remaining cycle day is projected from that day-of-cycle's historical
  average; otherwise a recency-weighted burn rate (last 7 days × 0.6 +
  earlier × 0.4). Cycle length is the median gap between your salaries
- **Giving floor**: set a category (e.g. "Offering") and a minimum % of
  cycle income it should never fall below — a dashboard warning shows how
  much more is needed, without ever blocking a transaction
- **Recurring transactions, on their actual due date** — a subscription
  billed on the 21st is only suggested once the 21st arrives, not from the
  start of the cycle
- Daily spend line chart with a least-squares trend line; payment-source
  donut with category drill-down; budget limits with 80% warnings; CSV
  export
- **7-point insights audit**: category variance vs your historical baseline,
  corrective limits, run-rate status, biggest leak, savings rate + Pareto
  concentration, weekend vs weekday patterns, cycle-over-cycle trend

## Architecture

```
Browser (Vite-built ES modules, installable PWA)
  src/main.js          app controller + auth + dashboard rendering
  src/engine/          PURE logic: dates, salary cycles, projections (tested)
  src/api.js           BFF client (HttpOnly-cookie session, auto-refresh)
  src/fonts.css        self-hosted @font-face (CSP-safe, no external fetch)
  charts               Chart.js, lazy-loaded as its own chunk
        │  fetch /.netlify/functions/* (cookies, same-origin)
        ▼
Netlify Functions (BFF) — netlify/functions/
  login/signup/refresh/logout/me   session management (HttpOnly cookies)
  transactions/categories/accounts money data (validated, whitelisted)
  _lib.js                          shared: cookies, validation, rate limits
        ▼
Supabase (Postgres + Auth) — Row Level Security enforces per-user access
```

**Security model**: tokens never reach JavaScript. Sessions live in HttpOnly,
Secure, SameSite=Strict cookies scoped to the functions path. Every function
uses the **anon key + the caller's JWT**, so Postgres RLS is the actual
authorization boundary (the service-role key is not used at all). All inputs
are validated and whitelisted server-side; login/signup/refresh are
rate-limited per IP; CSP allows scripts, styles, and fonts from this origin
only — no CDNs, which is why fonts are self-hosted in `public/fonts/`
(loaded via `src/fonts.css`) rather than fetched from Google Fonts. See
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
contains the table reference and the migrations in `supabase/migrations/`
that **must** be applied (RLS policies, then accounts + tracker cleanup).

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
  non-30-day cycles, and calendar-month arithmetic for recurring due dates
- `tests/functions/` — handler-level tests with a stubbed Supabase client:
  auth paths, validation rejections, mass-assignment stripping, rate limits
- `tests/e2e/` — Playwright: login flow, add-transaction → dashboard,
  accounts add/remove, the giving-floor warning, and recurring-suggestion
  due-date gating. The BFF is stubbed via route interception, so no
  credentials are needed (this is what lets E2E run in CI)

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

## Recurring transactions

Mark a transaction "recurring" and it becomes a template, not a repeating
charge — you still add each month's occurrence yourself, just with less
typing. The suggestion only appears once **one calendar month has passed
since the last occurrence** (`PFDates.addMonths`, day-of-month overflow
clamped to the target month's last day), so a subscription billed on the
21st shows up as due on the 21st, not from the first day of your salary
cycle.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
