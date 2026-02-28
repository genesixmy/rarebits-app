-- FEE-1
-- Platform fee rules + per-invoice fee snapshots (multi-select ready)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.platform_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fee_type TEXT NOT NULL,
  fee_value NUMERIC NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_fee_rules_name_not_blank'
      AND conrelid = 'public.platform_fee_rules'::regclass
  ) THEN
    ALTER TABLE public.platform_fee_rules
      ADD CONSTRAINT platform_fee_rules_name_not_blank
      CHECK (btrim(name) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_fee_rules_fee_type_allowed'
      AND conrelid = 'public.platform_fee_rules'::regclass
  ) THEN
    ALTER TABLE public.platform_fee_rules
      ADD CONSTRAINT platform_fee_rules_fee_type_allowed
      CHECK (fee_type IN ('percentage', 'flat'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_fee_rules_fee_value_non_negative'
      AND conrelid = 'public.platform_fee_rules'::regclass
  ) THEN
    ALTER TABLE public.platform_fee_rules
      ADD CONSTRAINT platform_fee_rules_fee_value_non_negative
      CHECK (fee_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_fee_rules_percentage_max_100'
      AND conrelid = 'public.platform_fee_rules'::regclass
  ) THEN
    ALTER TABLE public.platform_fee_rules
      ADD CONSTRAINT platform_fee_rules_percentage_max_100
      CHECK (fee_type <> 'percentage' OR fee_value <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_fee_rules_user_id
  ON public.platform_fee_rules(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_fee_rules_user_name_unique
  ON public.platform_fee_rules(user_id, lower(btrim(name)));

ALTER TABLE public.platform_fee_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_fee_rules'
      AND policyname = 'platform_fee_rules_select_own'
  ) THEN
    CREATE POLICY platform_fee_rules_select_own
      ON public.platform_fee_rules
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_fee_rules'
      AND policyname = 'platform_fee_rules_insert_own'
  ) THEN
    CREATE POLICY platform_fee_rules_insert_own
      ON public.platform_fee_rules
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_fee_rules'
      AND policyname = 'platform_fee_rules_update_own'
  ) THEN
    CREATE POLICY platform_fee_rules_update_own
      ON public.platform_fee_rules
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_fee_rules'
      AND policyname = 'platform_fee_rules_delete_own'
  ) THEN
    CREATE POLICY platform_fee_rules_delete_own
      ON public.platform_fee_rules
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.platform_fee_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_fee_rules TO authenticated;

CREATE TABLE IF NOT EXISTS public.invoice_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fee_rule_id UUID REFERENCES public.platform_fee_rules(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  fee_type TEXT NOT NULL,
  fee_value NUMERIC NOT NULL,
  base_amount NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_name_not_blank'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_name_not_blank
      CHECK (btrim(name) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_fee_type_allowed'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_fee_type_allowed
      CHECK (fee_type IN ('percentage', 'flat'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_fee_value_non_negative'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_fee_value_non_negative
      CHECK (fee_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_base_amount_non_negative'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_base_amount_non_negative
      CHECK (base_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_fees_amount_non_negative'
      AND conrelid = 'public.invoice_fees'::regclass
  ) THEN
    ALTER TABLE public.invoice_fees
      ADD CONSTRAINT invoice_fees_amount_non_negative
      CHECK (amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_fees_invoice_id
  ON public.invoice_fees(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_fees_user_id
  ON public.invoice_fees(user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_fees_fee_rule_id
  ON public.invoice_fees(fee_rule_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_fees_invoice_rule_unique
  ON public.invoice_fees(invoice_id, fee_rule_id)
  WHERE fee_rule_id IS NOT NULL;

ALTER TABLE public.invoice_fees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_fees'
      AND policyname = 'invoice_fees_select_own'
  ) THEN
    CREATE POLICY invoice_fees_select_own
      ON public.invoice_fees
      FOR SELECT
      TO authenticated
      USING (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.invoices i
          WHERE i.id = invoice_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_fees'
      AND policyname = 'invoice_fees_insert_own'
  ) THEN
    CREATE POLICY invoice_fees_insert_own
      ON public.invoice_fees
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.invoices i
          WHERE i.id = invoice_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_fees'
      AND policyname = 'invoice_fees_update_own'
  ) THEN
    CREATE POLICY invoice_fees_update_own
      ON public.invoice_fees
      FOR UPDATE
      TO authenticated
      USING (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.invoices i
          WHERE i.id = invoice_id
            AND i.user_id = auth.uid()
        )
      )
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.invoices i
          WHERE i.id = invoice_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_fees'
      AND policyname = 'invoice_fees_delete_own'
  ) THEN
    CREATE POLICY invoice_fees_delete_own
      ON public.invoice_fees
      FOR DELETE
      TO authenticated
      USING (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.invoices i
          WHERE i.id = invoice_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;
END $$;

REVOKE ALL ON TABLE public.invoice_fees FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_fees TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_invoice_fees_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_invoice_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  SELECT i.id, i.user_id, i.status
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = v_invoice_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invois tidak ditemui untuk caj platform.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id IS DISTINCT FROM v_invoice.user_id THEN
      RAISE EXCEPTION 'Pemilikan caj platform tidak sepadan dengan invois.';
    END IF;
  ELSE
    IF NEW.user_id IS DISTINCT FROM v_invoice.user_id THEN
      RAISE EXCEPTION 'Pemilikan caj platform tidak sepadan dengan invois.';
    END IF;

    IF NEW.fee_rule_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.platform_fee_rules r
      WHERE r.id = NEW.fee_rule_id
        AND r.user_id = v_invoice.user_id
    ) THEN
      RAISE EXCEPTION 'Rule caj platform tidak sah untuk invois ini.';
    END IF;
  END IF;

  IF v_invoice.status IN ('paid', 'partially_returned', 'returned') THEN
    RAISE EXCEPTION 'Caj platform tidak boleh diubah selepas invois dibayar.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_fees_mutation ON public.invoice_fees;

CREATE TRIGGER trg_guard_invoice_fees_mutation
BEFORE INSERT OR UPDATE OR DELETE
ON public.invoice_fees
FOR EACH ROW
EXECUTE FUNCTION public.guard_invoice_fees_mutation();

-- Preserve manually-snapshotted fee totals when sales_channel_id is NULL.
-- Legacy channel-based invoices (sales_channel_id present) keep existing behavior.
CREATE OR REPLACE FUNCTION public.apply_invoice_sales_channel_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel RECORD;
BEGIN
  IF NEW.sales_channel_id IS NULL THEN
    NEW.channel_fee_amount := GREATEST(COALESCE(NEW.channel_fee_amount, 0), 0);
    RETURN NEW;
  END IF;

  SELECT
    sc.id,
    sc.user_id,
    sc.fee_type,
    sc.fee_value
  INTO v_channel
  FROM public.sales_channels sc
  WHERE sc.id = NEW.sales_channel_id
    AND sc.user_id = NEW.user_id;

  IF v_channel IS NULL THEN
    RAISE EXCEPTION 'Platform jualan tidak sah untuk pengguna ini.';
  END IF;

  NEW.channel_fee_amount := public.calculate_sales_channel_fee(
    COALESCE(NEW.subtotal, 0),
    v_channel.fee_type,
    v_channel.fee_value
  );

  RETURN NEW;
END;
$$;
