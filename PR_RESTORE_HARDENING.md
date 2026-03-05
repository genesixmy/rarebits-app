# PR: Restore Hardening (Disaster Recovery)

## Compare URL
- https://github.com/genesixmy/rarebits-app/compare/main...claude/persist-form-data-tabs-011CV3DFjx8DLe4S8XuUjuvh

## Summary
- Hardened `restore-full-backup-to-account` for production use:
  - input/ZIP validation guardrails
  - cross-account disaster restore remap + parent checks
  - restore lock to block concurrent restore on same account
  - idempotency replay support
  - reconciliation + observability output
- Updated restore UI to reflect actual disaster restore behavior and show idempotency/reconciliation/observability.
- Added production runbook and DB migrations for lock/idempotency/security fixes.

## Scope
- `supabase/functions/restore-full-backup-to-account/index.ts`
- `src/components/RestorePreviewSection.jsx`
- `RESTORE_PRODUCTION_RUNBOOK.md`
- `supabase/migrations/20260303000050_restore_locks.sql`
- `supabase/migrations/20260303000051_invoice_fees_guard_delete_orphan_safe.sql`
- `supabase/migrations/20260303000052_restore_events_idempotency.sql`
- `supabase/migrations/20260303000053_snapshot_health_monitor_security_invoker.sql`

## 2026-03-05 Patch (Staging)
- Added post-restore client name rehydration in:
  - `supabase/functions/restore-full-backup-to-account/index.ts`
- Added mandatory client integrity SQL gate in:
  - `RESTORE_PRODUCTION_RUNBOOK.md`

### Staging deploy
- Function `restore-full-backup-to-account` deployed on `2026-03-05`.
- `supabase functions list` evidence:
  - slug: `restore-full-backup-to-account`
  - version: `30`
  - updated_at (UTC): `2026-03-05 06:00:23`

### Pending sign-off evidence (to be appended)
- Burn-in cycle #1/#2/#3 results
- Corrupt ZIP negative test result
- Missing metadata negative test result
- SQL gate outputs:
  - `clients_count`
  - `invoices_with_client_id`
  - `placeholder_clients`
- Orphan FK checks output

## Test Evidence
### UI evidence (Disaster Restore)
- Restore mode: `disaster`
- Idempotency key present:
  - `auto:disaster:live:wipe:6851deb8aa5688828914735d0d233cb2034ae9357fd903e22078a81139755193`
- Media uploaded/skipped existing: `0 / 3`
- Data inserted/skip missing parent/skip locked: `75 / 0 / 0`
- Reconciliation:
  - DB source/accounted/unaccounted: `78 / 78 / 0`
  - Media source/accounted/unaccounted: `3 / 3 / 0`
  - DB mismatch tables: `0`
- Observability:
  - phase: `completed`
  - duration: `3469 ms`

### SQL evidence (idempotency replay)
```sql
select count(*) as event_count
from public.restore_events
where new_user_id = 'bc64b8a7-aea7-455c-833f-527f2fda44b1'
  and idempotency_key = 'auto:disaster:live:wipe:6851deb8aa5688828914735d0d233cb2034ae9357fd903e22078a81139755193';
```

- Result: `event_count = 1` (duplicate request does not create extra event row).

## Risk/Impact
- Storage overwrite remains disabled (`upsert=false`).
- Disaster restore still requires empty account or explicit `force_wipe=true`.
- Snapshot monitor view now runs with invoker permissions (`security_invoker=true`) to satisfy linter/security posture.
