-- INV-ADJ-3 HOTFIX 2:
-- Ensure invoice-linked goodwill/refund adjustments stay classified as `adjustment`
-- (not forced to `sale`) so negative adjustment amounts pass transaction checks.

CREATE OR REPLACE FUNCTION public.normalize_wallet_transaction_type(
  p_raw_type TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_invoice_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type TEXT := lower(btrim(COALESCE(p_raw_type, '')));
  v_category TEXT := lower(btrim(COALESCE(p_category, '')));
BEGIN
  -- Explicit adjustment-like types must remain adjustments even when linked to invoice_id.
  IF v_type IN ('adjustment', 'pelarasan_manual_tambah', 'pelarasan_manual_kurang', 'refund', 'refund_adjustment', 'goodwill_adjustment') THEN
    RETURN 'adjustment';
  END IF;

  IF v_type IN ('expense', 'perbelanjaan') THEN
    IF v_category LIKE '%pelarasan%' THEN
      RETURN 'adjustment';
    END IF;
    RETURN 'expense';
  END IF;

  -- Invoice-linked rows default to sale unless explicitly overridden above.
  IF p_invoice_id IS NOT NULL THEN
    RETURN 'sale';
  END IF;

  IF v_type IN ('sale', 'jualan', 'pembayaran_invois', 'item_manual') THEN
    RETURN 'sale';
  END IF;

  IF v_type IN ('topup', 'pendapatan') THEN
    IF v_category LIKE '%pelarasan%' THEN
      RETURN 'adjustment';
    END IF;
    RETURN 'topup';
  END IF;

  IF v_type IN ('transfer_in', 'pemindahan_masuk') THEN
    RETURN 'transfer_in';
  END IF;

  IF v_type IN ('transfer_out', 'pemindahan_keluar') THEN
    RETURN 'transfer_out';
  END IF;

  IF COALESCE(p_amount, 0) < 0 THEN
    RETURN 'expense';
  END IF;

  RETURN 'adjustment';
END;
$$;

-- Reclassify any legacy refund/goodwill rows that were forced to `sale`.
UPDATE public.transactions t
SET transaction_type = 'adjustment'
WHERE lower(COALESCE(t.type, '')) IN ('refund', 'refund_adjustment', 'goodwill_adjustment')
  AND COALESCE(lower(t.transaction_type), '') <> 'adjustment';
