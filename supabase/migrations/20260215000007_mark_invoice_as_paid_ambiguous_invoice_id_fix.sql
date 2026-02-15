-- SHIP-2 hotfix: resolve ambiguous invoice_id reference in mark_invoice_as_paid.
-- Root cause: RETURNS TABLE exposes output variable invoice_id in PL/pgSQL scope,
-- and ON CONFLICT (shipment_id, invoice_id) becomes ambiguous.
-- Fix: use explicit primary-key constraint name for conflict target.
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

  IF v_invoice.total_amount IS NULL OR v_invoice.total_amount < 0 THEN
    SELECT *
    INTO v_totals
    FROM public.recalculate_invoice_totals_internal(v_invoice.id);

    v_invoice.total_amount := COALESCE(v_totals.total_amount, 0);
  END IF;

  v_invoice.total_amount := COALESCE(v_invoice.total_amount, 0);

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

  v_shipping_charged := COALESCE(v_invoice.shipping_charged, 0);
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
  v_shipping_method := lower(btrim(COALESCE(v_invoice.shipping_method, '')));
  v_shipping_needed := (v_shipping_charged > 0)
    OR (
      COALESCE(v_invoice.shipping_required, FALSE) = TRUE
      AND v_shipping_method NOT IN ('pickup', 'meetup', 'selfpickup')
    );
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
        FALSE
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
      'shipping_charged', v_shipping_charged
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

