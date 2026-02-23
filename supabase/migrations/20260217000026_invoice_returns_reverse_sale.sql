-- INV-RETURN-4:
-- Real return flow (reverse sale + restore stock) with separate goodwill path.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS returned_total NUMERIC;

UPDATE public.invoices
SET returned_total = GREATEST(COALESCE(returned_total, 0), 0)
WHERE returned_total IS NULL
   OR returned_total < 0;

UPDATE public.invoices
SET final_total = GREATEST(
  COALESCE(total_amount, 0)
    - GREATEST(COALESCE(adjustment_total, 0), 0)
    - GREATEST(COALESCE(returned_total, 0), 0),
  0
)
WHERE final_total IS NULL
   OR ABS(
        COALESCE(final_total, 0)
        - GREATEST(
            COALESCE(total_amount, 0)
              - GREATEST(COALESCE(adjustment_total, 0), 0)
              - GREATEST(COALESCE(returned_total, 0), 0),
            0
          )
      ) > 0.0001;

ALTER TABLE public.invoices
  ALTER COLUMN returned_total SET DEFAULT 0,
  ALTER COLUMN returned_total SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_returned_total_nonnegative_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_returned_total_nonnegative_check
      CHECK (returned_total >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_invoice_adjustment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.adjustment_total := ROUND(GREATEST(COALESCE(NEW.adjustment_total, 0), 0), 2);
  NEW.returned_total := ROUND(GREATEST(COALESCE(NEW.returned_total, 0), 0), 2);
  NEW.final_total := ROUND(
    GREATEST(
      COALESCE(NEW.total_amount, 0) - NEW.adjustment_total - NEW.returned_total,
      0
    ),
    2
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_adjustment_totals ON public.invoices;

CREATE TRIGGER trg_sync_invoice_adjustment_totals
BEFORE INSERT OR UPDATE OF total_amount, adjustment_total, returned_total
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.sync_invoice_adjustment_totals();

CREATE TABLE IF NOT EXISTS public.invoice_item_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_item_id UUID NOT NULL REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  item_id UUID NULL REFERENCES public.items(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_item_name TEXT,
  returned_quantity INTEGER NOT NULL CHECK (returned_quantity > 0),
  refund_amount NUMERIC NOT NULL CHECK (refund_amount >= 0),
  returned_unit_price NUMERIC NOT NULL DEFAULT 0 CHECK (returned_unit_price >= 0),
  returned_cost_price NUMERIC NOT NULL DEFAULT 0 CHECK (returned_cost_price >= 0),
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_item_returns_invoice_id
  ON public.invoice_item_returns(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_item_returns_invoice_item_id
  ON public.invoice_item_returns(invoice_item_id);

CREATE INDEX IF NOT EXISTS idx_invoice_item_returns_user_created
  ON public.invoice_item_returns(user_id, created_at DESC);

ALTER TABLE public.invoice_item_returns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_item_returns'
      AND policyname = 'invoice_item_returns_select_own'
  ) THEN
    CREATE POLICY invoice_item_returns_select_own
      ON public.invoice_item_returns
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_item_returns'
      AND policyname = 'invoice_item_returns_insert_own'
  ) THEN
    CREATE POLICY invoice_item_returns_insert_own
      ON public.invoice_item_returns
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_item_returns'
      AND policyname = 'invoice_item_returns_update_own'
  ) THEN
    CREATE POLICY invoice_item_returns_update_own
      ON public.invoice_item_returns
      FOR UPDATE
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
      AND tablename = 'invoice_item_returns'
      AND policyname = 'invoice_item_returns_delete_own'
  ) THEN
    CREATE POLICY invoice_item_returns_delete_own
      ON public.invoice_item_returns
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.process_invoice_return(UUID, UUID, UUID, INTEGER, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_invoice_return(
  p_invoice_id UUID,
  p_user_id UUID,
  p_invoice_item_id UUID,
  p_return_quantity INTEGER,
  p_refund_amount NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  return_id UUID,
  transaction_id UUID,
  new_balance NUMERIC,
  returned_total NUMERIC,
  final_total NUMERIC,
  invoice_status TEXT
) AS $$
DECLARE
  v_invoice RECORD;
  v_invoice_item RECORD;
  v_item RECORD;
  v_wallet RECORD;
  v_return_quantity INTEGER;
  v_refund_amount NUMERIC;
  v_reason TEXT;
  v_notes TEXT;
  v_existing_returned_qty INTEGER := 0;
  v_remaining_qty INTEGER := 0;
  v_return_id UUID;
  v_transaction_id UUID;
  v_new_balance NUMERIC;
  v_original_total NUMERIC;
  v_adjustment_total NUMERIC;
  v_existing_returned_total NUMERIC;
  v_current_final NUMERIC;
  v_next_returned_total NUMERIC;
  v_next_final NUMERIC;
  v_next_status TEXT;
  v_item_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY
    SELECT FALSE, 'Tidak dibenarkan'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_return_quantity := COALESCE(p_return_quantity, 0);
  IF v_return_quantity <= 0 THEN
    RETURN QUERY
    SELECT FALSE, 'Kuantiti pulangan mesti lebih besar daripada 0'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_refund_amount := COALESCE(p_refund_amount, 0);
  IF v_refund_amount <> v_refund_amount THEN
    RETURN QUERY
    SELECT FALSE, 'Amaun pulangan tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_refund_amount <= 0 THEN
    RETURN QUERY
    SELECT FALSE, 'Amaun pulangan mesti lebih besar daripada 0'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_refund_amount := ROUND(v_refund_amount, 2);

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    v_reason := 'Item Returned';
  END IF;

  v_notes := NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 500), '');

  SELECT
    i.id,
    i.user_id,
    i.invoice_number,
    i.status,
    i.total_amount,
    i.adjustment_total,
    i.returned_total,
    i.final_total
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF COALESCE(v_invoice.status, '') NOT IN ('paid', 'partially_returned') THEN
    RETURN QUERY
    SELECT FALSE, 'Pulangan hanya dibenarkan untuk invois dibayar'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  SELECT
    ii.id,
    ii.invoice_id,
    ii.item_id,
    GREATEST(COALESCE(ii.quantity, 0), 0) AS quantity,
    COALESCE(ii.unit_price, 0) AS unit_price,
    GREATEST(COALESCE(ii.cost_price, 0), 0) AS cost_price,
    COALESCE(ii.item_name, '') AS item_name,
    COALESCE(it.name, 'Item') AS linked_item_name
  INTO v_invoice_item
  FROM public.invoice_items ii
  LEFT JOIN public.items it
    ON it.id = ii.item_id
  WHERE ii.id = p_invoice_item_id
    AND ii.invoice_id = v_invoice.id
  FOR UPDATE OF ii;

  IF v_invoice_item IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Item invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_invoice_item.item_id IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Item manual tidak boleh dipulangkan stok'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(r.returned_quantity, 0)), 0)::INTEGER
  INTO v_existing_returned_qty
  FROM public.invoice_item_returns r
  WHERE r.invoice_item_id = v_invoice_item.id;

  v_remaining_qty := GREATEST(v_invoice_item.quantity - v_existing_returned_qty, 0);
  IF v_remaining_qty <= 0 THEN
    RETURN QUERY
    SELECT FALSE, 'Semua kuantiti item ini telah dipulangkan'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_return_quantity > v_remaining_qty THEN
    RETURN QUERY
    SELECT FALSE, format('Kuantiti pulangan melebihi baki yang boleh dipulangkan (maksimum %s)', v_remaining_qty)::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_original_total := GREATEST(COALESCE(v_invoice.total_amount, 0), 0);
  v_adjustment_total := GREATEST(COALESCE(v_invoice.adjustment_total, 0), 0);
  v_existing_returned_total := GREATEST(COALESCE(v_invoice.returned_total, 0), 0);
  v_current_final := GREATEST(
    COALESCE(v_invoice.final_total, v_original_total - v_adjustment_total - v_existing_returned_total),
    0
  );

  IF v_refund_amount > v_current_final THEN
    RETURN QUERY
    SELECT FALSE, format('Amaun pulangan melebihi baki invois (maksimum %s)', to_char(v_current_final, 'FM9999990.00'))::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_returned_total, v_current_final, COALESCE(v_invoice.status, 'paid');
    RETURN;
  END IF;

  SELECT
    it.id,
    COALESCE(it.quantity, 0) AS quantity
  INTO v_item
  FROM public.items it
  WHERE it.id = v_invoice_item.item_id
    AND it.user_id = p_user_id
  FOR UPDATE;

  IF v_item IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Item inventori tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_returned_total, v_current_final, COALESCE(v_invoice.status, 'paid');
    RETURN;
  END IF;

  SELECT
    w.id,
    COALESCE(w.balance, 0) AS balance
  INTO v_wallet
  FROM public.wallets w
  WHERE w.user_id = p_user_id
    AND w.account_type = 'Business'
  ORDER BY w.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Dompet tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_returned_total, v_current_final, COALESCE(v_invoice.status, 'paid');
    RETURN;
  END IF;

  IF COALESCE(v_wallet.balance, 0) < v_refund_amount THEN
    RETURN QUERY
    SELECT FALSE, 'Baki dompet tidak mencukupi'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_returned_total, v_current_final, COALESCE(v_invoice.status, 'paid');
    RETURN;
  END IF;

  UPDATE public.items
  SET
    quantity = COALESCE(quantity, 0) + v_return_quantity,
    updated_at = NOW()
  WHERE id = v_item.id
    AND user_id = p_user_id;

  v_item_name := COALESCE(
    NULLIF(btrim(v_invoice_item.item_name), ''),
    NULLIF(btrim(v_invoice_item.linked_item_name), ''),
    'Item'
  );

  INSERT INTO public.invoice_item_returns (
    invoice_id,
    invoice_item_id,
    item_id,
    user_id,
    return_item_name,
    returned_quantity,
    refund_amount,
    returned_unit_price,
    returned_cost_price,
    reason,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    v_invoice.id,
    v_invoice_item.id,
    v_invoice_item.item_id,
    p_user_id,
    v_item_name,
    v_return_quantity,
    v_refund_amount,
    GREATEST(COALESCE(v_invoice_item.unit_price, 0), 0),
    GREATEST(COALESCE(v_invoice_item.cost_price, 0), 0),
    v_reason,
    v_notes,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_return_id;

  INSERT INTO public.transactions (
    user_id,
    wallet_id,
    type,
    transaction_type,
    amount,
    description,
    category,
    transaction_date,
    invoice_id,
    reference_type,
    reference_id,
    metadata,
    created_at
  )
  VALUES (
    p_user_id,
    v_wallet.id,
    'sales_return',
    'adjustment',
    v_refund_amount,
    'Sales Return untuk invois ' || COALESCE(v_invoice.invoice_number, v_invoice.id::TEXT),
    'Pulangan Jualan',
    CURRENT_DATE,
    NULL,
    'invoice',
    v_invoice.id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'invoice_return_id', v_return_id,
        'invoice_item_id', v_invoice_item.id,
        'item_id', v_invoice_item.item_id,
        'returned_quantity', v_return_quantity,
        'refund_amount', v_refund_amount,
        'return_reason', v_reason,
        'return_notes', v_notes
      )
    ),
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  v_new_balance := COALESCE(v_wallet.balance, 0) - v_refund_amount;

  UPDATE public.wallets
  SET
    balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  v_next_returned_total := ROUND(v_existing_returned_total + v_refund_amount, 2);
  v_next_final := ROUND(
    GREATEST(v_original_total - v_adjustment_total - v_next_returned_total, 0),
    2
  );

  IF v_next_final <= 0 THEN
    v_next_status := 'returned';
  ELSE
    v_next_status := 'partially_returned';
  END IF;

  UPDATE public.invoices
  SET
    returned_total = v_next_returned_total,
    final_total = v_next_final,
    status = v_next_status,
    updated_at = NOW()
  WHERE id = v_invoice.id
    AND user_id = p_user_id;

  RETURN QUERY
  SELECT
    TRUE,
    'Pulangan berjaya diproses'::TEXT,
    v_return_id,
    v_transaction_id,
    v_new_balance,
    v_next_returned_total,
    v_next_final,
    v_next_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp, auth;

GRANT EXECUTE ON FUNCTION public.process_invoice_return(UUID, UUID, UUID, INTEGER, NUMERIC, TEXT, TEXT) TO authenticated;
