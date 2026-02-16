-- SHIP-PLAT-2:
-- Strict mode for platform-handled courier shipping.
-- Source of truth: invoices.courier_payment_mode ('seller' | 'platform').

CREATE OR REPLACE FUNCTION public.normalize_courier_payment_mode(
  p_mode TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_mode, 'seller'))) = 'platform' THEN 'platform'
    ELSE 'seller'
  END;
$$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS courier_payment_mode TEXT;

UPDATE public.invoices
SET courier_payment_mode = public.normalize_courier_payment_mode(courier_payment_mode)
WHERE courier_payment_mode IS NULL
   OR public.normalize_courier_payment_mode(courier_payment_mode) <> courier_payment_mode;

ALTER TABLE public.invoices
  ALTER COLUMN courier_payment_mode SET DEFAULT 'seller',
  ALTER COLUMN courier_payment_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_courier_payment_mode_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_courier_payment_mode_check
      CHECK (courier_payment_mode IN ('seller', 'platform'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_invoice_courier_payment_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.courier_payment_mode := public.normalize_courier_payment_mode(NEW.courier_payment_mode);

  IF NEW.courier_payment_mode = 'platform' THEN
    -- Strict mode: no shipping cashflow tracked on invoice.
    NEW.shipping_charged := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_courier_payment_mode ON public.invoices;

CREATE TRIGGER trg_enforce_invoice_courier_payment_mode
BEFORE INSERT OR UPDATE OF courier_payment_mode, shipping_charged
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_invoice_courier_payment_mode();

CREATE OR REPLACE FUNCTION public.sync_platform_mode_shipment_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.shipment_id IS NOT NULL
     AND public.normalize_courier_payment_mode(NEW.courier_payment_mode) = 'platform' THEN
    UPDATE public.shipments
    SET
      shipping_cost = 0,
      courier_paid = TRUE,
      courier_paid_at = COALESCE(courier_paid_at, NOW()),
      updated_at = NOW()
    WHERE id = NEW.shipment_id
      AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_platform_mode_shipment_flags ON public.invoices;

CREATE TRIGGER trg_sync_platform_mode_shipment_flags
AFTER INSERT OR UPDATE OF courier_payment_mode, shipment_id
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.sync_platform_mode_shipment_flags();

-- Safety backfill for rows now marked as platform.
UPDATE public.invoices
SET shipping_charged = 0
WHERE courier_payment_mode = 'platform'
  AND COALESCE(shipping_charged, 0) <> 0;

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
  v_invoice RECORD;
  v_totals RECORD;
  v_mode TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY SELECT FALSE, 'Tidak dibenarkan'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  SELECT
    i.id,
    i.user_id,
    i.courier_payment_mode
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice IS NULL OR v_invoice.user_id <> p_user_id THEN
    RETURN QUERY SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_mode := public.normalize_courier_payment_mode(v_invoice.courier_payment_mode);

  IF v_mode = 'platform' THEN
    v_shipping_charged := 0;
  ELSE
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
  END IF;

  UPDATE public.invoices
  SET
    courier_payment_mode = v_mode,
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
    CASE WHEN v_mode = 'platform'
      THEN 'Mode platform: caj pos ditetapkan RM0'
      ELSE 'Caj pos berjaya dikemaskini'
    END::TEXT,
    v_totals.item_total,
    v_totals.total_amount,
    v_shipping_charged;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.update_invoice_shipping_charged(UUID, UUID, NUMERIC) TO authenticated;

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

DROP FUNCTION IF EXISTS public.mark_invoice_as_paid(UUID, UUID);

CREATE OR REPLACE FUNCTION public.mark_invoice_as_paid(
  p_invoice_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  invoice_id UUID,
  transaction_id UUID,
  new_balance NUMERIC
) AS $$
DECLARE
  v_invoice RECORD;
  v_wallet RECORD;
  v_transaction_id UUID;
  v_new_balance NUMERIC;
  v_item RECORD;
  v_total_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_reserved_total INTEGER;
  v_reserved_for_client INTEGER;
  v_reservation_count INTEGER;
  v_reserved_legacy INTEGER;
  v_available_quantity INTEGER;
  v_item_name TEXT;
  v_new_quantity INTEGER;
  v_release_remaining INTEGER;
  v_reservation RECORD;
  v_current_reserved INTEGER;
  v_shipping_charged NUMERIC;
  v_shipping_needed BOOLEAN;
  v_shipping_method TEXT;
  v_shipping_state TEXT;
  v_shipment_id UUID;
  v_totals RECORD;
  v_courier_payment_mode TEXT;
BEGIN
  SELECT
    invoices.id,
    invoices.invoice_number,
    invoices.total_amount,
    invoices.status,
    invoices.client_id,
    invoices.shipping_charged,
    invoices.shipping_required,
    invoices.shipping_method,
    invoices.courier_payment_mode,
    invoices.shipment_id
  INTO v_invoice
  FROM public.invoices
  WHERE invoices.id = p_invoice_id
    AND invoices.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_invoice.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, 'Invois sudah ditandai sebagai dibayar'::TEXT, v_invoice.id, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  SELECT wallets.id, wallets.balance
  INTO v_wallet
  FROM public.wallets
  WHERE wallets.user_id = p_user_id
    AND wallets.account_type = 'Business'
  ORDER BY wallets.created_at ASC
  LIMIT 1;

  IF v_wallet IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Dompet tidak ditemui'::TEXT, v_invoice.id, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT ii.item_id, SUM(GREATEST(COALESCE(ii.quantity, 1), 1))::INTEGER AS quantity
    FROM public.invoice_items ii
    WHERE ii.invoice_id = v_invoice.id
      AND ii.item_id IS NOT NULL
    GROUP BY ii.item_id
    ORDER BY ii.item_id
  LOOP
    SELECT items.name, items.quantity, items.quantity_reserved
    INTO v_item_name, v_total_quantity, v_reserved_legacy
    FROM public.items
    WHERE items.id = v_item.item_id
      AND items.user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'Item tidak ditemui'::TEXT, v_invoice.id, NULL::UUID, NULL::NUMERIC;
      RETURN;
    END IF;

    SELECT COALESCE(SUM(quantity_reserved), 0), COUNT(*)
    INTO v_reserved_total, v_reservation_count
    FROM public.inventory_reservations
    WHERE item_id = v_item.item_id;

    IF v_invoice.client_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity_reserved), 0)
      INTO v_reserved_for_client
      FROM public.inventory_reservations
      WHERE item_id = v_item.item_id
        AND customer_id = v_invoice.client_id;

      v_reserved_quantity := GREATEST(COALESCE(v_reserved_total, 0) - COALESCE(v_reserved_for_client, 0), 0);
    ELSE
      v_reserved_quantity := COALESCE(v_reserved_total, 0);
    END IF;

    IF v_reservation_count = 0 THEN
      v_reserved_quantity := COALESCE(v_reserved_legacy, 0);
    END IF;

    v_available_quantity := GREATEST(COALESCE(v_total_quantity, 0) - COALESCE(v_reserved_quantity, 0), 0);

    IF COALESCE(v_item.quantity, 0) > v_available_quantity THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'Insufficient stock for %s. Available: %s, Requested: %s',
        COALESCE(v_item_name, 'Item'),
        v_available_quantity,
        COALESCE(v_item.quantity, 0)
      );
    END IF;

    v_new_quantity := COALESCE(v_total_quantity, 0) - COALESCE(v_item.quantity, 0);
    IF v_new_quantity < 0 THEN
      RAISE EXCEPTION USING MESSAGE = format(
        'Insufficient stock for %s. Available: %s, Requested: %s',
        COALESCE(v_item_name, 'Item'),
        v_available_quantity,
        COALESCE(v_item.quantity, 0)
      );
    END IF;

    UPDATE public.items
    SET quantity = v_new_quantity
    WHERE id = v_item.item_id;

    v_release_remaining := COALESCE(v_item.quantity, 0);
    IF v_release_remaining > 0 THEN
      IF v_invoice.client_id IS NOT NULL THEN
        FOR v_reservation IN
          SELECT id, quantity_reserved
          FROM public.inventory_reservations
          WHERE item_id = v_item.item_id
            AND customer_id = v_invoice.client_id
          ORDER BY created_at ASC, id ASC
          FOR UPDATE
        LOOP
          EXIT WHEN v_release_remaining <= 0;

          IF v_reservation.quantity_reserved <= v_release_remaining THEN
            DELETE FROM public.inventory_reservations
            WHERE id = v_reservation.id;
            v_release_remaining := v_release_remaining - v_reservation.quantity_reserved;
          ELSE
            UPDATE public.inventory_reservations
            SET quantity_reserved = quantity_reserved - v_release_remaining
            WHERE id = v_reservation.id;
            v_release_remaining := 0;
          END IF;
        END LOOP;
      ELSE
        FOR v_reservation IN
          SELECT id, quantity_reserved
          FROM public.inventory_reservations
          WHERE item_id = v_item.item_id
          ORDER BY created_at ASC, id ASC
          FOR UPDATE
        LOOP
          EXIT WHEN v_release_remaining <= 0;

          IF v_reservation.quantity_reserved <= v_release_remaining THEN
            DELETE FROM public.inventory_reservations
            WHERE id = v_reservation.id;
            v_release_remaining := v_release_remaining - v_reservation.quantity_reserved;
          ELSE
            UPDATE public.inventory_reservations
            SET quantity_reserved = quantity_reserved - v_release_remaining
            WHERE id = v_reservation.id;
            v_release_remaining := 0;
          END IF;
        END LOOP;
      END IF;
    END IF;

    SELECT COALESCE(SUM(quantity_reserved), 0)
    INTO v_current_reserved
    FROM public.inventory_reservations
    WHERE item_id = v_item.item_id;

    UPDATE public.items
    SET quantity_reserved = v_current_reserved
    WHERE id = v_item.item_id;
  END LOOP;

  IF v_invoice.status = 'draft' THEN
    UPDATE public.invoices
    SET status = 'finalized', updated_at = NOW()
    WHERE invoices.id = v_invoice.id;

    v_invoice.status := 'finalized';
  END IF;

  UPDATE public.items i
  SET
    invoice_quantity = ii.quantity,
    actual_sold_amount = ii.line_total,
    client_id = CASE
      WHEN v_invoice.client_id IS NOT NULL THEN v_invoice.client_id
      ELSE i.client_id
    END
  FROM public.invoice_items ii
  WHERE ii.invoice_id = v_invoice.id
    AND ii.item_id = i.id;

  v_courier_payment_mode := public.normalize_courier_payment_mode(v_invoice.courier_payment_mode);
  v_shipping_charged := COALESCE(v_invoice.shipping_charged, 0);

  IF v_courier_payment_mode = 'platform' THEN
    v_shipping_charged := 0;
  ELSE
    IF v_shipping_charged <> v_shipping_charged THEN
      RETURN QUERY SELECT FALSE, 'Caj pos tidak sah.'::TEXT, v_invoice.id, NULL::UUID, NULL::NUMERIC;
      RETURN;
    END IF;

    IF v_shipping_charged < 0 THEN
      RETURN QUERY SELECT FALSE, 'Caj pos mesti 0 atau lebih.'::TEXT, v_invoice.id, NULL::UUID, NULL::NUMERIC;
      RETURN;
    END IF;

    IF v_shipping_charged > 9999 THEN
      RETURN QUERY SELECT FALSE, 'Nombor terlalu besar - semak semula.'::TEXT, v_invoice.id, NULL::UUID, NULL::NUMERIC;
      RETURN;
    END IF;

    v_shipping_charged := ROUND(v_shipping_charged, 2);
  END IF;

  UPDATE public.invoices
  SET
    shipping_charged = v_shipping_charged,
    courier_payment_mode = v_courier_payment_mode,
    updated_at = NOW()
  WHERE id = v_invoice.id;

  SELECT *
  INTO v_totals
  FROM public.recalculate_invoice_totals_internal(v_invoice.id);

  v_invoice.total_amount := COALESCE(v_totals.total_amount, 0);

  v_shipping_method := lower(btrim(COALESCE(v_invoice.shipping_method, '')));
  v_shipping_needed := public.invoice_delivery_required(v_shipping_method, v_shipping_charged);
  v_shipping_state := CASE WHEN v_shipping_needed THEN 'ready_to_ship' ELSE 'not_required' END;

  IF v_shipping_needed THEN
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
        CASE WHEN v_courier_payment_mode = 'platform' THEN TRUE ELSE FALSE END
      )
      RETURNING id INTO v_shipment_id;

      UPDATE public.invoices
      SET shipment_id = v_shipment_id, updated_at = NOW()
      WHERE id = v_invoice.id;
    ELSE
      UPDATE public.shipments
      SET
        ship_status = CASE WHEN ship_status = 'not_required' THEN 'pending' ELSE ship_status END,
        updated_at = NOW()
      WHERE id = v_shipment_id
        AND user_id = p_user_id;
    END IF;

    IF v_courier_payment_mode = 'platform' THEN
      UPDATE public.shipments
      SET
        shipping_cost = 0,
        courier_paid = TRUE,
        courier_paid_at = COALESCE(courier_paid_at, NOW()),
        updated_at = NOW()
      WHERE id = v_shipment_id
        AND user_id = p_user_id;
    END IF;

    INSERT INTO public.shipment_invoices (shipment_id, invoice_id)
    VALUES (v_shipment_id, v_invoice.id)
    ON CONFLICT ON CONSTRAINT shipment_invoices_pkey DO NOTHING;
  ELSE
    IF v_invoice.shipment_id IS NOT NULL THEN
      UPDATE public.shipments
      SET ship_status = 'not_required', updated_at = NOW()
      WHERE id = v_invoice.shipment_id
        AND user_id = p_user_id;
    END IF;
  END IF;

  INSERT INTO public.transactions (
    user_id,
    wallet_id,
    type,
    amount,
    description,
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
    'sale',
    v_invoice.total_amount,
    'Pembayaran untuk invois ' || COALESCE(v_invoice.invoice_number, v_invoice.id::TEXT),
    CURRENT_DATE,
    v_invoice.id,
    'invoice',
    v_invoice.id,
    jsonb_build_object(
      'invoice_number', COALESCE(v_invoice.invoice_number, ''),
      'includes_shipping', (v_shipping_charged > 0),
      'shipping_charged', v_shipping_charged,
      'courier_payment_mode', v_courier_payment_mode
    ),
    NOW()
  )
  RETURNING transactions.id INTO v_transaction_id;

  v_new_balance := COALESCE(v_wallet.balance, 0) + v_invoice.total_amount;

  UPDATE public.wallets
  SET balance = v_new_balance, updated_at = NOW()
  WHERE wallets.id = v_wallet.id;

  UPDATE public.invoices
  SET
    status = 'paid',
    shipping_state = v_shipping_state,
    shipping_charged = v_shipping_charged,
    courier_payment_mode = v_courier_payment_mode,
    updated_at = NOW()
  WHERE invoices.id = v_invoice.id;

  RETURN QUERY SELECT
    TRUE,
    'Invois berjaya ditandai sebagai dibayar. Saldo dompet diperbarui.'::TEXT,
    v_invoice.id,
    v_transaction_id,
    v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.mark_invoice_as_paid(UUID, UUID) TO authenticated;
