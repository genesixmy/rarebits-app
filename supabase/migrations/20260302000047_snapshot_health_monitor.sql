-- SAFETY-3C
-- Daily monitor view: detect business snapshots missing metadata v2 keys.

CREATE OR REPLACE VIEW public.snapshot_health_monitor AS
SELECT
  bs.id,
  bs.user_id,
  bs.created_at,
  bs.snapshot_type,
  (CARDINALITY(mk.missing_keys) = 0) AS has_v2_metadata,
  mk.missing_keys,
  CASE
    WHEN CARDINALITY(mk.missing_keys) = 0 THEN 'v2'
    WHEN
      bs.metadata ? 'date_range_active_filter'
      AND bs.metadata ? 'net_profit_current'
      AND bs.metadata ? 'total_revenue'
      AND bs.metadata ? 'total_expense'
      AND bs.metadata ? 'wallet_balance'
      AND bs.metadata ? 'invoice_count'
      AND bs.metadata ? 'inventory_value'
      AND bs.metadata ? 'checksum'
      AND NOT (bs.metadata ? 'export_timestamp')
      THEN 'v2_without_export_timestamp'
    WHEN bs.metadata = '{}'::jsonb THEN 'empty_metadata'
    ELSE 'legacy_or_partial'
  END AS metadata_version_guess
FROM public.business_snapshots bs
CROSS JOIN LATERAL (
  SELECT COALESCE(
    ARRAY_AGG(required.key ORDER BY required.key) FILTER (WHERE NOT (bs.metadata ? required.key)),
    ARRAY[]::TEXT[]
  ) AS missing_keys
  FROM (
    VALUES
      ('export_timestamp'),
      ('date_range_active_filter'),
      ('net_profit_current'),
      ('total_revenue'),
      ('total_expense'),
      ('wallet_balance'),
      ('invoice_count'),
      ('inventory_value'),
      ('checksum')
  ) AS required(key)
) mk;
