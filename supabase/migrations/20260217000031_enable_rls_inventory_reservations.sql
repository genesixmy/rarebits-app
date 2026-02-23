-- SECURITY HOTFIX:
-- Enable RLS on public.inventory_reservations and scope access to item owner.

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_reservations'
      AND policyname = 'inventory_reservations_select_own'
  ) THEN
    CREATE POLICY inventory_reservations_select_own
      ON public.inventory_reservations
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.items i
          WHERE i.id = inventory_reservations.item_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_reservations'
      AND policyname = 'inventory_reservations_insert_own'
  ) THEN
    CREATE POLICY inventory_reservations_insert_own
      ON public.inventory_reservations
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.items i
          WHERE i.id = inventory_reservations.item_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_reservations'
      AND policyname = 'inventory_reservations_update_own'
  ) THEN
    CREATE POLICY inventory_reservations_update_own
      ON public.inventory_reservations
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.items i
          WHERE i.id = inventory_reservations.item_id
            AND i.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.items i
          WHERE i.id = inventory_reservations.item_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_reservations'
      AND policyname = 'inventory_reservations_delete_own'
  ) THEN
    CREATE POLICY inventory_reservations_delete_own
      ON public.inventory_reservations
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.items i
          WHERE i.id = inventory_reservations.item_id
            AND i.user_id = auth.uid()
        )
      );
  END IF;
END $$;
