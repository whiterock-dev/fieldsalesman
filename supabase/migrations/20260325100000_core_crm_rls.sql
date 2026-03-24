-- Field Salesman app uses the anon key + signed-in JWT for all CRM writes.
-- If RLS is enabled on these tables without policies, every insert/update fails.

-- profiles (sign-in upsert + team list)
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_authenticated" on public.profiles;
drop policy if exists "profiles_update_authenticated" on public.profiles;
drop policy if exists "profiles_delete_authenticated" on public.profiles;

create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

create policy "profiles_insert_authenticated"
  on public.profiles for insert to authenticated with check (true);

create policy "profiles_update_authenticated"
  on public.profiles for update to authenticated using (true) with check (true);

create policy "profiles_delete_authenticated"
  on public.profiles for delete to authenticated using (true);

-- customers (new lead from Add visit, list, assign)
alter table public.customers enable row level security;

drop policy if exists "customers_select_authenticated" on public.customers;
drop policy if exists "customers_insert_authenticated" on public.customers;
drop policy if exists "customers_update_authenticated" on public.customers;
drop policy if exists "customers_delete_authenticated" on public.customers;

create policy "customers_select_authenticated"
  on public.customers for select to authenticated using (true);

create policy "customers_insert_authenticated"
  on public.customers for insert to authenticated with check (true);

create policy "customers_update_authenticated"
  on public.customers for update to authenticated using (true) with check (true);

create policy "customers_delete_authenticated"
  on public.customers for delete to authenticated using (true);

-- followups
alter table public.followups enable row level security;

drop policy if exists "followups_select_authenticated" on public.followups;
drop policy if exists "followups_insert_authenticated" on public.followups;
drop policy if exists "followups_update_authenticated" on public.followups;
drop policy if exists "followups_delete_authenticated" on public.followups;

create policy "followups_select_authenticated"
  on public.followups for select to authenticated using (true);

create policy "followups_insert_authenticated"
  on public.followups for insert to authenticated with check (true);

create policy "followups_update_authenticated"
  on public.followups for update to authenticated using (true) with check (true);

create policy "followups_delete_authenticated"
  on public.followups for delete to authenticated using (true);

-- visits (direct select for sync; RPC create_visit_enforced is security definer but SELECT still needed)
alter table public.visits enable row level security;

drop policy if exists "visits_select_authenticated" on public.visits;
drop policy if exists "visits_insert_authenticated" on public.visits;
drop policy if exists "visits_update_authenticated" on public.visits;
drop policy if exists "visits_delete_authenticated" on public.visits;

create policy "visits_select_authenticated"
  on public.visits for select to authenticated using (true);

create policy "visits_insert_authenticated"
  on public.visits for insert to authenticated with check (true);

create policy "visits_update_authenticated"
  on public.visits for update to authenticated using (true) with check (true);

create policy "visits_delete_authenticated"
  on public.visits for delete to authenticated using (true);

-- live_locations (tracking ping insert)
alter table public.live_locations enable row level security;

drop policy if exists "live_locations_select_authenticated" on public.live_locations;
drop policy if exists "live_locations_insert_authenticated" on public.live_locations;
drop policy if exists "live_locations_update_authenticated" on public.live_locations;
drop policy if exists "live_locations_delete_authenticated" on public.live_locations;

create policy "live_locations_select_authenticated"
  on public.live_locations for select to authenticated using (true);

create policy "live_locations_insert_authenticated"
  on public.live_locations for insert to authenticated with check (true);

create policy "live_locations_update_authenticated"
  on public.live_locations for update to authenticated using (true) with check (true);

create policy "live_locations_delete_authenticated"
  on public.live_locations for delete to authenticated using (true);
