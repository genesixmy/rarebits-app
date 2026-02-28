-- REM-6
-- Basic recurring reminders (none/daily/weekly/monthly)

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS recurrence TEXT;

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER;

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS recurrence_until DATE;

UPDATE public.reminders
SET recurrence = CASE
  WHEN recurrence IS NULL OR btrim(recurrence) = '' THEN 'none'
  WHEN lower(btrim(recurrence)) IN ('none', 'daily', 'weekly', 'monthly') THEN lower(btrim(recurrence))
  ELSE 'none'
END;

UPDATE public.reminders
SET recurrence_interval = CASE
  WHEN recurrence_interval IS NULL OR recurrence_interval < 1 THEN 1
  ELSE recurrence_interval
END;

UPDATE public.reminders
SET recurrence_until = NULL
WHERE recurrence = 'none';

ALTER TABLE public.reminders
ALTER COLUMN recurrence SET DEFAULT 'none';

ALTER TABLE public.reminders
ALTER COLUMN recurrence SET NOT NULL;

ALTER TABLE public.reminders
ALTER COLUMN recurrence_interval SET DEFAULT 1;

ALTER TABLE public.reminders
ALTER COLUMN recurrence_interval SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminders_recurrence_allowed'
      AND conrelid = 'public.reminders'::regclass
  ) THEN
    ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_recurrence_allowed
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminders_recurrence_interval_positive'
      AND conrelid = 'public.reminders'::regclass
  ) THEN
    ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_recurrence_interval_positive
    CHECK (recurrence_interval >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminders_recurrence_until_valid'
      AND conrelid = 'public.reminders'::regclass
  ) THEN
    ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_recurrence_until_valid
    CHECK (recurrence_until IS NULL OR recurrence_until >= start_date);
  END IF;
END $$;
