-- Cross-device invite list (replaces localStorage-only for multi-device teams).
create table if not exists public.app_invites (
  email text primary key,
  role text not null check (role in ('owner', 'sub_admin', 'super_salesman', 'salesman')),
  added_at timestamptz not null default now()
);

create index if not exists idx_app_invites_added_at on public.app_invites (added_at);

alter table public.app_invites enable row level security;

-- Single-tenant: any signed-in user may read/write invites (gate is Google + your app rules).
create policy "app_invites_select_authenticated"
  on public.app_invites for select
  to authenticated
  using (true);

create policy "app_invites_insert_authenticated"
  on public.app_invites for insert
  to authenticated
  with check (true);

create policy "app_invites_update_authenticated"
  on public.app_invites for update
  to authenticated
  using (true)
  with check (true);

create policy "app_invites_delete_authenticated"
  on public.app_invites for delete
  to authenticated
  using (true);
