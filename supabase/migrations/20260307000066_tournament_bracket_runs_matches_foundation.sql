-- SAFETY-TP5
-- Single elimination match entities foundation (read-only progression skeleton).

CREATE TABLE IF NOT EXISTS public.tournament_bracket_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES public.tournament_bracket_snapshots(id) ON DELETE CASCADE,
  bracket_type TEXT NOT NULL CHECK (bracket_type IN ('swiss', 'single_elimination', 'double_elimination', 'round_robin')),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('draft', 'prepared', 'archived')),
  total_rounds INTEGER NOT NULL DEFAULT 1 CHECK (total_rounds >= 1),
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_bracket_runs_tournament_created
  ON public.tournament_bracket_runs (tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_bracket_runs_user_status
  ON public.tournament_bracket_runs (user_id, tournament_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_bracket_runs_prepared_per_tournament
  ON public.tournament_bracket_runs (tournament_id)
  WHERE status = 'prepared';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_bracket_runs_prepared_per_snapshot
  ON public.tournament_bracket_runs (snapshot_id)
  WHERE status = 'prepared';

CREATE TABLE IF NOT EXISTS public.tournament_bracket_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.tournament_bracket_runs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  round_index INTEGER NOT NULL CHECK (round_index >= 1),
  match_index INTEGER NOT NULL CHECK (match_index >= 1),
  bracket_side TEXT NULL,
  source_snapshot_id UUID NOT NULL REFERENCES public.tournament_bracket_snapshots(id) ON DELETE CASCADE,
  seed_a INTEGER NULL CHECK (seed_a BETWEEN 1 AND 4096),
  seed_b INTEGER NULL CHECK (seed_b BETWEEN 1 AND 4096),
  participant_a_name TEXT NULL,
  participant_b_name TEXT NULL,
  participant_a_snapshot_ref TEXT NULL,
  participant_b_snapshot_ref TEXT NULL,
  match_status TEXT NOT NULL DEFAULT 'locked' CHECK (match_status IN ('pending', 'bye', 'locked', 'completed_placeholder')),
  winner_slot_target_id UUID NULL REFERENCES public.tournament_bracket_matches(id) ON DELETE SET NULL,
  loser_slot_target_id UUID NULL REFERENCES public.tournament_bracket_matches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_bracket_matches_unique_position UNIQUE (run_id, round_index, match_index)
);

CREATE INDEX IF NOT EXISTS idx_tournament_bracket_matches_run_round
  ON public.tournament_bracket_matches (run_id, round_index, match_index);

CREATE INDEX IF NOT EXISTS idx_tournament_bracket_matches_tournament_status
  ON public.tournament_bracket_matches (tournament_id, match_status);

CREATE OR REPLACE FUNCTION public.set_tournament_bracket_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_tournament_bracket_matches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tournament_bracket_runs_updated_at ON public.tournament_bracket_runs;
CREATE TRIGGER trg_tournament_bracket_runs_updated_at
BEFORE UPDATE ON public.tournament_bracket_runs
FOR EACH ROW
EXECUTE FUNCTION public.set_tournament_bracket_runs_updated_at();

DROP TRIGGER IF EXISTS trg_tournament_bracket_matches_updated_at ON public.tournament_bracket_matches;
CREATE TRIGGER trg_tournament_bracket_matches_updated_at
BEFORE UPDATE ON public.tournament_bracket_matches
FOR EACH ROW
EXECUTE FUNCTION public.set_tournament_bracket_matches_updated_at();

ALTER TABLE public.tournament_bracket_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_bracket_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_bracket_runs_owner_select ON public.tournament_bracket_runs;
CREATE POLICY tournament_bracket_runs_owner_select
  ON public.tournament_bracket_runs
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_runs.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_runs_owner_insert ON public.tournament_bracket_runs;
CREATE POLICY tournament_bracket_runs_owner_insert
  ON public.tournament_bracket_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_runs.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_runs_owner_update ON public.tournament_bracket_runs;
CREATE POLICY tournament_bracket_runs_owner_update
  ON public.tournament_bracket_runs
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_runs.tournament_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_runs.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_runs_owner_delete ON public.tournament_bracket_runs;
CREATE POLICY tournament_bracket_runs_owner_delete
  ON public.tournament_bracket_runs
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_runs.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_matches_owner_select ON public.tournament_bracket_matches;
CREATE POLICY tournament_bracket_matches_owner_select
  ON public.tournament_bracket_matches
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_matches.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_matches_owner_insert ON public.tournament_bracket_matches;
CREATE POLICY tournament_bracket_matches_owner_insert
  ON public.tournament_bracket_matches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_matches.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_matches_owner_update ON public.tournament_bracket_matches;
CREATE POLICY tournament_bracket_matches_owner_update
  ON public.tournament_bracket_matches
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_matches.tournament_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_matches.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_bracket_matches_owner_delete ON public.tournament_bracket_matches;
CREATE POLICY tournament_bracket_matches_owner_delete
  ON public.tournament_bracket_matches
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_bracket_matches.tournament_id
        AND t.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tournament_bracket_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tournament_bracket_matches TO authenticated;
