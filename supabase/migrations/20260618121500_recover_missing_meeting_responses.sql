-- Data Recovery Script: Restore missing meeting responses
-- Description: Scans the `visits` table for any visits that have notes but are missing their corresponding `meeting_responses` record, and automatically inserts them.

INSERT INTO public.meeting_responses (
  id,
  customer_id,
  customer_name,
  salesman_id,
  salesman_name,
  response,
  created_at,
  visit_id
)
SELECT 
  'm-' || v.id AS id,
  v.customer_id,
  c.name AS customer_name,
  v.salesman_id,
  p.full_name AS salesman_name,
  v.notes AS response,
  v.captured_at AS created_at,
  v.id AS visit_id
FROM public.visits v
JOIN public.customers c ON v.customer_id = c.id
JOIN public.profiles p ON v.salesman_id = p.id
WHERE v.notes IS NOT NULL 
  AND trim(v.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.meeting_responses mr WHERE mr.visit_id = v.id
  )
ON CONFLICT (id) DO NOTHING;
