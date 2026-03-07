-- SAFETY-TP4
-- Bracket input snapshot foundation (plugin isolated, read-only draft basis).

CREATE TABLE IF NOT EXISTS public.tournament_bracket_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bracket_type TEXT NOT NULL CHECK (bracket_type IN ('swiss', 'single_elimination', 'double_elimination', 'round_robin')),
  snapshot_status TEXT NOT NULL DEFAULT 'prepared' CHECK (snapshot_status IN ('draft', 'prepared', 'archived')),
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  seeded_count INTEGER NOT NULL DEFAULT 0 CHECK (seeded_count >= 0),
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_bracket_snapshots_tournament_created
  ON public.tournament_bracket_snapshots (tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_bracket_snapshots_user_status
  ON public.tournament_bracket_snapshots (user_id, tournament_id, snapshot_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_bracket_snapshots_prepared_unique
  ON public.tournament_bracket_snapshots (tournament_id)
  WHERE snapshot_status = 'prepared';

CREATE OR REPLACE FUNCTION public.set_tournament_bracket_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tournament_bracket_snapshots_updated_at ON public.tournament_bracket_snapshots;
CREATE TRIGGER trg_tournament_bracket_snapshots_updated_at
BEFORE UPDATE ON public.tournament_bracket_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.set_tournament_bracket_snapshots_updated_at();

ALTER TABLE public.tournament_bracket_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_bracket_snapshots_owner_select ON public.tournament_bracket_snapshots;
CREATE POLICY tournament_bracket_snapshots_owner_select
  ON public.tournament_bracket_snapshots
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_snapshots.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_snapshots_owner_insert ON public.tournament_bracket_snapshots;
CREATE POLICY tournament_bracket_snapshots_owner_insert
  ON public.tournament_bracket_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_snapshots.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_snapshots_owner_update ON public.tournament_bracket_snapshots;
CREATE POLICY tournament_bracket_snapshots_owner_update
  ON public.tournament_bracket_snapshots
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_snapshots.tournament_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_snapshots.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_snapshots_owner_delete ON public.tournament_bracket_snapshots;
CREATE POLICY tournament_bracket_snapshots_owner_delete
  ON public.tournament_bracket_snapshots
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_snapshots.tournament_id
        AND t.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tournament_bracket_snapshots TO authenticated;
