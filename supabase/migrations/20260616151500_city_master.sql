-- 1. Create the City Master table
create table if not exists public.city_master (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Ensure case-insensitive unique names so we don't accidentally insert duplicates
create unique index if not exists idx_city_master_name_lower on public.city_master(lower(name));

-- 3. Add city_id foreign key to customers
alter table public.customers add column if not exists city_id uuid references public.city_master(id);

-- 4. Automatically migrate unique cities safely from existing customer data
insert into public.city_master (name)
select distinct btrim(city)
from public.customers
where city is not null and btrim(city) != ''
on conflict (lower(name)) do nothing;

-- 5. Backfill the new city_id on all existing customers so no data is orphaned
update public.customers c
set city_id = cm.id
from public.city_master cm
where lower(btrim(c.city)) = lower(cm.name)
and c.city_id is null;
