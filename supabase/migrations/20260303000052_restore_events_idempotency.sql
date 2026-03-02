-- SAFETY-PR3
-- Add idempotency support for restore events so duplicate restore requests
-- can return the most recent successful result without rerunning full restore.

ALTER TABLE public.restore_events
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_restore_events_user_idempotency_key
  ON public.restore_events (new_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restore_events_user_idempotency_scope
  ON public.restore_events (
    new_user_id,
    idempotency_key,
    restore_mode,
    source_backup_checksum,
    dry_run,
    force_wipe
  )
  WHERE idempotency_key IS NOT NULL;
