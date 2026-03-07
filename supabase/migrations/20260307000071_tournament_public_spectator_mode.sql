-- SAFETY-12
-- Public spectator foundation (read-only, plugin-isolated).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.generate_tournament_public_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT lower(encode(gen_random_bytes(10), 'hex'));
$$;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS public_code TEXT;

UPDATE public.tournaments
SET public_code = public.generate_tournament_public_code()
WHERE public_code IS NULL OR btrim(public_code) = '';

ALTER TABLE public.tournaments
  ALTER COLUMN public_code SET DEFAULT public.generate_tournament_public_code();

ALTER TABLE public.tournaments
  ALTER COLUMN public_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_public_code_unique
  ON public.tournaments (public_code);

ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_public_code_len;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_public_code_len
  CHECK (char_length(public_code) BETWEEN 12 AND 64);

DROP FUNCTION IF EXISTS public.get_tournament_public_view(TEXT);

CREATE OR REPLACE FUNCTION public.get_tournament_public_view(p_public_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH selected_tournament AS (
  SELECT
    t.id,
    t.name,
    t.public_code,
    t.category,
    t.bracket_type,
    t.status,
    t.event_date,
    t.venue,
    t.max_players,
    t.match_format,
    t.round_time_minutes,
    t.created_at,
    t.updated_at
  FROM public.tournaments t
  WHERE t.public_code = p_public_code
  LIMIT 1
),
selected_run AS (
  SELECT
    r.id,
    r.tournament_id,
    r.bracket_type,
    r.status,
    r.total_rounds,
    r.participant_count,
    r.champion_name,
    r.champion_seed_number,
    r.completed_at,
    r.created_at,
    r.updated_at
  FROM public.tournament_bracket_runs r
  JOIN selected_tournament t
    ON t.id = r.tournament_id
  WHERE r.status IN ('prepared', 'draft', 'completed')
  ORDER BY
    CASE
      WHEN r.status IN ('prepared', 'draft') THEN 0
      WHEN r.status = 'completed' THEN 1
      ELSE 2
    END,
    r.created_at DESC,
    r.updated_at DESC,
    r.id DESC
  LIMIT 1
),
matches_payload AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'round_index', m.round_index,
        'match_index', m.match_index,
        'seed_a', m.seed_a,
        'seed_b', m.seed_b,
        'participant_a_name', m.participant_a_name,
        'participant_b_name', m.participant_b_name,
        'match_status', m.match_status,
        'winner_participant_name', m.winner_participant_name,
        'winner_seed_number', m.winner_seed_number,
        'winner_source_slot', m.winner_source_slot,
        'completed_at', m.completed_at
      )
      ORDER BY m.round_index, m.match_index
    ),
    '[]'::jsonb
  ) AS matches
  FROM public.tournament_bracket_matches m
  JOIN selected_run r
    ON r.id = m.run_id
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM selected_tournament) THEN (
    jsonb_build_object(
      'tournament',
      (
        SELECT jsonb_build_object(
          'name', t.name,
          'public_code', t.public_code,
          'category', t.category,
          'bracket_type', t.bracket_type,
          'status', t.status,
          'event_date', t.event_date,
          'venue', t.venue,
          'max_players', t.max_players,
          'match_format', t.match_format,
          'round_time_minutes', t.round_time_minutes,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        )
        FROM selected_tournament t
      ),
      'display_run',
      (
        SELECT CASE
          WHEN r.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'bracket_type', r.bracket_type,
            'status', r.status,
            'total_rounds', r.total_rounds,
            'participant_count', r.participant_count,
            'champion_name', r.champion_name,
            'champion_seed_number', r.champion_seed_number,
            'completed_at', r.completed_at,
            'created_at', r.created_at,
            'updated_at', r.updated_at
          )
        END
        FROM selected_run r
      ),
      'matches',
      (SELECT matches FROM matches_payload)
    )
  )
  ELSE NULL
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tournament_public_view(TEXT) TO anon, authenticated;
