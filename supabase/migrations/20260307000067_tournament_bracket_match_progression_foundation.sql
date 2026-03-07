-- SAFETY-TP6
-- Single elimination winner assignment + controlled propagation foundation.

ALTER TABLE IF EXISTS public.tournament_bracket_matches
  ADD COLUMN IF NOT EXISTS winner_participant_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS winner_seed_number INTEGER NULL CHECK (winner_seed_number BETWEEN 1 AND 4096),
  ADD COLUMN IF NOT EXISTS winner_source_slot TEXT NULL CHECK (winner_source_slot IN ('A', 'B', 'BYE')),
  ADD COLUMN IF NOT EXISTS winner_snapshot_ref TEXT NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

ALTER TABLE IF EXISTS public.tournament_bracket_matches
  DROP CONSTRAINT IF EXISTS tournament_bracket_matches_match_status_check;

ALTER TABLE IF EXISTS public.tournament_bracket_matches
  ADD CONSTRAINT tournament_bracket_matches_match_status_check
  CHECK (match_status IN ('pending', 'ready', 'bye', 'completed', 'locked'));

UPDATE public.tournament_bracket_matches
SET match_status = CASE
  WHEN winner_participant_name IS NOT NULL THEN 'completed'
  WHEN match_status = 'completed_placeholder' THEN 'completed'
  ELSE match_status
END
WHERE match_status IN ('completed_placeholder', 'pending', 'ready', 'bye', 'locked')
  OR winner_participant_name IS NOT NULL;
