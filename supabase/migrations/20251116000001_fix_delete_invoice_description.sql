-- Fix delete_invoice RPC function - use invoice number in transaction description

DROP FUNCTION IF EXISTS delete_invoice(uuid, uuid) CASCADE;

CREATE OR REPLACE FUNCTION delete_invoice(
  p_invoice_id uuid,
  p_user_id uuid
)
RETURNS TABLE(
  success boolean,
  message text,
  invoice_id uuid
) AS $$
DECLARE
  v_invoice RECORD;
  v_invoice_number TEXT;
  v_was_paid BOOLEAN;
  v_wallet_id uuid;
  v_reversal_amount numeric;
BEGIN
  -- Get invoice details
  SELECT invoices.id, invoices.status, invoices.total_amount, invoices.invoice_number
  INTO v_invoice
  FROM invoices
  WHERE invoices.id = p_invoice_id AND invoices.user_id = p_user_id;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT false, 'Invois tidak ditemui'::text, NULL::uuid;
    RETURN;
  END IF;

  v_invoice_number := v_invoice.invoice_number;
  v_was_paid := v_invoice.status = 'paid';

  -- If invoice was paid, need to reverse the payment
  IF v_was_paid THEN
    -- Find the wallet and create reversal transaction
    SELECT wallets.id
    INTO v_wallet_id
    FROM wallets
    WHERE wallets.user_id = p_user_id AND wallets.account_type = 'Business'
    ORDER BY wallets.created_at ASC
    LIMIT 1;

    IF v_wallet_id IS NOT NULL THEN
      -- Create reversal transaction with proper description
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
        v_wallet_id,
        'pembayaran_invois',
        -v_invoice.total_amount,
        'Pembalikan: ' || v_invoice_number,
        CURRENT_DATE,
        p_invoice_id,
        NOW()
      );

      -- Decrease wallet balance (reverse the payment)
      UPDATE wallets
      SET balance = balance - v_invoice.total_amount
      WHERE wallets.id = v_wallet_id;
    END IF;
  END IF;

  -- Delete invoice items first
  DELETE FROM invoice_items
  WHERE invoice_items.invoice_id = p_invoice_id;

  -- Delete the invoice
  DELETE FROM invoices
  WHERE invoices.id = p_invoice_id;

  RETURN QUERY SELECT true, 'Invois berjaya dihapus'::text, p_invoice_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_invoice(uuid, uuid) TO authenticated;
