-- SAFETY-TP7
-- Tournament completion boundary for single elimination run finalization.

ALTER TABLE IF EXISTS public.tournament_bracket_runs
  ADD COLUMN IF NOT EXISTS champion_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS champion_seed_number INTEGER NULL CHECK (champion_seed_number BETWEEN 1 AND 4096),
  ADD COLUMN IF NOT EXISTS champion_snapshot_ref TEXT NULL,
  ADD COLUMN IF NOT EXISTS final_match_id UUID NULL REFERENCES public.tournament_bracket_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

ALTER TABLE IF EXISTS public.tournament_bracket_runs
  DROP CONSTRAINT IF EXISTS tournament_bracket_runs_status_check;

ALTER TABLE IF EXISTS public.tournament_bracket_runs
  ADD CONSTRAINT tournament_bracket_runs_status_check
  CHECK (status IN ('draft', 'prepared', 'archived', 'completed'));
