-- SAFETY-PR6
-- Optional wallet transaction receipt attachments (tax/audit support).
-- Keeps existing transaction flow intact: all new fields are nullable.

ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS receipt_path TEXT,
ADD COLUMN IF NOT EXISTS receipt_name TEXT,
ADD COLUMN IF NOT EXISTS receipt_mime TEXT,
ADD COLUMN IF NOT EXISTS receipt_size_bytes INTEGER,
ADD COLUMN IF NOT EXISTS receipt_original_size_bytes INTEGER,
ADD COLUMN IF NOT EXISTS receipt_compressed BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS receipt_uploaded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'wallet_receipts'
  ) THEN
    INSERT INTO storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    VALUES (
      'wallet_receipts',
      'wallet_receipts',
      FALSE,
      10485760,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    );
  END IF;
END $$;

DROP POLICY IF EXISTS wallet_receipts_select_own ON storage.objects;
CREATE POLICY wallet_receipts_select_own
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wallet_receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS wallet_receipts_insert_own ON storage.objects;
CREATE POLICY wallet_receipts_insert_own
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wallet_receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS wallet_receipts_update_own ON storage.objects;
CREATE POLICY wallet_receipts_update_own
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wallet_receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'wallet_receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS wallet_receipts_delete_own ON storage.objects;
CREATE POLICY wallet_receipts_delete_own
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'wallet_receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
