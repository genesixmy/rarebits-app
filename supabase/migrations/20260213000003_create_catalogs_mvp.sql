-- Catalog MVP: owner-managed catalogs + public read RPCs

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  selection_type TEXT NOT NULL DEFAULT 'all',
  public_code TEXT NOT NULL UNIQUE DEFAULT lower(encode(gen_random_bytes(9), 'hex')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS selection_type TEXT,
  ADD COLUMN IF NOT EXISTS public_code TEXT DEFAULT lower(encode(gen_random_bytes(9), 'hex')),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.catalog_items (
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (catalog_id, item_id)
);

ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.catalogs
SET public_code = lower(encode(gen_random_bytes(9), 'hex'))
WHERE public_code IS NULL OR btrim(public_code) = '';

UPDATE public.catalogs
SET selection_type = 'all'
WHERE selection_type IS NULL OR selection_type::TEXT = '';

ALTER TABLE public.catalogs
  ALTER COLUMN selection_type SET DEFAULT 'all';

ALTER TABLE public.catalogs
  ALTER COLUMN selection_type SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogs_public_code
  ON public.catalogs(public_code);

CREATE INDEX IF NOT EXISTS idx_catalogs_user_id
  ON public.catalogs(user_id);

CREATE INDEX IF NOT EXISTS idx_catalog_items_item_id
  ON public.catalog_items(item_id);

ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalogs' AND policyname = 'catalogs_select_own'
  ) THEN
    CREATE POLICY catalogs_select_own
    ON public.catalogs
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalogs' AND policyname = 'catalogs_insert_own'
  ) THEN
    CREATE POLICY catalogs_insert_own
    ON public.catalogs
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalogs' AND policyname = 'catalogs_update_own'
  ) THEN
    CREATE POLICY catalogs_update_own
    ON public.catalogs
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalogs' AND policyname = 'catalogs_delete_own'
  ) THEN
    CREATE POLICY catalogs_delete_own
    ON public.catalogs
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalog_items' AND policyname = 'catalog_items_select_own'
  ) THEN
    CREATE POLICY catalog_items_select_own
    ON public.catalog_items
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.catalogs c
        WHERE c.id = catalog_items.catalog_id
          AND c.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalog_items' AND policyname = 'catalog_items_insert_own'
  ) THEN
    CREATE POLICY catalog_items_insert_own
    ON public.catalog_items
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.catalogs c
        WHERE c.id = catalog_items.catalog_id
          AND c.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalog_items' AND policyname = 'catalog_items_update_own'
  ) THEN
    CREATE POLICY catalog_items_update_own
    ON public.catalog_items
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.catalogs c
        WHERE c.id = catalog_items.catalog_id
          AND c.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.catalogs c
        WHERE c.id = catalog_items.catalog_id
          AND c.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalog_items' AND policyname = 'catalog_items_delete_own'
  ) THEN
    CREATE POLICY catalog_items_delete_own
    ON public.catalog_items
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.catalogs c
        WHERE c.id = catalog_items.catalog_id
          AND c.user_id = auth.uid()
      )
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_catalogs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catalogs_updated_at ON public.catalogs;

CREATE TRIGGER trg_catalogs_updated_at
BEFORE UPDATE ON public.catalogs
FOR EACH ROW
EXECUTE FUNCTION public.set_catalogs_updated_at();

-- Avoid return-type conflict when function already exists with older OUT params
DROP FUNCTION IF EXISTS public.get_catalog_public(TEXT);
DROP FUNCTION IF EXISTS public.get_catalog_items_public(TEXT);

CREATE OR REPLACE FUNCTION public.get_catalog_public(p_public_code TEXT)
RETURNS TABLE(
  title TEXT,
  description TEXT
) AS $$
  SELECT
    c.title,
    c.description
  FROM public.catalogs c
  WHERE c.public_code = p_public_code
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

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
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_items_public(TEXT) TO anon, authenticated;
