-- SAFETY-PR2
-- Allow orphan invoice_fees cleanup during restore wipe.
-- Keep strict checks for INSERT/UPDATE, but do not block DELETE when parent invoice is already gone.

CREATE OR REPLACE FUNCTION public.guard_invoice_fees_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_invoice_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  SELECT i.id, i.user_id, i.status
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = v_invoice_id;

  IF v_invoice IS NULL THEN
    -- SAFETY: permit cleanup of orphan rows (common during disaster-force-wipe flows).
    -- INSERT/UPDATE still require a valid parent invoice.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Invois tidak ditemui untuk caj platform.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id IS DISTINCT FROM v_invoice.user_id THEN
      RAISE EXCEPTION 'Pemilikan caj platform tidak sepadan dengan invois.';
    END IF;
  ELSE
    IF NEW.user_id IS DISTINCT FROM v_invoice.user_id THEN
      RAISE EXCEPTION 'Pemilikan caj platform tidak sepadan dengan invois.';
    END IF;

    IF NEW.fee_rule_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.platform_fee_rules r
      WHERE r.id = NEW.fee_rule_id
        AND r.user_id = v_invoice.user_id
    ) THEN
      RAISE EXCEPTION 'Rule caj platform tidak sah untuk invois ini.';
    END IF;
  END IF;

  IF v_invoice.status IN ('paid', 'partially_returned', 'returned') THEN
    RAISE EXCEPTION 'Caj platform tidak boleh diubah selepas invois dibayar.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
