-- SAFETY-TP3
-- Tournament seeding constraints for participant readiness (plugin isolated).

-- Safety cleanup: dropped participants must not keep seed number.
UPDATE public.tournament_participants
SET seed_number = NULL
WHERE registration_status = 'dropped'
  AND seed_number IS NOT NULL;

-- Safety cleanup: keep earliest row for duplicated (tournament_id, seed_number), clear others.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tournament_id, seed_number
      ORDER BY created_at ASC, id ASC
    ) AS row_rank
  FROM public.tournament_participants
  WHERE seed_number IS NOT NULL
)
UPDATE public.tournament_participants tp
SET seed_number = NULL
FROM ranked r
WHERE tp.id = r.id
  AND r.row_rank > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tournament_participants_dropped_seed_null'
  ) THEN
    ALTER TABLE public.tournament_participants
      ADD CONSTRAINT tournament_participants_dropped_seed_null
      CHECK (registration_status <> 'dropped' OR seed_number IS NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_participants_tournament_seed_unique
  ON public.tournament_participants (tournament_id, seed_number)
  WHERE seed_number IS NOT NULL;
