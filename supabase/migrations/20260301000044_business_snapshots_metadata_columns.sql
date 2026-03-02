-- SAFETY-1-SCHEMA-FIX
-- Non-destructive alignment for business_snapshots export metadata fields.

ALTER TABLE public.business_snapshots
ADD COLUMN IF NOT EXISTS total_profit NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.business_snapshots
ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.business_snapshots
ADD COLUMN IF NOT EXISTS invoice_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.business_snapshots
ADD COLUMN IF NOT EXISTS inventory_value NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.business_snapshots
ADD COLUMN IF NOT EXISTS checksum TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_snapshots_invoice_count_non_negative'
      AND conrelid = 'public.business_snapshots'::regclass
  ) THEN
    ALTER TABLE public.business_snapshots
      ADD CONSTRAINT business_snapshots_invoice_count_non_negative
      CHECK (invoice_count >= 0);
  END IF;
END $$;
