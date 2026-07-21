-- Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
-- © 2026 WhiteRock (Royal Enterprise). All rights reserved.
--
-- Unauthorized copying, modification, or distribution is strictly prohibited.

-- Invite list shared across devices (Settings → invited emails).
create table if not exists app_invites (
  email text primary key,
  role text not null check (role in ('owner', 'sub_admin', 'super_salesman', 'salesman')),
  added_at timestamptz not null default now()
);

-- Role model.
create table if not exists profiles (
  id text primary key,
  full_name text not null,
  role text not null check (role in ('owner', 'sub_admin', 'super_salesman', 'salesman')),
  email text,
  phone text,
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
  dynamic_fields jsonb not null default '{}'::jsonb,
  lat double precision not null,
  lng double precision not null,
  is_deleted boolean not null default false,
  category text check (category in ('A', 'B', 'C', 'D', 'E')),
  updated_at timestamptz not null default now(),
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
  is_deleted boolean not null default false,
  archived boolean not null default false,
  visit_id text references visits(id) on delete set null,
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
  visit_started_at timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  dynamic_fields jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
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

create table if not exists meeting_responses (
  id text primary key,
  customer_id text references customers(id) on delete cascade,
  customer_name text not null,
  salesman_id text references profiles(id) on delete cascade,
  salesman_name text not null,
  response text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  visit_id text
);

create table if not exists form_fields (
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

create table if not exists password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  mobile text not null,
  otp text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_responses_created_at on meeting_responses (created_at desc);
create index if not exists idx_meeting_responses_customer_id on meeting_responses (customer_id);
create index if not exists idx_meeting_responses_salesman_id on meeting_responses (salesman_id);
create index if not exists idx_form_fields_order on form_fields ("order", created_at);
create index if not exists idx_password_reset_otps_user on password_reset_otps (user_id, created_at desc);
create index if not exists idx_password_reset_otps_mobile on password_reset_otps (mobile, created_at desc);

-- Server-side: existing-customer visits must be within 100m of pin; GPS max accuracy via p_max_gps_accuracy_meters.
alter table password_reset_otps enable row level security;

-- Server-side: existing-customer visits must be within 100m of pin; GPS max accuracy via p_max_gps_accuracy_meters.
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
  p_priority text default 'medium',
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
    if v_customer.lat = 0 and v_customer.lng = 0 then
      -- First visit: update customer location and allow visit
      update customers set lat = p_lat, lng = p_lng where id = p_customer_id;
      v_distance := 0;
    else
      -- Subsequent visits: calculate and validate distance
      v_distance :=
        6371000 * acos(
          cos(radians(v_customer.lat)) * cos(radians(p_lat)) * cos(radians(p_lng) - radians(v_customer.lng))
          + sin(radians(v_customer.lat)) * sin(radians(p_lat))
        );
      if v_distance > v_radius_m then
        raise exception 'Visit rejected: outside %sm customer radius (%.2f m)', v_radius_m, v_distance;
      end if;
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
    priority,
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
    p_priority,
    coalesce(p_dynamic_fields, '{}'::jsonb)
  )
  returning * into v_visit;

  return v_visit;
end;
$$;

-- IMPORTANT:
-- Add row level security policies to match your exact access model.
-- This file keeps policies intentionally minimal for initial setup.


-- Customer edit audit log
create table if not exists customer_edit_log (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references customers(id) on delete cascade,
  edited_by text not null references profiles(id),
  edited_at timestamptz not null default now(),
  changed_fields jsonb not null default '{}'::jsonb
);

create index if not exists idx_customer_edit_log_customer on customer_edit_log(customer_id, edited_at desc);

-- Realtime
alter publication supabase_realtime add table customer_edit_log;

-- Enable RLS on audit log
ALTER TABLE customer_edit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and super_salesman can view all edit logs" ON customer_edit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid()::text 
      AND profiles.role IN ('owner', 'sub_admin', 'super_salesman')
    )
  );

CREATE POLICY "Salesman can view logs for their assigned customers" ON customer_edit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = customer_edit_log.customer_id
      AND customers.assigned_salesman_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert edit logs" ON customer_edit_log
  FOR INSERT WITH CHECK (auth.uid()::text = edited_by);

-- Customer delete audit log
create table if not exists customer_delete_log (
  id uuid primary key default gen_random_uuid(),
  deleted_by text not null references profiles(id),
  deleted_at timestamptz not null default now(),
  customer_ids jsonb not null,
  record_count int not null
);

create index if not exists idx_customer_delete_log_deleted_at on customer_delete_log(deleted_at desc);

-- Enable RLS on delete log
ALTER TABLE customer_delete_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all delete logs" ON customer_delete_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid()::text 
      AND profiles.role IN ('owner', 'sub_admin')
    )
  );

CREATE POLICY "Users can insert delete logs" ON customer_delete_log
  FOR INSERT WITH CHECK (auth.uid()::text = deleted_by);

-- Password reset audit log
create table if not exists password_reset_log (
  id uuid primary key default gen_random_uuid(),
  target_user_id text not null references profiles(id),
  target_email text not null,
  changed_by_id text not null references profiles(id),
  changed_by_name text not null,
  action text not null default 'Password Reset',
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_log_created_at
  on password_reset_log(created_at desc);

alter table password_reset_log enable row level security;

CREATE POLICY "Admins can view password reset logs" ON password_reset_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()::text
      AND profiles.role IN ('owner', 'sub_admin')
    )
  );

CREATE POLICY "System can insert password reset logs" ON password_reset_log
  FOR INSERT WITH CHECK (true);
