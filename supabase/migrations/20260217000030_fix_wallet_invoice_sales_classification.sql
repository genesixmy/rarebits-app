-- INV-RETURN-4 HOTFIX 3:
-- Prevent invoice payment transactions from being misclassified as adjustment
-- when transactions.transaction_type default ('adjustment') is present.

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction_type_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_type TEXT;
BEGIN
  -- Prefer legacy `type` as source of truth.
  -- Using transaction_type first can incorrectly pick default 'adjustment'.
  v_source_type := COALESCE(
    NULLIF(btrim(COALESCE(NEW.type, '')), ''),
    NULLIF(btrim(COALESCE(NEW.transaction_type, '')), '')
  );

  NEW.transaction_type := public.normalize_wallet_transaction_type(
    v_source_type,
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

-- Backfill rows that should be sale but were saved as adjustment.
UPDATE public.transactions t
SET transaction_type = 'sale'
WHERE t.invoice_id IS NOT NULL
  AND lower(COALESCE(t.type, '')) IN ('sale', 'jualan', 'pembayaran_invois', 'item_manual')
  AND COALESCE(lower(t.transaction_type), '') <> 'sale';
