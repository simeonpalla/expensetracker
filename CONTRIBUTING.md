# Contributing

## Setup

```bash
npm ci
cp .env.example .env   # Supabase URL + anon key
npm run dev            # http://localhost:8888 (Vite + functions)
```

Node ≥ 20 required. First E2E run: `npx playwright install chromium`.

## Before you open a PR

```bash
npm run lint
npm run format:check   # or: npm run format
npm test
npm run build
npm run test:e2e
```

CI runs exactly these steps; Netlify builds a deploy preview for every PR.

## Ground rules

- **Small commits, clear messages** (conventional-commits style:
  `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`).
- **The engine stays pure.** Anything under `src/engine/` must not touch the
  DOM, `window`, `fetch`, or the current time (inject `today` as a
  parameter). Every behavior change there needs a test.
- **Never weaken the security boundary**: functions must keep using the anon
  key + caller JWT (no service-role key in request handling), validate every
  input, and never echo unescaped user data into `innerHTML` — use
  `escapeHtml` from `src/ui.js` at every sink.
- **No inline event handlers or third-party script origins** — the CSP is
  `script-src 'self'` and inline handlers are blocked. Use
  `addEventListener` / event delegation.
- New endpoints follow the `_lib.js` pattern: `requireUser`, `readJsonBody`,
  field whitelists, and a rate limit if unauthenticated.

## Architecture notes

- `src/main.js` — app controller (dashboard, forms, insights rendering)
- `src/engine/` — pure, tested logic (dates/cycles/projection)
- `src/api.js` — the only place that talks to the BFF
- `netlify/functions/` — CommonJS; note that function tests stub Supabase
  through Node's `require.cache` (see `tests/functions/login.test.js`)
- Database schema + RLS: `docs/supabase-setup.md`, `supabase/migrations/`
