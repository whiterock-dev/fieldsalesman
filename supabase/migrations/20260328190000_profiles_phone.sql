-- Optional phone field for team directory / invite form.
alter table public.profiles add column if not exists phone text;

-- Backfill from Auth metadata when available.
update public.profiles p
set phone = coalesce((u.raw_user_meta_data->>'phone'), p.phone)
from auth.users u
where u.id::text = p.id
  and (p.phone is null or p.phone = '');
