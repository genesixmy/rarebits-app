-- W1: Lightweight wallet transaction classification (labeling layer)

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT;

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
  IF p_invoice_id IS NOT NULL THEN
    RETURN 'sale';
  END IF;

  IF v_type IN ('sale', 'jualan', 'pembayaran_invois', 'item_manual') THEN
    RETURN 'sale';
  END IF;

  IF v_type IN ('expense', 'perbelanjaan', 'refund') THEN
    IF v_category LIKE '%pelarasan%' THEN
      RETURN 'adjustment';
    END IF;
    RETURN 'expense';
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

  IF v_type IN ('adjustment', 'pelarasan_manual_tambah', 'pelarasan_manual_kurang') THEN
    RETURN 'adjustment';
  END IF;

  -- Safe fallback for legacy/unknown rows.
  IF COALESCE(p_amount, 0) < 0 THEN
    RETURN 'expense';
  END IF;

  RETURN 'adjustment';
END;
$$;

UPDATE public.transactions t
SET transaction_type = public.normalize_wallet_transaction_type(
  COALESCE(NULLIF(t.transaction_type, ''), t.type),
  t.amount,
  t.category,
  t.invoice_id
)
WHERE t.transaction_type IS NULL
  OR btrim(t.transaction_type) = ''
  OR t.transaction_type NOT IN ('sale', 'expense', 'topup', 'transfer_in', 'transfer_out', 'adjustment');

UPDATE public.transactions t
SET transaction_type = 'sale'
WHERE t.invoice_id IS NOT NULL
  AND t.transaction_type IS DISTINCT FROM 'sale';

ALTER TABLE public.transactions
  ALTER COLUMN transaction_type SET DEFAULT 'adjustment';

UPDATE public.transactions
SET transaction_type = 'adjustment'
WHERE transaction_type IS NULL;

ALTER TABLE public.transactions
  ALTER COLUMN transaction_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_transaction_type_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_transaction_type_check
      CHECK (transaction_type IN ('sale', 'expense', 'topup', 'transfer_in', 'transfer_out', 'adjustment'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_transaction_type
  ON public.transactions(transaction_type);

CREATE INDEX IF NOT EXISTS idx_transactions_user_transaction_type_date
  ON public.transactions(user_id, transaction_type, transaction_date DESC);

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction_type_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.transaction_type := public.normalize_wallet_transaction_type(
    COALESCE(NULLIF(NEW.transaction_type, ''), NEW.type),
    NEW.amount,
    NEW.category,
    NEW.invoice_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_wallet_transaction_type_classification ON public.transactions;

CREATE TRIGGER trg_apply_wallet_transaction_type_classification
BEFORE INSERT OR UPDATE OF type, transaction_type, amount, category, invoice_id
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.apply_wallet_transaction_type_classification();

