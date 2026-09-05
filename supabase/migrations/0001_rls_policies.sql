-- 0001_rls_policies.sql
-- Row Level Security for all user data tables.
--
-- The Netlify functions call Supabase with the ANON key plus the caller's
-- JWT, so these policies are the actual authorization boundary: a user can
-- only touch rows where user_id = auth.uid().
--
-- Idempotent: safe to run in the Supabase SQL editor even if RLS/policies
-- already exist. Verify afterwards under
-- Dashboard -> Authentication -> Policies.

do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'categories']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "select own rows" on public.%I', t);
    execute format(
      'create policy "select own rows" on public.%I for select using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "insert own rows" on public.%I', t);
    execute format(
      'create policy "insert own rows" on public.%I for insert with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "update own rows" on public.%I', t);
    execute format(
      'create policy "update own rows" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "delete own rows" on public.%I', t);
    execute format(
      'create policy "delete own rows" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
