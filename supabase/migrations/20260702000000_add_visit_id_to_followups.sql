-- Add visit_id to followups table
alter table public.followups
add column visit_id text references public.visits (id) on delete set null;

create index if not exists idx_followups_visit_id on public.followups (visit_id);

-- Retroactively link existing followups to visits based on creation timestamps
-- Since a followup is inserted immediately after a visit is uploaded, their created_at timestamps are very close.
update public.followups f
set visit_id = v.id
from public.visits v
where f.customer_id = v.customer_id
  and f.salesman_id = v.salesman_id
  and abs(extract(epoch from (f.created_at - v.created_at))) < 300
  and f.visit_id is null;
