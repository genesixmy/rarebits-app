-- SAFETY-TP8
-- Minimal run lifecycle audit trail for tournament bracket runs.

CREATE TABLE IF NOT EXISTS public.tournament_run_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID NULL REFERENCES public.tournament_bracket_runs(id) ON DELETE SET NULL,
  snapshot_id UUID NULL REFERENCES public.tournament_bracket_snapshots(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'run_created',
      'run_archived',
      'run_completed',
      'run_rebuilt_from_snapshot',
      'new_run_started_from_snapshot'
    )
  ),
  event_note TEXT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_run_audit_events_tournament_created
  ON public.tournament_run_audit_events (tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_run_audit_events_user_created
  ON public.tournament_run_audit_events (user_id, created_at DESC);

ALTER TABLE public.tournament_run_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_run_audit_events_owner_select ON public.tournament_run_audit_events;
CREATE POLICY tournament_run_audit_events_owner_select
  ON public.tournament_run_audit_events
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_run_audit_events.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_run_audit_events_owner_insert ON public.tournament_run_audit_events;
CREATE POLICY tournament_run_audit_events_owner_insert
  ON public.tournament_run_audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_run_audit_events.tournament_id
        AND t.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON TABLE public.tournament_run_audit_events TO authenticated;
