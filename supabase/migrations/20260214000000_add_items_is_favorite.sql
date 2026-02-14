-- I1: Add favorite flag for inventory items

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.items
SET is_favorite = FALSE
WHERE is_favorite IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_user_favorite_created_at
  ON public.items(user_id, is_favorite DESC, created_at DESC);
