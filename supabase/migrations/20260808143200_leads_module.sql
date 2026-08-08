-- Migration: Leads Module
-- Created: 2026-08-08
-- Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
-- © 2026 WhiteRock (Royal Enterprise). All rights reserved.

-- 1. Create leads table
CREATE TABLE public.leads (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
    salesman_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
    requirement_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    order_value NUMERIC(15, 2),
    closing_remarks TEXT,
    lost_reason TEXT,
    lost_remarks TEXT,
    admin_review_remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add lead_id to followups table
ALTER TABLE public.followups ADD COLUMN lead_id TEXT REFERENCES public.leads(id) ON DELETE CASCADE;

-- 3. Enable RLS on leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 4. Policies for leads (matching fieldsalesman authenticated true convention)
drop policy if exists "leads_select_authenticated" on public.leads;
drop policy if exists "leads_insert_authenticated" on public.leads;
drop policy if exists "leads_update_authenticated" on public.leads;
drop policy if exists "leads_delete_authenticated" on public.leads;

create policy "leads_select_authenticated"
  on public.leads for select to authenticated using (true);

create policy "leads_insert_authenticated"
  on public.leads for insert to authenticated with check (true);

create policy "leads_update_authenticated"
  on public.leads for update to authenticated using (true) with check (true);

create policy "leads_delete_authenticated"
  on public.leads for delete to authenticated using (true);

-- 5. Enable realtime for leads
ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
