-- Fix: Replace buggy RPC function with corrected version
-- Issue: "column reference 'invoice_id' is ambiguous"
-- Solution: Qualify all column references with table names

DROP FUNCTION IF EXISTS create_or_update_invoice_for_sold_item(uuid, uuid) CASCADE;

CREATE FUNCTION create_or_update_invoice_for_sold_item(
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
  -- Validate item exists and get its data
  SELECT items.id, items.client_id, items.selling_price, items.invoice_id
  INTO v_item
  FROM items
  WHERE items.id = p_item_id AND items.user_id = p_user_id;

  IF v_item IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 'Item tidak ditemui'::text;
    RETURN;
  END IF;

  -- Prevent duplicate invoicing
  IF v_item.invoice_id IS NOT NULL THEN
    RETURN QUERY SELECT v_item.invoice_id, false, true, 'Item sudah mempunyai invois'::text;
    RETURN;
  END IF;

  v_today := CURRENT_DATE;

  -- STEP 1: Look for existing invoice for same client on same date
  SELECT invoices.id, invoices.client_id, invoices.invoice_date, invoices.status
  INTO v_existing_invoice
  FROM invoices
  WHERE invoices.user_id = p_user_id
    AND invoices.client_id = v_item.client_id
    AND invoices.invoice_date = v_today
    AND invoices.status != 'cancelled'
  LIMIT 1;

  -- STEP 2A: If existing invoice found, add item to it (Model C: Gabung)
  IF v_existing_invoice IS NOT NULL THEN
    -- Add item to existing invoice
    INSERT INTO invoice_items (invoice_id, item_id, unit_price, line_total, quantity)
    VALUES (v_existing_invoice.id, p_item_id, v_item.selling_price, v_item.selling_price, 1);

    -- Update item to reference invoice
    UPDATE items
    SET items.invoice_id = v_existing_invoice.id
    WHERE items.id = p_item_id;

    -- Recalculate invoice totals
    UPDATE invoices
    SET
      subtotal = (SELECT COALESCE(SUM(invoice_items.line_total), 0) FROM invoice_items WHERE invoice_items.invoice_id = v_existing_invoice.id),
      total_amount = (SELECT COALESCE(SUM(invoice_items.line_total), 0) FROM invoice_items WHERE invoice_items.invoice_id = v_existing_invoice.id),
      updated_at = NOW()
    WHERE invoices.id = v_existing_invoice.id;

    RETURN QUERY SELECT v_existing_invoice.id, false, true, 'Item ditambah ke invois sedia ada'::text;
    RETURN;
  END IF;

  -- STEP 2B: No existing invoice, create new one (Model C: Baru)
  -- Generate invoice number
  SELECT generate_invoice_number(p_user_id) INTO v_invoice_number;

  -- Create new invoice
  INSERT INTO invoices (
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

  -- Add item to new invoice
  INSERT INTO invoice_items (invoice_id, item_id, unit_price, line_total, quantity)
  VALUES (v_new_invoice.id, p_item_id, v_item.selling_price, v_item.selling_price, 1);

  -- Update item to reference invoice
  UPDATE items
  SET items.invoice_id = v_new_invoice.id
  WHERE items.id = p_item_id;

  RETURN QUERY SELECT v_new_invoice.id, true, true, 'Invois baru dibuat'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_or_update_invoice_for_sold_item(uuid, uuid) TO authenticated;
