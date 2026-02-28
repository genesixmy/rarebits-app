-- FIN-REFUND-1:
-- Refund truth system with two explicit refund types:
-- 1) goodwill (no stock restore)
-- 2) return (stock restore)
--
-- Existing invoice totals model is preserved:
-- invoices.total_amount stays original, and net is reflected through
-- invoices.adjustment_total / invoices.returned_total / invoices.final_total.

CREATE TABLE IF NOT EXISTS public.invoice_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  refund_type TEXT NOT NULL CHECK (refund_type IN ('goodwill', 'return')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  reason TEXT,
  note TEXT,
  affects_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_restocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  wallet_transaction_id UUID NULL REFERENCES public.transactions(id) ON DELETE SET NULL,
  legacy_refund_id UUID NULL,
  legacy_return_id UUID NULL,
  restock_details JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_refunds_invoice_id
  ON public.invoice_refunds(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_refunds_user_id
  ON public.invoice_refunds(user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_refunds_user_created_at
  ON public.invoice_refunds(user_id, created_at DESC);

ALTER TABLE public.invoice_refunds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_refunds'
      AND policyname = 'invoice_refunds_select_own'
  ) THEN
    CREATE POLICY invoice_refunds_select_own
      ON public.invoice_refunds
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_refunds TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_refunds'
      AND policyname = 'invoice_refunds_insert_own'
  ) THEN
    CREATE POLICY invoice_refunds_insert_own
      ON public.invoice_refunds
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_refunds'
      AND policyname = 'invoice_refunds_update_own'
  ) THEN
    CREATE POLICY invoice_refunds_update_own
      ON public.invoice_refunds
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_refunds'
      AND policyname = 'invoice_refunds_delete_own'
  ) THEN
    CREATE POLICY invoice_refunds_delete_own
      ON public.invoice_refunds
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Backfill legacy goodwill rows so historical dashboard + invoice history remain accurate.
DO $$
DECLARE
  v_refunds_exists BOOLEAN := FALSE;
  v_refunds_has_user_id BOOLEAN := FALSE;
  v_refunds_has_issued_by BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'refunds'
  )
  INTO v_refunds_exists;

  IF NOT v_refunds_exists THEN
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
    INSERT INTO public.invoice_refunds (
      user_id,
      invoice_id,
      refund_type,
      amount,
      reason,
      note,
      affects_inventory,
      inventory_restocked,
      created_by,
      legacy_refund_id,
      created_at
    )
    SELECT
      i.user_id,
      r.invoice_id,
      'goodwill',
      GREATEST(COALESCE(r.amount, 0), 0),
      r.reason,
      r.notes,
      FALSE,
      FALSE,
      COALESCE(r.issued_by, r.user_id, i.user_id),
      r.id,
      COALESCE(r.created_at, r.issued_at, NOW())
    FROM public.refunds r
    INNER JOIN public.invoices i
      ON i.id = r.invoice_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.invoice_refunds ir
      WHERE ir.legacy_refund_id = r.id
    );
  ELSIF v_refunds_has_user_id THEN
    INSERT INTO public.invoice_refunds (
      user_id,
      invoice_id,
      refund_type,
      amount,
      reason,
      note,
      affects_inventory,
      inventory_restocked,
      created_by,
      legacy_refund_id,
      created_at
    )
    SELECT
      i.user_id,
      r.invoice_id,
      'goodwill',
      GREATEST(COALESCE(r.amount, 0), 0),
      r.reason,
      r.notes,
      FALSE,
      FALSE,
      COALESCE(r.user_id, i.user_id),
      r.id,
      COALESCE(r.created_at, r.issued_at, NOW())
    FROM public.refunds r
    INNER JOIN public.invoices i
      ON i.id = r.invoice_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.invoice_refunds ir
      WHERE ir.legacy_refund_id = r.id
    );
  ELSIF v_refunds_has_issued_by THEN
    INSERT INTO public.invoice_refunds (
      user_id,
      invoice_id,
      refund_type,
      amount,
      reason,
      note,
      affects_inventory,
      inventory_restocked,
      created_by,
      legacy_refund_id,
      created_at
    )
    SELECT
      i.user_id,
      r.invoice_id,
      'goodwill',
      GREATEST(COALESCE(r.amount, 0), 0),
      r.reason,
      r.notes,
      FALSE,
      FALSE,
      COALESCE(r.issued_by, i.user_id),
      r.id,
      COALESCE(r.created_at, r.issued_at, NOW())
    FROM public.refunds r
    INNER JOIN public.invoices i
      ON i.id = r.invoice_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.invoice_refunds ir
      WHERE ir.legacy_refund_id = r.id
    );
  ELSE
    INSERT INTO public.invoice_refunds (
      user_id,
      invoice_id,
      refund_type,
      amount,
      reason,
      note,
      affects_inventory,
      inventory_restocked,
      created_by,
      legacy_refund_id,
      created_at
    )
    SELECT
      i.user_id,
      r.invoice_id,
      'goodwill',
      GREATEST(COALESCE(r.amount, 0), 0),
      r.reason,
      r.notes,
      FALSE,
      FALSE,
      i.user_id,
      r.id,
      COALESCE(r.created_at, r.issued_at, NOW())
    FROM public.refunds r
    INNER JOIN public.invoices i
      ON i.id = r.invoice_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.invoice_refunds ir
      WHERE ir.legacy_refund_id = r.id
    );
  END IF;
END $$;

-- Backfill legacy return rows for historical net reporting and audit continuity.
INSERT INTO public.invoice_refunds (
  user_id,
  invoice_id,
  refund_type,
  amount,
  reason,
  note,
  affects_inventory,
  inventory_restocked,
  created_by,
  legacy_return_id,
  restock_details,
  created_at
)
SELECT
  i.user_id,
  r.invoice_id,
  'return',
  GREATEST(COALESCE(r.refund_amount, 0), 0),
  r.reason,
  r.notes,
  TRUE,
  TRUE,
  COALESCE(r.user_id, i.user_id),
  r.id,
  jsonb_build_array(
    jsonb_strip_nulls(
      jsonb_build_object(
        'invoice_item_id', r.invoice_item_id,
        'item_id', r.item_id,
        'quantity', COALESCE(r.returned_quantity, 0),
        'item_name', r.return_item_name,
        'refund_amount', GREATEST(COALESCE(r.refund_amount, 0), 0)
      )
    )
  ),
  COALESCE(r.created_at, NOW())
FROM public.invoice_item_returns r
INNER JOIN public.invoices i
  ON i.id = r.invoice_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.invoice_refunds ir
  WHERE ir.legacy_return_id = r.id
);

DROP FUNCTION IF EXISTS public.create_invoice_refund(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.create_invoice_refund(
  p_invoice_id UUID,
  p_user_id UUID,
  p_refund_type TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_return_items JSONB DEFAULT '[]'::JSONB
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  invoice_refund_id UUID,
  legacy_refund_id UUID,
  legacy_return_id UUID,
  wallet_transaction_id UUID,
  new_balance NUMERIC,
  adjustment_total NUMERIC,
  returned_total NUMERIC,
  final_total NUMERIC,
  invoice_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
DECLARE
  v_invoice RECORD;
  v_wallet RECORD;
  v_invoice_item RECORD;
  v_item RECORD;

  v_refund_type TEXT;
  v_amount NUMERIC;
  v_reason TEXT;
  v_note TEXT;
  v_return_items JSONB;

  v_original_total NUMERIC;
  v_existing_adjustment NUMERIC;
  v_existing_returned NUMERIC;
  v_current_final NUMERIC;
  v_next_adjustment NUMERIC;
  v_next_returned NUMERIC;
  v_next_final NUMERIC;
  v_next_status TEXT;

  v_new_balance NUMERIC;

  v_refunds_has_user_id BOOLEAN := FALSE;
  v_refunds_has_issued_by BOOLEAN := FALSE;

  v_invoice_refund_id UUID;
  v_legacy_refund_id UUID;
  v_legacy_return_id UUID;
  v_wallet_transaction_id UUID;

  v_wallet_tx_type TEXT;
  v_wallet_tx_description TEXT;
  v_wallet_tx_category TEXT;

  v_entry JSONB;
  v_entry_item_id_text TEXT;
  v_entry_qty_text TEXT;
  v_entry_invoice_item_id UUID;
  v_entry_qty INTEGER;
  v_existing_returned_qty INTEGER;
  v_remaining_qty INTEGER;
  v_item_name TEXT;

  v_entry_count INTEGER := 0;
  v_entry_index INTEGER := 0;
  v_entry_weight NUMERIC := 0;
  v_total_weight NUMERIC := 0;
  v_entry_refund NUMERIC := 0;
  v_allocated_sum NUMERIC := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN QUERY
    SELECT FALSE, 'Tidak dibenarkan'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_refund_type := lower(btrim(COALESCE(p_refund_type, '')));
  IF v_refund_type NOT IN ('goodwill', 'return') THEN
    RETURN QUERY
    SELECT FALSE, 'Jenis refund tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_amount := COALESCE(p_amount, 0);
  IF v_amount <> v_amount THEN
    RETURN QUERY
    SELECT FALSE, 'Amaun refund tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF v_amount <= 0 THEN
    RETURN QUERY
    SELECT FALSE, 'Amaun refund mesti lebih besar daripada 0'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  v_amount := ROUND(v_amount, 2);
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_note := NULLIF(LEFT(btrim(COALESCE(p_note, '')), 500), '');
  v_return_items := COALESCE(p_return_items, '[]'::JSONB);

  IF v_reason IS NULL THEN
    v_reason := CASE
      WHEN v_refund_type = 'goodwill' THEN 'Price Adjustment'
      ELSE 'Item Returned'
    END;
  END IF;

  SELECT
    i.id,
    i.user_id,
    i.invoice_number,
    i.status,
    i.total_amount,
    i.adjustment_total,
    i.returned_total,
    i.final_total
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.user_id = p_user_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RETURN QUERY
    SELECT FALSE, 'Invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF COALESCE(v_invoice.status, '') NOT IN ('paid', 'partially_returned') THEN
    RETURN QUERY
    SELECT FALSE, 'Refund hanya dibenarkan untuk invois dibayar'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, COALESCE(v_invoice.status, '')::TEXT;
    RETURN;
  END IF;

  v_original_total := GREATEST(COALESCE(v_invoice.total_amount, 0), 0);
  v_existing_adjustment := GREATEST(COALESCE(v_invoice.adjustment_total, 0), 0);
  v_existing_returned := GREATEST(COALESCE(v_invoice.returned_total, 0), 0);
  v_current_final := GREATEST(
    COALESCE(v_invoice.final_total, v_original_total - v_existing_adjustment - v_existing_returned),
    0
  );

  IF v_amount > v_current_final THEN
    RETURN QUERY
    SELECT FALSE, format('Amaun refund melebihi baki invois (maksimum %s)', to_char(v_current_final, 'FM9999990.00'))::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
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
    SELECT FALSE, 'Dompet tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
    RETURN;
  END IF;

  IF COALESCE(v_wallet.balance, 0) < v_amount THEN
    RETURN QUERY
    SELECT FALSE, 'Baki dompet tidak mencukupi'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
    RETURN;
  END IF;

  v_next_adjustment := v_existing_adjustment;
  v_next_returned := v_existing_returned;
  v_next_status := COALESCE(v_invoice.status, 'paid');

  IF v_refund_type = 'return' THEN
    IF jsonb_typeof(v_return_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_return_items) = 0 THEN
      RETURN QUERY
      SELECT FALSE, 'Senarai item return diperlukan'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
      RETURN;
    END IF;

    v_entry_count := jsonb_array_length(v_return_items);
    v_total_weight := 0;

    -- Validation pass
    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(v_return_items)
    LOOP
      v_entry_item_id_text := COALESCE(
        NULLIF(btrim(v_entry->>'invoice_item_id'), ''),
        NULLIF(btrim(v_entry->>'invoiceItemId'), '')
      );
      v_entry_qty_text := COALESCE(
        NULLIF(btrim(v_entry->>'quantity'), ''),
        NULLIF(btrim(v_entry->>'returned_quantity'), '')
      );

      IF v_entry_item_id_text IS NULL
         OR v_entry_item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN QUERY
        SELECT FALSE, 'Item return tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      IF v_entry_qty_text IS NULL OR v_entry_qty_text !~ '^[0-9]+$' THEN
        RETURN QUERY
        SELECT FALSE, 'Kuantiti return tidak sah'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      v_entry_invoice_item_id := v_entry_item_id_text::UUID;
      v_entry_qty := v_entry_qty_text::INTEGER;

      IF v_entry_qty <= 0 THEN
        RETURN QUERY
        SELECT FALSE, 'Kuantiti return mesti lebih besar daripada 0'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      SELECT
        ii.id,
        ii.invoice_id,
        ii.item_id,
        GREATEST(COALESCE(ii.quantity, 0), 0) AS quantity,
        COALESCE(ii.unit_price, 0) AS unit_price,
        GREATEST(COALESCE(ii.cost_price, 0), 0) AS cost_price,
        COALESCE(ii.item_name, '') AS item_name,
        COALESCE(it.name, 'Item') AS linked_item_name
      INTO v_invoice_item
      FROM public.invoice_items ii
      LEFT JOIN public.items it
        ON it.id = ii.item_id
      WHERE ii.id = v_entry_invoice_item_id
        AND ii.invoice_id = v_invoice.id
      FOR UPDATE OF ii;

      IF v_invoice_item IS NULL THEN
        RETURN QUERY
        SELECT FALSE, 'Item invois tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      IF v_invoice_item.item_id IS NULL THEN
        RETURN QUERY
        SELECT FALSE, 'Item manual tidak boleh dipulangkan stok'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      SELECT
        COALESCE(SUM(COALESCE(r.returned_quantity, 0)), 0)::INTEGER
      INTO v_existing_returned_qty
      FROM public.invoice_item_returns r
      WHERE r.invoice_item_id = v_invoice_item.id;

      v_remaining_qty := GREATEST(v_invoice_item.quantity - v_existing_returned_qty, 0);
      IF v_remaining_qty <= 0 THEN
        RETURN QUERY
        SELECT FALSE, 'Semua kuantiti item ini telah dipulangkan'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      IF v_entry_qty > v_remaining_qty THEN
        RETURN QUERY
        SELECT FALSE, format('Kuantiti pulangan melebihi baki yang boleh dipulangkan (maksimum %s)', v_remaining_qty)::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      SELECT
        it.id,
        COALESCE(it.quantity, 0) AS quantity
      INTO v_item
      FROM public.items it
      WHERE it.id = v_invoice_item.item_id
        AND it.user_id = p_user_id
      FOR UPDATE;

      IF v_item IS NULL THEN
        RETURN QUERY
        SELECT FALSE, 'Item inventori tidak ditemui'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
        RETURN;
      END IF;

      v_entry_weight := GREATEST(COALESCE(v_invoice_item.unit_price, 0), 0) * v_entry_qty;
      IF v_entry_weight <= 0 THEN
        v_entry_weight := v_entry_qty;
      END IF;
      v_total_weight := v_total_weight + v_entry_weight;
    END LOOP;

    IF v_total_weight <= 0 THEN
      RETURN QUERY
      SELECT FALSE, 'Amaun return tidak dapat diagihkan'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::NUMERIC, v_existing_adjustment, v_existing_returned, v_current_final, COALESCE(v_invoice.status, '')::TEXT;
      RETURN;
    END IF;

    -- Apply pass
    v_entry_index := 0;
    v_allocated_sum := 0;
    v_legacy_return_id := NULL;

    FOR v_entry IN
      SELECT value
      FROM jsonb_array_elements(v_return_items)
    LOOP
      v_entry_index := v_entry_index + 1;
      v_entry_item_id_text := COALESCE(
        NULLIF(btrim(v_entry->>'invoice_item_id'), ''),
        NULLIF(btrim(v_entry->>'invoiceItemId'), '')
      );
      v_entry_qty_text := COALESCE(
        NULLIF(btrim(v_entry->>'quantity'), ''),
        NULLIF(btrim(v_entry->>'returned_quantity'), '')
      );

      v_entry_invoice_item_id := v_entry_item_id_text::UUID;
      v_entry_qty := v_entry_qty_text::INTEGER;

      SELECT
        ii.id,
        ii.invoice_id,
        ii.item_id,
        GREATEST(COALESCE(ii.quantity, 0), 0) AS quantity,
        COALESCE(ii.unit_price, 0) AS unit_price,
        GREATEST(COALESCE(ii.cost_price, 0), 0) AS cost_price,
        COALESCE(ii.item_name, '') AS item_name,
        COALESCE(it.name, 'Item') AS linked_item_name
      INTO v_invoice_item
      FROM public.invoice_items ii
      LEFT JOIN public.items it
        ON it.id = ii.item_id
      WHERE ii.id = v_entry_invoice_item_id
        AND ii.invoice_id = v_invoice.id
      FOR UPDATE OF ii;

      SELECT
        it.id,
        COALESCE(it.quantity, 0) AS quantity
      INTO v_item
      FROM public.items it
      WHERE it.id = v_invoice_item.item_id
        AND it.user_id = p_user_id
      FOR UPDATE;

      v_entry_weight := GREATEST(COALESCE(v_invoice_item.unit_price, 0), 0) * v_entry_qty;
      IF v_entry_weight <= 0 THEN
        v_entry_weight := v_entry_qty;
      END IF;

      IF v_entry_index < v_entry_count THEN
        v_entry_refund := ROUND(v_amount * (v_entry_weight / v_total_weight), 2);
      ELSE
        v_entry_refund := ROUND(GREATEST(v_amount - v_allocated_sum, 0), 2);
      END IF;

      v_allocated_sum := v_allocated_sum + v_entry_refund;

      UPDATE public.items
      SET quantity = COALESCE(quantity, 0) + v_entry_qty
      WHERE id = v_item.id
        AND user_id = p_user_id;

      v_item_name := COALESCE(
        NULLIF(btrim(v_invoice_item.item_name), ''),
        NULLIF(btrim(v_invoice_item.linked_item_name), ''),
        'Item'
      );

      INSERT INTO public.invoice_item_returns (
        invoice_id,
        invoice_item_id,
        item_id,
        user_id,
        return_item_name,
        returned_quantity,
        refund_amount,
        returned_unit_price,
        returned_cost_price,
        reason,
        notes,
        created_at,
        updated_at
      )
      VALUES (
        v_invoice.id,
        v_invoice_item.id,
        v_invoice_item.item_id,
        p_user_id,
        v_item_name,
        v_entry_qty,
        v_entry_refund,
        GREATEST(COALESCE(v_invoice_item.unit_price, 0), 0),
        GREATEST(COALESCE(v_invoice_item.cost_price, 0), 0),
        v_reason,
        v_note,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_legacy_return_id;
    END LOOP;

    v_next_returned := ROUND(v_existing_returned + v_amount, 2);
    v_next_status := CASE
      WHEN ROUND(GREATEST(v_original_total - v_existing_adjustment - v_next_returned, 0), 2) <= 0 THEN 'returned'
      ELSE 'partially_returned'
    END;
  ELSE
    -- goodwill (legacy compatibility row in public.refunds)
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
        v_amount,
        v_reason,
        v_note,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_legacy_refund_id;
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
        v_amount,
        v_reason,
        v_note,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_legacy_refund_id;
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
        v_amount,
        v_reason,
        v_note,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_legacy_refund_id;
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
        v_amount,
        v_reason,
        v_note,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_legacy_refund_id;
    END IF;

    v_next_adjustment := ROUND(v_existing_adjustment + v_amount, 2);
    -- keep partially_returned if already in that state
    IF COALESCE(v_invoice.status, '') = 'partially_returned' THEN
      v_next_status := 'partially_returned';
    ELSE
      v_next_status := 'paid';
    END IF;
  END IF;

  v_next_final := ROUND(
    GREATEST(v_original_total - v_next_adjustment - v_next_returned, 0),
    2
  );

  INSERT INTO public.invoice_refunds (
    user_id,
    invoice_id,
    refund_type,
    amount,
    reason,
    note,
    affects_inventory,
    inventory_restocked,
    created_by,
    legacy_refund_id,
    legacy_return_id,
    restock_details,
    created_at
  )
  VALUES (
    p_user_id,
    v_invoice.id,
    v_refund_type,
    v_amount,
    v_reason,
    v_note,
    v_refund_type = 'return',
    v_refund_type = 'return',
    COALESCE(auth.uid(), p_user_id),
    v_legacy_refund_id,
    v_legacy_return_id,
    CASE WHEN v_refund_type = 'return' THEN v_return_items ELSE NULL END,
    NOW()
  )
  RETURNING id INTO v_invoice_refund_id;

  IF v_refund_type = 'return' THEN
    v_wallet_tx_type := 'sales_return';
    v_wallet_tx_description := 'Sales Return untuk invois ' || COALESCE(v_invoice.invoice_number, v_invoice.id::TEXT);
    v_wallet_tx_category := 'Pulangan Jualan';
  ELSE
    v_wallet_tx_type := 'refund';
    v_wallet_tx_description := 'Refund (Goodwill) untuk invois ' || COALESCE(v_invoice.invoice_number, v_invoice.id::TEXT);
    v_wallet_tx_category := 'Refund Goodwill';
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
    v_wallet_tx_type,
    'adjustment',
    v_amount,
    v_wallet_tx_description,
    v_wallet_tx_category,
    CURRENT_DATE,
    NULL,
    'invoice',
    v_invoice.id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'invoice_refund_id', v_invoice_refund_id,
        'refund_type', v_refund_type,
        'amount', v_amount,
        'reason', v_reason,
        'note', v_note,
        'legacy_refund_id', v_legacy_refund_id,
        'legacy_return_id', v_legacy_return_id,
        'return_items', CASE WHEN v_refund_type = 'return' THEN v_return_items ELSE NULL END
      )
    ),
    NOW()
  )
  RETURNING id INTO v_wallet_transaction_id;

  UPDATE public.invoice_refunds
  SET wallet_transaction_id = v_wallet_transaction_id
  WHERE id = v_invoice_refund_id;

  v_new_balance := COALESCE(v_wallet.balance, 0) - v_amount;

  UPDATE public.wallets
  SET
    balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  UPDATE public.invoices
  SET
    adjustment_total = v_next_adjustment,
    returned_total = v_next_returned,
    final_total = v_next_final,
    status = v_next_status,
    updated_at = NOW()
  WHERE id = v_invoice.id
    AND user_id = p_user_id;

  RETURN QUERY
  SELECT
    TRUE,
    CASE
      WHEN v_refund_type = 'return' THEN 'Pulangan item berjaya diproses'
      ELSE 'Pelarasan harga berjaya direkod'
    END::TEXT,
    v_invoice_refund_id,
    v_legacy_refund_id,
    v_legacy_return_id,
    v_wallet_transaction_id,
    v_new_balance,
    v_next_adjustment,
    v_next_returned,
    v_next_final,
    v_next_status;
END;
$$;

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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.success,
    r.message,
    COALESCE(r.legacy_refund_id, r.invoice_refund_id) AS refund_id,
    r.wallet_transaction_id AS transaction_id,
    r.new_balance,
    r.adjustment_total,
    r.final_total
  FROM public.create_invoice_refund(
    p_invoice_id,
    p_user_id,
    'goodwill',
    p_refund_amount,
    p_reason,
    p_notes,
    '[]'::JSONB
  ) r;
END;
$$;

DROP FUNCTION IF EXISTS public.process_invoice_return(UUID, UUID, UUID, INTEGER, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_invoice_return(
  p_invoice_id UUID,
  p_user_id UUID,
  p_invoice_item_id UUID,
  p_return_quantity INTEGER,
  p_refund_amount NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  return_id UUID,
  transaction_id UUID,
  new_balance NUMERIC,
  returned_total NUMERIC,
  final_total NUMERIC,
  invoice_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.success,
    r.message,
    COALESCE(r.legacy_return_id, r.invoice_refund_id) AS return_id,
    r.wallet_transaction_id AS transaction_id,
    r.new_balance,
    r.returned_total,
    r.final_total,
    r.invoice_status
  FROM public.create_invoice_refund(
    p_invoice_id,
    p_user_id,
    'return',
    p_refund_amount,
    p_reason,
    p_notes,
    jsonb_build_array(
      jsonb_build_object(
        'invoice_item_id', p_invoice_item_id,
        'quantity', p_return_quantity
      )
    )
  ) r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_invoice_refund(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_refund(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_invoice_return(UUID, UUID, UUID, INTEGER, NUMERIC, TEXT, TEXT) TO authenticated;
