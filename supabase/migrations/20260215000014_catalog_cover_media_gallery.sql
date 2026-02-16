-- COV-1: reusable catalog cover gallery (upload once, reuse across catalogs).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.catalog_cover_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  filename TEXT,
  size_bytes BIGINT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.catalog_cover_media
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS public_url TEXT,
  ADD COLUMN IF NOT EXISTS filename TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.catalog_cover_media
SET created_at = NOW()
WHERE created_at IS NULL;

DELETE FROM public.catalog_cover_media
WHERE user_id IS NULL
  OR COALESCE(btrim(file_path), '') = ''
  OR COALESCE(btrim(public_url), '') = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_cover_media_size_non_negative'
      AND conrelid = 'public.catalog_cover_media'::regclass
  ) THEN
    ALTER TABLE public.catalog_cover_media
      ADD CONSTRAINT catalog_cover_media_size_non_negative
      CHECK (size_bytes IS NULL OR size_bytes >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_cover_media_width_non_negative'
      AND conrelid = 'public.catalog_cover_media'::regclass
  ) THEN
    ALTER TABLE public.catalog_cover_media
      ADD CONSTRAINT catalog_cover_media_width_non_negative
      CHECK (width IS NULL OR width >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_cover_media_height_non_negative'
      AND conrelid = 'public.catalog_cover_media'::regclass
  ) THEN
    ALTER TABLE public.catalog_cover_media
      ADD CONSTRAINT catalog_cover_media_height_non_negative
      CHECK (height IS NULL OR height >= 0);
  END IF;
END $$;

ALTER TABLE public.catalog_cover_media
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.catalog_cover_media
  ALTER COLUMN file_path SET NOT NULL;

ALTER TABLE public.catalog_cover_media
  ALTER COLUMN public_url SET NOT NULL;

ALTER TABLE public.catalog_cover_media
  ALTER COLUMN created_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_cover_media_file_path
  ON public.catalog_cover_media(file_path);

CREATE INDEX IF NOT EXISTS idx_catalog_cover_media_user_created_at
  ON public.catalog_cover_media(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_cover_media_user_filename
  ON public.catalog_cover_media(user_id, filename);

-- Backfill existing catalog covers already stored in item_images/catalog-covers.
INSERT INTO public.catalog_cover_media (
  user_id,
  file_path,
  public_url,
  filename,
  created_at
)
SELECT
  c.user_id,
  split_part(c.cover_image_url, '/item_images/', 2) AS file_path,
  c.cover_image_url AS public_url,
  NULLIF(regexp_replace(split_part(c.cover_image_url, '/item_images/', 2), '^.*/', ''), '') AS filename,
  COALESCE(c.updated_at, c.created_at, NOW()) AS created_at
FROM public.catalogs c
WHERE COALESCE(btrim(c.cover_image_url), '') <> ''
  AND split_part(c.cover_image_url, '/item_images/', 2) LIKE 'catalog-covers/%'
ON CONFLICT (file_path) DO UPDATE
SET
  public_url = EXCLUDED.public_url,
  user_id = EXCLUDED.user_id,
  filename = COALESCE(public.catalog_cover_media.filename, EXCLUDED.filename);

ALTER TABLE public.catalog_cover_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_cover_media'
      AND policyname = 'catalog_cover_media_select_own'
  ) THEN
    CREATE POLICY catalog_cover_media_select_own
    ON public.catalog_cover_media
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_cover_media'
      AND policyname = 'catalog_cover_media_insert_own'
  ) THEN
    CREATE POLICY catalog_cover_media_insert_own
    ON public.catalog_cover_media
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_cover_media'
      AND policyname = 'catalog_cover_media_update_own'
  ) THEN
    CREATE POLICY catalog_cover_media_update_own
    ON public.catalog_cover_media
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'catalog_cover_media'
      AND policyname = 'catalog_cover_media_delete_own'
  ) THEN
    CREATE POLICY catalog_cover_media_delete_own
    ON public.catalog_cover_media
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.catalog_cover_media FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalog_cover_media TO authenticated;
