-- Role model.
create table if not exists profiles (
  id text primary key,
  full_name text not null,
  role text not null check (role in ('owner', 'sub_admin', 'super_salesman', 'salesman')),
  created_at timestamptz not null default now()
);

-- CRM customers/leads.
create table if not exists customers (
  id text primary key,
  name text not null,
  phone text not null,
  whatsapp text,
  address text,
  city text,
  tags text[] not null default '{}',
  assigned_salesman_id text references profiles(id),
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

-- Follow-up task storage.
create table if not exists followups (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  salesman_id text not null references profiles(id) on delete cascade,
  due_date date not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  status text not null check (status in ('pending', 'in_progress', 'closed')),
  remarks text,
  created_at timestamptz not null default now()
);

-- Visit log with anti-fake fields.
create table if not exists visits (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  salesman_id text not null references profiles(id) on delete cascade,
  visit_type text not null check (visit_type in ('New lead', 'Existing customer', 'Follow-up', 'Collection', 'Complaint')),
  captured_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_meters double precision not null,
  distance_from_customer_meters double precision,
  photo_path text not null,
  notes text not null,
  next_action text,
  follow_up_date date,
  created_at timestamptz not null default now()
);

-- Live tracking points.
create table if not exists live_locations (
  id bigserial primary key,
  salesman_id text not null references profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_meters double precision not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_followups_salesman_due_date on followups(salesman_id, due_date);
create index if not exists idx_visits_salesman_captured_at on visits(salesman_id, captured_at desc);
create index if not exists idx_live_locations_salesman_captured_at on live_locations(salesman_id, captured_at desc);

-- Server-side 30m rule for existing customers.
create or replace function public.create_visit_enforced(
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
  p_max_gps_accuracy_meters double precision default 30
)
returns visits
language plpgsql
security definer
as $$
declare
  v_customer customers;
  v_distance double precision;
  v_visit visits;
  v_max_acc double precision;
begin
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
    -- Approximate earth distance in meters.
    v_distance :=
      6371000 * acos(
        cos(radians(v_customer.lat)) * cos(radians(p_lat)) * cos(radians(p_lng) - radians(v_customer.lng))
        + sin(radians(v_customer.lat)) * sin(radians(p_lat))
      );
    if v_distance > 30 then
      raise exception 'Visit rejected: outside 30m customer radius (%.2f m)', v_distance;
    end if;
  else
    v_distance := null;
  end if;

  insert into visits (
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
    follow_up_date
  )
  values (
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
    p_follow_up_date
  )
  returning * into v_visit;

  return v_visit;
end;
$$;

-- IMPORTANT:
-- Add row level security policies to match your exact access model.
-- This file keeps policies intentionally minimal for initial setup.

