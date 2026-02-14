-- QR display settings per print template (A4 / Thermal / Paperang)

ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS qr_enabled_a4 BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qr_enabled_thermal BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qr_enabled_paperang BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qr_label TEXT DEFAULT 'Scan untuk lihat katalog',
  ADD COLUMN IF NOT EXISTS qr_url TEXT;

UPDATE public.invoice_settings
SET
  qr_enabled_a4 = COALESCE(qr_enabled_a4, FALSE),
  qr_enabled_thermal = COALESCE(qr_enabled_thermal, FALSE),
  qr_enabled_paperang = COALESCE(qr_enabled_paperang, FALSE),
  qr_label = COALESCE(NULLIF(TRIM(qr_label), ''), 'Scan untuk lihat katalog'),
  updated_at = NOW();
