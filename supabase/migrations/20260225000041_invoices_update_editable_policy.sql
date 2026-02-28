-- FEE-2-FIX
-- Ensure users can edit their own non-paid invoices (including finalized)
-- while keeping paid/returned invoices immutable from client direct UPDATE.

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoices'
      AND policyname = 'invoices_update_editable_own'
  ) THEN
    CREATE POLICY invoices_update_editable_own
      ON public.invoices
      FOR UPDATE
      TO authenticated
      USING (
        auth.uid() = user_id
        AND status NOT IN ('paid', 'partially_returned', 'returned')
      )
      WITH CHECK (
        auth.uid() = user_id
        AND status NOT IN ('paid', 'partially_returned', 'returned')
      );
  END IF;
END $$;
