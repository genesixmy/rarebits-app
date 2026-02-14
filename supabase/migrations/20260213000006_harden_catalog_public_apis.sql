-- C4: Harden public catalog APIs and code generation defaults

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.generate_catalog_public_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT lower(encode(gen_random_bytes(12), 'hex'));
$$;

UPDATE public.catalogs
SET public_code = public.generate_catalog_public_code()
WHERE public_code IS NULL OR btrim(public_code) = '';

ALTER TABLE public.catalogs
  ALTER COLUMN public_code SET DEFAULT public.generate_catalog_public_code();

ALTER TABLE public.catalogs
  ALTER COLUMN public_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogs_public_code
  ON public.catalogs(public_code);

REVOKE ALL ON TABLE public.catalogs FROM anon;
REVOKE ALL ON TABLE public.catalog_items FROM anon;

DROP FUNCTION IF EXISTS public.get_catalog_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_contact_public(TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_public(p_public_code TEXT)
RETURNS TABLE(
  title TEXT,
  description TEXT,
  public_code TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  item_count INTEGER
) AS $$
  SELECT
    c.title,
    c.description,
    c.public_code,
    c.created_at,
    c.updated_at,
    COALESCE(ci.item_count, 0)::INTEGER AS item_count
  FROM public.catalogs c
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS item_count
    FROM public.catalog_items x
    WHERE x.catalog_id = c.id
  ) ci ON TRUE
  WHERE c.public_code = p_public_code
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_catalog_items_public(p_public_code TEXT)
RETURNS TABLE(
  item_id UUID,
  name TEXT,
  image_url TEXT,
  selling_price NUMERIC,
  category TEXT,
  available_quantity INTEGER
) AS $$
  SELECT
    i.id AS item_id,
    i.name,
    i.image_url,
    COALESCE(i.selling_price, 0)::NUMERIC AS selling_price,
    i.category,
    GREATEST(
      COALESCE(i.quantity, 0) - GREATEST(COALESCE(res.total_reserved, 0), COALESCE(i.quantity_reserved, 0)),
      0
    )::INTEGER AS available_quantity
  FROM public.catalogs c
  JOIN public.catalog_items ci
    ON ci.catalog_id = c.id
  JOIN public.items i
    ON i.id = ci.item_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(ir.quantity_reserved), 0)::INTEGER AS total_reserved
    FROM public.inventory_reservations ir
    WHERE ir.item_id = i.id
  ) res ON TRUE
  WHERE c.public_code = p_public_code
  ORDER BY i.created_at DESC, i.name ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

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
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.get_catalog_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_items_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_contact_public(TEXT) TO anon, authenticated;
