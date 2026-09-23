# Accounts, settings and privacy

## Per-user settings

Budget limits, the giving floor (category + %) and the salary account live in
`public.user_settings` (one row per user, RLS-protected), served by
`netlify/functions/settings.js` (`GET`, partial `PUT`). They follow the
account across devices.

**Migration from localStorage.** Older versions kept these in the browser. On
load, if the account has no settings row yet and this browser holds the old
values, they are uploaded once (`ExpenseTracker.loadSettings()` in
`src/main.js`). If the settings endpoint is unavailable (for example the
migration has not run), the app keeps working from the local copy.

## Onboarding

For a brand-new account (no settings stamp, no categories, no transactions)
`OnboardingCard` offers to seed defaults via `netlify/functions/onboarding.js`:
starter categories (Salary, Other Income, Food & Dining, Groceries, Transport,
Rent, Bills & Utilities, Shopping, Health, Entertainment, Other) and a Cash
account, plus optionally the bank the salary lands in. The endpoint only seeds
when the user has **no categories**, so it can never duplicate or alter an
existing user's data, and it is idempotent. *Skip* just stamps `onboarded_at`.

## Password reset

1. **Forgot password?** → `forgot-password.js` (`POST {email}`) asks Supabase
   to email a link. It always answers 200, so it cannot reveal which emails
   have accounts. Rate limited (3/hour/IP).
2. The link returns to the site with a short-lived recovery token in the URL
   **fragment**. `AuthPage` reads it once, removes it from the address bar and
   shows a new-password form.
3. `reset-password.js` (`POST {access_token, password}`) sets the password via
   Supabase's `/auth/v1/user` using that token. Failures return one generic
   message. Rate limited (5/hour/IP). The token is never stored.

Supabase must have the site URL configured (see `docs/supabase-setup.md`).

## Data export and deletion (Account & privacy)

- **Export** — `GET /account` returns JSON (transactions, categories, payment
  accounts, settings, account id/email) as a download. Only the caller's rows;
  rate limited.
- **Delete** — `DELETE /account` with `{"confirm":"DELETE"}` calls the SQL
  function `delete_my_account()`, which removes the user's rows in every table
  and their `auth.users` record. It is `SECURITY DEFINER`, executable only by
  `authenticated`, and acts on `auth.uid()` only — so the service-role key is
  never needed. The session cookies are cleared and the app returns to login.
  Provider backups may retain data until they roll off; state the real period
  in the Privacy Policy.

If you add a new per-user table, **add it to `delete_my_account()` and to the
export in `account.js`**, and add a test.

## Legal pages

`public/privacy.html` and `public/terms.html` are drafts with bracketed
placeholders (operator name, support email, region, retention, governing law,
plans). Fill them and have them reviewed by a lawyer before launch. Signup
links to both.
