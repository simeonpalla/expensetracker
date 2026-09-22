-- 0003_indexes.sql
--
-- Every query in netlify/functions/lib/*-repo.js filters by user_id (RLS
-- also checks auth.uid() = user_id on every row), and transactions is
-- additionally sorted by transaction_date on every GET. None of these
-- columns had an index until now, so every list query has been a full
-- table scan since day one. Not urgent at today's single-user data volume,
-- but cheap to fix now and it only gets more valuable as data grows.
--
-- docs/supabase-setup.md's fresh-install DDL already documents the
-- transactions index; this migration is what actually gets it onto an
-- existing database (like the live one), since that doc's DDL only runs
-- on brand-new projects. categories and payment_accounts had no index
-- documented anywhere.
--
-- Run manually in the Supabase SQL editor. Idempotent (IF NOT EXISTS),
-- purely additive — no behavior change, safe to run against live data.

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, transaction_date desc);

create index if not exists categories_user_id_idx
  on public.categories (user_id);

create index if not exists payment_accounts_user_id_idx
  on public.payment_accounts (user_id);
