-- Concurrency-safe stock validation + deduction when marking invoice as paid

DROP FUNCTION IF EXISTS mark_invoice_as_paid(uuid, uuid) CASCADE;

CREATE OR REPLACE FUNCTION mark_invoice_as_paid(
  p_invoice_id uuid,
  p_user_id uuid
)
RETURNS TABLE(
  success boolean,
  message text,
  invoice_id uuid,
  transaction_id uuid,
  new_balance numeric
) AS $$
DECLARE
  v_invoice RECORD;
  v_wallet RECORD;
  v_transaction_id uuid;
  v_new_balance numeric;
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
BEGIN
  -- Lock invoice row to prevent double payment
  SELECT invoices.id, invoices.total_amount, invoices.status, invoices.client_id
  INTO v_invoice
  FROM invoices
  WHERE invoices.id = p_invoice_id AND invoices.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT false, 'Invois tidak ditemui'::text, NULL::uuid, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Idempotent: exit early if already paid
  IF v_invoice.status = 'paid' THEN
    RETURN QUERY SELECT false, 'Invois sudah ditandai sebagai dibayar'::text, v_invoice.id, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Get default wallet for user
  SELECT wallets.id, wallets.balance
  INTO v_wallet
  FROM wallets
  WHERE wallets.user_id = p_user_id AND wallets.account_type = 'Business'
  ORDER BY wallets.created_at ASC
  LIMIT 1;

  IF v_wallet IS NULL THEN
    RETURN QUERY SELECT false, 'Dompet tidak ditemui'::text, v_invoice.id, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Concurrency-safe validation + deduction (lock items in a stable order)
  FOR v_item IN
    SELECT ii.item_id, SUM(ii.quantity) AS quantity
    FROM public.invoice_items ii
    WHERE ii.invoice_id = v_invoice.id AND ii.item_id IS NOT NULL
    GROUP BY ii.item_id
    ORDER BY ii.item_id
  LOOP
    SELECT items.name, items.quantity, items.quantity_reserved
    INTO v_item_name, v_total_quantity, v_reserved_legacy
    FROM items
    WHERE items.id = v_item.item_id AND items.user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'Item tidak ditemui'::text, v_invoice.id, NULL::uuid, NULL::uuid, NULL::numeric;
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

    -- Deduct stock atomically while row is locked
    UPDATE items
    SET quantity = v_new_quantity
    WHERE id = v_item.item_id;

    -- Release reservations with priority to invoice client
    v_release_remaining := COALESCE(v_item.quantity, 0);
    IF v_release_remaining > 0 THEN
      IF v_invoice.client_id IS NOT NULL THEN
        -- Step 1: Release reservations for the same client first (oldest first)
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
        -- Guest invoice: release reservations FIFO (any customer)
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

    -- Keep legacy quantity_reserved in sync with reservation totals
    SELECT COALESCE(SUM(quantity_reserved), 0)
    INTO v_current_reserved
    FROM public.inventory_reservations
    WHERE item_id = v_item.item_id;

    UPDATE items
    SET quantity_reserved = v_current_reserved
    WHERE id = v_item.item_id;
  END LOOP;

  -- Auto-finalize if still in draft status
  IF v_invoice.status = 'draft' THEN
    UPDATE invoices
    SET status = 'finalized', updated_at = NOW()
    WHERE invoices.id = v_invoice.id;

    v_invoice.status := 'finalized';
  END IF;

  -- Sync item sales data and client_id
  UPDATE items i
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

  -- Create transaction record
  INSERT INTO transactions (
    user_id,
    wallet_id,
    type,
    amount,
    description,
    transaction_date,
    invoice_id,
    created_at
  )
  VALUES (
    p_user_id,
    v_wallet.id,
    'pembayaran_invois',
    v_invoice.total_amount,
    'Pembayaran untuk invois ' || (SELECT invoice_number FROM invoices WHERE id = v_invoice.id),
    CURRENT_DATE,
    v_invoice.id,
    NOW()
  )
  RETURNING transactions.id INTO v_transaction_id;

  -- Update wallet balance
  v_new_balance := v_wallet.balance + v_invoice.total_amount;

  UPDATE wallets
  SET balance = v_new_balance, updated_at = NOW()
  WHERE wallets.id = v_wallet.id;

  -- Mark invoice as paid
  UPDATE invoices
  SET status = 'paid', updated_at = NOW()
  WHERE invoices.id = v_invoice.id;

  RETURN QUERY SELECT
    true,
    'Invois berjaya ditandai sebagai dibayar. Saldo dompet diperbarui.'::text,
    v_invoice.id,
    v_transaction_id,
    v_new_balance;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mark_invoice_as_paid(uuid, uuid) TO authenticated;
