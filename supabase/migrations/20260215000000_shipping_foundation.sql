-- SHIP-1: Shipping DB foundation (pass-through shipping support)
-- Allowed ship_status values:
-- - not_required
-- - pending
-- - shipped
-- - delivered
-- - returned
-- - cancelled

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS shipping_charged NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS shipping_required BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shipment_id UUID;

UPDATE public.invoices
SET shipping_charged = 0
WHERE shipping_charged IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN shipping_charged SET DEFAULT 0;

ALTER TABLE public.invoices
  ALTER COLUMN shipping_charged SET NOT NULL;

UPDATE public.invoices
SET shipping_required = TRUE
WHERE shipping_required IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN shipping_required SET DEFAULT TRUE;

ALTER TABLE public.invoices
  ALTER COLUMN shipping_required SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_shipping_charged_non_negative'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_shipping_charged_non_negative
      CHECK (shipping_charged >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_shipping_method_check'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_shipping_method_check
      CHECK (
        shipping_method IS NULL
        OR lower(btrim(shipping_method)) IN ('prepaid', 'cod', 'pickup', 'meetup', 'selfpickup')
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  courier TEXT,
  tracking_no TEXT,
  ship_status TEXT NOT NULL DEFAULT 'pending',
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  shipping_cost NUMERIC NOT NULL DEFAULT 0,
  courier_paid BOOLEAN NOT NULL DEFAULT FALSE,
  courier_paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS courier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_no TEXT,
  ADD COLUMN IF NOT EXISTS ship_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS courier_paid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS courier_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.shipments
SET shipping_cost = 0
WHERE shipping_cost IS NULL;

ALTER TABLE public.shipments
  ALTER COLUMN shipping_cost SET DEFAULT 0;

ALTER TABLE public.shipments
  ALTER COLUMN shipping_cost SET NOT NULL;

UPDATE public.shipments
SET courier_paid = FALSE
WHERE courier_paid IS NULL;

ALTER TABLE public.shipments
  ALTER COLUMN courier_paid SET DEFAULT FALSE;

ALTER TABLE public.shipments
  ALTER COLUMN courier_paid SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_ship_status_check'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_ship_status_check
      CHECK (ship_status IN ('not_required', 'pending', 'shipped', 'delivered', 'returned', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipments_shipping_cost_non_negative'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT shipments_shipping_cost_non_negative
      CHECK (shipping_cost >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_shipment_id_fkey'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_shipment_id_fkey
      FOREIGN KEY (shipment_id)
      REFERENCES public.shipments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shipment_invoices (
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shipment_id, invoice_id)
);

ALTER TABLE public.shipment_invoices
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_invoices_shipment_id
  ON public.invoices(shipment_id);

CREATE INDEX IF NOT EXISTS idx_shipments_user_id
  ON public.shipments(user_id);

CREATE INDEX IF NOT EXISTS idx_shipments_user_ship_status
  ON public.shipments(user_id, ship_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_user_courier_paid
  ON public.shipments(user_id, courier_paid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipment_invoices_invoice_id
  ON public.shipment_invoices(invoice_id);

CREATE OR REPLACE FUNCTION public.set_shipments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipments_updated_at ON public.shipments;

CREATE TRIGGER trg_shipments_updated_at
BEFORE UPDATE ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.set_shipments_updated_at();

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipments'
      AND policyname = 'shipments_select_own'
  ) THEN
    CREATE POLICY shipments_select_own
    ON public.shipments
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipments'
      AND policyname = 'shipments_insert_own'
  ) THEN
    CREATE POLICY shipments_insert_own
    ON public.shipments
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipments'
      AND policyname = 'shipments_update_own'
  ) THEN
    CREATE POLICY shipments_update_own
    ON public.shipments
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipments'
      AND policyname = 'shipments_delete_own'
  ) THEN
    CREATE POLICY shipments_delete_own
    ON public.shipments
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipment_invoices'
      AND policyname = 'shipment_invoices_select_own'
  ) THEN
    CREATE POLICY shipment_invoices_select_own
    ON public.shipment_invoices
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.shipments s
        WHERE s.id = shipment_invoices.shipment_id
          AND s.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipment_invoices'
      AND policyname = 'shipment_invoices_insert_own'
  ) THEN
    CREATE POLICY shipment_invoices_insert_own
    ON public.shipment_invoices
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.shipments s
        WHERE s.id = shipment_invoices.shipment_id
          AND s.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = shipment_invoices.invoice_id
          AND i.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipment_invoices'
      AND policyname = 'shipment_invoices_update_own'
  ) THEN
    CREATE POLICY shipment_invoices_update_own
    ON public.shipment_invoices
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.shipments s
        WHERE s.id = shipment_invoices.shipment_id
          AND s.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = shipment_invoices.invoice_id
          AND i.user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.shipments s
        WHERE s.id = shipment_invoices.shipment_id
          AND s.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = shipment_invoices.invoice_id
          AND i.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shipment_invoices'
      AND policyname = 'shipment_invoices_delete_own'
  ) THEN
    CREATE POLICY shipment_invoices_delete_own
    ON public.shipment_invoices
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1
        FROM public.shipments s
        WHERE s.id = shipment_invoices.shipment_id
          AND s.user_id = auth.uid()
      )
    );
  END IF;
END $$;

REVOKE ALL ON TABLE public.shipments FROM anon;
REVOKE ALL ON TABLE public.shipment_invoices FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shipments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shipment_invoices TO authenticated;
