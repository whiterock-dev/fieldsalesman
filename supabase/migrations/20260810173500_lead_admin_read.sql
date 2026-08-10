-- Migration: Add admin_review_read to leads
alter table public.leads
  add column if not exists admin_review_read boolean not null default false;
