-- T1: Tag system foundation (per-user tags + item_tags join table)
-- Adds catalog allowed_tag_ids filtering via get_catalog_rule_items().

ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS allowed_tag_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.tags
SET
  name = COALESCE(NULLIF(btrim(name), ''), 'Tag'),
  updated_at = COALESCE(updated_at, NOW())
WHERE name IS NULL
   OR btrim(name) = ''
   OR updated_at IS NULL;

ALTER TABLE public.tags
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tags_name_not_blank_check'
      AND conrelid = 'public.tags'::regclass
  ) THEN
    ALTER TABLE public.tags
      ADD CONSTRAINT tags_name_not_blank_check
      CHECK (btrim(name) <> '');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_name_unique
  ON public.tags(user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_tags_user_id
  ON public.tags(user_id);

CREATE TABLE IF NOT EXISTS public.item_tags (
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, tag_id)
);

ALTER TABLE public.item_tags
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_item_tags_tag_id
  ON public.item_tags(tag_id);

CREATE INDEX IF NOT EXISTS idx_item_tags_item_id
  ON public.item_tags(item_id);

CREATE OR REPLACE FUNCTION public.set_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tags_updated_at ON public.tags;

CREATE TRIGGER trg_tags_updated_at
BEFORE UPDATE ON public.tags
FOR EACH ROW
EXECUTE FUNCTION public.set_tags_updated_at();

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_tags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tags' AND policyname = 'tags_select_own'
  ) THEN
    CREATE POLICY tags_select_own
    ON public.tags
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tags' AND policyname = 'tags_insert_own'
  ) THEN
    CREATE POLICY tags_insert_own
    ON public.tags
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tags' AND policyname = 'tags_update_own'
  ) THEN
    CREATE POLICY tags_update_own
    ON public.tags
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tags' AND policyname = 'tags_delete_own'
  ) THEN
    CREATE POLICY tags_delete_own
    ON public.tags
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'item_tags' AND policyname = 'item_tags_select_own'
  ) THEN
    CREATE POLICY item_tags_select_own
    ON public.item_tags
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_tags.item_id
          AND i.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.tags t
        WHERE t.id = item_tags.tag_id
          AND t.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'item_tags' AND policyname = 'item_tags_insert_own'
  ) THEN
    CREATE POLICY item_tags_insert_own
    ON public.item_tags
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_tags.item_id
          AND i.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.tags t
        WHERE t.id = item_tags.tag_id
          AND t.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'item_tags' AND policyname = 'item_tags_update_own'
  ) THEN
    CREATE POLICY item_tags_update_own
    ON public.item_tags
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_tags.item_id
          AND i.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.tags t
        WHERE t.id = item_tags.tag_id
          AND t.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_tags.item_id
          AND i.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.tags t
        WHERE t.id = item_tags.tag_id
          AND t.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'item_tags' AND policyname = 'item_tags_delete_own'
  ) THEN
    CREATE POLICY item_tags_delete_own
    ON public.item_tags
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_tags.item_id
          AND i.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.tags t
        WHERE t.id = item_tags.tag_id
          AND t.user_id = auth.uid()
      )
    );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_tags TO authenticated;

DROP FUNCTION IF EXISTS public.get_user_tags();

CREATE OR REPLACE FUNCTION public.get_user_tags()
RETURNS TABLE(
  id UUID,
  name TEXT,
  color TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
  SELECT
    t.id,
    t.name,
    t.color,
    t.created_at,
    t.updated_at
  FROM public.tags t
  WHERE t.user_id = auth.uid()
  ORDER BY lower(btrim(t.name)) ASC, t.created_at ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_user_tags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_tags() TO authenticated;

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
      (
        rule.include_all_items = TRUE
        OR i.id = ANY(rule.manual_item_ids)
        OR (
          COALESCE(array_length(rule.allowed_category_ids, 1), 0) > 0
          AND cat.id = ANY(rule.allowed_category_ids)
        )
      )
      AND (
        COALESCE(array_length(rule.allowed_tag_ids, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.item_tags it
          JOIN public.tags t
            ON t.id = it.tag_id
          WHERE it.item_id = i.id
            AND it.tag_id = ANY(rule.allowed_tag_ids)
            AND t.user_id = rule.user_id
        )
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

