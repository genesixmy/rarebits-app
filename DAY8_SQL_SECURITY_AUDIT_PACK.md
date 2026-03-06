# Day 8 SQL Security Audit Pack

Date: 2026-03-07  
Owner: Codex + User

## Objective
- Keep SQL lint clean.
- Track and classify legacy `SECURITY DEFINER` functions for controlled hardening.

## Current Gate Status
- SQL lint (`public`): PASS
- Baseline command:
```powershell
npx supabase db lint --linked --schema public --fail-on error
```

## Audit Queries

### 1) List SECURITY DEFINER functions
```sql
select
  n.nspname as schema_name,
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
order by 1, 2;
```

### 2) Candidate functions for `SECURITY INVOKER` migration review
```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
  and p.proname not in (
    'handle_new_user',
    'create_profile_on_signup',
    'create_default_wallet_on_signup'
  )
order by 1, 2;
```

## Review Rule
- Do not remove `SECURITY DEFINER` blindly.
- For each function:
  1. Identify whether it must bypass caller RLS.
  2. If not required, migrate to safer invoker pattern with explicit grants.
  3. Verify with smoke flow before merge.

## Deliverable
- Day-8 pack provides repeatable SQL audit queries + classification process.
- Runtime behavior unchanged in this step.

