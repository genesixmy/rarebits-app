-- FEE-2
-- Add applies_to base for platform fee rules + invoice fee snapshots

ALTER TABLE public.platform_fee_rules
ADD COLUMN IF NOT EXISTS applies_to TEXT;

UPDATE public.platform_fee_rules
SET applies_to = CASE
  WHEN applies_to IN ('item_subtotal', 'shipping_charged', 'total_collected') THEN applies_to
  ELSE 'item_subtotal'
END;

ALTER TABLE public.platform_fee_rules
ALTER COLUMN applies_to SET DEFAULT 'item_subtotal';

ALTER TABLE public.platform_fee_rules
ALTER COLUMN applies_to SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_fee_rules_applies_to_allowed'
      AND conrelid = 'public.platform_fee_rules'::regclass
  ) THEN
    ALTER TABLE public.platform_fee_rules
      ADD CONSTRAINT platform_fee_rules_applies_to_allowed
      CHECK (applies_to IN ('item_subtotal', 'shipping_charged', 'total_collected'));
  END IF;
END $$;

ALTER TABLE public.invoice_fees
ADD COLUMN IF NOT EXISTS applies_to TEXT;

DO $$
DECLARE
  v_has_guard_trigger BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.invoice_fees'::regclass
      AND tgname = 'trg_guard_invoice_fees_mutation'
      AND NOT tgisinternal
  )
  INTO v_has_guard_trigger;

  IF v_has_guard_trigger THEN
    ALTER TABLE public.invoice_fees DISABLE TRIGGER trg_guard_invoice_fees_mutation;
  END IF;

  UPDATE public.invoice_fees
  SET applies_to = CASE
    WHEN applies_to IN ('item_subtotal', 'shipping_charged', 'total_collected') THEN applies_to
    ELSE 'item_subtotal'
  END;

  IF v_has_guard_trigger THEN
    ALTER TABLE public.invoice_fees ENABLE TRIGGER trg_guard_invoice_fees_mutation;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    IF v_has_guard_trigger THEN
      ALTER TABLE public.invoice_fees ENABLE TRIGGER trg_guard_invoice_fees_mutation;
    END IF;
    RAISE;
END $$;

ALTER TABLE public.invoice_fees
ALTER COLUMN applies_to SET DEFAULT 'item_subtotal';

ALTER TABLE public.invoice_fees
ALTER COLUMN applies_to SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_applies_to_allowed'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_applies_to_allowed
      CHECK (applies_to IN ('item_subtotal', 'shipping_charged', 'total_collected'));
  END IF;
END $$;
