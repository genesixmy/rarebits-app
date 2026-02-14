-- Add reserved metadata fields to items table
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS reserved_customer_id UUID,
  ADD COLUMN IF NOT EXISTS reserved_customer_name TEXT,
  ADD COLUMN IF NOT EXISTS reserved_note TEXT;

COMMENT ON COLUMN items.reserved_customer_id IS 'Optional customer id for reserved items';
COMMENT ON COLUMN items.reserved_customer_name IS 'Optional manual customer name for reserved items';
COMMENT ON COLUMN items.reserved_note IS 'Optional note for reserved items';
