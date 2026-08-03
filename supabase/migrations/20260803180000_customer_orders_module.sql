-- Customer Orders module & product master migration
-- Adds customer_orders table, product_master table, and summary columns on customers table.

create table if not exists customer_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references customers(id) on delete cascade,
  order_number text,
  order_date date not null,
  order_value numeric not null default 0,
  products jsonb not null default '[]'::jsonb, -- Array of items: [{"productName": string, "sellingRate": number, "orderValue": number}]
  salesman_id text references profiles(id) on delete set null,
  salesman_name text,
  remark text,
  created_by text references profiles(id) on delete set null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_orders_customer on customer_orders(customer_id, order_date desc);
create index if not exists idx_customer_orders_date on customer_orders(order_date desc);

alter table customers
  add column if not exists total_purchase_value numeric not null default 0,
  add column if not exists last_order_date date;

create table if not exists product_master (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed default product items if empty
insert into product_master (name, is_active)
values
  ('Gypsum Tile', true),
  ('T-Grid', true),
  ('Soffit Panel', true),
  ('Fluted Panel', true)
on conflict (name) do nothing;

-- Function to recompute total_purchase_value and last_order_date on a customer
create or replace function public.sync_customer_order_summary(p_customer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_last_date date;
begin
  select coalesce(sum(order_value), 0), max(order_date)
  into v_total, v_last_date
  from customer_orders
  where customer_id = p_customer_id and is_deleted = false;

  update customers
  set total_purchase_value = coalesce(v_total, 0),
      last_order_date = v_last_date,
      updated_at = now()
  where id = p_customer_id;
end;
$$;

-- Trigger on customer_orders to automatically run sync_customer_order_summary
create or replace function public.trg_sync_customer_order_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform sync_customer_order_summary(old.customer_id);
    return old;
  elsif tg_op = 'UPDATE' then
    if old.customer_id <> new.customer_id then
      perform sync_customer_order_summary(old.customer_id);
    end if;
    perform sync_customer_order_summary(new.customer_id);
    return new;
  else
    perform sync_customer_order_summary(new.customer_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_customer_orders_sync on customer_orders;
create trigger trg_customer_orders_sync
after insert or update or delete on customer_orders
for each row execute function public.trg_sync_customer_order_summary();

-- Enable Row Level Security
alter table customer_orders enable row level security;
alter table product_master enable row level security;

-- Policies for customer_orders
create policy "Authenticated users can select customer_orders"
  on customer_orders for select using (true);

create policy "Admins and super_salesman can insert customer_orders"
  on customer_orders for insert with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()::text
      and profiles.role in ('owner', 'sub_admin', 'super_salesman')
    )
  );

create policy "Admins and super_salesman can update customer_orders"
  on customer_orders for update using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()::text
      and profiles.role in ('owner', 'sub_admin', 'super_salesman')
    )
  );

create policy "Admins and super_salesman can delete customer_orders"
  on customer_orders for delete using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()::text
      and profiles.role in ('owner', 'sub_admin', 'super_salesman')
    )
  );

-- Policies for product_master
create policy "All users can select product_master"
  on product_master for select using (true);

create policy "Admins can manage product_master"
  on product_master for all using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()::text
      and profiles.role in ('owner', 'sub_admin', 'super_salesman')
    )
  );
