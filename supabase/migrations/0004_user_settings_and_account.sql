-- 0004_user_settings_and_account.sql
--
-- 1. user_settings: budgets / giving floor / salary account used to live
--    in each browser's localStorage. They become one row per user so they
--    follow the account across devices. Same RLS pattern as other tables.
-- 2. delete_my_account(): lets a signed-in user erase their own data and
--    auth record using ONLY their own JWT (SECURITY DEFINER), so the app
--    never needs the service-role key. Required for DPDP/GDPR erasure.
--
-- Run manually in the Supabase SQL editor. Idempotent.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salary_account text not null default 'UBI',
  budget_limits jsonb not null default '{}'::jsonb,
  giving_floor_pct numeric not null default 5 check (giving_floor_pct >= 0 and giving_floor_pct <= 100),
  giving_floor_category text not null default '',
  onboarded_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "select own rows" on public.user_settings;
create policy "select own rows" on public.user_settings for select using (auth.uid() = user_id);

drop policy if exists "insert own rows" on public.user_settings;
create policy "insert own rows" on public.user_settings for insert with check (auth.uid() = user_id);

drop policy if exists "update own rows" on public.user_settings;
create policy "update own rows" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- self-service account deletion ----

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.transactions where user_id = uid;
  delete from public.categories where user_id = uid;
  delete from public.payment_accounts where user_id = uid;
  delete from public.user_settings where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
