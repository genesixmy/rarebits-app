-- Per-template print toggles for A4 vs Thermal/Paperang

ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS show_logo_a4 BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_logo_thermal BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_logo_paperang BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS thermal_show_address BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS thermal_show_phone BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS thermal_show_email BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS thermal_show_website BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS thermal_show_tax BOOLEAN,
  ADD COLUMN IF NOT EXISTS show_generated_by_a4 BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_generated_by_thermal BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_generated_by_paperang BOOLEAN DEFAULT FALSE;

UPDATE public.invoice_settings
SET
  show_logo_a4 = COALESCE(show_logo_a4, show_logo, TRUE),
  show_logo_thermal = COALESCE(show_logo_thermal, FALSE),
  show_logo_paperang = COALESCE(show_logo_paperang, FALSE),
  thermal_show_address = COALESCE(thermal_show_address, FALSE),
  thermal_show_phone = COALESCE(thermal_show_phone, TRUE),
  thermal_show_email = COALESCE(thermal_show_email, FALSE),
  thermal_show_website = COALESCE(thermal_show_website, TRUE),
  thermal_show_tax = COALESCE(thermal_show_tax, show_tax),
  show_generated_by_a4 = COALESCE(show_generated_by_a4, show_generated_by, TRUE),
  show_generated_by_thermal = COALESCE(show_generated_by_thermal, FALSE),
  show_generated_by_paperang = COALESCE(show_generated_by_paperang, FALSE),
  updated_at = NOW();
