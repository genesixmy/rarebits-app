-- C7.1: Public company identity for catalog header trust layer

DROP FUNCTION IF EXISTS public.get_catalog_company_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_company_public(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_company_public(
  p_public_code TEXT,
  p_access_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  company_name TEXT,
  logo_url TEXT,
  phone TEXT,
  website TEXT,
  footer_notes TEXT
) AS $$
  SELECT
    COALESCE(NULLIF(btrim(s.company_name), ''), NULLIF(btrim(p.username), ''), 'Penjual') AS company_name,
    CASE
      WHEN COALESCE(s.show_logo, TRUE) = TRUE THEN NULLIF(btrim(s.logo_url), '')
      ELSE NULL
    END AS logo_url,
    NULLIF(regexp_replace(COALESCE(s.phone, ''), '[^0-9+]', '', 'g'), '') AS phone,
    NULLIF(btrim(s.website), '') AS website,
    NULLIF(btrim(s.footer_notes), '') AS footer_notes
  FROM public.catalogs c
  LEFT JOIN public.invoice_settings s
    ON s.user_id = c.user_id
  LEFT JOIN public.profiles p
    ON p.id = c.user_id
  WHERE c.public_code = p_public_code
    AND c.is_active = TRUE
    AND (c.expires_at IS NULL OR c.expires_at > NOW())
    AND (
      c.visibility = 'public'
      OR (
        c.visibility = 'unlisted'
        AND c.access_code = public.normalize_catalog_access_code(p_access_code)
      )
    )
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.get_catalog_company_public(TEXT, TEXT) TO anon, authenticated;
