-- Add quantity_reserved column to items table
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS quantity_reserved INTEGER DEFAULT 0;

-- Ensure nulls are normalized to 0 for existing data
UPDATE items
  SET quantity_reserved = 0
  WHERE quantity_reserved IS NULL;

-- Add comment for clarity
COMMENT ON COLUMN items.quantity_reserved IS 'Reserved quantity for inventory items';
