-- P2: QR content mode (none/url) for brand settings and print gating

ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS qr_mode TEXT;

UPDATE public.invoice_settings
SET qr_mode = CASE
  WHEN lower(btrim(COALESCE(qr_mode, ''))) = 'none' THEN 'none'
  WHEN lower(btrim(COALESCE(qr_mode, ''))) = 'url' THEN 'url'
  WHEN COALESCE(NULLIF(btrim(COALESCE(qr_url, '')), ''), '') <> '' THEN 'url'
  ELSE 'none'
END;

ALTER TABLE public.invoice_settings
  ALTER COLUMN qr_mode SET DEFAULT 'url';

UPDATE public.invoice_settings
SET qr_mode = CASE
  WHEN COALESCE(NULLIF(btrim(COALESCE(qr_url, '')), ''), '') <> '' THEN 'url'
  ELSE 'none'
END
WHERE qr_mode IS NULL;

ALTER TABLE public.invoice_settings
  ALTER COLUMN qr_mode SET NOT NULL;

ALTER TABLE public.invoice_settings
  DROP CONSTRAINT IF EXISTS invoice_settings_qr_mode_check;

ALTER TABLE public.invoice_settings
  ADD CONSTRAINT invoice_settings_qr_mode_check
  CHECK (qr_mode IN ('none', 'url'));
