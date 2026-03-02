-- SAFETY-PR2
-- Add restore lock primitives to prevent concurrent restore on same account.

CREATE TABLE IF NOT EXISTS public.restore_locks (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  restore_mode TEXT NOT NULL CHECK (restore_mode IN ('self', 'disaster')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restore_locks_expires_at
  ON public.restore_locks (expires_at);

CREATE OR REPLACE FUNCTION public.try_acquire_restore_lock(
  p_user_id UUID,
  p_request_id UUID,
  p_restore_mode TEXT,
  p_ttl_seconds INTEGER DEFAULT 1200
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row_count INTEGER := 0;
  v_mode TEXT := LOWER(COALESCE(p_restore_mode, ''));
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required for restore lock.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required for restore lock.';
  END IF;

  IF v_mode NOT IN ('self', 'disaster') THEN
    RAISE EXCEPTION 'restore_mode must be self or disaster.';
  END IF;

  IF COALESCE(p_ttl_seconds, 0) < 60 THEN
    p_ttl_seconds := 60;
  END IF;

  INSERT INTO public.restore_locks (user_id, request_id, restore_mode, created_at, expires_at)
  VALUES (p_user_id, p_request_id, v_mode, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (user_id) DO UPDATE
  SET request_id = EXCLUDED.request_id,
      restore_mode = EXCLUDED.restore_mode,
      created_at = now(),
      expires_at = EXCLUDED.expires_at
  WHERE public.restore_locks.expires_at <= now();

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_restore_lock(
  p_user_id UUID,
  p_request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.restore_locks
  WHERE user_id = p_user_id
    AND (p_request_id IS NULL OR request_id = p_request_id);
END;
$$;

REVOKE ALL ON TABLE public.restore_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.restore_locks TO service_role;

REVOKE ALL ON FUNCTION public.try_acquire_restore_lock(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_restore_lock(UUID, UUID, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.release_restore_lock(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_restore_lock(UUID, UUID) TO service_role;
