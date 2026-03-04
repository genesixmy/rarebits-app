# Restore Next-Agent Checklist

## Objective
Complete final production-readiness step for disaster restore fidelity (client naming), then perform sign-off validation.

## 1. Implement Client Name Rehydration
- File: `supabase/functions/restore-full-backup-to-account/index.ts`
- Add post-restore step after existing client sync helpers.
- Logic:
  - Build map from backup customer rows (`customers` export key) using candidate IDs:
    - `id`, `client_id`, `customer_id`
  - For each restored `clients` row where `name = 'Pelanggan Restore'`:
    - If source has non-empty name, update to that real name.
    - Optional: set email if currently `null` and source email is valid.
  - Do not overwrite non-placeholder names.

## 2. Add Verification Gate To Runbook
- File: `RESTORE_PRODUCTION_RUNBOOK.md`
- Add mandatory SQL checks after each disaster restore:

```sql
select count(*) as clients_count
from public.clients
where user_id = '<USER_ID>';

select
  count(*) as invoices_count,
  count(*) filter (where client_id is not null) as invoices_with_client_id
from public.invoices
where user_id = '<USER_ID>';

select count(*) as placeholder_clients
from public.clients
where user_id = '<USER_ID>'
  and name = 'Pelanggan Restore';
```

- Pass criteria:
  - `clients_count > 0`
  - `invoices_with_client_id > 0`
  - `placeholder_clients = 0` (or explicit documented exception)

## 3. Burn-In Validation (Staging)
- Execute 2-3 full cycles:
  - backup -> force wipe restore -> SQL checks -> UI checks
- Verify:
  - Clients list shows real names
  - Client detail aggregates match invoice totals
  - No missing-parent issues

## 4. Release Steps
- Deploy function:
  - `npx supabase functions deploy restore-full-backup-to-account`
- Commit + push only relevant files.
- Record final evidence in:
  - `PR_RESTORE_HARDENING.md`
  - `RELEASE_NOTES.md`
