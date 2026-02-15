-- SHIP-4: Mark courier paid with paid timestamp + optional notes.
-- Wallet deduction happens only in this flow using existing expense pattern.

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
      v_shipping_cost,
      'Bayaran courier untuk shipment ' || v_shipment.id::TEXT,
      'Kos Courier',
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
