-- Lint cleanup (non-blocking): remove unused variables from legacy SECURITY DEFINER RPCs.
-- No behavior change intended.

CREATE OR REPLACE FUNCTION public.delete_transfer_transactions(
  p_transfer_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    source_wallet_id UUID;
    destination_wallet_id UUID;
    transfer_amount NUMERIC;
BEGIN
    -- Get transfer details from one of the linked transactions
    SELECT wallet_id, amount,
           CASE
               WHEN type = 'pemindahan_keluar' THEN wallet_id
               WHEN type = 'pemindahan_masuk' THEN (SELECT wallet_id FROM transactions WHERE transfer_id = p_transfer_id AND user_id = p_user_id AND type = 'pemindahan_keluar' LIMIT 1)
           END AS s_wallet_id,
           CASE
               WHEN type = 'pemindahan_masuk' THEN wallet_id
               WHEN type = 'pemindahan_keluar' THEN (SELECT wallet_id FROM transactions WHERE transfer_id = p_transfer_id AND user_id = p_user_id AND type = 'pemindahan_masuk' LIMIT 1)
           END AS d_wallet_id
    INTO source_wallet_id, transfer_amount, source_wallet_id, destination_wallet_id
    FROM transactions
    WHERE transfer_id = p_transfer_id AND user_id = p_user_id
    LIMIT 1;

    IF source_wallet_id IS NULL OR destination_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Transfer transactions not found or incomplete for transfer_id %', p_transfer_id;
    END IF;

    -- Revert the balance for the source wallet (add amount back)
    UPDATE wallets
    SET balance = balance + transfer_amount
    WHERE id = source_wallet_id AND user_id = p_user_id;

    -- Revert the balance for the destination wallet (subtract amount)
    UPDATE wallets
    SET balance = balance - transfer_amount
    WHERE id = destination_wallet_id AND user_id = p_user_id;

    -- Delete both transfer transactions
    DELETE FROM transactions WHERE transfer_id = p_transfer_id AND user_id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_invoice(
  p_invoice_id uuid,
  p_user_id uuid
)
RETURNS TABLE(success boolean, message text, invoice_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_invoice RECORD;
  v_wallet RECORD;
  v_item_count INT;
  v_items_reverted INT := 0;
  v_client_id uuid;
  v_manual_items_total DECIMAL(10,2) := 0;
  v_invoice_item RECORD;
BEGIN
  -- STEP 1: Validate invoice exists and belongs to user
  SELECT id, user_id, status, total_amount, client_id, invoice_number
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id AND user_id = p_user_id;

  IF v_invoice IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invois tidak ditemui atau tidak memiliki akses'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Store client_id for later use
  v_client_id := v_invoice.client_id;

  -- STEP 2: Get count of items to be cleared
  SELECT COUNT(*)
  INTO v_item_count
  FROM public.invoice_items ii
  WHERE ii.invoice_id = p_invoice_id;

  -- STEP 3: Calculate total manual items amount
  SELECT COALESCE(SUM(line_total), 0)
  INTO v_manual_items_total
  FROM public.invoice_items ii
  WHERE ii.invoice_id = p_invoice_id AND ii.is_manual = TRUE;

  -- STEP 4: Get user's wallet for later operations
  SELECT id, balance
  INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  LIMIT 1;

  -- STEP 5: If invoice was paid, reverse the payment
  IF v_invoice.status = 'paid' AND v_invoice.total_amount > 0 THEN
    IF v_wallet IS NOT NULL THEN
      -- Simply reverse the wallet balance (subtract the paid amount)
      UPDATE public.wallets
      SET balance = balance - v_invoice.total_amount
      WHERE id = v_wallet.id;

      -- Create reversal log entry with proper description for display
      INSERT INTO public.transactions (
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
        'perbelanjaan',
        v_invoice.total_amount,
        'Pembalikan: Invois #' || v_invoice.invoice_number,
        CURRENT_DATE,
        NOW()
      );

      -- Update client payment history (reverse)
      IF v_client_id IS NOT NULL THEN
        UPDATE public.clients
        SET
          total_purchased = GREATEST(0, COALESCE(total_purchased, 0) - v_invoice.total_amount),
          purchase_count = GREATEST(0, COALESCE(purchase_count, 0) - 1)
        WHERE id = v_client_id AND user_id = p_user_id;
      END IF;
    END IF;
  -- STEP 6: If invoice NOT paid but has manual items, still reverse the manual item amounts
  ELSIF v_manual_items_total > 0 AND v_wallet IS NOT NULL THEN
    -- Reverse manual items from wallet
    UPDATE public.wallets
    SET balance = GREATEST(0, balance - v_manual_items_total)
    WHERE id = v_wallet.id;

    -- Create reversal log entry for manual items
    INSERT INTO public.transactions (
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
      'perbelanjaan',
      v_manual_items_total,
      'Pembatalan: Invois #' || v_invoice.invoice_number || ' (Item Manual)',
      CURRENT_DATE,
      NOW()
    );
  END IF;

  -- STEP 7: Restore item quantities for all invoice items
  FOR v_invoice_item IN
    SELECT ii.item_id, ii.quantity
    FROM public.invoice_items ii
    WHERE ii.invoice_id = p_invoice_id
      AND ii.item_id IS NOT NULL
  LOOP
    -- Restore the quantity back to the item
    UPDATE public.items
    SET
      quantity = quantity + v_invoice_item.quantity,
      date_sold = NULL,
      status = 'tersedia',
      client_id = NULL
    WHERE id = v_invoice_item.item_id;

    v_items_reverted := v_items_reverted + 1;
  END LOOP;

  -- STEP 8: Clear invoice_id from items table
  UPDATE public.items
  SET invoice_id = NULL
  WHERE id IN (
    SELECT ii.item_id
    FROM public.invoice_items ii
    WHERE ii.invoice_id = p_invoice_id AND ii.item_id IS NOT NULL
  );

  -- STEP 9: Delete all invoice items
  DELETE FROM public.invoice_items ii
  WHERE ii.invoice_id = p_invoice_id;

  -- STEP 10: Delete the invoice itself
  DELETE FROM public.invoices inv
  WHERE inv.id = p_invoice_id AND inv.user_id = p_user_id;

  -- STEP 11: Return success
  RETURN QUERY SELECT
    TRUE::boolean,
    'Invois dihapus. ' || v_item_count::text || ' item dihapus dari invois, ' || v_items_reverted::text || ' item kuantiti dikembalikan.'::text,
    p_invoice_id;
END;
$function$;

