-- W2: Simplified wallet cashflow analytics (SQL aggregates)

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_created_at
  ON public.transactions(wallet_id, created_at DESC);

DROP FUNCTION IF EXISTS public.get_wallet_cashflow_trend(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.get_wallet_cashflow_trend(
  p_user_id UUID,
  p_wallet_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  tx_date DATE,
  inflow NUMERIC,
  outflow NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_DATE - (GREATEST(COALESCE(p_days, 30), 1) - 1))::DATE AS start_date,
      CURRENT_DATE::DATE AS end_date
  ),
  calendar AS (
    SELECT generate_series(
      (SELECT start_date FROM bounds),
      (SELECT end_date FROM bounds),
      INTERVAL '1 day'
    )::DATE AS tx_date
  ),
  normalized AS (
    SELECT
      DATE_TRUNC('day', t.created_at)::DATE AS tx_date,
      ABS(COALESCE(t.amount, 0)) AS amount_abs,
      CASE
        WHEN COALESCE(NULLIF(btrim(t.transaction_type), ''), '') <> '' THEN lower(t.transaction_type)
        ELSE lower(COALESCE(t.type, ''))
      END AS tx_type,
      lower(COALESCE(t.type, '')) AS legacy_type
    FROM public.transactions t
    CROSS JOIN bounds b
    WHERE t.user_id = p_user_id
      AND (p_wallet_id IS NULL OR t.wallet_id = p_wallet_id)
      AND t.created_at >= b.start_date
      AND t.created_at < (b.end_date + INTERVAL '1 day')
  ),
  aggregated AS (
    SELECT
      n.tx_date,
      SUM(
        CASE
          WHEN n.tx_type IN ('sale', 'topup', 'transfer_in') THEN n.amount_abs
          WHEN n.tx_type = 'adjustment'
            AND n.legacy_type NOT IN ('pelarasan_manual_kurang')
          THEN n.amount_abs
          ELSE 0
        END
      ) AS inflow,
      SUM(
        CASE
          WHEN n.tx_type IN ('expense', 'transfer_out') THEN n.amount_abs
          WHEN n.tx_type = 'adjustment'
            AND n.legacy_type IN ('pelarasan_manual_kurang')
          THEN n.amount_abs
          ELSE 0
        END
      ) AS outflow
    FROM normalized n
    GROUP BY n.tx_date
  )
  SELECT
    c.tx_date,
    COALESCE(a.inflow, 0)::NUMERIC AS inflow,
    COALESCE(a.outflow, 0)::NUMERIC AS outflow
  FROM calendar c
  LEFT JOIN aggregated a
    ON a.tx_date = c.tx_date
  ORDER BY c.tx_date ASC;
$$;

DROP FUNCTION IF EXISTS public.get_wallet_cashflow_breakdown(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.get_wallet_cashflow_breakdown(
  p_user_id UUID,
  p_wallet_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  flow_group TEXT,
  flow_type TEXT,
  total NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_DATE - (GREATEST(COALESCE(p_days, 30), 1) - 1))::DATE AS start_date,
      CURRENT_DATE::DATE AS end_date
  ),
  normalized AS (
    SELECT
      ABS(COALESCE(t.amount, 0)) AS amount_abs,
      CASE
        WHEN COALESCE(NULLIF(btrim(t.transaction_type), ''), '') <> '' THEN lower(t.transaction_type)
        ELSE lower(COALESCE(t.type, ''))
      END AS tx_type,
      lower(COALESCE(t.type, '')) AS legacy_type
    FROM public.transactions t
    CROSS JOIN bounds b
    WHERE t.user_id = p_user_id
      AND (p_wallet_id IS NULL OR t.wallet_id = p_wallet_id)
      AND t.created_at >= b.start_date
      AND t.created_at < (b.end_date + INTERVAL '1 day')
  ),
  classified AS (
    SELECT
      CASE
        WHEN n.tx_type IN ('sale', 'topup', 'transfer_in') THEN 'inflow'
        WHEN n.tx_type IN ('expense', 'transfer_out') THEN 'outflow'
        WHEN n.tx_type = 'adjustment' AND n.legacy_type IN ('pelarasan_manual_kurang') THEN 'outflow'
        WHEN n.tx_type = 'adjustment' THEN 'inflow'
        ELSE NULL
      END AS flow_group,
      CASE
        WHEN n.tx_type IN ('sale', 'topup', 'transfer_in', 'expense', 'transfer_out') THEN n.tx_type
        WHEN n.tx_type = 'adjustment' THEN 'other'
        ELSE NULL
      END AS flow_type,
      n.amount_abs
    FROM normalized n
    WHERE n.amount_abs > 0
  )
  SELECT
    c.flow_group,
    c.flow_type,
    SUM(c.amount_abs)::NUMERIC AS total
  FROM classified c
  WHERE c.flow_group IS NOT NULL
    AND c.flow_type IS NOT NULL
  GROUP BY c.flow_group, c.flow_type
  ORDER BY c.flow_group, c.flow_type;
$$;

GRANT EXECUTE ON FUNCTION public.get_wallet_cashflow_trend(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_cashflow_breakdown(UUID, UUID, INTEGER) TO authenticated;

