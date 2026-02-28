-- FIN-AUDIT-2c
-- Normalize legacy NULL/blank adjustment types and enforce explicit type values.

ALTER TABLE public.invoice_refunds
ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE public.invoice_refunds
SET amount = ABS(amount)
WHERE amount < 0;

UPDATE public.invoice_refunds
SET refund_type = lower(btrim(refund_type))
WHERE refund_type IS NOT NULL
  AND btrim(refund_type) <> ''
  AND refund_type IS DISTINCT FROM lower(btrim(refund_type));

UPDATE public.invoice_refunds
SET type = lower(btrim(type))
WHERE type IS NOT NULL
  AND btrim(type) <> ''
  AND type IS DISTINCT FROM lower(btrim(type));

UPDATE public.invoice_refunds
SET refund_type = CASE
  WHEN COALESCE(affects_inventory, FALSE) OR legacy_return_id IS NOT NULL THEN 'return'
  WHEN COALESCE(amount, 0) < 0 THEN 'goodwill'
  WHEN lower(COALESCE(reason, '') || ' ' || COALESCE(note, '')) LIKE '%courtesy%'
    OR lower(COALESCE(reason, '') || ' ' || COALESCE(note, '')) LIKE '%gerak budi%'
    OR lower(COALESCE(reason, '') || ' ' || COALESCE(note, '')) LIKE '%diskaun%'
    OR lower(COALESCE(reason, '') || ' ' || COALESCE(note, '')) LIKE '%price adjustment%'
    OR lower(COALESCE(reason, '') || ' ' || COALESCE(note, '')) LIKE '%kompensasi%'
    THEN 'goodwill'
  ELSE 'goodwill'
END
WHERE refund_type IS NULL
  OR btrim(refund_type) = ''
  OR lower(btrim(refund_type)) NOT IN ('goodwill', 'return', 'cancel', 'correction');

UPDATE public.invoice_refunds
SET type = CASE
  WHEN type IS NOT NULL
    AND btrim(type) <> ''
    AND lower(btrim(type)) IN ('goodwill', 'return', 'cancel', 'correction')
    THEN lower(btrim(type))
  ELSE refund_type
END;

ALTER TABLE public.invoice_refunds
  ALTER COLUMN refund_type SET DEFAULT 'goodwill',
  ALTER COLUMN type SET DEFAULT 'goodwill';

ALTER TABLE public.invoice_refunds
  DROP CONSTRAINT IF EXISTS invoice_refunds_refund_type_check,
  DROP CONSTRAINT IF EXISTS invoice_refunds_refund_type_allowed,
  DROP CONSTRAINT IF EXISTS invoice_refunds_type_allowed;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_refunds_refund_type_allowed'
      AND conrelid = 'public.invoice_refunds'::regclass
  ) THEN
    ALTER TABLE public.invoice_refunds
      ADD CONSTRAINT invoice_refunds_refund_type_allowed
      CHECK (refund_type IN ('goodwill', 'return', 'cancel', 'correction'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_refunds_type_allowed'
      AND conrelid = 'public.invoice_refunds'::regclass
  ) THEN
    ALTER TABLE public.invoice_refunds
      ADD CONSTRAINT invoice_refunds_type_allowed
      CHECK (type IN ('goodwill', 'return', 'cancel', 'correction'));
  END IF;
END $$;

ALTER TABLE public.invoice_refunds
  ALTER COLUMN refund_type SET NOT NULL,
  ALTER COLUMN type SET NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_invoice_refund_type_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_hint TEXT;
BEGIN
  v_type := lower(btrim(COALESCE(NEW.type, NEW.refund_type, '')));
  v_hint := lower(COALESCE(NEW.reason, '') || ' ' || COALESCE(NEW.note, ''));

  IF v_type = '' THEN
    IF COALESCE(NEW.affects_inventory, FALSE) OR NEW.legacy_return_id IS NOT NULL THEN
      v_type := 'return';
    ELSIF COALESCE(NEW.amount, 0) < 0 THEN
      v_type := 'goodwill';
    ELSIF v_hint LIKE '%courtesy%'
      OR v_hint LIKE '%gerak budi%'
      OR v_hint LIKE '%diskaun%'
      OR v_hint LIKE '%price adjustment%'
      OR v_hint LIKE '%kompensasi%' THEN
      v_type := 'goodwill';
    ELSE
      RAISE EXCEPTION 'Jenis adjustment wajib dipilih.';
    END IF;
  END IF;

  IF v_type NOT IN ('goodwill', 'return', 'cancel', 'correction') THEN
    RAISE EXCEPTION 'Jenis adjustment tidak sah. Dibenarkan: goodwill, return, cancel, correction.';
  END IF;

  NEW.amount := ABS(COALESCE(NEW.amount, 0));
  NEW.refund_type := v_type;
  NEW.type := v_type;

  IF v_type = 'return' THEN
    NEW.affects_inventory := TRUE;
  ELSIF NEW.affects_inventory IS NULL THEN
    NEW.affects_inventory := FALSE;
  END IF;

  IF v_type <> 'return' THEN
    NEW.inventory_restocked := FALSE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_invoice_refund_type_columns ON public.invoice_refunds;

CREATE TRIGGER trg_normalize_invoice_refund_type_columns
BEFORE INSERT OR UPDATE OF refund_type, type, amount, reason, note, affects_inventory, legacy_return_id
ON public.invoice_refunds
FOR EACH ROW
EXECUTE FUNCTION public.normalize_invoice_refund_type_columns();

DO $$
DECLARE
  v_has_returned_total BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'returned_total'
  )
  INTO v_has_returned_total;

  IF v_has_returned_total THEN
    WITH refund_totals AS (
      SELECT
        invoice_id,
        ROUND(SUM(
          CASE
            WHEN refund_type IN ('goodwill', 'cancel', 'correction')
              THEN GREATEST(COALESCE(amount, 0), 0)
            ELSE 0
          END
        ), 2) AS goodwill_total,
        ROUND(SUM(
          CASE
            WHEN refund_type = 'return'
              THEN GREATEST(COALESCE(amount, 0), 0)
            ELSE 0
          END
        ), 2) AS returned_total
      FROM public.invoice_refunds
      GROUP BY invoice_id
    )
    UPDATE public.invoices i
    SET
      adjustment_total = COALESCE(t.goodwill_total, 0),
      returned_total = COALESCE(t.returned_total, 0),
      final_total = ROUND(
        GREATEST(
          COALESCE(i.total_amount, 0)
          - COALESCE(t.goodwill_total, 0)
          - COALESCE(t.returned_total, 0),
          0
        ),
        2
      ),
      updated_at = NOW()
    FROM refund_totals t
    WHERE t.invoice_id = i.id;
  ELSE
    WITH refund_totals AS (
      SELECT
        invoice_id,
        ROUND(SUM(
          CASE
            WHEN refund_type IN ('goodwill', 'cancel', 'correction')
              THEN GREATEST(COALESCE(amount, 0), 0)
            ELSE 0
          END
        ), 2) AS goodwill_total
      FROM public.invoice_refunds
      GROUP BY invoice_id
    )
    UPDATE public.invoices i
    SET
      adjustment_total = COALESCE(t.goodwill_total, 0),
      final_total = ROUND(
        GREATEST(COALESCE(i.total_amount, 0) - COALESCE(t.goodwill_total, 0), 0),
        2
      ),
      updated_at = NOW()
    FROM refund_totals t
    WHERE t.invoice_id = i.id;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_refund(
  p_invoice_id UUID,
  p_user_id UUID,
  p_refund_amount NUMERIC,
  p_reason TEXT,
  p_notes TEXT,
  p_adjustment_type TEXT
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  refund_id UUID,
  transaction_id UUID,
  new_balance NUMERIC,
  adjustment_total NUMERIC,
  final_total NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
DECLARE
  v_adjustment_type TEXT;
  v_result RECORD;
BEGIN
  v_adjustment_type := lower(btrim(COALESCE(p_adjustment_type, '')));

  IF v_adjustment_type = '' THEN
    RETURN QUERY
    SELECT FALSE, 'Jenis adjustment wajib dipilih.'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_adjustment_type NOT IN ('goodwill', 'return', 'cancel', 'correction') THEN
    RETURN QUERY
    SELECT FALSE, 'Jenis adjustment tidak sah.'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_adjustment_type = 'return' THEN
    RETURN QUERY
    SELECT FALSE, 'Jenis return perlu diproses melalui pulangan item.'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  SELECT *
  INTO v_result
  FROM public.create_invoice_refund(
    p_invoice_id,
    p_user_id,
    'goodwill',
    p_refund_amount,
    p_reason,
    p_notes,
    '[]'::JSONB
  );

  IF v_result IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Tiada respons dari pelayan.'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_result.success
    AND v_result.invoice_refund_id IS NOT NULL
    AND v_adjustment_type <> 'goodwill' THEN
    UPDATE public.invoice_refunds
    SET
      refund_type = v_adjustment_type,
      type = v_adjustment_type
    WHERE id = v_result.invoice_refund_id;
  END IF;

  RETURN QUERY
  SELECT
    v_result.success,
    v_result.message,
    COALESCE(v_result.legacy_refund_id, v_result.invoice_refund_id),
    v_result.wallet_transaction_id,
    v_result.new_balance,
    v_result.adjustment_total,
    v_result.final_total;
END;
$$;

DROP FUNCTION IF EXISTS public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_refund(
  p_invoice_id UUID,
  p_user_id UUID,
  p_refund_amount NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  refund_id UUID,
  transaction_id UUID,
  new_balance NUMERIC,
  adjustment_total NUMERIC,
  final_total NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.process_refund(
    p_invoice_id,
    p_user_id,
    p_refund_amount,
    p_reason,
    p_notes,
    'goodwill'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
