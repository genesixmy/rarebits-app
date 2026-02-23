-- FAV-2:
-- Fast-sell favorite suggestions based on paid invoices in a recent window.

DROP FUNCTION IF EXISTS public.get_fast_sell_suggestions(INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_fast_sell_suggestions(
  p_days INTEGER DEFAULT 30,
  p_min_sold INTEGER DEFAULT 3,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
  item_id UUID,
  item_name TEXT,
  sold_qty INTEGER,
  available_qty INTEGER,
  is_favorite BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      GREATEST(COALESCE(p_days, 30), 1) AS days_window,
      GREATEST(COALESCE(p_min_sold, 3), 1) AS min_sold,
      LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100) AS limit_rows
  ),
  reservation_totals AS (
    SELECT
      ir.item_id,
      COALESCE(SUM(GREATEST(COALESCE(ir.quantity_reserved, 0), 0)), 0)::INTEGER AS reserved_qty
    FROM public.inventory_reservations ir
    GROUP BY ir.item_id
  ),
  sold_counts AS (
    SELECT
      ii.item_id,
      COALESCE(SUM(GREATEST(COALESCE(ii.quantity, 1), 1)), 0)::INTEGER AS sold_qty
    FROM public.invoice_items ii
    JOIN public.invoices i
      ON i.id = ii.invoice_id
    CROSS JOIN params p
    WHERE ii.item_id IS NOT NULL
      AND i.user_id = auth.uid()
      AND i.status = 'paid'
      AND i.invoice_date >= (CURRENT_DATE - (p.days_window || ' days')::INTERVAL)::DATE
    GROUP BY ii.item_id
  ),
  eligible_items AS (
    SELECT
      it.id AS item_id,
      COALESCE(NULLIF(btrim(it.name), ''), 'Item') AS item_name,
      sc.sold_qty,
      GREATEST(
        COALESCE(it.quantity, 1)
        - COALESCE(rt.reserved_qty, COALESCE(it.quantity_reserved, 0), 0),
        0
      )::INTEGER AS available_qty,
      COALESCE(it.is_favorite, FALSE) AS is_favorite
    FROM sold_counts sc
    JOIN public.items it
      ON it.id = sc.item_id
    LEFT JOIN reservation_totals rt
      ON rt.item_id = it.id
    WHERE it.user_id = auth.uid()
      AND COALESCE(lower(btrim(it.status)), 'tersedia') <> 'terjual'
  )
  SELECT
    ei.item_id,
    ei.item_name,
    ei.sold_qty,
    ei.available_qty,
    ei.is_favorite
  FROM eligible_items ei
  WHERE ei.sold_qty >= (SELECT min_sold FROM params)
    AND ei.available_qty > 0
  ORDER BY
    ei.sold_qty DESC,
    lower(ei.item_name) ASC,
    ei.item_id ASC
  LIMIT (SELECT limit_rows FROM params);
$$;

REVOKE ALL ON FUNCTION public.get_fast_sell_suggestions(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fast_sell_suggestions(INTEGER, INTEGER, INTEGER) TO authenticated;
