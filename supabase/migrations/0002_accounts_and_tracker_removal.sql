-- 0002_accounts_and_tracker_removal.sql
--
-- Two independent changes, bundled because they shipped together:
--
-- 1. Time Tracker and Workout Tracker were removed from the app. Their
--    tables are dropped. This is DESTRUCTIVE — back up time_logs/workouts/
--    active_timers first if you ever want that history again.
--
-- 2. Payment accounts/cards (previously a hardcoded list in main.js) become
--    a real per-user table, following the same RLS pattern as `categories`.
--
-- Run manually in the Supabase SQL editor. Idempotent.

-- ---- 1. drop the tracker tables ----

drop table if exists public.time_logs;
drop table if exists public.workouts;
drop table if exists public.active_timers;

-- ---- 2. payment_accounts table ----

create table if not exists public.payment_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('upi', 'debit-card', 'credit-card', 'cash')),
  created_at timestamptz not null default now(),
  unique (user_id, name, type)
);

alter table public.payment_accounts enable row level security;

drop policy if exists "select own rows" on public.payment_accounts;
create policy "select own rows" on public.payment_accounts for select using (auth.uid() = user_id);

drop policy if exists "insert own rows" on public.payment_accounts;
create policy "insert own rows" on public.payment_accounts for insert with check (auth.uid() = user_id);

drop policy if exists "delete own rows" on public.payment_accounts;
create policy "delete own rows" on public.payment_accounts for delete using (auth.uid() = user_id);

-- Seed every existing user with the accounts that used to be hardcoded in
-- main.js, so switching to the DB-backed list doesn't lose any of them.
insert into public.payment_accounts (user_id, name, type)
select u.id, v.name, v.type
from auth.users u
cross join (values
  ('UBI', 'upi'), ('ICICI', 'upi'), ('SBI', 'upi'), ('Indian Bank', 'upi'),
  ('UBI', 'debit-card'), ('ICICI', 'debit-card'), ('SBI', 'debit-card'), ('Indian Bank', 'debit-card'),
  ('ICICI Amazon', 'credit-card'), ('ICICI Platinum', 'credit-card'), ('ICICI Coral', 'credit-card'),
  ('RBL', 'credit-card'), ('Union Bank', 'credit-card'),
  ('Cash', 'cash')
) as v(name, type)
on conflict (user_id, name, type) do nothing;
