-- REM-5
-- Add date-range support to reminders (start_date/end_date)

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS start_date DATE;

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS end_date DATE;

UPDATE public.reminders
SET start_date = COALESCE(start_date, due_date);

UPDATE public.reminders
SET end_date = start_date
WHERE end_date IS NOT NULL
  AND start_date IS NOT NULL
  AND end_date < start_date;

ALTER TABLE public.reminders
ALTER COLUMN start_date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminders_end_date_after_start_date'
      AND conrelid = 'public.reminders'::regclass
  ) THEN
    ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_end_date_after_start_date
    CHECK (end_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

-- Keep legacy due_date aligned as due boundary to preserve older reads.
UPDATE public.reminders
SET due_date = COALESCE(end_date, start_date, due_date);
