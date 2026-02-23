-- INV-ADJ-3 HOTFIX:
-- Handle schemas where refunds.issued_by is NOT NULL by always providing issued_by.

DROP FUNCTION IF EXISTS public.process_refund(UUID, UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_refund(
  p_invoice_id UUID,
  p_user_id UUID,
  p_refund_amount NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  refund_id UUID,
  transaction_id UUID,
  new_balance NUMERIC,
  adjustment_total NUMERIC,
  final_total NUMERIC
) AS $$
DECLARE
  v_invoice RECORD;
  v_wallet RECORD;
  v_refund_amount NUMERIC;
  v_reason TEXT;
  v_notes TEXT;
  v_refund_id UUID;
  v_transaction_id UUID;
  v_new_balance NUMERIC;
  v_original_total NUMERIC;
  v_existing_adjustment NUMERIC;
  v_current_final NUMERIC;
  v_next_adjustment NUMERIC;
  v_next_final NUMERIC;
  v_refunds_has_user_id BOOLEAN := FALSE;
  v_refunds_has_issued_by BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY
    SELECT FALSE, 'Tidak dibenarkan'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_refund_amount := COALESCE(p_refund_amount, 0);
  IF v_refund_amount <> v_refund_amount THEN
    RETURN QUERY
    SELECT FALSE, 'Amaun pelarasan tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_refund_amount <= 0 THEN
    RETURN QUERY
    SELECT FALSE, 'Amaun pelarasan mesti lebih besar daripada 0'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_refund_amount := ROUND(v_refund_amount, 2);

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    v_reason := 'Price Adjustment';
  END IF;

  v_notes := NULLIF(LEFT(btrim(COALESCE(p_notes, '')), 500), '');

  SELECT
    i.id,
    i.user_id,
    i.invoice_number,
    i.status,
    i.total_amount,
    i.adjustment_total,
    i.final_total
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF COALESCE(v_invoice.status, '') <> 'paid' THEN
    RETURN QUERY
    SELECT FALSE, 'Pelarasan hanya dibenarkan untuk invois dibayar'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_original_total := GREATEST(COALESCE(v_invoice.total_amount, 0), 0);
  v_existing_adjustment := GREATEST(COALESCE(v_invoice.adjustment_total, 0), 0);
  v_current_final := GREATEST(
    COALESCE(v_invoice.final_total, v_original_total - v_existing_adjustment),
    0
  );

  IF v_refund_amount > v_current_final THEN
    RETURN QUERY
    SELECT FALSE, format('Amaun pelarasan melebihi baki invois (maksimum %s)', to_char(v_current_final, 'FM9999990.00'))::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_current_final;
    RETURN;
  END IF;

  SELECT
    w.id,
    COALESCE(w.balance, 0) AS balance
  INTO v_wallet
  FROM public.wallets w
  WHERE w.user_id = p_user_id
    AND w.account_type = 'Business'
  ORDER BY w.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Dompet tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_current_final;
    RETURN;
  END IF;

  IF COALESCE(v_wallet.balance, 0) < v_refund_amount THEN
    RETURN QUERY
    SELECT FALSE, 'Baki dompet tidak mencukupi'::TEXT, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_current_final;
    RETURN;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'refunds'
        AND column_name = 'user_id'
    ),
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'refunds'
        AND column_name = 'issued_by'
    )
  INTO v_refunds_has_user_id, v_refunds_has_issued_by;

  IF v_refunds_has_user_id AND v_refunds_has_issued_by THEN
    INSERT INTO public.refunds (
      invoice_id,
      user_id,
      issued_by,
      amount,
      reason,
      notes,
      issued_at,
      created_at
    )
    VALUES (
      v_invoice.id,
      p_user_id,
      p_user_id,
      v_refund_amount,
      v_reason,
      v_notes,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_refund_id;
  ELSIF v_refunds_has_user_id THEN
    INSERT INTO public.refunds (
      invoice_id,
      user_id,
      amount,
      reason,
      notes,
      issued_at,
      created_at
    )
    VALUES (
      v_invoice.id,
      p_user_id,
      v_refund_amount,
      v_reason,
      v_notes,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_refund_id;
  ELSIF v_refunds_has_issued_by THEN
    INSERT INTO public.refunds (
      invoice_id,
      issued_by,
      amount,
      reason,
      notes,
      issued_at,
      created_at
    )
    VALUES (
      v_invoice.id,
      p_user_id,
      v_refund_amount,
      v_reason,
      v_notes,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_refund_id;
  ELSE
    INSERT INTO public.refunds (
      invoice_id,
      amount,
      reason,
      notes,
      issued_at,
      created_at
    )
    VALUES (
      v_invoice.id,
      v_refund_amount,
      v_reason,
      v_notes,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_refund_id;
  END IF;

  INSERT INTO public.transactions (
    user_id,
    wallet_id,
    type,
    transaction_type,
    amount,
    description,
    category,
    transaction_date,
    invoice_id,
    reference_type,
    reference_id,
    metadata,
    created_at
  )
  VALUES (
    p_user_id,
    v_wallet.id,
    'goodwill_adjustment',
    'adjustment',
    v_refund_amount,
    'Price Adjustment untuk invois ' || COALESCE(v_invoice.invoice_number, v_invoice.id::TEXT),
    'Pelarasan Invois',
    CURRENT_DATE,
    NULL,
    'invoice',
    v_invoice.id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'adjustment_id', v_refund_id,
        'adjustment_reason', v_reason,
        'adjustment_notes', v_notes,
        'adjustment_amount', v_refund_amount,
        'refund_id', v_refund_id,
        'refund_reason', v_reason,
        'refund_notes', v_notes,
        'refund_amount', v_refund_amount
      )
    ),
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  v_new_balance := COALESCE(v_wallet.balance, 0) - v_refund_amount;

  UPDATE public.wallets
  SET
    balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  v_next_adjustment := ROUND(v_existing_adjustment + v_refund_amount, 2);
  v_next_final := ROUND(GREATEST(v_original_total - v_next_adjustment, 0), 2);

  UPDATE public.invoices
  SET
    adjustment_total = v_next_adjustment,
    final_total = v_next_final,
    updated_at = NOW()
  WHERE id = v_invoice.id
    AND user_id = p_user_id;

  RETURN QUERY
  SELECT
    TRUE,
    'Pelarasan harga berjaya direkod sebagai pelarasan hasil.'::TEXT,
    v_refund_id,
    v_transaction_id,
    v_new_balance,
    v_next_adjustment,
    v_next_final;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
