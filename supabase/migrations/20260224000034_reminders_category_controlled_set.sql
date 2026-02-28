-- REM-4
-- Controlled reminder categories + data normalization

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS category TEXT;

UPDATE public.reminders
SET category = CASE
  WHEN category IS NULL OR btrim(category) = '' THEN 'general'
  WHEN lower(btrim(category)) IN ('general', 'event', 'payment', 'restock', 'customer', 'ops') THEN lower(btrim(category))
  ELSE 'general'
END;

ALTER TABLE public.reminders
ALTER COLUMN category SET DEFAULT 'general';

ALTER TABLE public.reminders
ALTER COLUMN category SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminders_category_allowed'
      AND conrelid = 'public.reminders'::regclass
  ) THEN
    ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_category_allowed
    CHECK (category IN ('general', 'event', 'payment', 'restock', 'customer', 'ops'));
  END IF;
END $$;
