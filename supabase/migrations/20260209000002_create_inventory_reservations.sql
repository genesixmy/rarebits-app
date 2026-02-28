-- Create inventory_reservations table for multi-reservation support
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity_reserved INTEGER NOT NULL CHECK (quantity_reserved > 0),
  customer_id uuid,
  customer_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_reservations_item_id_idx
  ON inventory_reservations (item_id);

-- Backfill from legacy single-reserved fields (only if no reservation exists yet)
INSERT INTO inventory_reservations (item_id, quantity_reserved, customer_id, customer_name, note)
SELECT
  items.id,
  COALESCE(items.quantity_reserved, 0) AS quantity_reserved,
  items.reserved_customer_id,
  items.reserved_customer_name,
  items.reserved_note
FROM items
WHERE (COALESCE(items.quantity_reserved, 0) > 0
  OR items.reserved_customer_id IS NOT NULL
  OR items.reserved_customer_name IS NOT NULL
  OR items.reserved_note IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM inventory_reservations r WHERE r.item_id = items.id
  );
