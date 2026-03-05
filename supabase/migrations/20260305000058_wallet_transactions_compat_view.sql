-- CORE-LINT-58
-- Compatibility shim for legacy routines still referencing public.wallet_transactions.

DO $$
BEGIN
  IF to_regclass('public.wallet_transactions') IS NULL
     AND to_regclass('public.transactions') IS NOT NULL THEN
    EXECUTE '
      CREATE VIEW public.wallet_transactions AS
      SELECT t.*
      FROM public.transactions t
    ';
  END IF;
END $$;
