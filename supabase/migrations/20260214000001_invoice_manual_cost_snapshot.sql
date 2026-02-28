-- INV-MANUAL-COST: snapshot cost per invoice line (inventory + manual)

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0;

UPDATE public.invoice_items
SET cost_price = 0
WHERE cost_price IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_items_cost_price_non_negative'
      AND conrelid = 'public.invoice_items'::regclass
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_cost_price_non_negative
      CHECK (cost_price >= 0);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.add_item_to_invoice(UUID, UUID, INTEGER, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.add_item_to_invoice(
  p_invoice_id UUID,
  p_item_id UUID,
  p_quantity INTEGER,
  p_unit_price NUMERIC,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_invoice_client_id UUID;
  v_item_already_invoiced BOOLEAN;
  v_selling_price NUMERIC;
  v_cost_price NUMERIC;
  v_total_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_reserved_total INTEGER;
  v_reserved_for_client INTEGER;
  v_reserved_legacy INTEGER;
  v_available_quantity INTEGER;
  v_item_name TEXT;
  v_quantity INTEGER;
  v_unit_price NUMERIC;
BEGIN
  SELECT client_id
  INTO v_invoice_client_id
  FROM public.invoices
  WHERE id = p_invoice_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Invoice not found';
    RETURN;
  END IF;

  SELECT
    items.selling_price,
    items.cost_price,
    items.quantity,
    items.quantity_reserved,
    items.invoice_id IS NOT NULL,
    items.name
  INTO v_selling_price, v_cost_price, v_total_quantity, v_reserved_legacy, v_item_already_invoiced, v_item_name
  FROM public.items
  WHERE items.id = p_item_id AND items.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Item not found';
    RETURN;
  END IF;

  IF v_item_already_invoiced THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Item is already invoiced';
    RETURN;
  END IF;

  v_quantity := GREATEST(COALESCE(p_quantity, 1), 1);
  v_unit_price := COALESCE(p_unit_price, v_selling_price, 0);

  SELECT COALESCE(SUM(quantity_reserved), 0)
  INTO v_reserved_total
  FROM public.inventory_reservations
  WHERE item_id = p_item_id;

  IF v_invoice_client_id IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity_reserved), 0)
    INTO v_reserved_for_client
    FROM public.inventory_reservations
    WHERE item_id = p_item_id
      AND customer_id = v_invoice_client_id;

    v_reserved_quantity := GREATEST(COALESCE(v_reserved_total, 0) - COALESCE(v_reserved_for_client, 0), 0);
  ELSE
    v_reserved_quantity := COALESCE(v_reserved_total, 0);
  END IF;

  IF v_reserved_total = 0 THEN
    v_reserved_quantity := COALESCE(v_reserved_legacy, 0);
  END IF;

  v_available_quantity := GREATEST(COALESCE(v_total_quantity, 0) - COALESCE(v_reserved_quantity, 0), 0);

  IF v_quantity > v_available_quantity THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, format(
      'Stok tidak mencukupi untuk %s. Available: %s, Requested: %s',
      COALESCE(v_item_name, 'Item'),
      v_available_quantity,
      v_quantity
    );
    RETURN;
  END IF;

  INSERT INTO public.invoice_items (
    invoice_id,
    item_id,
    quantity,
    unit_price,
    cost_price,
    line_total
  )
  VALUES (
    p_invoice_id,
    p_item_id,
    v_quantity,
    v_unit_price,
    GREATEST(COALESCE(v_cost_price, 0), 0),
    v_unit_price * v_quantity
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.items
  SET invoice_id = p_invoice_id
  WHERE id = p_item_id;

  UPDATE public.invoices
  SET
    subtotal = (
      SELECT COALESCE(SUM(line_total), 0)
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id
    ),
    total_amount = (
      SELECT COALESCE(SUM(line_total), 0)
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id
    ),
    updated_at = NOW()
  WHERE id = p_invoice_id;

  RETURN QUERY SELECT TRUE::BOOLEAN, 'Item added to invoice';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_item_to_invoice(UUID, UUID, INTEGER, NUMERIC, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.add_manual_item_to_invoice(UUID, TEXT, INTEGER, NUMERIC, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.add_manual_item_to_invoice(UUID, TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.add_manual_item_to_invoice(
  p_invoice_id UUID,
  p_item_name TEXT,
  p_quantity INTEGER,
  p_unit_price NUMERIC,
  p_cost_price NUMERIC,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_item_name TEXT;
  v_quantity INTEGER;
  v_unit_price NUMERIC;
  v_cost_price NUMERIC;
BEGIN
  PERFORM 1
  FROM public.invoices
  WHERE id = p_invoice_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Invoice not found';
    RETURN;
  END IF;

  v_item_name := NULLIF(btrim(COALESCE(p_item_name, '')), '');
  IF v_item_name IS NULL THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Manual item name is required';
    RETURN;
  END IF;

  v_quantity := GREATEST(COALESCE(p_quantity, 1), 1);
  v_unit_price := GREATEST(COALESCE(p_unit_price, 0), 0);
  v_cost_price := GREATEST(COALESCE(p_cost_price, 0), 0);

  INSERT INTO public.invoice_items (
    invoice_id,
    item_id,
    item_name,
    is_manual,
    quantity,
    unit_price,
    cost_price,
    line_total
  )
  VALUES (
    p_invoice_id,
    NULL,
    v_item_name,
    TRUE,
    v_quantity,
    v_unit_price,
    v_cost_price,
    v_unit_price * v_quantity
  );

  UPDATE public.invoices
  SET
    subtotal = (
      SELECT COALESCE(SUM(line_total), 0)
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id
    ),
    total_amount = (
      SELECT COALESCE(SUM(line_total), 0)
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id
    ),
    updated_at = NOW()
  WHERE id = p_invoice_id;

  RETURN QUERY SELECT TRUE::BOOLEAN, 'Manual item added to invoice';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.add_manual_item_to_invoice(
  p_invoice_id UUID,
  p_item_name TEXT,
  p_unit_price NUMERIC,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.add_manual_item_to_invoice(
    p_invoice_id,
    p_item_name,
    1,
    p_unit_price,
    0,
    p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_manual_item_to_invoice(UUID, TEXT, INTEGER, NUMERIC, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_manual_item_to_invoice(UUID, TEXT, NUMERIC, UUID) TO authenticated;

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
  v_recalculated_total NUMERIC;
BEGIN
  SELECT invoices.id, invoices.total_amount, invoices.status, invoices.client_id
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

  -- Normalize line snapshots for consistent accounting.
  UPDATE public.invoice_items ii
  SET
    quantity = GREATEST(COALESCE(ii.quantity, 1), 1),
    unit_price = COALESCE(ii.unit_price, 0),
    cost_price = GREATEST(COALESCE(ii.cost_price, 0), 0),
    line_total = COALESCE(ii.unit_price, 0) * GREATEST(COALESCE(ii.quantity, 1), 1)
  WHERE ii.invoice_id = v_invoice.id;

  SELECT COALESCE(SUM(ii.line_total), 0)
  INTO v_recalculated_total
  FROM public.invoice_items ii
  WHERE ii.invoice_id = v_invoice.id;

  UPDATE public.invoices
  SET
    subtotal = v_recalculated_total,
    total_amount = v_recalculated_total,
    updated_at = NOW()
  WHERE id = v_invoice.id;

  v_invoice.total_amount := v_recalculated_total;

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

  INSERT INTO public.transactions (
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
    'Pembayaran untuk invois ' || (SELECT invoice_number FROM public.invoices WHERE id = v_invoice.id),
    CURRENT_DATE,
    v_invoice.id,
    NOW()
  )
  RETURNING transactions.id INTO v_transaction_id;

  v_new_balance := v_wallet.balance + v_invoice.total_amount;

  UPDATE public.wallets
  SET balance = v_new_balance, updated_at = NOW()
  WHERE wallets.id = v_wallet.id;

  UPDATE public.invoices
  SET status = 'paid', updated_at = NOW()
  WHERE invoices.id = v_invoice.id;

  RETURN QUERY SELECT
    TRUE,
    'Invois berjaya ditandai sebagai dibayar. Saldo dompet diperbarui.'::TEXT,
    v_invoice.id,
    v_transaction_id,
    v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.mark_invoice_as_paid(UUID, UUID) TO authenticated;
