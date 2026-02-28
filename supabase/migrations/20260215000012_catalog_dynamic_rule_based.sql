-- CATALOG-D1: move catalogs from static snapshot to dynamic rule-based selection.
-- Keep catalog_items table for backward compatibility/migration history only.

ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS include_all_items BOOLEAN,
  ADD COLUMN IF NOT EXISTS allowed_category_ids UUID[],
  ADD COLUMN IF NOT EXISTS allowed_tag_ids UUID[],
  ADD COLUMN IF NOT EXISTS only_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS manual_item_ids UUID[];

UPDATE public.catalogs
SET
  include_all_items = COALESCE(include_all_items, FALSE),
  allowed_category_ids = COALESCE(allowed_category_ids, ARRAY[]::UUID[]),
  allowed_tag_ids = COALESCE(allowed_tag_ids, ARRAY[]::UUID[]),
  only_available = COALESCE(only_available, TRUE),
  manual_item_ids = COALESCE(manual_item_ids, ARRAY[]::UUID[]);

ALTER TABLE public.catalogs
  ALTER COLUMN include_all_items SET DEFAULT FALSE,
  ALTER COLUMN include_all_items SET NOT NULL,
  ALTER COLUMN allowed_category_ids SET DEFAULT ARRAY[]::UUID[],
  ALTER COLUMN allowed_category_ids SET NOT NULL,
  ALTER COLUMN allowed_tag_ids SET DEFAULT ARRAY[]::UUID[],
  ALTER COLUMN allowed_tag_ids SET NOT NULL,
  ALTER COLUMN only_available SET DEFAULT TRUE,
  ALTER COLUMN only_available SET NOT NULL,
  ALTER COLUMN manual_item_ids SET DEFAULT ARRAY[]::UUID[],
  ALTER COLUMN manual_item_ids SET NOT NULL;

-- Migrate old snapshot catalogs:
-- use catalog_items as initial manual override list so existing public links keep behavior.
WITH legacy_snapshot AS (
  SELECT
    c.id AS catalog_id,
    COALESCE(ARRAY(
      SELECT DISTINCT ci.item_id
      FROM public.catalog_items ci
      WHERE ci.catalog_id = c.id
        AND ci.item_id IS NOT NULL
      ORDER BY ci.item_id
    ), ARRAY[]::UUID[]) AS item_ids
  FROM public.catalogs c
)
UPDATE public.catalogs c
SET
  include_all_items = FALSE,
  manual_item_ids = ls.item_ids,
  updated_at = NOW()
FROM legacy_snapshot ls
WHERE ls.catalog_id = c.id;

DROP FUNCTION IF EXISTS public.get_catalog_rule_items(UUID);

CREATE OR REPLACE FUNCTION public.get_catalog_rule_items(
  p_catalog_id UUID
)
RETURNS TABLE(
  item_id UUID,
  user_id UUID,
  available_quantity INTEGER
) AS $$
  WITH catalog_rule AS (
    SELECT
      c.id,
      c.user_id,
      COALESCE(c.include_all_items, FALSE) AS include_all_items,
      COALESCE(c.allowed_category_ids, ARRAY[]::UUID[]) AS allowed_category_ids,
      COALESCE(c.allowed_tag_ids, ARRAY[]::UUID[]) AS allowed_tag_ids,
      COALESCE(c.only_available, TRUE) AS only_available,
      COALESCE(c.manual_item_ids, ARRAY[]::UUID[]) AS manual_item_ids
    FROM public.catalogs c
    WHERE c.id = p_catalog_id
  ),
  candidate_items AS (
    SELECT
      i.id AS item_id,
      rule.user_id,
      GREATEST(
        COALESCE(i.quantity, 0) - GREATEST(COALESCE(res.total_reserved, 0), COALESCE(i.quantity_reserved, 0)),
        0
      )::INTEGER AS available_quantity
    FROM catalog_rule rule
    JOIN public.items i
      ON i.user_id = rule.user_id
    LEFT JOIN public.categories cat
      ON cat.user_id = rule.user_id
     AND cat.name = i.category
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ir.quantity_reserved), 0)::INTEGER AS total_reserved
      FROM public.inventory_reservations ir
      WHERE ir.item_id = i.id
    ) res ON TRUE
    WHERE
      rule.include_all_items = TRUE
      OR i.id = ANY(rule.manual_item_ids)
      OR (
        COALESCE(array_length(rule.allowed_category_ids, 1), 0) > 0
        AND cat.id = ANY(rule.allowed_category_ids)
      )
  )
  SELECT
    ci.item_id,
    ci.user_id,
    ci.available_quantity
  FROM candidate_items ci
  JOIN catalog_rule rule ON TRUE
  WHERE rule.only_available = FALSE
    OR ci.available_quantity > 0
  ORDER BY ci.item_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

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
    COALESCE(CASE WHEN cb.access_granted THEN live_counts.item_count ELSE 0 END, 0)::INTEGER AS item_count,
    cb.visibility,
    cb.requires_access,
    cb.access_granted,
    cb.is_active,
    cb.is_expired,
    cb.expires_at
  FROM catalog_base cb
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS item_count
    FROM public.get_catalog_rule_items(cb.id)
  ) live_counts
    ON cb.access_granted;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp, auth;

GRANT EXECUTE ON FUNCTION public.get_catalog_public(TEXT, TEXT) TO anon, authenticated;

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
  WITH accessible_catalog AS (
    SELECT c.id, c.user_id
    FROM public.catalogs c
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
    LIMIT 1
  ),
  scoped_items AS (
    SELECT
      rule_items.item_id,
      rule_items.available_quantity,
      accessible_catalog.user_id
    FROM accessible_catalog
    JOIN LATERAL public.get_catalog_rule_items(accessible_catalog.id) rule_items
      ON TRUE
  )
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
    si.available_quantity
  FROM scoped_items si
  JOIN public.items i
    ON i.id = si.item_id
   AND i.user_id = si.user_id
  LEFT JOIN public.categories cat
    ON cat.user_id = si.user_id
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
  ORDER BY i.created_at DESC, i.name ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.get_catalog_items_public(TEXT, TEXT) TO anon, authenticated;

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
  v_allowed_category_ids UUID[] := ARRAY[]::UUID[];
  v_manual_item_ids UUID[] := ARRAY[]::UUID[];
  v_visibility TEXT;
  v_access_code TEXT;
  v_catalog_exists BOOLEAN := FALSE;
  v_only_available BOOLEAN := TRUE;
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

    IF COALESCE(array_length(v_selected_categories, 1), 0) = 0 THEN
      RETURN QUERY SELECT FALSE, 'Pilih sekurang-kurangnya satu kategori', 0;
      RETURN;
    END IF;

    SELECT COALESCE(
      ARRAY_AGG(cat.id ORDER BY cat.id),
      ARRAY[]::UUID[]
    )
    INTO v_allowed_category_ids
    FROM public.categories cat
    WHERE cat.user_id = p_user_id
      AND lower(btrim(cat.name)) = ANY(
        ARRAY(
          SELECT lower(btrim(name_value))
          FROM unnest(v_selected_categories) AS name_value
        )
      );

    IF COALESCE(array_length(v_allowed_category_ids, 1), 0) = 0 THEN
      RETURN QUERY SELECT FALSE, 'Kategori dipilih tidak sah', 0;
      RETURN;
    END IF;
  END IF;

  SELECT COALESCE(
    ARRAY_AGG(item_id ORDER BY item_id),
    ARRAY[]::UUID[]
  )
  INTO v_manual_item_ids
  FROM (
    SELECT DISTINCT incoming.item_id
    FROM unnest(COALESCE(p_item_ids, ARRAY[]::UUID[])) AS incoming(item_id)
    JOIN public.items i
      ON i.id = incoming.item_id
     AND i.user_id = p_user_id
  ) valid_items;

  IF v_selection_type = 'manual' AND COALESCE(array_length(v_manual_item_ids, 1), 0) = 0 THEN
    RETURN QUERY SELECT FALSE, 'Pilih sekurang-kurangnya satu item', 0;
    RETURN;
  END IF;

  IF v_selection_type = 'all' THEN
    v_manual_item_ids := ARRAY[]::UUID[];
    v_allowed_category_ids := ARRAY[]::UUID[];
    v_selected_categories := ARRAY[]::TEXT[];
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

  SELECT TRUE, COALESCE(c.only_available, TRUE)
  INTO v_catalog_exists, v_only_available
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
    include_all_items = (v_selection_type = 'all'),
    allowed_category_ids = v_allowed_category_ids,
    allowed_tag_ids = COALESCE(c.allowed_tag_ids, ARRAY[]::UUID[]),
    manual_item_ids = v_manual_item_ids,
    only_available = COALESCE(v_only_available, TRUE),
    visibility = v_visibility,
    access_code = v_access_code,
    expires_at = p_expires_at,
    cover_image_url = NULLIF(btrim(COALESCE(p_cover_image_url, '')), ''),
    updated_at = NOW()
  WHERE c.id = p_catalog_id
    AND c.user_id = p_user_id;

  RETURN QUERY
  SELECT
    TRUE,
    'Katalog berjaya dikemaskini',
    COUNT(*)::INTEGER
  FROM public.get_catalog_rule_items(p_catalog_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.update_catalog_with_items(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT[], UUID[], TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO authenticated;

