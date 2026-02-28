-- Client-aware availability for add_item_to_invoice (allow customer to use own reservations)

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
  v_selling_price DECIMAL(10, 2);
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
  -- Verify invoice belongs to user and get client_id
  SELECT client_id
  INTO v_invoice_client_id
  FROM public.invoices
  WHERE id = p_invoice_id AND user_id = p_user_id;

  IF NOT FOUND THEN
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
