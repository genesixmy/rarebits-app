-- C9: Public catalog items include ordered image gallery URLs (cover + media list)

DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_items_public(
  p_public_code TEXT,
  p_access_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  item_id UUID,
  name TEXT,
  image_url TEXT,
  cover_image_url TEXT,
  image_urls TEXT[],
  images TEXT[],
  selling_price NUMERIC,
  category TEXT,
  category_color TEXT,
  available_quantity INTEGER
) AS $$
  SELECT
    i.id AS item_id,
    COALESCE(i.name, 'Item') AS name,
    COALESCE(
      NULLIF(btrim(media.cover_image_url), ''),
      NULLIF(btrim(i.image_url), '')
    ) AS image_url,
    COALESCE(
      NULLIF(btrim(media.cover_image_url), ''),
      NULLIF(btrim(i.image_url), '')
    ) AS cover_image_url,
    CASE
      WHEN COALESCE(array_length(media.image_urls, 1), 0) > 0 THEN media.image_urls
      WHEN COALESCE(NULLIF(btrim(i.image_url), ''), '') <> '' THEN ARRAY[NULLIF(btrim(i.image_url), '')]
      ELSE ARRAY[]::TEXT[]
    END AS image_urls,
    CASE
      WHEN COALESCE(array_length(media.image_urls, 1), 0) > 0 THEN media.image_urls
      WHEN COALESCE(NULLIF(btrim(i.image_url), ''), '') <> '' THEN ARRAY[NULLIF(btrim(i.image_url), '')]
      ELSE ARRAY[]::TEXT[]
    END AS images,
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
    SELECT
      ARRAY_AGG(im.url ORDER BY
        CASE WHEN im.is_cover THEN 0 ELSE 1 END,
        im.position ASC,
        im.created_at ASC,
        im.id ASC
      ) FILTER (WHERE COALESCE(btrim(im.url), '') <> '') AS image_urls,
      (
        ARRAY_AGG(im.url ORDER BY
          CASE WHEN im.is_cover THEN 0 ELSE 1 END,
          im.position ASC,
          im.created_at ASC,
          im.id ASC
        ) FILTER (WHERE COALESCE(btrim(im.url), '') <> '')
      )[1] AS cover_image_url
    FROM public.item_media im
    WHERE im.item_id = i.id
  ) media ON TRUE
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

GRANT EXECUTE ON FUNCTION public.get_catalog_items_public(TEXT, TEXT) TO anon, authenticated;
