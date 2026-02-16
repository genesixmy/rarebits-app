-- INV-RACK-1:
-- Add optional rack/storage location metadata for inventory items.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS rack_location TEXT;
