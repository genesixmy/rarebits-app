-- Fix reverse_invoice_payment RPC function - Remove invoice_id reference
-- The transactions table doesn't have invoice_id column

DROP FUNCTION IF EXISTS reverse_invoice_payment(uuid, uuid) CASCADE;

CREATE OR REPLACE FUNCTION reverse_invoice_payment(
  p_invoice_id uuid,
  p_user_id uuid
)
RETURNS TABLE(
  success boolean,
  message text,
  invoice_id uuid,
  new_balance numeric
) AS $$
DECLARE
  v_invoice RECORD;
  v_invoice_number TEXT;
  v_wallet RECORD;
  v_transaction_id uuid;
  v_new_balance numeric;
BEGIN
  -- Get invoice details
  SELECT invoices.id, invoices.status, invoices.total_amount, invoices.invoice_number
  INTO v_invoice
  FROM invoices
  WHERE invoices.id = p_invoice_id AND invoices.user_id = p_user_id;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT false, 'Invois tidak ditemui'::text, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  v_invoice_number := v_invoice.invoice_number;

  -- Check if invoice is paid
  IF v_invoice.status != 'paid' THEN
    RETURN QUERY SELECT false, 'Invois bukan dalam status dibayar'::text, v_invoice.id, NULL::numeric;
    RETURN;
  END IF;

  -- Get wallet
  SELECT wallets.id, wallets.balance
  INTO v_wallet
  FROM wallets
  WHERE wallets.user_id = p_user_id AND wallets.account_type = 'Business'
  ORDER BY wallets.created_at ASC
  LIMIT 1;

  IF v_wallet IS NULL THEN
    RETURN QUERY SELECT false, 'Dompet tidak ditemui'::text, v_invoice.id, NULL::numeric;
    RETURN;
  END IF;

  -- Create reversal transaction (WITHOUT invoice_id field)
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
    -v_invoice.total_amount,
    'Pembalikan: Invois #' || v_invoice_number,
    CURRENT_DATE,
    NOW()
  )
  RETURNING transactions.id INTO v_transaction_id;

  -- Update wallet balance (decrease)
  v_new_balance := v_wallet.balance - v_invoice.total_amount;

  UPDATE wallets
  SET balance = v_new_balance
  WHERE wallets.id = v_wallet.id;

  -- Update invoice status back to finalized
  UPDATE invoices
  SET status = 'finalized'
  WHERE invoices.id = v_invoice.id;

  RETURN QUERY SELECT
    true,
    'Pembayaran invois berjaya dibatalkan'::text,
    v_invoice.id,
    v_new_balance;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reverse_invoice_payment(uuid, uuid) TO authenticated;
