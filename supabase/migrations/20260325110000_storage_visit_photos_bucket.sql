-- Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
-- © 2026 WhiteRock (Royal Enterprise). All rights reserved.
--
-- Unauthorized copying, modification, or distribution is strictly prohibited.

-- Private bucket for visit JPEGs (path: {salesman_profile_id}/{visitId}.jpg)
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

-- Policies on storage.objects (RLS is enabled by default on Supabase Storage)
drop policy if exists "visit_photos_select_authenticated" on storage.objects;
drop policy if exists "visit_photos_insert_authenticated" on storage.objects;
drop policy if exists "visit_photos_update_authenticated" on storage.objects;
drop policy if exists "visit_photos_delete_authenticated" on storage.objects;

create policy "visit_photos_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'visit-photos');

create policy "visit_photos_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'visit-photos');

create policy "visit_photos_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'visit-photos')
  with check (bucket_id = 'visit-photos');

create policy "visit_photos_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'visit-photos');
