-- Migration: Add customer_id and salesman_id to meeting_responses and backfill data
-- Description: Supports robust relational tracking for meeting notes, especially from New Leads.

-- Step 1: Add the relational columns
ALTER TABLE public.meeting_responses
  ADD COLUMN IF NOT EXISTS customer_id text REFERENCES public.customers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS salesman_id text REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Step 2: Backfill IDs using the linked visits table (Safest method for existing visits)
UPDATE public.meeting_responses mr
SET customer_id = v.customer_id,
    salesman_id = v.salesman_id
FROM public.visits v
WHERE mr.visit_id = v.id;

-- Step 3: Backfill remaining from customers and profiles by name matching (Fallback for New Leads)
UPDATE public.meeting_responses mr
SET salesman_id = p.id
FROM public.profiles p
WHERE mr.salesman_id IS NULL AND mr.salesman_name = p.full_name;

UPDATE public.meeting_responses mr
SET customer_id = c.id
FROM public.customers c
WHERE mr.customer_id IS NULL AND mr.customer_name = c.name;

-- Ensure indexes exist for the new foreign keys
CREATE INDEX IF NOT EXISTS idx_meeting_responses_customer_id ON public.meeting_responses(customer_id);
CREATE INDEX IF NOT EXISTS idx_meeting_responses_salesman_id ON public.meeting_responses(salesman_id);
