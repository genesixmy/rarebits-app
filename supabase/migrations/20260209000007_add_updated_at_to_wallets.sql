-- Add updated_at column to wallets if missing (required by invoice payment functions)

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- Optional: ensure existing rows have a value
UPDATE public.wallets
SET updated_at = NOW()
WHERE updated_at IS NULL;
