-- SHIP-2b: Shipping validation layer (sanity checks + safe defaults)
-- Caps:
-- - shipping_charged: 0..9999
-- - shipping_cost: 0..9999
-- - courier length: <= 50
-- - tracking_no length: <= 64, allowed chars: A-Z a-z 0-9 dash space

UPDATE public.invoices
SET shipping_charged = 0
WHERE shipping_charged IS NULL
  OR shipping_charged <> shipping_charged
  OR shipping_charged < 0;

UPDATE public.invoices
SET shipping_charged = 9999
WHERE shipping_charged > 9999;

UPDATE public.shipments
SET shipping_cost = 0
WHERE shipping_cost IS NULL
  OR shipping_cost <> shipping_cost
  OR shipping_cost < 0;

UPDATE public.shipments
SET shipping_cost = 9999
WHERE shipping_cost > 9999;

UPDATE public.shipments
SET courier = NULLIF(LEFT(btrim(COALESCE(courier, '')), 50), '');

UPDATE public.shipments
SET tracking_no = NULLIF(LEFT(btrim(COALESCE(tracking_no, '')), 64), '');

UPDATE public.shipments
SET tracking_no = NULL
WHERE tracking_no IS NOT NULL
  AND btrim(tracking_no) <> ''
  AND btrim(tracking_no) !~ '^[A-Za-z0-9 -]+$';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_shipping_charged_finite_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_shipping_charged_finite_check
      CHECK (shipping_charged = shipping_charged);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_shipping_charged_max_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_shipping_charged_max_check
      CHECK (shipping_charged <= 9999);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_shipping_cost_finite_check'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_shipping_cost_finite_check
      CHECK (shipping_cost = shipping_cost);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_shipping_cost_max_check'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_shipping_cost_max_check
      CHECK (shipping_cost <= 9999);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_courier_length_check'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_courier_length_check
      CHECK (courier IS NULL OR btrim(courier) = '' OR length(btrim(courier)) <= 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_tracking_no_length_check'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_tracking_no_length_check
      CHECK (tracking_no IS NULL OR btrim(tracking_no) = '' OR length(btrim(tracking_no)) <= 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_tracking_no_format_check'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_tracking_no_format_check
      CHECK (tracking_no IS NULL OR btrim(tracking_no) = '' OR btrim(tracking_no) ~ '^[A-Za-z0-9 -]+$');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.update_invoice_shipping_charged(UUID, UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.update_invoice_shipping_charged(
  p_invoice_id UUID,
  p_user_id UUID,
  p_shipping_charged NUMERIC
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  subtotal NUMERIC,
  total_amount NUMERIC,
  shipping_charged NUMERIC
) AS $$
DECLARE
  v_shipping_charged NUMERIC;
  v_invoice_owner UUID;
  v_totals RECORD;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT FALSE, 'Tidak dibenarkan'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_shipping_charged := COALESCE(p_shipping_charged, 0);

  IF v_shipping_charged <> v_shipping_charged THEN
    RETURN QUERY SELECT FALSE, 'Caj pos tidak sah.'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_shipping_charged < 0 THEN
    RETURN QUERY SELECT FALSE, 'Caj pos mesti 0 atau lebih.'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_shipping_charged > 9999 THEN
    RETURN QUERY SELECT FALSE, 'Nombor terlalu besar - semak semula.'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_shipping_charged := ROUND(v_shipping_charged, 2);

  SELECT i.user_id
  INTO v_invoice_owner
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice_owner IS NULL OR v_invoice_owner <> p_user_id THEN
    RETURN QUERY SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  UPDATE public.invoices
  SET
    shipping_charged = v_shipping_charged,
    updated_at = NOW()
  WHERE id = p_invoice_id
    AND user_id = p_user_id;

  SELECT *
  INTO v_totals
  FROM public.recalculate_invoice_totals_internal(p_invoice_id);

  RETURN QUERY
  SELECT
    TRUE,
    'Caj pos berjaya dikemaskini'::TEXT,
    v_totals.item_total,
    v_totals.total_amount,
    v_shipping_charged;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.update_invoice_shipping_charged(UUID, UUID, NUMERIC) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_shipment_courier_paid(UUID, UUID, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.mark_shipment_courier_paid(
  p_invoice_id UUID,
  p_user_id UUID,
  p_shipping_cost NUMERIC,
  p_wallet_id UUID DEFAULT NULL
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
      'perbelanjaan',
      v_shipping_cost,
      'Bayaran courier untuk shipment ' || v_shipment.id::TEXT,
      'Kos Courier',
      CURRENT_DATE,
      NULL,
      'shipment',
      v_shipment.id,
      jsonb_build_object(
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.invoice_number,
        'tracking_no', v_shipment.tracking_no,
        'courier', v_shipment.courier
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
    courier_paid_at = NOW(),
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

GRANT EXECUTE ON FUNCTION public.mark_shipment_courier_paid(UUID, UUID, NUMERIC, UUID) TO authenticated;
