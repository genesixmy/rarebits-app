-- Update mark_invoice_as_paid to auto-update inventory items to 'terjual'
-- When invoice is marked paid, all inventory items in it are automatically marked as sold
-- Manual items are skipped (they don't update inventory)

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
  v_item_names TEXT;
  v_items_updated INT;
BEGIN
  -- Validate invoice exists and belongs to user
  SELECT invoices.id, invoices.total_amount, invoices.status, invoices.client_id, invoices.invoice_number
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

  -- Get item names from invoice items (concatenated)
  SELECT STRING_AGG(COALESCE(item_name, ''), ', ')
  INTO v_item_names
  FROM invoice_items
  WHERE invoice_items.invoice_id = v_invoice.id;

  -- Auto-finalize if still in draft status
  IF v_invoice.status = 'draft' THEN
    UPDATE invoices
    SET status = 'finalized'
    WHERE invoices.id = v_invoice.id;

    v_invoice.status := 'finalized';
  END IF;

  -- Create transaction record with invoice number and item names
  INSERT INTO transactions (
    user_id,
    wallet_id,
    type,
    amount,
    description,
    transaction_date,
    created_at
  )
  VALUES (
    p_user_id,
    v_wallet.id,
    'pembayaran_invois',
    v_invoice.total_amount,
    'Pembayaran Invois #' || v_invoice.invoice_number || ': ' || COALESCE(v_item_names, 'Item'),
    CURRENT_DATE,
    NOW()
  )
  RETURNING transactions.id INTO v_transaction_id;

  -- Update wallet balance
  v_new_balance := v_wallet.balance + v_invoice.total_amount;

  UPDATE wallets
  SET balance = v_new_balance
  WHERE wallets.id = v_wallet.id;

  -- Mark invoice as paid
  UPDATE invoices
  SET status = 'paid'
  WHERE invoices.id = v_invoice.id;

  -- AUTO-UPDATE INVENTORY ITEMS: Mark all inventory items in this invoice as 'terjual'
  -- Only update items that are registered in inventory (item_id is not null)
  -- Manual items (item_id is null) are skipped
  UPDATE items
  SET
    status = 'terjual',
    date_sold = CURRENT_DATE,
    client_id = CASE
      WHEN v_invoice.client_id IS NOT NULL THEN v_invoice.client_id
      ELSE items.client_id
    END
  WHERE items.id IN (
    SELECT ii.item_id
    FROM invoice_items ii
    WHERE ii.invoice_id = v_invoice.id
      AND ii.item_id IS NOT NULL  -- Only inventory items, skip manual items
  );

  GET DIAGNOSTICS v_items_updated = ROW_COUNT;

  -- Update client profile if client is selected in invoice
  IF v_invoice.client_id IS NOT NULL THEN
    UPDATE clients
    SET
      last_purchase_date = CURRENT_DATE,
      purchase_count = COALESCE(purchase_count, 0) + 1,
      total_purchased = COALESCE(total_purchased, 0) + v_invoice.total_amount
    WHERE clients.id = v_invoice.client_id AND clients.user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT
    true,
    'Invois berjaya ditandai sebagai dibayar. Saldo dompet diperbarui. ' || v_items_updated || ' item terjual.'::text,
    v_invoice.id,
    v_transaction_id,
    v_new_balance;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mark_invoice_as_paid(uuid, uuid) TO authenticated;
