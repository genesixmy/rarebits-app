-- Add invoice_id column to transactions if missing (required by mark_invoice_as_paid)

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS invoice_id uuid;

-- Optional FK (only add if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
      ON DELETE SET NULL;
  END IF;
END $$;
