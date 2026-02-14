-- C4 follow-up: enforce strict random public_code generation

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.generate_catalog_public_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT lower(encode(gen_random_bytes(12), 'hex'));
$$;

UPDATE public.catalogs
SET public_code = public.generate_catalog_public_code()
WHERE public_code IS NULL
   OR btrim(public_code) = ''
   OR public_code !~ '^[a-f0-9]{24}$';

ALTER TABLE public.catalogs
  ALTER COLUMN public_code SET DEFAULT public.generate_catalog_public_code();

ALTER TABLE public.catalogs
  ALTER COLUMN public_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalogs_public_code_format_check'
      AND conrelid = 'public.catalogs'::regclass
  ) THEN
    ALTER TABLE public.catalogs
      ADD CONSTRAINT catalogs_public_code_format_check
      CHECK (public_code ~ '^[a-f0-9]{24}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_catalog_public_code()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.public_code := public.generate_catalog_public_code();
  ELSIF TG_OP = 'UPDATE' AND NEW.public_code IS DISTINCT FROM OLD.public_code THEN
    RAISE EXCEPTION USING
      MESSAGE = 'catalog public_code cannot be changed',
      ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_catalog_public_code ON public.catalogs;

CREATE TRIGGER trg_enforce_catalog_public_code
BEFORE INSERT OR UPDATE OF public_code ON public.catalogs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_catalog_public_code();
