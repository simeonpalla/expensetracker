# Deployment and launch checklist

Pushing to `main` deploys via Netlify. Some steps cannot be done by code and
must be sequenced with the deploy.

## Every release that adds a migration

1. Run the new file from `supabase/migrations/` in the Supabase SQL editor
   (all are idempotent).
2. Then merge/deploy. The app tolerates the reverse order for settings (it
   falls back to the local copy), but do not rely on it.
3. Smoke test on the deployed site: log in, add a transaction, open the
   Dashboard, change a budget and reload.

## This release (settings, onboarding, reset, data rights, health, scanning)

1. Apply `0004_user_settings_and_account.sql` (creates `user_settings` and
   `delete_my_account()`).
2. Supabase → Authentication → URL Configuration: set **Site URL** to the
   production URL and add it to **Redirect URLs** (reset links land there).
3. Supabase → Authentication → SMTP: configure a real provider. The built-in
   mailer is heavily rate-limited and will fail under real use.
4. Optional: set `SITE_URL` in Netlify (defaults to Netlify's `URL`).
5. Fill the `[PLACEHOLDERS]` in `public/privacy.html` and `public/terms.html`.
6. Expect a one-time upload of each browser's old budget/giving-floor values
   on first load; verify Budgets shows the same numbers afterwards.
7. The CSP now includes `'wasm-unsafe-eval'` and `blob:` images, and the
   service worker caches `/ocr/`. After deploy, scan a real bill on the phone.

## Before charging customers (not yet built)

- Billing provider (Razorpay for India / Stripe globally), webhook function
  and a per-user plan field enforced server-side
- Landing and pricing pages, support email, transactional email templates
- A staging environment and Supabase backups/PITR (a bad migration now
  affects paying users)
- Uptime monitoring alongside Sentry; analytics that respect privacy
- Legal review of the policies and terms
- Load and abuse review of the rate limits (they are per function instance)

## Rollback

Netlify keeps previous deploys: publish an earlier one from the Deploys page.
Migrations are additive and are not rolled back; the previous frontend keeps
working against the new tables.
