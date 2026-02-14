-- Fix add_item_to_invoice RPC function to allow guest invoices
-- Remove the client matching validation

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
  v_item_exists BOOLEAN;
  v_item_already_invoiced BOOLEAN;
  v_selling_price DECIMAL(10, 2);
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
  SELECT EXISTS(
    SELECT 1 FROM public.items
    WHERE id = p_item_id AND user_id = p_user_id
  ), items.invoice_id IS NOT NULL, items.selling_price
  INTO v_item_exists, v_item_already_invoiced, v_selling_price
  FROM public.items
  WHERE items.id = p_item_id;

  IF NOT v_item_exists THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Item not found';
    RETURN;
  END IF;

  IF v_item_already_invoiced THEN
    RETURN QUERY SELECT FALSE::BOOLEAN, 'Item is already invoiced';
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
