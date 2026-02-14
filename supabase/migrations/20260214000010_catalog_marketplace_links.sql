-- C7.5: Seller marketplace links for public catalog icon row

ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS shopee_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS lazada_url TEXT,
  ADD COLUMN IF NOT EXISTS carousell_url TEXT,
  ADD COLUMN IF NOT EXISTS show_marketplace_links BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.invoice_settings
SET show_marketplace_links = TRUE
WHERE show_marketplace_links IS NULL;

ALTER TABLE public.invoice_settings
  ALTER COLUMN show_marketplace_links SET DEFAULT TRUE;

ALTER TABLE public.invoice_settings
  ALTER COLUMN show_marketplace_links SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_settings_shopee_url_http_check'
      AND conrelid = 'public.invoice_settings'::regclass
  ) THEN
    ALTER TABLE public.invoice_settings
      ADD CONSTRAINT invoice_settings_shopee_url_http_check
      CHECK (
        shopee_url IS NULL OR btrim(shopee_url) = '' OR lower(btrim(shopee_url)) ~ '^https?://'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_settings_tiktok_url_http_check'
      AND conrelid = 'public.invoice_settings'::regclass
  ) THEN
    ALTER TABLE public.invoice_settings
      ADD CONSTRAINT invoice_settings_tiktok_url_http_check
      CHECK (
        tiktok_url IS NULL OR btrim(tiktok_url) = '' OR lower(btrim(tiktok_url)) ~ '^https?://'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_settings_lazada_url_http_check'
      AND conrelid = 'public.invoice_settings'::regclass
  ) THEN
    ALTER TABLE public.invoice_settings
      ADD CONSTRAINT invoice_settings_lazada_url_http_check
      CHECK (
        lazada_url IS NULL OR btrim(lazada_url) = '' OR lower(btrim(lazada_url)) ~ '^https?://'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_settings_carousell_url_http_check'
      AND conrelid = 'public.invoice_settings'::regclass
  ) THEN
    ALTER TABLE public.invoice_settings
      ADD CONSTRAINT invoice_settings_carousell_url_http_check
      CHECK (
        carousell_url IS NULL OR btrim(carousell_url) = '' OR lower(btrim(carousell_url)) ~ '^https?://'
      );
  END IF;
END $$;

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
  footer_notes TEXT,
  show_marketplace_links BOOLEAN,
  shopee_url TEXT,
  tiktok_url TEXT,
  lazada_url TEXT,
  carousell_url TEXT
) AS $$
  SELECT
    COALESCE(NULLIF(btrim(s.company_name), ''), NULLIF(btrim(p.username), ''), 'Penjual') AS company_name,
    CASE
      WHEN COALESCE(s.show_logo, TRUE) = TRUE THEN NULLIF(btrim(s.logo_url), '')
      ELSE NULL
    END AS logo_url,
    NULLIF(regexp_replace(COALESCE(s.phone, ''), '[^0-9+]', '', 'g'), '') AS phone,
    NULLIF(btrim(s.website), '') AS website,
    NULLIF(btrim(s.footer_notes), '') AS footer_notes,
    COALESCE(s.show_marketplace_links, TRUE) AS show_marketplace_links,
    CASE
      WHEN lower(COALESCE(btrim(s.shopee_url), '')) ~ '^https?://'
        THEN NULLIF(btrim(s.shopee_url), '')
      ELSE NULL
    END AS shopee_url,
    CASE
      WHEN lower(COALESCE(btrim(s.tiktok_url), '')) ~ '^https?://'
        THEN NULLIF(btrim(s.tiktok_url), '')
      ELSE NULL
    END AS tiktok_url,
    CASE
      WHEN lower(COALESCE(btrim(s.lazada_url), '')) ~ '^https?://'
        THEN NULLIF(btrim(s.lazada_url), '')
      ELSE NULL
    END AS lazada_url,
    CASE
      WHEN lower(COALESCE(btrim(s.carousell_url), '')) ~ '^https?://'
        THEN NULLIF(btrim(s.carousell_url), '')
      ELSE NULL
    END AS carousell_url
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
