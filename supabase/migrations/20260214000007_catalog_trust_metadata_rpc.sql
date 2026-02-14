-- C7.4: Add trust metadata fields for public catalog badges

DROP FUNCTION IF EXISTS public.get_catalog_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_public(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_public(
  p_public_code TEXT,
  p_access_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  title TEXT,
  description TEXT,
  cover_image_url TEXT,
  public_code TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  seller_created_at TIMESTAMPTZ,
  item_count INTEGER,
  visibility TEXT,
  requires_access BOOLEAN,
  access_granted BOOLEAN,
  is_active BOOLEAN,
  is_expired BOOLEAN,
  expires_at TIMESTAMPTZ
) AS $$
  WITH catalog_base AS (
    SELECT
      c.id,
      c.title,
      c.description,
      c.cover_image_url,
      c.public_code,
      c.created_at,
      c.updated_at,
      u.created_at AS seller_created_at,
      c.visibility,
      c.is_active,
      c.expires_at,
      (c.visibility = 'unlisted') AS requires_access,
      CASE
        WHEN c.visibility = 'public' THEN TRUE
        WHEN c.visibility = 'unlisted'
          AND c.access_code IS NOT NULL
          AND c.access_code = public.normalize_catalog_access_code(p_access_code)
        THEN TRUE
        ELSE FALSE
      END AS access_granted,
      (c.expires_at IS NOT NULL AND c.expires_at <= NOW()) AS is_expired
    FROM public.catalogs c
    LEFT JOIN auth.users u
      ON u.id = c.user_id
    WHERE c.public_code = p_public_code
    LIMIT 1
  )
  SELECT
    CASE WHEN cb.access_granted THEN cb.title ELSE NULL END AS title,
    CASE WHEN cb.access_granted THEN cb.description ELSE NULL END AS description,
    CASE WHEN cb.access_granted THEN cb.cover_image_url ELSE NULL END AS cover_image_url,
    cb.public_code,
    cb.created_at,
    cb.updated_at,
    cb.seller_created_at,
    COALESCE(ci.item_count, 0)::INTEGER AS item_count,
    cb.visibility,
    cb.requires_access,
    cb.access_granted,
    cb.is_active,
    cb.is_expired,
    cb.expires_at
  FROM catalog_base cb
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS item_count
    FROM public.catalog_items x
    WHERE x.catalog_id = cb.id
  ) ci ON TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp, auth;

GRANT EXECUTE ON FUNCTION public.get_catalog_public(TEXT, TEXT) TO anon, authenticated;
