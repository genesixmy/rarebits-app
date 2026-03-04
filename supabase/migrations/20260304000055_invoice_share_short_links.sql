-- SAFETY-PR5
-- Short invoice share links with controlled public resolver.

CREATE TABLE IF NOT EXISTS public.invoice_share_links (
  short_code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_share_links_short_code_len CHECK (char_length(short_code) BETWEEN 6 AND 64),
  CONSTRAINT invoice_share_links_target_url_not_blank CHECK (char_length(btrim(target_url)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_share_links_invoice_id
  ON public.invoice_share_links (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_share_links_user_created_at
  ON public.invoice_share_links (user_id, created_at DESC);

ALTER TABLE public.invoice_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_share_links_owner_select ON public.invoice_share_links;
CREATE POLICY invoice_share_links_owner_select
  ON public.invoice_share_links
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS invoice_share_links_owner_insert ON public.invoice_share_links;
CREATE POLICY invoice_share_links_owner_insert
  ON public.invoice_share_links
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS invoice_share_links_owner_update ON public.invoice_share_links;
CREATE POLICY invoice_share_links_owner_update
  ON public.invoice_share_links
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS invoice_share_links_owner_delete ON public.invoice_share_links;
CREATE POLICY invoice_share_links_owner_delete
  ON public.invoice_share_links
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.resolve_invoice_share_link(p_short_code TEXT)
RETURNS TABLE (
  target_url TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
DECLARE
  v_code TEXT;
  v_share public.invoice_share_links%ROWTYPE;
BEGIN
  v_code := btrim(COALESCE(p_short_code, ''));
  IF v_code = '' THEN
    RETURN;
  END IF;

  SELECT l.*
  INTO v_share
  FROM public.invoice_share_links l
  WHERE l.short_code = v_code
    AND l.revoked_at IS NULL
    AND l.expires_at > NOW();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.invoice_share_links
  SET
    access_count = COALESCE(access_count, 0) + 1,
    last_accessed_at = NOW()
  WHERE short_code = v_share.short_code;

  RETURN QUERY
  SELECT v_share.target_url, v_share.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_invoice_share_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_share_link(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_share_link(TEXT) TO authenticated;

