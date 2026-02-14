-- Enforce reserved availability when adding invoice items and marking invoices as paid

-- Update/add RPC for adding a single item (quantity defaults to 1)
CREATE OR REPLACE FUNCTION public.add_item_to_invoice(
  p_invoice_id UUID,
  p_item_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_invoice_exists BOOLEAN;
  v_item_already_invoiced BOOLEAN;
  v_selling_price DECIMAL(10, 2);
  v_total_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_reserved_legacy INTEGER;
  v_available_quantity INTEGER;
  v_item_name TEXT;
BEGIN
  -- Verify invoice belongs to user
  SELECT EXISTS(
    SELECT 1 FROM public.invoices
    WHERE id = p_invoice_id AND user_id = p_user_id
  ) INTO v_invoice_exists;

  IF NOT v_invoice_exists THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Invoice not found';
    RETURN;
  END IF;

  -- Verify item exists and belongs to user
  SELECT
    items.selling_price,
    items.quantity,
    items.quantity_reserved,
    items.invoice_id IS NOT NULL,
    items.name
  INTO v_selling_price, v_total_quantity, v_reserved_legacy, v_item_already_invoiced, v_item_name
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

  SELECT COALESCE(SUM(quantity_reserved), 0)
  INTO v_reserved_quantity
  FROM public.inventory_reservations
  WHERE item_id = p_item_id;

  v_reserved_quantity := GREATEST(COALESCE(v_reserved_quantity, 0), COALESCE(v_reserved_legacy, 0));

  v_available_quantity := GREATEST(COALESCE(v_total_quantity, 0) - COALESCE(v_reserved_quantity, 0), 0);

  IF v_available_quantity < 1 THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, format(
      'Stok tidak mencukupi untuk %s. Available: %s, Requested: %s',
      COALESCE(v_item_name, 'Item'),
      v_available_quantity,
      1
    );
    RETURN;
  END IF;

  -- Add item to invoice
  INSERT INTO public.invoice_items (invoice_id, item_id, quantity, unit_price, line_total)
  VALUES (p_invoice_id, p_item_id, 1, v_selling_price, v_selling_price)
  ON CONFLICT DO NOTHING;

  -- Update item
  UPDATE public.items
  SET invoice_id = p_invoice_id
  WHERE id = p_item_id;

  -- Update invoice totals
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

GRANT EXECUTE ON FUNCTION public.add_item_to_invoice(UUID, UUID, UUID) TO authenticated;

-- Update/add RPC for adding item with quantity + price
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
  v_invoice_exists BOOLEAN;
  v_item_already_invoiced BOOLEAN;
  v_selling_price DECIMAL(10, 2);
  v_total_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_reserved_legacy INTEGER;
  v_available_quantity INTEGER;
  v_item_name TEXT;
  v_quantity INTEGER;
  v_unit_price NUMERIC;
BEGIN
  -- Verify invoice belongs to user
  SELECT EXISTS(
    SELECT 1 FROM public.invoices
    WHERE id = p_invoice_id AND user_id = p_user_id
  ) INTO v_invoice_exists;

  IF NOT v_invoice_exists THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Invoice not found';
    RETURN;
  END IF;

  -- Verify item exists and belongs to user
  SELECT
    items.selling_price,
    items.quantity,
    items.quantity_reserved,
    items.invoice_id IS NOT NULL,
    items.name
  INTO v_selling_price, v_total_quantity, v_reserved_legacy, v_item_already_invoiced, v_item_name
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

  v_quantity := COALESCE(p_quantity, 1);
  IF v_quantity < 1 THEN v_quantity := 1; END IF;
  v_unit_price := COALESCE(p_unit_price, v_selling_price);

  SELECT COALESCE(SUM(quantity_reserved), 0)
  INTO v_reserved_quantity
  FROM public.inventory_reservations
  WHERE item_id = p_item_id;

  v_reserved_quantity := GREATEST(COALESCE(v_reserved_quantity, 0), COALESCE(v_reserved_legacy, 0));

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

  -- Add item to invoice
  INSERT INTO public.invoice_items (invoice_id, item_id, quantity, unit_price, line_total)
  VALUES (p_invoice_id, p_item_id, v_quantity, v_unit_price, v_unit_price * v_quantity)
  ON CONFLICT DO NOTHING;

  -- Update item
  UPDATE public.items
  SET invoice_id = p_invoice_id
  WHERE id = p_item_id;

  -- Update invoice totals
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

-- Update mark_invoice_as_paid to validate availability vs reserved
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
  v_reserved_legacy INTEGER;
  v_available_quantity INTEGER;
  v_item_name TEXT;
BEGIN
  -- Validate invoice exists and belongs to user
  SELECT invoices.id, invoices.total_amount, invoices.status, invoices.client_id
  INTO v_invoice
  FROM invoices
  WHERE invoices.id = p_invoice_id AND invoices.user_id = p_user_id;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT false, 'Invois tidak ditemui'::text, NULL::uuid, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Check if already paid
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

  -- Validate inventory availability against reservations
  FOR v_item IN
    SELECT item_id, quantity
    FROM invoice_items
    WHERE invoice_id = v_invoice.id AND item_id IS NOT NULL
  LOOP
    SELECT items.name, items.quantity, items.quantity_reserved
    INTO v_item_name, v_total_quantity, v_reserved_legacy
    FROM items
    WHERE items.id = v_item.item_id AND items.user_id = p_user_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'Item tidak ditemui'::text, v_invoice.id, NULL::uuid, NULL::numeric;
      RETURN;
    END IF;

    SELECT COALESCE(SUM(quantity_reserved), 0)
    INTO v_reserved_quantity
    FROM public.inventory_reservations
    WHERE item_id = v_item.item_id;

    v_reserved_quantity := GREATEST(COALESCE(v_reserved_quantity, 0), COALESCE(v_reserved_legacy, 0));

    v_available_quantity := GREATEST(COALESCE(v_total_quantity, 0) - COALESCE(v_reserved_quantity, 0), 0);

    IF COALESCE(v_item.quantity, 0) > v_available_quantity THEN
      RETURN QUERY SELECT
        false,
        format(
          'Stok tidak mencukupi untuk %s. Available: %s, Requested: %s',
          COALESCE(v_item_name, 'Item'),
          v_available_quantity,
          COALESCE(v_item.quantity, 0)
        ),
        v_invoice.id,
        NULL::uuid,
        NULL::numeric;
      RETURN;
    END IF;
  END LOOP;

  -- Auto-finalize if still in draft status
  IF v_invoice.status = 'draft' THEN
    UPDATE invoices
    SET status = 'finalized', updated_at = NOW()
    WHERE invoices.id = v_invoice.id;

    v_invoice.status := 'finalized';
  END IF;

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
