-- Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
-- © 2026 WhiteRock (Royal Enterprise). All rights reserved.
--
-- Unauthorized copying, modification, or distribution is strictly prohibited.

-- Core CRM tables (required before create_visit_enforced, which returns composite type visits).
-- app_invites and meeting_responses (+ their RLS) are added in later migrations.

create table if not exists public.profiles (
  id text primary key,
  full_name text not null,
  role text not null check (role in ('owner', 'sub_admin', 'super_salesman', 'salesman')),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id text primary key,
  name text not null,
  phone text not null,
  whatsapp text,
  address text,
  city text,
  tags text[] not null default '{}',
  assigned_salesman_id text references public.profiles (id),
  dynamic_fields jsonb not null default '{}'::jsonb,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists public.followups (
  id text primary key,
  customer_id text not null references public.customers (id) on delete cascade,
  salesman_id text not null references public.profiles (id) on delete cascade,
  due_date date not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  status text not null check (status in ('pending', 'in_progress', 'closed')),
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists public.visits (
  id text primary key,
  customer_id text not null references public.customers (id) on delete cascade,
  salesman_id text not null references public.profiles (id) on delete cascade,
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
  dynamic_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists public.live_locations (
  id bigserial primary key,
  salesman_id text not null references public.profiles (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_meters double precision not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_followups_salesman_due_date on public.followups (salesman_id, due_date);
create index if not exists idx_visits_salesman_captured_at on public.visits (salesman_id, captured_at desc);
create index if not exists idx_live_locations_salesman_captured_at on public.live_locations (salesman_id, captured_at desc);
create index if not exists idx_form_fields_order on public.form_fields ("order", created_at);
