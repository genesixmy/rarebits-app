-- Catalog public contact lookup (safe fields only)

DROP FUNCTION IF EXISTS public.get_catalog_contact_public(TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_contact_public(p_public_code TEXT)
RETURNS TABLE(
  whatsapp_phone TEXT,
  display_name TEXT
) AS $$
  SELECT
    NULLIF(regexp_replace(COALESCE(s.phone, ''), '[^0-9+]', '', 'g'), '') AS whatsapp_phone,
    COALESCE(NULLIF(btrim(s.company_name), ''), NULLIF(btrim(p.username), ''), 'Penjual') AS display_name
  FROM public.catalogs c
  LEFT JOIN public.invoice_settings s
    ON s.user_id = c.user_id
  LEFT JOIN public.profiles p
    ON p.id = c.user_id
  WHERE c.public_code = p_public_code
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_catalog_contact_public(TEXT) TO anon, authenticated;
