-- REM-6-FIX
-- Harden recurrence column types for environments that already have mismatched schema

DO $$
DECLARE
  v_recurrence_type TEXT;
  v_interval_type TEXT;
  v_until_type TEXT;
BEGIN
  SELECT data_type
  INTO v_recurrence_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'reminders'
    AND column_name = 'recurrence';

  IF v_recurrence_type IS NULL THEN
    ALTER TABLE public.reminders
    ADD COLUMN recurrence TEXT;
  ELSIF v_recurrence_type NOT IN ('text', 'character varying') THEN
    ALTER TABLE public.reminders
    ALTER COLUMN recurrence TYPE TEXT
    USING lower(btrim(recurrence::TEXT));
  END IF;

  SELECT data_type
  INTO v_interval_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'reminders'
    AND column_name = 'recurrence_interval';

  IF v_interval_type IS NULL THEN
    ALTER TABLE public.reminders
    ADD COLUMN recurrence_interval INTEGER;
  ELSIF v_interval_type <> 'integer' THEN
    ALTER TABLE public.reminders
    ALTER COLUMN recurrence_interval TYPE INTEGER
    USING (
      CASE
        WHEN recurrence_interval IS NULL THEN NULL
        WHEN btrim(recurrence_interval::TEXT) ~ '^[0-9]+$' THEN btrim(recurrence_interval::TEXT)::INTEGER
        ELSE 1
      END
    );
  END IF;

  SELECT data_type
  INTO v_until_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'reminders'
    AND column_name = 'recurrence_until';

  IF v_until_type IS NULL THEN
    ALTER TABLE public.reminders
    ADD COLUMN recurrence_until DATE;
  ELSIF v_until_type <> 'date' THEN
    ALTER TABLE public.reminders
    ALTER COLUMN recurrence_until TYPE DATE
    USING (
      CASE
        WHEN recurrence_until IS NULL THEN NULL
        WHEN btrim(recurrence_until::TEXT) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN recurrence_until::DATE
        ELSE NULL
      END
    );
  END IF;
END $$;

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

ALTER TABLE public.reminders
DROP CONSTRAINT IF EXISTS reminders_recurrence_allowed;

ALTER TABLE public.reminders
ADD CONSTRAINT reminders_recurrence_allowed
CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));

ALTER TABLE public.reminders
DROP CONSTRAINT IF EXISTS reminders_recurrence_interval_positive;

ALTER TABLE public.reminders
ADD CONSTRAINT reminders_recurrence_interval_positive
CHECK (recurrence_interval >= 1);

ALTER TABLE public.reminders
DROP CONSTRAINT IF EXISTS reminders_recurrence_until_valid;

ALTER TABLE public.reminders
ADD CONSTRAINT reminders_recurrence_until_valid
CHECK (recurrence_until IS NULL OR recurrence_until >= start_date);
