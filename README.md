# Personal OS — Salary-Cycle Expense Tracker

> A personal finance tracker that thinks in **salary cycles**, not calendar
> months, and tells you where your money is going and what to change. A Vite
> + React/TypeScript PWA, Supabase (Postgres + Auth), Netlify Functions as a
> BFF. Insights, projections and bill scanning all run **locally** — no
> external AI APIs, and bill photos never leave the device.

## Features

**Track**

- Log income/expenses with categories, payment sources (UPI, credit/debit
  card, cash), your own bank/card list, descriptions and recurring flags
- **Scan a bill** — take a photo of a printed bill and the amount, date and
  merchant are read on-device (Tesseract WASM) and prefilled for you to
  confirm; tap-to-swap candidates if it picked the wrong total. See
  [docs/bill-scanning.md](docs/bill-scanning.md)
- Salary-aware form — a salary transaction auto-locks to your salary account
- **Manage Accounts**: banks, UPI IDs and cards are your own data
- **Recurring transactions on their actual due date** — a subscription
  billed on the 21st is suggested once the 21st arrives
- Mobile-first: numeric keyboards for amounts, swipe-to-delete, installable PWA

**Understand** (Dashboard)

- **Financial health score (0–100)** with a transparent breakdown — savings
  rate, spending stability, budget adherence, fixed-cost load, tracked
  cushion. Parts without enough data are left out, never guessed
- **What to do next** — up to five actions ranked by rupee impact, each with
  its evidence (category running above your usual pace, projected overspend
  and the daily spend to fix it, credit-card money already spent, weekend
  skew, many small purchases, missing budgets)
- **Pace chart** — cumulative spend this cycle against *your own* usual path
- **Where your money goes** — per-category share, amount vs your usual at the
  same day of the cycle, and budget limits
- Income vs spending per cycle; **next-cycle spending forecast** (OLS
  regression over completed cycles, shown once there are ≥4)
- Pattern-aware **run-rate projection**, budget limits with 80% warnings, a
  **giving floor** (minimum % of income for a category), no-spend streaks,
  CSV export
- **7-point Insights audit** (variance vs baseline, corrective limits,
  run-rate, biggest leak, savings/Pareto, weekend vs weekday, cycle trend)

How the score and actions are computed: [docs/financial-health.md](docs/financial-health.md).

**Your account**

- Settings (budgets, giving floor, salary account) are stored **per user in
  the database**, so they follow you across devices
- First-run onboarding seeds default categories and a Cash account for new
  accounts (never touches existing data)
- Password reset by emailed link; **download all your data** (JSON) and
  **permanently delete your account** from *Account & privacy*
- Privacy Policy and Terms in `public/` (filled in for the current
  invitation-only release; add a public contact email and get legal review
  before a public launch)

## Architecture

```
Browser (Vite-built ES modules, installable PWA)
  src/main.js          app controller: boot, settings, shell, edit/delete modals
  src/react/pages/     React/TS pages, lazy-loaded islands (Dashboard, Add
                       Transaction, Budgets, Categories, Accounts, Insights,
                       Auth, Account & privacy, Onboarding)
  src/engine/          PURE logic (tested): dates, cycles, projection,
                       health (score/actions/pace), receipt parsing
  src/ocr.js           on-device bill OCR (lazy; self-hosted under /ocr)
  src/api.js           BFF client (HttpOnly-cookie session, auto-refresh)
  src/fonts.css        self-hosted fonts (CSP-safe, no external fetch)
        │  fetch /.netlify/functions/* (cookies, same-origin)
        ▼
Netlify Functions (BFF) — netlify/functions/
  login/signup/refresh/logout/me            session (HttpOnly cookies)
  forgot-password/reset-password            password recovery
  transactions/categories/accounts          money data (validated, whitelisted)
  settings/onboarding/account               per-user settings, first run,
                                            export + deletion
  lib/*-repo.js                             Supabase queries split from handlers
  _lib.js                                   cookies, validation, rate limits,
                                            structured logging, Sentry
        ▼
Supabase (Postgres + Auth) — Row Level Security enforces per-user access
```

### Frontend

The app was migrated page-by-page from vanilla JS to React + TypeScript. All
pages are now React islands, mounted after login so the login screen only
loads the small Auth island. `src/main.js` remains the shell: boot, loading
per-user settings, and the edit/delete transaction modals. Cross-page state
uses a tiny pub/sub (`src/react/crossPageSync.ts`) plus `window.app`. History
and reasoning: [SCALABILITY_ROADMAP.md](SCALABILITY_ROADMAP.md).

### Security model

Tokens never reach JavaScript. Sessions live in HttpOnly, Secure,
SameSite=Strict cookies scoped to the functions path. Every function uses the
**anon key + the caller's JWT**, so Postgres RLS is the authorization
boundary; the service-role key is not used at all. Inputs are validated and
whitelisted server-side; login/signup/forgot/reset are rate-limited per IP.
Account deletion runs through a `SECURITY DEFINER` SQL function
(`delete_my_account()`) callable only by the signed-in user, which is why no
service-role key is needed. CSP allows scripts, styles, fonts and images from
this origin only (no CDNs), plus `'wasm-unsafe-eval'` (needed for the OCR
WebAssembly) and `blob:` images. See `netlify.toml`.

## Getting started

### Prerequisites
- Node.js ≥ 20 (CI uses 22)
- A [Supabase](https://supabase.com) project and a [Netlify](https://netlify.com) site

### Setup
```bash
npm ci
cp .env.example .env      # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm run dev               # netlify dev on http://localhost:8888
```

Database, auth and email configuration: [docs/supabase-setup.md](docs/supabase-setup.md).
**All four migrations in `supabase/migrations/` must be applied, in order.**

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | Netlify env + local `.env` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Netlify env + local `.env` | Public anon key (RLS enforced) |
| `SITE_URL` | Netlify env (optional) | Where password-reset links return to. Falls back to Netlify's `URL` |
| `SENTRY_DSN` | Netlify env (optional) | Error tracking; unset in dev/CI. Only `fn`/`requestId`/`method` are reported, never request bodies |

The service-role key is intentionally **not** used.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Netlify dev: Vite + functions, one origin |
| `npm run build` | Copies the OCR runtime into `public/ocr`, then builds to `dist/` (hashed assets + PWA service worker) |
| `npm test` | Vitest: engine, function handlers, React components |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:e2e` | Playwright against the built app (stubbed BFF, production CSP applied) |
| `npm run lint` / `format` | ESLint / Prettier |

## Testing

- `tests/engine/` — dates, cycles, projections, **health analysis**, **receipt parsing**
- `tests/functions/` — handler tests with a stubbed Supabase client: auth,
  validation, mass-assignment stripping, rate limits, settings, onboarding,
  export/deletion, password reset
- `tests/react/` — component tests (Testing Library, jsdom) for every page
- `tests/e2e/` — Playwright: login, add-transaction → dashboard, accounts,
  giving floor, recurring due dates, settings sync + legacy import,
  onboarding, account export/delete, password reset, **real OCR of a rendered
  receipt under the production CSP**, axe accessibility scans (WCAG AA)

CI runs lint → typecheck → format check → tests → build → E2E on every PR.

## Deployment

Pushing to `main` triggers Netlify: `npm run build`, publish `dist/`,
functions from `netlify/functions/`. **Order matters for releases that add a
migration:** run the migration in Supabase first, then deploy. The checklist
for the current release is in [docs/deployment.md](docs/deployment.md).

## Insights engine

**Projection** — pattern-aware with ≥10 historical expenses (each remaining
cycle day projected from that day-of-cycle's historical average), otherwise
recency-weighted (last 7 days × 0.6 + earlier × 0.4). Cycle length is the
median gap between salaries (clamped 20–45, default 30).

**Health, pace, actions** — see [docs/financial-health.md](docs/financial-health.md).

**Recurring transactions** are templates, not auto-charges: a suggestion
appears once one calendar month has passed since the last occurrence.

## Documentation

- [docs/supabase-setup.md](docs/supabase-setup.md) — tables, migrations, auth and email setup
- [docs/deployment.md](docs/deployment.md) — release checklist and launch checklist
- [docs/financial-health.md](docs/financial-health.md) — score, actions, pace, assumptions
- [docs/bill-scanning.md](docs/bill-scanning.md) — on-device OCR and total detection
- [docs/account-and-privacy.md](docs/account-and-privacy.md) — settings, onboarding, export, deletion, password reset
- [docs/future-scope.md](docs/future-scope.md) — where the app is going: decision-support analytics and deferred encryption
- [SCALABILITY_ROADMAP.md](SCALABILITY_ROADMAP.md) — architecture decisions and status

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
