-- Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
-- © 2026 WhiteRock (Royal Enterprise). All rights reserved.
--
-- Unauthorized copying, modification, or distribution is strictly prohibited.

create table if not exists public.password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  mobile text not null,
  otp text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_otps_user on public.password_reset_otps (user_id, created_at desc);
create index if not exists idx_password_reset_otps_mobile on public.password_reset_otps (mobile, created_at desc);

alter table public.password_reset_otps enable row level security;
