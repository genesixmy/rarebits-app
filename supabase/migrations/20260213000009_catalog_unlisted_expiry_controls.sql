-- C6: Catalog basic access control (public/unlisted + expiry)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS access_code TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.catalogs
SET visibility = 'public'
WHERE visibility IS NULL OR btrim(visibility) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalogs_visibility_check'
      AND conrelid = 'public.catalogs'::regclass
  ) THEN
    ALTER TABLE public.catalogs
      ADD CONSTRAINT catalogs_visibility_check
      CHECK (visibility IN ('public', 'unlisted'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.generate_catalog_access_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT upper(substring(encode(gen_random_bytes(5), 'hex') from 1 for 8));
$$;

CREATE OR REPLACE FUNCTION public.normalize_catalog_access_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.enforce_catalog_access_controls()
RETURNS TRIGGER AS $$
DECLARE
  v_normalized_code TEXT;
BEGIN
  NEW.visibility := COALESCE(NULLIF(btrim(NEW.visibility), ''), 'public');

  IF NEW.visibility NOT IN ('public', 'unlisted') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'catalog visibility must be public or unlisted',
      ERRCODE = '22023';
  END IF;

  IF NEW.visibility = 'unlisted' THEN
    v_normalized_code := public.normalize_catalog_access_code(NEW.access_code);
    IF v_normalized_code IS NULL THEN
      v_normalized_code := public.generate_catalog_access_code();
    END IF;

    IF length(v_normalized_code) < 6 THEN
      RAISE EXCEPTION USING
        MESSAGE = 'catalog access_code must be at least 6 characters',
        ERRCODE = '22023';
    END IF;

    NEW.access_code := left(v_normalized_code, 12);
  ELSE
    NEW.access_code := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_catalog_access_controls ON public.catalogs;

CREATE TRIGGER trg_enforce_catalog_access_controls
BEFORE INSERT OR UPDATE OF visibility, access_code
ON public.catalogs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_catalog_access_controls();

UPDATE public.catalogs
SET
  visibility = CASE WHEN visibility IN ('public', 'unlisted') THEN visibility ELSE 'public' END,
  access_code = CASE
    WHEN visibility = 'unlisted' THEN COALESCE(public.normalize_catalog_access_code(access_code), public.generate_catalog_access_code())
    ELSE NULL
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalogs_unlisted_requires_access_code'
      AND conrelid = 'public.catalogs'::regclass
  ) THEN
    ALTER TABLE public.catalogs
      ADD CONSTRAINT catalogs_unlisted_requires_access_code
      CHECK (
        (visibility = 'unlisted' AND access_code IS NOT NULL AND btrim(access_code) <> '')
        OR (visibility = 'public' AND access_code IS NULL)
      );
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_catalog_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_public(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_contact_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_contact_public(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_public(
  p_public_code TEXT,
  p_access_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  title TEXT,
  description TEXT,
  public_code TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
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
      c.public_code,
      c.created_at,
      c.updated_at,
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
    WHERE c.public_code = p_public_code
    LIMIT 1
  )
  SELECT
    CASE WHEN cb.access_granted THEN cb.title ELSE NULL END AS title,
    CASE WHEN cb.access_granted THEN cb.description ELSE NULL END AS description,
    cb.public_code,
    cb.created_at,
    cb.updated_at,
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
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_catalog_items_public(
  p_public_code TEXT,
  p_access_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  item_id UUID,
  name TEXT,
  image_url TEXT,
  selling_price NUMERIC,
  category TEXT,
  category_color TEXT,
  available_quantity INTEGER
) AS $$
  SELECT
    i.id AS item_id,
    i.name,
    i.image_url,
    COALESCE(i.selling_price, 0)::NUMERIC AS selling_price,
    i.category,
    cat.color AS category_color,
    GREATEST(
      COALESCE(i.quantity, 0) - GREATEST(COALESCE(res.total_reserved, 0), COALESCE(i.quantity_reserved, 0)),
      0
    )::INTEGER AS available_quantity
  FROM public.catalogs c
  JOIN public.catalog_items ci
    ON ci.catalog_id = c.id
  JOIN public.items i
    ON i.id = ci.item_id
  LEFT JOIN public.categories cat
    ON cat.user_id = c.user_id
   AND cat.name = i.category
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(ir.quantity_reserved), 0)::INTEGER AS total_reserved
    FROM public.inventory_reservations ir
    WHERE ir.item_id = i.id
  ) res ON TRUE
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
  ORDER BY i.created_at DESC, i.name ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_catalog_contact_public(
  p_public_code TEXT,
  p_access_code TEXT DEFAULT NULL
)
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

GRANT EXECUTE ON FUNCTION public.get_catalog_public(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_items_public(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_contact_public(TEXT, TEXT) TO anon, authenticated;
