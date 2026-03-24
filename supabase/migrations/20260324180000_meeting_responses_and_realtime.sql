-- Meeting notes surfaced in Admin → Meeting responses (synced + realtime).
-- If ALTER PUBLICATION fails because a table is already in supabase_realtime, remove that line only.
create table if not exists public.meeting_responses (
  id text primary key,
  customer_name text not null,
  salesman_name text not null,
  response text not null,
  created_at timestamptz not null default now(),
  visit_id text
);

create index if not exists idx_meeting_responses_created_at on public.meeting_responses (created_at desc);

alter table public.meeting_responses enable row level security;

create policy "meeting_responses_select_authenticated"
  on public.meeting_responses for select
  to authenticated
  using (true);

create policy "meeting_responses_insert_authenticated"
  on public.meeting_responses for insert
  to authenticated
  with check (true);

create policy "meeting_responses_update_authenticated"
  on public.meeting_responses for update
  to authenticated
  using (true)
  with check (true);

create policy "meeting_responses_delete_authenticated"
  on public.meeting_responses for delete
  to authenticated
  using (true);

-- Realtime: add tables to the supabase_realtime publication (ignore if already added).
alter publication supabase_realtime add table public.app_invites;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.followups;
alter publication supabase_realtime add table public.visits;
alter publication supabase_realtime add table public.live_locations;
alter publication supabase_realtime add table public.meeting_responses;
