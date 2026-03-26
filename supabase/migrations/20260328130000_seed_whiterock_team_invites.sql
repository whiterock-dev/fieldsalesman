-- Seed invited team emails (roles can be adjusted in app or via SQL).
-- hello@axitmehta.com as owner; others as field salesmen.
insert into public.app_invites (email, role, added_at) values
  ('axit@nerdshouse.com', 'salesman', now()),
  ('ea.royalenterprise1818@gmail.com', 'salesman', now()),
  ('fieldsaleswr04@gmail.com', 'salesman', now()),
  ('hello@axitmehta.com', 'owner', now()),
  ('retailoperationheadwr@gmail.com', 'salesman', now()),
  ('whiterock.devx@gmail.com', 'salesman', now())
on conflict (email) do nothing;
