-- CORE-LINT-57
-- Production-safety fixes for RPC lint errors without changing app behavior.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure unqualified gen_random_bytes(...) resolves in public schema.
CREATE OR REPLACE FUNCTION public.gen_random_bytes(p_length integer)
RETURNS bytea
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_result bytea;
BEGIN
  PERFORM set_config('search_path', 'extensions,pg_catalog', true);
  EXECUTE 'SELECT gen_random_bytes($1)' INTO v_result USING p_length;
  RETURN v_result;
END;
$$;

-- Compatibility shim for legacy routines still referencing public.customers.
DO $$
BEGIN
  IF to_regclass('public.customers') IS NULL
     AND to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE '
      CREATE VIEW public.customers AS
      SELECT
        c.id,
        c.user_id,
        c.name,
        c.email
      FROM public.clients c
    ';
  END IF;
END $$;

-- Keep legacy refunds compatibility path compilable.
DO $$
BEGIN
  IF to_regclass('public.refunds') IS NOT NULL THEN
    ALTER TABLE public.refunds
      ADD COLUMN IF NOT EXISTS user_id uuid,
      ADD COLUMN IF NOT EXISTS issued_by uuid;

    IF to_regclass('public.invoices') IS NOT NULL THEN
      UPDATE public.refunds r
      SET user_id = i.user_id
      FROM public.invoices i
      WHERE r.invoice_id = i.id
        AND r.user_id IS NULL;
    END IF;

    UPDATE public.refunds
    SET issued_by = user_id
    WHERE issued_by IS NULL
      AND user_id IS NOT NULL;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.create_or_update_invoice_for_sold_item(uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_or_update_invoice_for_sold_item(
  p_item_id uuid,
  p_user_id uuid
)
RETURNS TABLE(
  invoice_id uuid,
  created boolean,
  success boolean,
  message text
) AS $$
DECLARE
  v_item RECORD;
  v_existing_invoice RECORD;
  v_new_invoice RECORD;
  v_today DATE;
  v_invoice_number TEXT;
BEGIN
  SELECT i.id, i.client_id, i.selling_price, i.invoice_id
  INTO v_item
  FROM public.items i
  WHERE i.id = p_item_id
    AND i.user_id = p_user_id;

  IF v_item IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 'Item tidak ditemui'::text;
    RETURN;
  END IF;

  IF v_item.invoice_id IS NOT NULL THEN
    RETURN QUERY SELECT v_item.invoice_id, false, true, 'Item sudah mempunyai invois'::text;
    RETURN;
  END IF;

  v_today := CURRENT_DATE;

  SELECT i.id, i.client_id, i.invoice_date, i.status
  INTO v_existing_invoice
  FROM public.invoices i
  WHERE i.user_id = p_user_id
    AND i.client_id = v_item.client_id
    AND i.invoice_date = v_today
    AND i.status <> 'cancelled'
  LIMIT 1;

  IF v_existing_invoice IS NOT NULL THEN
    INSERT INTO public.invoice_items (invoice_id, item_id, unit_price, line_total, quantity)
    VALUES (v_existing_invoice.id, p_item_id, v_item.selling_price, v_item.selling_price, 1);

    UPDATE public.items
    SET invoice_id = v_existing_invoice.id
    WHERE id = p_item_id;

    UPDATE public.invoices
    SET
      subtotal = (SELECT COALESCE(SUM(ii.line_total), 0) FROM public.invoice_items ii WHERE ii.invoice_id = v_existing_invoice.id),
      total_amount = (SELECT COALESCE(SUM(ii.line_total), 0) FROM public.invoice_items ii WHERE ii.invoice_id = v_existing_invoice.id),
      updated_at = NOW()
    WHERE id = v_existing_invoice.id;

    RETURN QUERY SELECT v_existing_invoice.id, false, true, 'Item ditambah ke invois sedia ada'::text;
    RETURN;
  END IF;

  SELECT public.generate_invoice_number(p_user_id) INTO v_invoice_number;

  INSERT INTO public.invoices (
    user_id,
    invoice_number,
    client_id,
    invoice_date,
    subtotal,
    total_amount,
    status,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_invoice_number,
    v_item.client_id,
    v_today,
    v_item.selling_price,
    v_item.selling_price,
    'draft',
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_invoice;

  INSERT INTO public.invoice_items (invoice_id, item_id, unit_price, line_total, quantity)
  VALUES (v_new_invoice.id, p_item_id, v_item.selling_price, v_item.selling_price, 1);

  UPDATE public.items
  SET invoice_id = v_new_invoice.id
  WHERE id = p_item_id;

  RETURN QUERY SELECT v_new_invoice.id, true, true, 'Invois baru dibuat'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.create_or_update_invoice_for_sold_item(uuid, uuid) TO authenticated;

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
  v_courier_payment_mode TEXT;
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
    i.shipment_id,
    i.courier_payment_mode
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  v_courier_payment_mode := public.normalize_courier_payment_mode(v_invoice.courier_payment_mode);
  IF v_courier_payment_mode = 'platform' THEN
    RETURN QUERY SELECT FALSE, 'Mode platform: bayaran courier diurus platform.'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
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
    ON CONFLICT ON CONSTRAINT shipment_invoices_pkey DO NOTHING;
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
