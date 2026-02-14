-- M1: Multi-image support for inventory items (cover + ordering)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.item_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.item_media
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'item_media_position_non_negative'
      AND conrelid = 'public.item_media'::regclass
  ) THEN
    ALTER TABLE public.item_media
      ADD CONSTRAINT item_media_position_non_negative
      CHECK (position >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_item_media_item_id
  ON public.item_media(item_id);

CREATE INDEX IF NOT EXISTS idx_item_media_item_id_position
  ON public.item_media(item_id, position, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_media_single_cover_per_item
  ON public.item_media(item_id)
  WHERE is_cover = TRUE;

-- Backfill legacy single-image items into item_media.
INSERT INTO public.item_media (item_id, url, position, is_cover)
SELECT
  i.id,
  i.image_url,
  0,
  TRUE
FROM public.items i
WHERE COALESCE(btrim(i.image_url), '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.item_media im
    WHERE im.item_id = i.id
  );

-- Normalize cover flags: keep exactly one cover per item when media exists.
WITH ranked AS (
  SELECT
    im.id,
    ROW_NUMBER() OVER (
      PARTITION BY im.item_id
      ORDER BY
        CASE WHEN im.is_cover THEN 0 ELSE 1 END,
        im.position ASC,
        im.created_at ASC,
        im.id ASC
    ) AS rn
  FROM public.item_media im
)
UPDATE public.item_media im
SET is_cover = (ranked.rn = 1)
FROM ranked
WHERE ranked.id = im.id;

-- Keep legacy items.image_url aligned to current cover URL.
UPDATE public.items i
SET image_url = cover.url
FROM (
  SELECT DISTINCT ON (im.item_id)
    im.item_id,
    im.url
  FROM public.item_media im
  ORDER BY
    im.item_id,
    im.is_cover DESC,
    im.position ASC,
    im.created_at ASC,
    im.id ASC
) cover
WHERE cover.item_id = i.id
  AND COALESCE(i.image_url, '') IS DISTINCT FROM COALESCE(cover.url, '');

ALTER TABLE public.item_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'item_media'
      AND policyname = 'item_media_select_own'
  ) THEN
    CREATE POLICY item_media_select_own
    ON public.item_media
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_media.item_id
          AND i.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'item_media'
      AND policyname = 'item_media_insert_own'
  ) THEN
    CREATE POLICY item_media_insert_own
    ON public.item_media
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_media.item_id
          AND i.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'item_media'
      AND policyname = 'item_media_update_own'
  ) THEN
    CREATE POLICY item_media_update_own
    ON public.item_media
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_media.item_id
          AND i.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_media.item_id
          AND i.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'item_media'
      AND policyname = 'item_media_delete_own'
  ) THEN
    CREATE POLICY item_media_delete_own
    ON public.item_media
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = item_media.item_id
          AND i.user_id = auth.uid()
      )
    );
  END IF;
END $$;

REVOKE ALL ON TABLE public.item_media FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.item_media TO authenticated;
