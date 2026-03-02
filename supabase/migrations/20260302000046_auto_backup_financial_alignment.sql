-- SAFETY-3B
-- Align auto backup snapshot financial metadata with dashboard financial definitions.
-- Why: keep `business_snapshots.metadata` numbers consistent with dashboard canonical logic
-- (net qty = sold qty - returned qty, shipping charged vs shipping cost split, goodwill as expense).

CREATE OR REPLACE FUNCTION public.insert_business_snapshot_for_user(
  p_user_id UUID,
  p_trigger TEXT DEFAULT 'auto_daily'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot_id UUID;
  v_revenue_item NUMERIC := 0;
  v_shipping_charged_total NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_item_cost_total NUMERIC := 0;
  v_shipping_cost_total NUMERIC := 0;
  v_platform_fees_total NUMERIC := 0;
  v_goodwill_adjustments_total NUMERIC := 0;
  v_total_expense NUMERIC := 0;
  v_total_profit NUMERIC := 0;
  v_wallet_balance NUMERIC := 0;
  v_inventory_value NUMERIC := 0;
  v_invoice_count INTEGER := 0;
  v_settled_invoice_count INTEGER := 0;
  v_items_count INTEGER := 0;
  v_customers_count INTEGER := 0;
  v_invoices_count INTEGER := 0;
  v_invoice_items_count INTEGER := 0;
  v_invoice_refunds_count INTEGER := 0;
  v_invoice_item_returns_count INTEGER := 0;
  v_shipments_count INTEGER := 0;
  v_wallet_transactions_count INTEGER := 0;
  v_wallets_count INTEGER := 0;
  v_invoice_fees_count INTEGER := 0;
  v_row_count_total INTEGER := 0;
  v_table_counts JSONB := '{}'::jsonb;
  v_checksum TEXT;
  v_file_name TEXT;
  v_metadata JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required for business snapshot insert.';
  END IF;

  WITH settled_invoices AS (
    SELECT
      i.id,
      GREATEST(COALESCE(NULLIF(to_jsonb(i)->>'shipping_charged', '')::numeric, 0), 0) AS shipping_charged,
      GREATEST(COALESCE(NULLIF(to_jsonb(i)->>'channel_fee_amount', '')::numeric, 0), 0) AS channel_fee_amount,
      GREATEST(COALESCE(NULLIF(to_jsonb(i)->>'adjustment_total', '')::numeric, 0), 0) AS adjustment_total,
      LOWER(COALESCE(NULLIF(to_jsonb(i)->>'courier_payment_mode', ''), 'seller')) AS courier_payment_mode,
      NULLIF(to_jsonb(i)->>'shipment_id', '') AS shipment_id
    FROM public.invoices i
    WHERE i.user_id = p_user_id
      AND i.status IN ('paid', 'partially_returned', 'returned')
  ),
  returns_by_item AS (
    SELECT
      r.invoice_item_id,
      SUM(COALESCE(r.refund_amount, 0)) AS refund_amount,
      SUM(COALESCE(r.returned_quantity, 0)) AS returned_quantity
    FROM public.invoice_item_returns r
    GROUP BY r.invoice_item_id
  ),
  invoice_line_rollup AS (
    SELECT
      ii.invoice_id,
      SUM(
        CASE
          WHEN NULLIF(to_jsonb(ii)->>'actual_sold_amount', '') IS NOT NULL
            THEN COALESCE(NULLIF(to_jsonb(ii)->>'actual_sold_amount', '')::numeric, 0)
          WHEN NULLIF(to_jsonb(ii)->>'line_total', '') IS NOT NULL
            THEN COALESCE(NULLIF(to_jsonb(ii)->>'line_total', '')::numeric, 0) - COALESCE(rbi.refund_amount, 0)
          ELSE (
            COALESCE(
              NULLIF(to_jsonb(ii)->>'unit_price', '')::numeric,
              NULLIF(to_jsonb(ii)->>'selling_price', '')::numeric,
              0
            ) * GREATEST(
              COALESCE(
                NULLIF(to_jsonb(ii)->>'quantity_sold', '')::numeric,
                COALESCE(
                  NULLIF(to_jsonb(ii)->>'quantity', '')::numeric,
                  NULLIF(to_jsonb(ii)->>'invoice_quantity', '')::numeric,
                  0
                ) - COALESCE(rbi.returned_quantity, 0),
                0
              ),
              0
            )
          ) - COALESCE(rbi.refund_amount, 0)
        END
      ) AS item_subtotal,
      SUM(
        (
          CASE
            WHEN COALESCE(NULLIF(to_jsonb(ii)->>'cost_price', '')::numeric, 0) > 0
              THEN COALESCE(NULLIF(to_jsonb(ii)->>'cost_price', '')::numeric, 0)
            WHEN COALESCE(NULLIF(to_jsonb(ii)->>'is_manual', '')::boolean, FALSE) = FALSE
              THEN COALESCE(NULLIF(to_jsonb(it)->>'cost_price', '')::numeric, 0)
            ELSE GREATEST(COALESCE(NULLIF(to_jsonb(ii)->>'cost_price', '')::numeric, 0), 0)
          END
        ) * GREATEST(
          COALESCE(
            NULLIF(to_jsonb(ii)->>'quantity_sold', '')::numeric,
            COALESCE(
              NULLIF(to_jsonb(ii)->>'quantity', '')::numeric,
              NULLIF(to_jsonb(ii)->>'invoice_quantity', '')::numeric,
              0
            ) - COALESCE(rbi.returned_quantity, 0),
            0
          ),
          0
        )
      ) AS item_cost,
      BOOL_OR(
        GREATEST(
          COALESCE(
            NULLIF(to_jsonb(ii)->>'quantity_sold', '')::numeric,
            COALESCE(
              NULLIF(to_jsonb(ii)->>'quantity', '')::numeric,
              NULLIF(to_jsonb(ii)->>'invoice_quantity', '')::numeric,
              0
            ) - COALESCE(rbi.returned_quantity, 0),
            0
          ),
          0
        ) > 0
        OR ABS(
          CASE
            WHEN NULLIF(to_jsonb(ii)->>'actual_sold_amount', '') IS NOT NULL
              THEN COALESCE(NULLIF(to_jsonb(ii)->>'actual_sold_amount', '')::numeric, 0)
            WHEN NULLIF(to_jsonb(ii)->>'line_total', '') IS NOT NULL
              THEN COALESCE(NULLIF(to_jsonb(ii)->>'line_total', '')::numeric, 0) - COALESCE(rbi.refund_amount, 0)
            ELSE (
              COALESCE(
                NULLIF(to_jsonb(ii)->>'unit_price', '')::numeric,
                NULLIF(to_jsonb(ii)->>'selling_price', '')::numeric,
                0
              ) * GREATEST(
                COALESCE(
                  NULLIF(to_jsonb(ii)->>'quantity_sold', '')::numeric,
                  COALESCE(
                    NULLIF(to_jsonb(ii)->>'quantity', '')::numeric,
                    NULLIF(to_jsonb(ii)->>'invoice_quantity', '')::numeric,
                    0
                  ) - COALESCE(rbi.returned_quantity, 0),
                  0
                ),
                0
              )
            ) - COALESCE(rbi.refund_amount, 0)
          END
        ) > 0.0001
      ) AS has_sales_activity
    FROM public.invoice_items ii
    LEFT JOIN returns_by_item rbi
      ON rbi.invoice_item_id = ii.id
    LEFT JOIN public.items it
      ON it.id::text = NULLIF(to_jsonb(ii)->>'item_id', '')
      AND it.user_id = p_user_id
    GROUP BY ii.invoice_id
  ),
  shipment_lookup AS (
    SELECT
      s.id::text AS shipment_id,
      COALESCE(NULLIF(to_jsonb(s)->>'courier_paid', '')::boolean, FALSE) AS courier_paid,
      GREATEST(COALESCE(NULLIF(to_jsonb(s)->>'shipping_cost', '')::numeric, 0), 0) AS shipping_cost
    FROM public.shipments s
    WHERE s.user_id = p_user_id
  ),
  fee_rollup AS (
    SELECT
      f.invoice_id,
      SUM(
        GREATEST(
          COALESCE(
            NULLIF(to_jsonb(f)->>'amount_override', '')::numeric,
            NULLIF(to_jsonb(f)->>'amount', '')::numeric,
            0
          ),
          0
        )
      ) AS platform_fee
    FROM public.invoice_fees f
    GROUP BY f.invoice_id
  ),
  goodwill_rollup AS (
    SELECT
      ir.invoice_id,
      SUM(
        CASE
          WHEN LOWER(COALESCE(to_jsonb(ir)->>'refund_type', to_jsonb(ir)->>'type', '')) IN ('goodwill', 'cancel', 'correction')
            THEN ABS(COALESCE(NULLIF(to_jsonb(ir)->>'amount', '')::numeric, 0))
          WHEN COALESCE(NULLIF(to_jsonb(ir)->>'amount', '')::numeric, 0) < 0
            THEN ABS(COALESCE(NULLIF(to_jsonb(ir)->>'amount', '')::numeric, 0))
          WHEN (
            LOWER(COALESCE(to_jsonb(ir)->>'reason', '') || ' ' || COALESCE(to_jsonb(ir)->>'notes', '') || ' ' || COALESCE(to_jsonb(ir)->>'note', '')) LIKE '%courtesy%'
            OR LOWER(COALESCE(to_jsonb(ir)->>'reason', '') || ' ' || COALESCE(to_jsonb(ir)->>'notes', '') || ' ' || COALESCE(to_jsonb(ir)->>'note', '')) LIKE '%gerak budi%'
            OR LOWER(COALESCE(to_jsonb(ir)->>'reason', '') || ' ' || COALESCE(to_jsonb(ir)->>'notes', '') || ' ' || COALESCE(to_jsonb(ir)->>'note', '')) LIKE '%diskaun%'
            OR LOWER(COALESCE(to_jsonb(ir)->>'reason', '') || ' ' || COALESCE(to_jsonb(ir)->>'notes', '') || ' ' || COALESCE(to_jsonb(ir)->>'note', '')) LIKE '%price adjustment%'
            OR LOWER(COALESCE(to_jsonb(ir)->>'reason', '') || ' ' || COALESCE(to_jsonb(ir)->>'notes', '') || ' ' || COALESCE(to_jsonb(ir)->>'note', '')) LIKE '%kompensasi%'
          )
            THEN ABS(COALESCE(NULLIF(to_jsonb(ir)->>'amount', '')::numeric, 0))
          ELSE 0
        END
      ) AS goodwill_total
    FROM public.invoice_refunds ir
    WHERE ir.user_id = p_user_id
    GROUP BY ir.invoice_id
  )
  SELECT
    ROUND(COALESCE(SUM(COALESCE(ilr.item_subtotal, 0)), 0), 2),
    ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN si.courier_payment_mode = 'platform' THEN 0
            ELSE COALESCE(si.shipping_charged, 0)
          END
        ),
        0
      ),
      2
    ),
    ROUND(COALESCE(SUM(COALESCE(ilr.item_cost, 0)), 0), 2),
    ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN si.courier_payment_mode = 'platform' THEN 0
            WHEN COALESCE(sl.courier_paid, FALSE) THEN COALESCE(sl.shipping_cost, 0)
            ELSE 0
          END
        ),
        0
      ),
      2
    ),
    ROUND(COALESCE(SUM(COALESCE(fr.platform_fee, si.channel_fee_amount, 0)), 0), 2),
    ROUND(
      COALESCE(
        SUM(
          CASE
            WHEN si.adjustment_total > 0 THEN si.adjustment_total
            ELSE COALESCE(gr.goodwill_total, 0)
          END
        ),
        0
      ),
      2
    ),
    COUNT(si.id)::INTEGER,
    COUNT(si.id) FILTER (WHERE COALESCE(ilr.has_sales_activity, FALSE))::INTEGER
  INTO
    v_revenue_item,
    v_shipping_charged_total,
    v_item_cost_total,
    v_shipping_cost_total,
    v_platform_fees_total,
    v_goodwill_adjustments_total,
    v_settled_invoice_count,
    v_invoice_count
  FROM settled_invoices si
  LEFT JOIN invoice_line_rollup ilr
    ON ilr.invoice_id = si.id
  LEFT JOIN shipment_lookup sl
    ON sl.shipment_id = si.shipment_id
  LEFT JOIN fee_rollup fr
    ON fr.invoice_id = si.id
  LEFT JOIN goodwill_rollup gr
    ON gr.invoice_id = si.id;

  v_total_revenue := ROUND(COALESCE(v_revenue_item, 0) + COALESCE(v_shipping_charged_total, 0), 2);
  v_total_expense := ROUND(
    COALESCE(v_item_cost_total, 0)
    + COALESCE(v_shipping_cost_total, 0)
    + COALESCE(v_platform_fees_total, 0)
    + COALESCE(v_goodwill_adjustments_total, 0),
    2
  );
  v_total_profit := ROUND(COALESCE(v_total_revenue, 0) - COALESCE(v_total_expense, 0), 2);
  v_invoice_count := GREATEST(COALESCE(v_invoice_count, 0), 0);
  v_settled_invoice_count := GREATEST(COALESCE(v_settled_invoice_count, 0), 0);

  IF to_regclass('public.wallets') IS NOT NULL THEN
    SELECT
      ROUND(
        COALESCE(
          SUM(
            COALESCE(
              NULLIF(to_jsonb(w)->>'current_balance', '')::numeric,
              NULLIF(to_jsonb(w)->>'balance', '')::numeric,
              NULLIF(to_jsonb(w)->>'amount', '')::numeric,
              0
            )
          ),
          0
        ),
        2
      ),
      COUNT(*)::INTEGER
    INTO v_wallet_balance, v_wallets_count
    FROM public.wallets w
    WHERE w.user_id = p_user_id;
  ELSE
    v_wallet_balance := 0;
    v_wallets_count := 0;
  END IF;

  IF to_regclass('public.items') IS NOT NULL THEN
    SELECT
      ROUND(
        COALESCE(
          SUM(
            COALESCE(NULLIF(to_jsonb(i)->>'cost_price', '')::numeric, 0) *
            GREATEST(
              COALESCE(
                NULLIF(to_jsonb(i)->>'available_quantity', '')::numeric,
                COALESCE(NULLIF(to_jsonb(i)->>'quantity', '')::numeric, 0) - COALESCE(NULLIF(to_jsonb(i)->>'quantity_reserved', '')::numeric, 0),
                0
              ),
              0
            )
          ),
          0
        ),
        2
      ),
      COUNT(*)::INTEGER
    INTO v_inventory_value, v_items_count
    FROM public.items i
    WHERE i.user_id = p_user_id;
  ELSE
    v_inventory_value := 0;
    v_items_count := 0;
  END IF;

  IF to_regclass('public.customers') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER
    INTO v_customers_count
    FROM public.customers c
    WHERE c.user_id = p_user_id;
  ELSIF to_regclass('public.clients') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER
    INTO v_customers_count
    FROM public.clients c
    WHERE c.user_id = p_user_id;
  ELSE
    v_customers_count := 0;
  END IF;

  IF to_regclass('public.invoices') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_invoices_count
    FROM public.invoices i
    WHERE i.user_id = p_user_id;
  END IF;

  IF to_regclass('public.invoice_items') IS NOT NULL
     AND to_regclass('public.invoices') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_invoice_items_count
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.user_id = p_user_id;
  END IF;

  IF to_regclass('public.invoice_refunds') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_invoice_refunds_count
    FROM public.invoice_refunds ir
    WHERE ir.user_id = p_user_id;
  END IF;

  IF to_regclass('public.invoice_item_returns') IS NOT NULL
     AND to_regclass('public.invoice_items') IS NOT NULL
     AND to_regclass('public.invoices') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_invoice_item_returns_count
    FROM public.invoice_item_returns r
    JOIN public.invoice_items ii ON ii.id = r.invoice_item_id
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.user_id = p_user_id;
  END IF;

  IF to_regclass('public.shipments') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_shipments_count
    FROM public.shipments s
    WHERE s.user_id = p_user_id;
  END IF;

  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_wallet_transactions_count
    FROM public.wallet_transactions wt
    WHERE wt.user_id = p_user_id;
  ELSIF to_regclass('public.transactions') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_wallet_transactions_count
    FROM public.transactions wt
    WHERE wt.user_id = p_user_id;
  END IF;

  IF to_regclass('public.invoice_fees') IS NOT NULL
     AND to_regclass('public.invoices') IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_invoice_fees_count
    FROM public.invoice_fees f
    JOIN public.invoices i ON i.id = f.invoice_id
    WHERE i.user_id = p_user_id;
  END IF;

  SELECT jsonb_build_object(
    'invoices', v_invoices_count,
    'invoice_items', v_invoice_items_count,
    'invoice_refunds', v_invoice_refunds_count,
    'invoice_item_returns', v_invoice_item_returns_count,
    'shipments', v_shipments_count,
    'items', v_items_count,
    'wallet_transactions', v_wallet_transactions_count,
    'wallets', v_wallets_count,
    'customers', v_customers_count,
    'invoice_fees', v_invoice_fees_count
  ) INTO v_table_counts;

  SELECT COALESCE(SUM((value)::INTEGER), 0)
  INTO v_row_count_total
  FROM jsonb_each_text(v_table_counts);

  v_checksum := md5(
    CONCAT_WS(
      '|',
      p_user_id::TEXT,
      v_revenue_item::TEXT,
      v_shipping_charged_total::TEXT,
      v_total_revenue::TEXT,
      v_item_cost_total::TEXT,
      v_shipping_cost_total::TEXT,
      v_platform_fees_total::TEXT,
      v_goodwill_adjustments_total::TEXT,
      v_total_expense::TEXT,
      v_total_profit::TEXT,
      v_wallet_balance::TEXT,
      v_invoice_count::TEXT,
      v_settled_invoice_count::TEXT,
      v_inventory_value::TEXT,
      v_row_count_total::TEXT,
      CURRENT_DATE::TEXT
    )
  );

  v_file_name := FORMAT(
    'auto-backup-%s.json',
    TO_CHAR(NOW(), 'YYYYMMDD')
  );

  v_metadata := jsonb_build_object(
    'trigger', p_trigger,
    'schedule', 'daily',
    'retention_keep_latest', 7,
    'generated_at', NOW(),
    'export_timestamp', NOW(),
    'mode', 'auto_snapshot',
    'date_range_active_filter', 'all_time',
    -- `revenue_item` follows dashboard "Revenue Item", while `total_revenue` includes shipping charged.
    'revenue_item', v_revenue_item,
    'shipping_charged', v_shipping_charged_total,
    'item_cost_total', v_item_cost_total,
    'shipping_cost_total', v_shipping_cost_total,
    'platform_fees_total', v_platform_fees_total,
    'goodwill_adjustments_total', v_goodwill_adjustments_total,
    'net_profit_current', v_total_profit,
    'total_profit', v_total_profit,
    'total_revenue', v_total_revenue,
    'total_expense', v_total_expense,
    'wallet_balance', v_wallet_balance,
    'invoice_count', v_invoice_count,
    'settled_invoice_count', v_settled_invoice_count,
    'inventory_value', v_inventory_value,
    'checksum', v_checksum
  );

  INSERT INTO public.business_snapshots (
    user_id,
    snapshot_type,
    file_name,
    row_count_total,
    table_counts,
    metadata,
    net_profit_current,
    total_revenue,
    total_expense,
    total_profit,
    wallet_balance,
    invoice_count,
    inventory_value,
    checksum,
    exported_at
  )
  VALUES (
    p_user_id,
    'full_backup',
    v_file_name,
    v_row_count_total,
    v_table_counts,
    v_metadata,
    v_total_profit,
    v_total_revenue,
    v_total_expense,
    v_total_profit,
    v_wallet_balance,
    v_invoice_count,
    v_inventory_value,
    v_checksum,
    NOW()
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_daily_business_snapshots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_processed INTEGER := 0;
  v_failed INTEGER := 0;
  v_active_user_sql TEXT := '';
  v_errors JSONB := '[]'::jsonb;
  v_error_message TEXT;
  v_error_state TEXT;
BEGIN
  IF to_regclass('public.invoices') IS NOT NULL THEN
    v_active_user_sql := v_active_user_sql
      || CASE WHEN v_active_user_sql = '' THEN '' ELSE ' UNION ' END
      || 'SELECT user_id FROM public.invoices';
  END IF;

  IF to_regclass('public.items') IS NOT NULL THEN
    v_active_user_sql := v_active_user_sql
      || CASE WHEN v_active_user_sql = '' THEN '' ELSE ' UNION ' END
      || 'SELECT user_id FROM public.items';
  ELSIF to_regclass('public.inventory') IS NOT NULL THEN
    v_active_user_sql := v_active_user_sql
      || CASE WHEN v_active_user_sql = '' THEN '' ELSE ' UNION ' END
      || 'SELECT user_id FROM public.inventory';
  END IF;

  IF to_regclass('public.wallets') IS NOT NULL THEN
    v_active_user_sql := v_active_user_sql
      || CASE WHEN v_active_user_sql = '' THEN '' ELSE ' UNION ' END
      || 'SELECT user_id FROM public.wallets';
  END IF;

  IF to_regclass('public.customers') IS NOT NULL THEN
    v_active_user_sql := v_active_user_sql
      || CASE WHEN v_active_user_sql = '' THEN '' ELSE ' UNION ' END
      || 'SELECT user_id FROM public.customers';
  ELSIF to_regclass('public.clients') IS NOT NULL THEN
    v_active_user_sql := v_active_user_sql
      || CASE WHEN v_active_user_sql = '' THEN '' ELSE ' UNION ' END
      || 'SELECT user_id FROM public.clients';
  END IF;

  IF v_active_user_sql = '' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'processed_users', 0,
      'failed_users', 0
    );
  END IF;

  v_active_user_sql := 'SELECT DISTINCT user_id FROM (' || v_active_user_sql || ') active_users WHERE user_id IS NOT NULL';

  FOR v_user_id IN EXECUTE v_active_user_sql LOOP
    BEGIN
      PERFORM public.insert_business_snapshot_for_user(v_user_id, 'auto_daily');
      v_processed := v_processed + 1;
    EXCEPTION
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
        GET STACKED DIAGNOSTICS
          v_error_message = MESSAGE_TEXT,
          v_error_state = RETURNED_SQLSTATE;
        IF jsonb_array_length(v_errors) < 20 THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object(
              'user_id', v_user_id,
              'sqlstate', v_error_state,
              'error', v_error_message
            )
          );
        END IF;
    END;
  END LOOP;

  IF v_failed > 0 THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'processed_users', v_processed,
      'failed_users', v_failed,
      'errors', v_errors
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'processed_users', v_processed,
    'failed_users', v_failed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.insert_business_snapshot_for_user(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_daily_business_snapshots() FROM PUBLIC, anon, authenticated;
