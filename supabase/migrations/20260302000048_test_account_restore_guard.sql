-- SAFETY-4D
-- Add test-account gate for dummy-only restore flows.
-- Guardrail: authenticated users can read their own flag but cannot set `is_test_account`.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE;

REVOKE INSERT (is_test_account) ON public.profiles FROM anon, authenticated;
REVOKE UPDATE (is_test_account) ON public.profiles FROM anon, authenticated;

GRANT SELECT (is_test_account) ON public.profiles TO authenticated;
GRANT INSERT (is_test_account), UPDATE (is_test_account), SELECT (is_test_account) ON public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.guard_profiles_test_account_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := COALESCE(auth.role(), current_user);
BEGIN
  IF v_role IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_test_account, FALSE) IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'is_test_account can only be set by service/admin role.';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_test_account, FALSE) IS DISTINCT FROM COALESCE(OLD.is_test_account, FALSE) THEN
    RAISE EXCEPTION 'is_test_account can only be changed by service/admin role.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_test_account_flag ON public.profiles;
CREATE TRIGGER trg_guard_profiles_test_account_flag
BEFORE INSERT OR UPDATE OF is_test_account ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profiles_test_account_flag();
