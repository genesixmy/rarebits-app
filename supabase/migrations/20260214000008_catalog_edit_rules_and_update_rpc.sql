-- C8: Catalog edit rules storage + atomic update RPC

ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS selected_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Legacy DBs may already have a stricter CHECK that only allows 'category'.
-- Replace any selection_type checks with a normalized, backward-safe constraint first.
DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.catalogs'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%selection_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.catalogs DROP CONSTRAINT IF EXISTS %I',
      constraint_row.conname
    );
  END LOOP;
END $$;

UPDATE public.catalogs
SET selection_type = CASE
  WHEN lower(btrim(COALESCE(selection_type, ''))) IN ('all', 'manual', 'category', 'categories')
    THEN lower(btrim(selection_type))
  ELSE 'manual'
END;

ALTER TABLE public.catalogs
  DROP CONSTRAINT IF EXISTS catalogs_selection_type_check;

ALTER TABLE public.catalogs
  ADD CONSTRAINT catalogs_selection_type_check
  CHECK (selection_type IN ('all', 'manual', 'category', 'categories'));

UPDATE public.catalogs
SET selection_type = 'categories'
WHERE lower(COALESCE(selection_type, '')) = 'category';

WITH inferred AS (
  SELECT
    c.id AS catalog_id,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(btrim(i.category), '')), NULL) AS categories
  FROM public.catalogs c
  LEFT JOIN public.catalog_items ci
    ON ci.catalog_id = c.id
  LEFT JOIN public.items i
    ON i.id = ci.item_id
  WHERE lower(COALESCE(c.selection_type, '')) = 'categories'
  GROUP BY c.id
)
UPDATE public.catalogs c
SET selected_categories = COALESCE(inferred.categories, ARRAY[]::TEXT[])
FROM inferred
WHERE inferred.catalog_id = c.id
  AND (
    c.selected_categories IS NULL
    OR array_length(c.selected_categories, 1) IS NULL
    OR array_length(c.selected_categories, 1) = 0
  );

DROP FUNCTION IF EXISTS public.update_catalog_with_items(UUID, UUID, TEXT, TEXT, TEXT, TEXT[], UUID[], TEXT, TEXT, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.update_catalog_with_items(
  p_catalog_id UUID,
  p_user_id UUID,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_selection_type TEXT DEFAULT 'manual',
  p_selected_categories TEXT[] DEFAULT NULL,
  p_item_ids UUID[] DEFAULT NULL,
  p_visibility TEXT DEFAULT NULL,
  p_access_code TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_cover_image_url TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  item_count INTEGER
) AS $$
DECLARE
  v_title TEXT;
  v_selection_type TEXT;
  v_selected_categories TEXT[] := ARRAY[]::TEXT[];
  v_item_ids UUID[] := ARRAY[]::UUID[];
  v_visibility TEXT;
  v_access_code TEXT;
  v_catalog_exists BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT FALSE, 'Tidak dibenarkan', 0;
    RETURN;
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_title, '')), '');
  IF v_title IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Tajuk katalog diperlukan', 0;
    RETURN;
  END IF;

  v_selection_type := lower(NULLIF(btrim(COALESCE(p_selection_type, 'manual')), ''));
  IF v_selection_type = 'category' THEN
    v_selection_type := 'categories';
  END IF;

  IF v_selection_type NOT IN ('all', 'categories', 'manual') THEN
    RETURN QUERY SELECT FALSE, 'selection_type tidak sah', 0;
    RETURN;
  END IF;

  IF v_selection_type = 'categories' THEN
    SELECT COALESCE(
      ARRAY_AGG(category_name ORDER BY category_name),
      ARRAY[]::TEXT[]
    )
    INTO v_selected_categories
    FROM (
      SELECT DISTINCT NULLIF(btrim(category_name), '') AS category_name
      FROM unnest(COALESCE(p_selected_categories, ARRAY[]::TEXT[])) AS category_name
      WHERE NULLIF(btrim(category_name), '') IS NOT NULL
    ) cleaned;
  END IF;

  IF v_selection_type = 'all' THEN
    SELECT COALESCE(
      ARRAY_AGG(i.id ORDER BY i.id),
      ARRAY[]::UUID[]
    )
    INTO v_item_ids
    FROM public.items i
    WHERE i.user_id = p_user_id;
  ELSIF v_selection_type = 'categories' THEN
    IF COALESCE(array_length(v_selected_categories, 1), 0) = 0 THEN
      RETURN QUERY SELECT FALSE, 'Pilih sekurang-kurangnya satu kategori', 0;
      RETURN;
    END IF;

    SELECT COALESCE(
      ARRAY_AGG(i.id ORDER BY i.id),
      ARRAY[]::UUID[]
    )
    INTO v_item_ids
    FROM public.items i
    WHERE i.user_id = p_user_id
      AND NULLIF(btrim(i.category), '') = ANY(v_selected_categories);
  ELSE
    SELECT COALESCE(
      ARRAY_AGG(item_id ORDER BY item_id),
      ARRAY[]::UUID[]
    )
    INTO v_item_ids
    FROM (
      SELECT DISTINCT incoming.item_id
      FROM unnest(COALESCE(p_item_ids, ARRAY[]::UUID[])) AS incoming(item_id)
      JOIN public.items i
        ON i.id = incoming.item_id
       AND i.user_id = p_user_id
    ) valid_items;
  END IF;

  IF COALESCE(array_length(v_item_ids, 1), 0) = 0 THEN
    RETURN QUERY SELECT FALSE, 'Tiada item yang sepadan untuk katalog ini', 0;
    RETURN;
  END IF;

  v_visibility := lower(NULLIF(btrim(COALESCE(p_visibility, 'public')), ''));
  IF v_visibility NOT IN ('public', 'unlisted') THEN
    v_visibility := 'public';
  END IF;

  IF v_visibility = 'unlisted' THEN
    v_access_code := public.normalize_catalog_access_code(p_access_code);
    IF v_access_code IS NULL THEN
      v_access_code := public.generate_catalog_access_code();
    END IF;
  ELSE
    v_access_code := NULL;
  END IF;

  SELECT TRUE
  INTO v_catalog_exists
  FROM public.catalogs c
  WHERE c.id = p_catalog_id
    AND c.user_id = p_user_id
  FOR UPDATE;

  IF NOT COALESCE(v_catalog_exists, FALSE) THEN
    RETURN QUERY SELECT FALSE, 'Katalog tidak ditemui', 0;
    RETURN;
  END IF;

  UPDATE public.catalogs c
  SET
    title = v_title,
    description = NULLIF(btrim(COALESCE(p_description, '')), ''),
    selection_type = v_selection_type,
    selected_categories = v_selected_categories,
    visibility = v_visibility,
    access_code = v_access_code,
    expires_at = p_expires_at,
    cover_image_url = NULLIF(btrim(COALESCE(p_cover_image_url, '')), ''),
    updated_at = NOW()
  WHERE c.id = p_catalog_id
    AND c.user_id = p_user_id;

  DELETE FROM public.catalog_items ci
  WHERE ci.catalog_id = p_catalog_id
    AND NOT (ci.item_id = ANY(v_item_ids));

  INSERT INTO public.catalog_items (catalog_id, item_id)
  SELECT p_catalog_id, item_id
  FROM unnest(v_item_ids) AS item_id
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT TRUE, 'Katalog berjaya dikemaskini', COUNT(*)::INTEGER
  FROM public.catalog_items
  WHERE catalog_id = p_catalog_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.update_catalog_with_items(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT[], UUID[], TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO authenticated;
