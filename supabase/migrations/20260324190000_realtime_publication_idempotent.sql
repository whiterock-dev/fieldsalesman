-- Ensure workspace tables emit Realtime events (safe if already in supabase_realtime).
-- Fixes partial applies of older migrations that used non-idempotent ALTER PUBLICATION.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_invites',
    'profiles',
    'customers',
    'followups',
    'visits',
    'live_locations',
    'meeting_responses'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
