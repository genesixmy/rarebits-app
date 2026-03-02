-- SAFETY-1-FIX
-- Business snapshot log for full backup exports (optional audit trail).

CREATE TABLE IF NOT EXISTS public.business_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_type TEXT NOT NULL DEFAULT 'full_backup' CHECK (snapshot_type IN ('full_backup')),
  file_name TEXT NOT NULL CHECK (btrim(file_name) <> ''),
  row_count_total INTEGER NOT NULL DEFAULT 0 CHECK (row_count_total >= 0),
  table_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  net_profit_current NUMERIC NOT NULL DEFAULT 0,
  total_revenue NUMERIC NOT NULL DEFAULT 0,
  total_expense NUMERIC NOT NULL DEFAULT 0,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_snapshots_user_id
  ON public.business_snapshots(user_id);

CREATE INDEX IF NOT EXISTS idx_business_snapshots_exported_at
  ON public.business_snapshots(exported_at DESC);

ALTER TABLE public.business_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'business_snapshots'
      AND policyname = 'business_snapshots_select_own'
  ) THEN
    CREATE POLICY business_snapshots_select_own
      ON public.business_snapshots
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
      AND tablename = 'business_snapshots'
      AND policyname = 'business_snapshots_insert_own'
  ) THEN
    CREATE POLICY business_snapshots_insert_own
      ON public.business_snapshots
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
      AND tablename = 'business_snapshots'
      AND policyname = 'business_snapshots_delete_own'
  ) THEN
    CREATE POLICY business_snapshots_delete_own
      ON public.business_snapshots
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.business_snapshots FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.business_snapshots TO authenticated;
