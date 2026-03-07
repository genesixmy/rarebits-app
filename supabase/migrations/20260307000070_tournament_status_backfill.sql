-- SAFETY-11.5: data-only status backfill for tournament root rows.
-- Rule:
-- - latest run completed => tournaments.status = 'completed'
-- - latest run prepared/draft => tournaments.status = 'ongoing'
-- - no run => unchanged
WITH latest_runs AS (
  SELECT DISTINCT ON (r.tournament_id, r.user_id)
    r.tournament_id,
    r.user_id,
    r.status
  FROM public.tournament_bracket_runs r
  ORDER BY
    r.tournament_id,
    r.user_id,
    r.created_at DESC,
    r.updated_at DESC,
    r.id DESC
),
status_backfill AS (
  SELECT
    lr.tournament_id,
    lr.user_id,
    CASE
      WHEN lr.status = 'completed' THEN 'completed'
      WHEN lr.status IN ('prepared', 'draft') THEN 'ongoing'
      ELSE NULL
    END AS next_status
  FROM latest_runs lr
)
UPDATE public.tournaments t
SET status = sb.next_status
FROM status_backfill sb
WHERE t.id = sb.tournament_id
  AND t.user_id = sb.user_id
  AND sb.next_status IS NOT NULL
  AND COALESCE(t.status, '') <> sb.next_status;