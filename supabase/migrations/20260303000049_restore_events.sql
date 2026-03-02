-- SAFETY-5
-- Disaster recovery restore event logging.

CREATE TABLE IF NOT EXISTS public.restore_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_backup_checksum TEXT NOT NULL,
  old_user_id UUID NULL,
  new_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restore_mode TEXT NOT NULL CHECK (restore_mode IN ('self', 'disaster')),
  force_wipe BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restore_events_new_user_id_created_at
  ON public.restore_events (new_user_id, created_at DESC);

ALTER TABLE public.restore_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restore_events'
      AND policyname = 'Users can view own restore events'
  ) THEN
    CREATE POLICY "Users can view own restore events"
      ON public.restore_events
      FOR SELECT
      USING (new_user_id = auth.uid());
  END IF;
END;
$$;

REVOKE ALL ON public.restore_events FROM PUBLIC, anon;
GRANT SELECT ON public.restore_events TO authenticated;
GRANT ALL ON public.restore_events TO service_role;
