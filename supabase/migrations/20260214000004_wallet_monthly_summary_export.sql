-- W3: Monthly wallet summary and export helpers

DROP FUNCTION IF EXISTS public.get_wallet_monthly_summary(UUID, UUID, DATE);

CREATE OR REPLACE FUNCTION public.get_wallet_monthly_summary(
  p_user_id UUID,
  p_wallet_id UUID,
  p_month_start DATE
)
RETURNS TABLE(
  month_start DATE,
  month_end DATE,
  inflow NUMERIC,
  outflow NUMERIC,
  net NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', COALESCE(p_month_start, CURRENT_DATE))::DATE AS start_date,
      (date_trunc('month', COALESCE(p_month_start, CURRENT_DATE)) + INTERVAL '1 month')::DATE AS next_month_date
  ),
  normalized AS (
    SELECT
      ABS(COALESCE(t.amount, 0)) AS amount_abs,
      public.normalize_wallet_transaction_type(
        COALESCE(NULLIF(btrim(t.transaction_type), ''), t.type),
        t.amount,
        t.category,
        t.invoice_id
      ) AS tx_type
    FROM public.transactions t
    CROSS JOIN bounds b
    WHERE t.user_id = p_user_id
      AND t.wallet_id = p_wallet_id
      AND t.created_at >= b.start_date
      AND t.created_at < b.next_month_date
  )
  SELECT
    b.start_date AS month_start,
    (b.next_month_date - INTERVAL '1 day')::DATE AS month_end,
    COALESCE(SUM(CASE WHEN n.tx_type IN ('sale', 'topup', 'transfer_in') THEN n.amount_abs ELSE 0 END), 0)::NUMERIC AS inflow,
    COALESCE(SUM(CASE WHEN n.tx_type IN ('expense', 'transfer_out') THEN n.amount_abs ELSE 0 END), 0)::NUMERIC AS outflow,
    (
      COALESCE(SUM(CASE WHEN n.tx_type IN ('sale', 'topup', 'transfer_in') THEN n.amount_abs ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN n.tx_type IN ('expense', 'transfer_out') THEN n.amount_abs ELSE 0 END), 0)
    )::NUMERIC AS net
  FROM bounds b
  LEFT JOIN normalized n ON TRUE
  GROUP BY b.start_date, b.next_month_date;
$$;

DROP FUNCTION IF EXISTS public.get_wallet_monthly_transactions_export(UUID, UUID, DATE);

CREATE OR REPLACE FUNCTION public.get_wallet_monthly_transactions_export(
  p_user_id UUID,
  p_wallet_id UUID,
  p_month_start DATE
)
RETURNS TABLE(
  created_at TIMESTAMPTZ,
  transaction_type TEXT,
  legacy_type TEXT,
  description TEXT,
  category TEXT,
  amount NUMERIC,
  wallet_id UUID,
  invoice_id UUID,
  transfer_id UUID
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', COALESCE(p_month_start, CURRENT_DATE))::DATE AS start_date,
      (date_trunc('month', COALESCE(p_month_start, CURRENT_DATE)) + INTERVAL '1 month')::DATE AS next_month_date
  )
  SELECT
    t.created_at,
    public.normalize_wallet_transaction_type(
      COALESCE(NULLIF(btrim(t.transaction_type), ''), t.type),
      t.amount,
      t.category,
      t.invoice_id
    ) AS transaction_type,
    lower(COALESCE(t.type, '')) AS legacy_type,
    COALESCE(NULLIF(btrim(t.description), ''), NULLIF(btrim(t.category), ''), 'Transaksi') AS description,
    COALESCE(t.category, '') AS category,
    COALESCE(t.amount, 0) AS amount,
    t.wallet_id,
    t.invoice_id,
    t.transfer_id
  FROM public.transactions t
  CROSS JOIN bounds b
  WHERE t.user_id = p_user_id
    AND t.wallet_id = p_wallet_id
    AND t.created_at >= b.start_date
    AND t.created_at < b.next_month_date
  ORDER BY t.created_at ASC, t.id ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_wallet_monthly_summary(UUID, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_monthly_transactions_export(UUID, UUID, DATE) TO authenticated;

