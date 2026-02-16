-- INV-DESC-SKU-1:
-- Add optional SKU + description fields for inventory items.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;
