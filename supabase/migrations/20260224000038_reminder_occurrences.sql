-- REM-7
-- Per-occurrence completion state for recurring reminders

CREATE TABLE IF NOT EXISTS public.reminder_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_id UUID NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_occurrences_unique_user_reminder_date
  ON public.reminder_occurrences(user_id, reminder_id, occurrence_date);

CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_user_id
  ON public.reminder_occurrences(user_id);

CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_reminder_id
  ON public.reminder_occurrences(reminder_id);

CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_occurrence_date
  ON public.reminder_occurrences(occurrence_date);

ALTER TABLE public.reminder_occurrences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reminder_occurrences'
      AND policyname = 'reminder_occurrences_select_own'
  ) THEN
    CREATE POLICY reminder_occurrences_select_own
      ON public.reminder_occurrences
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reminder_occurrences'
      AND policyname = 'reminder_occurrences_insert_own'
  ) THEN
    CREATE POLICY reminder_occurrences_insert_own
      ON public.reminder_occurrences
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reminder_occurrences'
      AND policyname = 'reminder_occurrences_update_own'
  ) THEN
    CREATE POLICY reminder_occurrences_update_own
      ON public.reminder_occurrences
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reminder_occurrences'
      AND policyname = 'reminder_occurrences_delete_own'
  ) THEN
    CREATE POLICY reminder_occurrences_delete_own
      ON public.reminder_occurrences
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reminder_occurrences TO authenticated;
