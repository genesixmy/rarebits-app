-- Invoice settings for A4/Thermal print header/footer
-- Keeps legacy numbering columns for compatibility.

CREATE TABLE IF NOT EXISTS public.invoice_settings (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_prefix TEXT DEFAULT 'RB-INV',
  current_date_counter TEXT DEFAULT '',
  current_counter INTEGER DEFAULT 0,
  company_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  fax TEXT,
  logo_url TEXT,
  show_logo BOOLEAN NOT NULL DEFAULT TRUE,
  tax_number TEXT,
  show_tax BOOLEAN NOT NULL DEFAULT FALSE,
  business_reg_no TEXT,
  footer_notes TEXT,
  show_generated_by BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS invoice_prefix TEXT DEFAULT 'RB-INV',
  ADD COLUMN IF NOT EXISTS current_date_counter TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_counter INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS fax TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS show_logo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tax_number TEXT,
  ADD COLUMN IF NOT EXISTS show_tax BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS business_reg_no TEXT,
  ADD COLUMN IF NOT EXISTS footer_notes TEXT,
  ADD COLUMN IF NOT EXISTS show_generated_by BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_settings_user_id
  ON public.invoice_settings(user_id);

ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_settings'
      AND policyname = 'invoice_settings_select_own'
  ) THEN
    CREATE POLICY invoice_settings_select_own
    ON public.invoice_settings
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_settings'
      AND policyname = 'invoice_settings_insert_own'
  ) THEN
    CREATE POLICY invoice_settings_insert_own
    ON public.invoice_settings
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_settings'
      AND policyname = 'invoice_settings_update_own'
  ) THEN
    CREATE POLICY invoice_settings_update_own
    ON public.invoice_settings
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_settings'
      AND policyname = 'invoice_settings_delete_own'
  ) THEN
    CREATE POLICY invoice_settings_delete_own
    ON public.invoice_settings
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_invoice_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_settings_updated_at ON public.invoice_settings;

CREATE TRIGGER trg_invoice_settings_updated_at
BEFORE UPDATE ON public.invoice_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_invoice_settings_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_settings TO authenticated;
