-- SHIP-4.2: Courier payment must be recorded as expense and counted in wallet outflow charts.
-- 1) Enforce shipment courier payment transaction type = expense
-- 2) Backfill older shipment/courier rows wrongly labeled as adjustment
-- 3) Ensure cashflow analytics count expense/transfer_out only

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT;

DROP FUNCTION IF EXISTS public.mark_shipment_courier_paid(UUID, UUID, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.mark_shipment_courier_paid(UUID, UUID, NUMERIC, UUID, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.mark_shipment_courier_paid(
  p_invoice_id UUID,
  p_user_id UUID,
  p_shipping_cost NUMERIC,
  p_wallet_id UUID DEFAULT NULL,
  p_paid_at TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  shipment_id UUID,
  transaction_id UUID,
  new_balance NUMERIC
) AS $$
DECLARE
  v_invoice RECORD;
  v_shipment RECORD;
  v_wallet RECORD;
  v_shipment_id UUID;
  v_transaction_id UUID;
  v_new_balance NUMERIC;
  v_shipping_cost NUMERIC;
  v_paid_at TIMESTAMPTZ;
  v_notes TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT FALSE, 'Tidak dibenarkan'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  v_shipping_cost := COALESCE(p_shipping_cost, 0);
  IF v_shipping_cost <> v_shipping_cost THEN
    RETURN QUERY SELECT FALSE, 'Kos courier tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_shipping_cost < 0 THEN
    RETURN QUERY SELECT FALSE, 'Kos courier mesti 0 atau lebih'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_shipping_cost > 9999 THEN
    RETURN QUERY SELECT FALSE, 'Nombor terlalu besar - semak semula.'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  v_shipping_cost := ROUND(v_shipping_cost, 2);
  v_paid_at := COALESCE(p_paid_at, NOW());
  v_notes := NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 500), '');

  SELECT
    i.id,
    i.user_id,
    i.invoice_number,
    i.shipment_id
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  v_shipment_id := v_invoice.shipment_id;

  IF v_shipment_id IS NULL THEN
    INSERT INTO public.shipments (
      user_id,
      ship_status,
      shipping_cost,
      courier_paid
    )
    VALUES (
      p_user_id,
      'pending',
      0,
      FALSE
    )
    RETURNING id INTO v_shipment_id;

    UPDATE public.invoices
    SET shipment_id = v_shipment_id, updated_at = NOW()
    WHERE id = v_invoice.id;

    INSERT INTO public.shipment_invoices (shipment_id, invoice_id)
    VALUES (v_shipment_id, v_invoice.id)
    ON CONFLICT (shipment_id, invoice_id) DO NOTHING;
  END IF;

  SELECT s.*
  INTO v_shipment
  FROM public.shipments s
  WHERE s.id = v_shipment_id
    AND s.user_id = p_user_id
  FOR UPDATE;

  IF v_shipment IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Shipment tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF COALESCE(v_shipment.courier_paid, FALSE) THEN
    RETURN QUERY SELECT FALSE, 'Courier sudah ditandai dibayar'::TEXT, v_shipment.id, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF COALESCE(v_shipment.ship_status, 'pending') NOT IN ('pending', 'shipped', 'delivered') THEN
    RETURN QUERY SELECT FALSE, 'Status shipment tidak membenarkan bayaran courier.'::TEXT, v_shipment.id, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF p_wallet_id IS NOT NULL THEN
    SELECT w.id, w.balance
    INTO v_wallet
    FROM public.wallets w
    WHERE w.id = p_wallet_id
      AND w.user_id = p_user_id
    FOR UPDATE;
  ELSE
    SELECT w.id, w.balance
    INTO v_wallet
    FROM public.wallets w
    WHERE w.user_id = p_user_id
      AND w.account_type = 'Business'
    ORDER BY w.created_at ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_wallet IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Dompet tidak ditemui'::TEXT, v_shipment.id, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF COALESCE(v_wallet.balance, 0) < v_shipping_cost THEN
    RETURN QUERY SELECT FALSE, 'Baki dompet tidak mencukupi'::TEXT, v_shipment.id, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_shipping_cost > 0 THEN
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
      'expense',
      'expense',
      v_shipping_cost,
      'Bayaran Courier untuk shipment ' || v_shipment.id::TEXT,
      'Kos Pos',
      v_paid_at::DATE,
      NULL,
      'shipment',
      v_shipment.id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'courier', v_shipment.courier,
          'tracking_no', v_shipment.tracking_no,
          'shipment_id', v_shipment.id,
          'invoice_number', v_invoice.invoice_number,
          'paid_at', v_paid_at,
          'notes', v_notes
        )
      ),
      NOW()
    )
    RETURNING id INTO v_transaction_id;

    v_new_balance := COALESCE(v_wallet.balance, 0) - v_shipping_cost;

    UPDATE public.wallets
    SET balance = v_new_balance, updated_at = NOW()
    WHERE id = v_wallet.id;
  ELSE
    v_transaction_id := NULL;
    v_new_balance := COALESCE(v_wallet.balance, 0);
  END IF;

  UPDATE public.shipments
  SET
    shipping_cost = v_shipping_cost,
    courier_paid = TRUE,
    courier_paid_at = v_paid_at,
    notes = COALESCE(v_notes, shipments.notes),
    updated_at = NOW()
  WHERE id = v_shipment.id;

  RETURN QUERY
  SELECT
    TRUE,
    'Bayaran courier berjaya direkod'::TEXT,
    v_shipment.id,
    v_transaction_id,
    v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.mark_shipment_courier_paid(UUID, UUID, NUMERIC, UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- Backfill shipment/courier rows that were stored as adjustment or non-expense legacy types.
WITH shipment_related AS (
  SELECT t.id
  FROM public.transactions t
  WHERE (
      t.reference_type = 'shipment'
      OR lower(COALESCE(t.description, '')) LIKE '%courier%'
      OR lower(COALESCE(t.description, '')) LIKE '%kos pos%'
      OR lower(COALESCE(t.description, '')) LIKE '%kos courier%'
      OR lower(COALESCE(t.category, '')) LIKE '%courier%'
      OR lower(COALESCE(t.category, '')) LIKE '%kos pos%'
      OR lower(COALESCE(t.category, '')) LIKE '%kos courier%'
    )
    AND (
      lower(COALESCE(t.type, '')) IN ('adjustment', 'perbelanjaan')
      OR lower(COALESCE(t.transaction_type, '')) = 'adjustment'
      OR lower(COALESCE(t.type, '')) <> 'expense'
      OR lower(COALESCE(t.transaction_type, '')) <> 'expense'
    )
)
UPDATE public.transactions t
SET
  type = 'expense',
  transaction_type = 'expense',
  category = COALESCE(NULLIF(btrim(t.category), ''), 'Kos Pos'),
  description = COALESCE(NULLIF(btrim(t.description), ''), 'Bayaran Courier')
WHERE t.id IN (SELECT id FROM shipment_related);

DROP FUNCTION IF EXISTS public.get_wallet_cashflow_trend(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.get_wallet_cashflow_trend(
  p_user_id UUID,
  p_wallet_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  tx_date DATE,
  inflow NUMERIC,
  outflow NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_DATE - (GREATEST(COALESCE(p_days, 30), 1) - 1))::DATE AS start_date,
      CURRENT_DATE::DATE AS end_date
  ),
  calendar AS (
    SELECT generate_series(
      (SELECT start_date FROM bounds),
      (SELECT end_date FROM bounds),
      INTERVAL '1 day'
    )::DATE AS tx_date
  ),
  normalized AS (
    SELECT
      DATE_TRUNC('day', COALESCE(t.transaction_date::timestamptz, t.created_at))::DATE AS tx_date,
      ABS(COALESCE(t.amount, 0)) AS amount_abs,
      public.normalize_wallet_transaction_type(
        COALESCE(NULLIF(btrim(t.transaction_type), ''), t.type),
        t.amount,
        t.category,
        t.invoice_id
      ) AS tx_type
    FROM public.transactions t
    CROSS JOIN bounds b
    WHERE t.user_id = p_user_id
      AND (p_wallet_id IS NULL OR t.wallet_id = p_wallet_id)
      AND COALESCE(t.transaction_date::timestamptz, t.created_at) >= b.start_date
      AND COALESCE(t.transaction_date::timestamptz, t.created_at) < (b.end_date + INTERVAL '1 day')
  ),
  aggregated AS (
    SELECT
      n.tx_date,
      SUM(CASE WHEN n.tx_type IN ('sale', 'topup', 'transfer_in') THEN n.amount_abs ELSE 0 END) AS inflow,
      SUM(CASE WHEN n.tx_type IN ('expense', 'transfer_out') THEN n.amount_abs ELSE 0 END) AS outflow
    FROM normalized n
    GROUP BY n.tx_date
  )
  SELECT
    c.tx_date,
    COALESCE(a.inflow, 0)::NUMERIC AS inflow,
    COALESCE(a.outflow, 0)::NUMERIC AS outflow
  FROM calendar c
  LEFT JOIN aggregated a
    ON a.tx_date = c.tx_date
  ORDER BY c.tx_date ASC;
$$;

DROP FUNCTION IF EXISTS public.get_wallet_cashflow_breakdown(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.get_wallet_cashflow_breakdown(
  p_user_id UUID,
  p_wallet_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  flow_group TEXT,
  flow_type TEXT,
  total NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_DATE - (GREATEST(COALESCE(p_days, 30), 1) - 1))::DATE AS start_date,
      CURRENT_DATE::DATE AS end_date
  ),
  normalized AS (
    SELECT
      ABS(COALESCE(t.amount, 0)) AS amount_abs,
      public.normalize_wallet_transaction_type(
        COALESCE(NULLIF(btrim(t.transaction_type), ''), t.type),
        t.amount,
        t.category,
        t.invoice_id
      ) AS tx_type
    FROM public.transactions t
    CROSS JOIN bounds b
    WHERE t.user_id = p_user_id
      AND (p_wallet_id IS NULL OR t.wallet_id = p_wallet_id)
      AND COALESCE(t.transaction_date::timestamptz, t.created_at) >= b.start_date
      AND COALESCE(t.transaction_date::timestamptz, t.created_at) < (b.end_date + INTERVAL '1 day')
      AND COALESCE(t.amount, 0) <> 0
  )
  SELECT
    CASE
      WHEN n.tx_type IN ('sale', 'topup', 'transfer_in') THEN 'inflow'
      WHEN n.tx_type IN ('expense', 'transfer_out') THEN 'outflow'
      ELSE NULL
    END AS flow_group,
    CASE
      WHEN n.tx_type IN ('sale', 'topup', 'transfer_in', 'expense', 'transfer_out') THEN n.tx_type
      ELSE NULL
    END AS flow_type,
    SUM(n.amount_abs)::NUMERIC AS total
  FROM normalized n
  WHERE n.tx_type IN ('sale', 'topup', 'transfer_in', 'expense', 'transfer_out')
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION public.get_wallet_cashflow_trend(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_cashflow_breakdown(UUID, UUID, INTEGER) TO authenticated;
