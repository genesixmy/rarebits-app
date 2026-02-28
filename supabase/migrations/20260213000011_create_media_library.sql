-- M3: Per-user media library index for reusable inventory images

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.media_library
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.media_library
SET created_at = NOW()
WHERE created_at IS NULL;

DELETE FROM public.media_library
WHERE user_id IS NULL
  OR storage_path IS NULL
  OR btrim(storage_path) = ''
  OR url IS NULL
  OR btrim(url) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'media_library_size_bytes_non_negative'
      AND conrelid = 'public.media_library'::regclass
  ) THEN
    ALTER TABLE public.media_library
      ADD CONSTRAINT media_library_size_bytes_non_negative
      CHECK (size_bytes IS NULL OR size_bytes >= 0);
  END IF;
END $$;

ALTER TABLE public.media_library
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.media_library
  ALTER COLUMN storage_path SET NOT NULL;

ALTER TABLE public.media_library
  ALTER COLUMN url SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_library_storage_path
  ON public.media_library(storage_path);

CREATE INDEX IF NOT EXISTS idx_media_library_user_created_at
  ON public.media_library(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_library_user_filename
  ON public.media_library(user_id, original_filename);

-- Backfill existing uploaded item images into media_library.
INSERT INTO public.media_library (
  user_id,
  storage_path,
  url,
  original_filename
)
SELECT
  i.user_id,
  split_part(im.url, '/item_images/', 2) AS storage_path,
  im.url,
  NULLIF(split_part(split_part(im.url, '/item_images/', 2), '/', 2), '') AS original_filename
FROM public.item_media im
JOIN public.items i
  ON i.id = im.item_id
WHERE COALESCE(btrim(im.url), '') <> ''
  AND split_part(im.url, '/item_images/', 2) <> ''
ON CONFLICT (storage_path) DO UPDATE
SET
  url = EXCLUDED.url,
  user_id = EXCLUDED.user_id,
  original_filename = COALESCE(public.media_library.original_filename, EXCLUDED.original_filename);

ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'media_library'
      AND policyname = 'media_library_select_own'
  ) THEN
    CREATE POLICY media_library_select_own
    ON public.media_library
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'media_library'
      AND policyname = 'media_library_insert_own'
  ) THEN
    CREATE POLICY media_library_insert_own
    ON public.media_library
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'media_library'
      AND policyname = 'media_library_update_own'
  ) THEN
    CREATE POLICY media_library_update_own
    ON public.media_library
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'media_library'
      AND policyname = 'media_library_delete_own'
  ) THEN
    CREATE POLICY media_library_delete_own
    ON public.media_library
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.media_library FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_library TO authenticated;
