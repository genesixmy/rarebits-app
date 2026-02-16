-- SC-1: Sales Channel foundation + invoice fee snapshot.
-- Adds per-user sales channels and invoice snapshot fee fields.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sales_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fee_type TEXT NOT NULL DEFAULT 'none',
  fee_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sales_channels
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS fee_type TEXT,
  ADD COLUMN IF NOT EXISTS fee_value NUMERIC,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.sales_channels
SET
  name = COALESCE(NULLIF(btrim(name), ''), 'Platform'),
  fee_type = CASE
    WHEN lower(COALESCE(fee_type, 'none')) IN ('none', 'percentage', 'fixed')
      THEN lower(COALESCE(fee_type, 'none'))
    ELSE 'none'
  END,
  fee_value = GREATEST(COALESCE(fee_value, 0), 0),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW())
WHERE
  name IS NULL
  OR btrim(name) = ''
  OR fee_type IS NULL
  OR lower(fee_type) NOT IN ('none', 'percentage', 'fixed')
  OR fee_value IS NULL
  OR fee_value < 0
  OR created_at IS NULL
  OR updated_at IS NULL;

DELETE FROM public.sales_channels
WHERE user_id IS NULL
  OR COALESCE(btrim(name), '') = '';

ALTER TABLE public.sales_channels
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN fee_type SET DEFAULT 'none',
  ALTER COLUMN fee_type SET NOT NULL,
  ALTER COLUMN fee_value SET DEFAULT 0,
  ALTER COLUMN fee_value SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_channels_name_not_blank_check'
      AND conrelid = 'public.sales_channels'::regclass
  ) THEN
    ALTER TABLE public.sales_channels
      ADD CONSTRAINT sales_channels_name_not_blank_check
      CHECK (btrim(name) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_channels_fee_type_check'
      AND conrelid = 'public.sales_channels'::regclass
  ) THEN
    ALTER TABLE public.sales_channels
      ADD CONSTRAINT sales_channels_fee_type_check
      CHECK (lower(fee_type) IN ('none', 'percentage', 'fixed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_channels_fee_value_non_negative_check'
      AND conrelid = 'public.sales_channels'::regclass
  ) THEN
    ALTER TABLE public.sales_channels
      ADD CONSTRAINT sales_channels_fee_value_non_negative_check
      CHECK (fee_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_channels_percentage_range_check'
      AND conrelid = 'public.sales_channels'::regclass
  ) THEN
    ALTER TABLE public.sales_channels
      ADD CONSTRAINT sales_channels_percentage_range_check
      CHECK (
        lower(fee_type) <> 'percentage'
        OR fee_value <= 100
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_channels_user_name_unique
  ON public.sales_channels(user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_sales_channels_user_id
  ON public.sales_channels(user_id);

CREATE OR REPLACE FUNCTION public.set_sales_channels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_channels_updated_at ON public.sales_channels;

CREATE TRIGGER trg_sales_channels_updated_at
BEFORE UPDATE ON public.sales_channels
FOR EACH ROW
EXECUTE FUNCTION public.set_sales_channels_updated_at();

ALTER TABLE public.sales_channels ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_channels' AND policyname = 'sales_channels_select_own'
  ) THEN
    CREATE POLICY sales_channels_select_own
    ON public.sales_channels
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_channels' AND policyname = 'sales_channels_insert_own'
  ) THEN
    CREATE POLICY sales_channels_insert_own
    ON public.sales_channels
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_channels' AND policyname = 'sales_channels_update_own'
  ) THEN
    CREATE POLICY sales_channels_update_own
    ON public.sales_channels
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_channels' AND policyname = 'sales_channels_delete_own'
  ) THEN
    CREATE POLICY sales_channels_delete_own
    ON public.sales_channels
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.sales_channels FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_channels TO authenticated;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sales_channel_id UUID,
  ADD COLUMN IF NOT EXISTS channel_fee_amount NUMERIC;

UPDATE public.invoices
SET channel_fee_amount = COALESCE(channel_fee_amount, 0)
WHERE channel_fee_amount IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN channel_fee_amount SET DEFAULT 0,
  ALTER COLUMN channel_fee_amount SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_channel_fee_non_negative_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_channel_fee_non_negative_check
      CHECK (channel_fee_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_sales_channel_id_fkey'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_sales_channel_id_fkey
      FOREIGN KEY (sales_channel_id)
      REFERENCES public.sales_channels(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_sales_channel_id
  ON public.invoices(sales_channel_id);

DROP FUNCTION IF EXISTS public.calculate_sales_channel_fee(NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.calculate_sales_channel_fee(
  p_subtotal NUMERIC,
  p_fee_type TEXT,
  p_fee_value NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_subtotal NUMERIC := GREATEST(COALESCE(p_subtotal, 0), 0);
  v_fee_value NUMERIC := GREATEST(COALESCE(p_fee_value, 0), 0);
  v_fee_type TEXT := lower(COALESCE(p_fee_type, 'none'));
BEGIN
  IF v_fee_type = 'percentage' THEN
    RETURN ROUND((v_subtotal * v_fee_value) / 100.0, 2);
  ELSIF v_fee_type = 'fixed' THEN
    RETURN ROUND(v_fee_value, 2);
  END IF;

  RETURN 0;
END;
$$;

DROP FUNCTION IF EXISTS public.apply_invoice_sales_channel_fee();

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
    NEW.channel_fee_amount := 0;
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

DROP TRIGGER IF EXISTS trg_apply_invoice_sales_channel_fee ON public.invoices;

CREATE TRIGGER trg_apply_invoice_sales_channel_fee
BEFORE INSERT OR UPDATE OF sales_channel_id, subtotal
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.apply_invoice_sales_channel_fee();

DROP FUNCTION IF EXISTS public.get_user_sales_channels();

CREATE OR REPLACE FUNCTION public.get_user_sales_channels()
RETURNS TABLE(
  id UUID,
  name TEXT,
  fee_type TEXT,
  fee_value NUMERIC,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
  SELECT
    sc.id,
    sc.name,
    lower(sc.fee_type) AS fee_type,
    sc.fee_value,
    sc.created_at,
    sc.updated_at
  FROM public.sales_channels sc
  WHERE sc.user_id = auth.uid()
  ORDER BY lower(btrim(sc.name)) ASC, sc.created_at ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_user_sales_channels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_sales_channels() TO authenticated;
