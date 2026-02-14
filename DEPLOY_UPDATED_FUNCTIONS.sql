-- Deploy Updated Invoice Functions with Better Descriptions
-- Run this script in Supabase SQL Editor

-- ============================================
-- 1. Update mark_invoice_as_paid function
-- ============================================
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

  -- Auto-finalize if still in draft status
  IF v_invoice.status = 'draft' THEN
    UPDATE invoices
    SET status = 'finalized', updated_at = NOW()
    WHERE invoices.id = v_invoice.id;

    v_invoice.status := 'finalized';
  END IF;

  -- Create transaction record with invoice number in description
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
    'Pembayaran Invois #' || v_invoice.invoice_number,
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

-- ============================================
-- 2. Update delete_invoice function
-- ============================================
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
        'Pembalikan: Invois #' || v_invoice_number,
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

GRANT EXECUTE ON FUNCTION delete_invoice(uuid, uuid) TO authenticated;

-- ============================================
-- 3. Update reverse_invoice_payment function
-- ============================================
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

  -- Create reversal transaction with invoice number in description
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
    -v_invoice.total_amount,
    'Pembalikan: Invois #' || v_invoice_number,
    CURRENT_DATE,
    p_invoice_id,
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
