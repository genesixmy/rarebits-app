-- SAFETY-PR5
-- Prevent duplicate clients/customers per account by normalized email.

DO $$
DECLARE
  v_table TEXT;
  v_has_dups BOOLEAN := FALSE;
  v_index_name TEXT;
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    v_table := 'clients';
  ELSIF to_regclass('public.customers') IS NOT NULL THEN
    v_table := 'customers';
  ELSE
    RAISE NOTICE 'Skip client email uniqueness guard: clients/customers table not found.';
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE public.%I
        SET email = NULL
      WHERE email IS NOT NULL
        AND btrim(email) = '''';',
    v_table
  );

  EXECUTE format(
    'UPDATE public.%I
        SET email = lower(btrim(email))
      WHERE email IS NOT NULL
        AND email <> lower(btrim(email));',
    v_table
  );

  EXECUTE format(
    'SELECT EXISTS (
       SELECT 1
       FROM public.%I
       WHERE email IS NOT NULL
       GROUP BY user_id, email
       HAVING count(*) > 1
     )',
    v_table
  )
  INTO v_has_dups;

  IF v_has_dups THEN
    RAISE EXCEPTION 'Duplicate clients detected in %. Resolve duplicates before applying unique guard on (user_id, email).', v_table;
  END IF;

  v_index_name := format('uq_%s_user_email', v_table);

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I
       ON public.%I (user_id, email)
     WHERE email IS NOT NULL;',
    v_index_name,
    v_table
  );
END;
$$;
