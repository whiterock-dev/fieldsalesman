-- Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
-- © 2026 WhiteRock (Royal Enterprise). All rights reserved.
--
-- Unauthorized copying, modification, or distribution is strictly prohibited.

alter table public.visits
  add column if not exists dynamic_fields jsonb not null default '{}'::jsonb;

alter table public.customers
  add column if not exists dynamic_fields jsonb not null default '{}'::jsonb;

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  key text not null unique,
  type text not null,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  is_deleted boolean not null default false,
  "order" int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_form_fields_order
  on public.form_fields ("order", created_at);

alter table public.form_fields enable row level security;

drop policy if exists "form_fields_select_authenticated" on public.form_fields;
create policy "form_fields_select_authenticated"
  on public.form_fields for select
  to authenticated
  using (true);

drop policy if exists "form_fields_insert_authenticated" on public.form_fields;
create policy "form_fields_insert_authenticated"
  on public.form_fields for insert
  to authenticated
  with check (true);

drop policy if exists "form_fields_update_authenticated" on public.form_fields;
create policy "form_fields_update_authenticated"
  on public.form_fields for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "form_fields_delete_authenticated" on public.form_fields;
create policy "form_fields_delete_authenticated"
  on public.form_fields for delete
  to authenticated
  using (true);

alter publication supabase_realtime add table public.form_fields;

create or replace function public.create_visit_enforced(
  p_visit_id text,
  p_customer_id text,
  p_salesman_id text,
  p_visit_type text,
  p_captured_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_meters double precision,
  p_photo_path text,
  p_notes text,
  p_next_action text,
  p_follow_up_date date,
  p_visit_started_at timestamptz default null,
  p_dynamic_fields jsonb default '{}'::jsonb,
  p_max_gps_accuracy_meters double precision default 30
)
returns visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer customers;
  v_distance double precision;
  v_visit visits;
  v_max_acc double precision;
  v_radius_m double precision := 100;
begin
  if p_visit_id is null or btrim(p_visit_id) = '' then
    raise exception 'Visit id is required';
  end if;

  select * into v_customer from customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'Customer does not exist';
  end if;

  v_max_acc := coalesce(p_max_gps_accuracy_meters, 30);
  if v_max_acc < 5 or v_max_acc > 500 then
    v_max_acc := 30;
  end if;

  if p_accuracy_meters > v_max_acc then
    raise exception 'GPS accuracy must be <= % meters (reported: %)', v_max_acc, p_accuracy_meters;
  end if;

  if p_visit_type = 'Existing customer' then
    v_distance :=
      6371000 * acos(
        cos(radians(v_customer.lat)) * cos(radians(p_lat)) * cos(radians(p_lng) - radians(v_customer.lng))
        + sin(radians(v_customer.lat)) * sin(radians(p_lat))
      );
    if v_distance > v_radius_m then
      raise exception 'Visit rejected: outside %sm customer radius (%.2f m)', v_radius_m, v_distance;
    end if;
  else
    v_distance := null;
  end if;

  insert into visits (
    id,
    customer_id,
    salesman_id,
    visit_type,
    captured_at,
    lat,
    lng,
    accuracy_meters,
    distance_from_customer_meters,
    photo_path,
    notes,
    next_action,
    follow_up_date,
    visit_started_at,
    dynamic_fields
  )
  values (
    p_visit_id,
    p_customer_id,
    p_salesman_id,
    p_visit_type,
    p_captured_at,
    p_lat,
    p_lng,
    p_accuracy_meters,
    v_distance,
    p_photo_path,
    p_notes,
    p_next_action,
    p_follow_up_date,
    p_visit_started_at,
    coalesce(p_dynamic_fields, '{}'::jsonb)
  )
  returning * into v_visit;

  return v_visit;
end;
$$;
