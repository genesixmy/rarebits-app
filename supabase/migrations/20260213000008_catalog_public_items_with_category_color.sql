-- Public catalog items: include category color for colored tags on public page

DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_items_public(p_public_code TEXT)
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
  ORDER BY i.created_at DESC, i.name ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.get_catalog_items_public(TEXT) TO anon, authenticated;
