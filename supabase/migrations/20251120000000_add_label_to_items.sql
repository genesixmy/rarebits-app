-- Add label column to items table
ALTER TABLE items ADD COLUMN IF NOT EXISTS label TEXT;

-- Add comment explaining the label field
COMMENT ON COLUMN items.label IS 'Optional label/tag for the item (e.g., driver, fragile, etc)';
