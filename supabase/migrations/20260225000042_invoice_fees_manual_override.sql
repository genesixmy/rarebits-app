-- FEE-3
-- Optional manual override per invoice fee line (per-invoice, read-only after paid via existing trigger guard)

ALTER TABLE public.invoice_fees
ADD COLUMN IF NOT EXISTS amount_override NUMERIC;

UPDATE public.invoice_fees
SET amount_override = NULL
WHERE amount_override IS NOT NULL
  AND amount_override < 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_amount_override_non_negative'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_amount_override_non_negative
      CHECK (amount_override IS NULL OR amount_override >= 0);
  END IF;
END $$;
