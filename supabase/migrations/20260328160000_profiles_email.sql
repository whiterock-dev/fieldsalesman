-- Link profiles to sign-in email for invite↔profile role reconciliation.
alter table public.profiles add column if not exists email text;

-- Backfill from Supabase Auth (fixes rows created before email was stored on profiles).
update public.profiles p
set email = u.email
from auth.users u
where u.id::text = p.id
  and (p.email is null or p.email = '');
