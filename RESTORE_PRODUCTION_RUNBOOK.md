# Restore Production Runbook (RareBits)

## Scope
- Edge Function: `restore-full-backup-to-account`
- Modes:
  - `self`: validate checksum against user snapshot
  - `disaster`: cross-account remap + optional wipe

## Preconditions
- Latest function deployed.
- Latest migrations applied:
  - `20260303000049_restore_events.sql`
  - `20260303000050_restore_locks.sql`
  - `20260303000051_invoice_fees_guard_delete_orphan_safe.sql`
  - `20260303000052_restore_events_idempotency.sql`

## Operational Safety Rules
- Disaster restore only when:
  - account empty (`items=0`, `invoices=0`, `wallets<=1`), or
  - explicit `force_wipe=true`.
- Storage upload uses `upsert=false` (no overwrite).
- Concurrency protected by `restore_locks`.
- Duplicate request deduped by `idempotency_key` within replay window.

## Preflight SQL
```sql
select
  (select count(*) from public.items where user_id = '<user_id>') as items,
  (select count(*) from public.invoices where user_id = '<user_id>') as invoices,
  (select count(*) from public.wallets where user_id = '<user_id>') as wallets;
```

## Execute
- Upload backup zip in Restore Preview UI.
- For cross-account recovery use `Disaster Restore`.
- Tick force wipe only when source account is not empty.

## Success Criteria
- API result:
  - `ok = true`
  - `data.failed_count = 0`
  - `media.failed_count = 0`
  - `reconciliation.db.unaccounted_rows_total = 0`
  - `reconciliation.media.unaccounted_files_total = 0` (or explained mismatch)
- `restore_events` has a new event row.
- `restore_locks` has no active lock after completion.

## Post-restore SQL Validation
```sql
select count(*) as active_lock
from public.restore_locks
where user_id = '<user_id>' and expires_at > now();
```

```sql
select
  (select count(*) from public.invoice_items ii left join public.invoices i on i.id = ii.invoice_id where i.id is null) as orphan_invoice_items,
  (select count(*) from public.invoice_fees f left join public.invoices i on i.id = f.invoice_id where i.id is null) as orphan_invoice_fees,
  (select count(*) from public.shipment_invoices si left join public.invoices i on i.id = si.invoice_id where i.id is null) as orphan_shipment_invoices;
```

```sql
select created_at, idempotency_key, restore_mode, dry_run, force_wipe, summary
from public.restore_events
where new_user_id = '<user_id>'
order by created_at desc
limit 5;
```

## Mandatory Client Integrity Gate
Run checks ini selepas setiap `disaster restore`:

```sql
select count(*) as clients_count
from public.clients
where user_id = '<USER_ID>';
```

```sql
select
  count(*) as invoices_count,
  count(*) filter (where client_id is not null) as invoices_with_client_id
from public.invoices
where user_id = '<USER_ID>';
```

```sql
select count(*) as placeholder_clients
from public.clients
where user_id = '<USER_ID>'
  and name = 'Pelanggan Restore';
```

Pass criteria:
- `clients_count > 0`
- `invoices_with_client_id > 0`
- `placeholder_clients = 0` (atau exception didokumentasi dengan sebab sah)

## Idempotency Test
- Repeat same request (<15 min) with same checksum/mode/flags.
- Expected:
  - response has `replayed = true`
  - event count for that key/scope does not increase.

## Failure Handling
- If `409` lock: wait until in-flight restore completes.
- If `500`:
  - capture `phase` and `observability.phase_durations_ms` from response
  - inspect latest `restore_events.summary`
  - rerun with same idempotency scope only after root cause is fixed.

## Release Checklist
- [ ] Function deployed
- [ ] Migrations applied in production
- [ ] Disaster happy path tested
- [ ] Corrupt ZIP negative test validated
- [ ] Missing metadata negative test validated
- [ ] Concurrency lock test validated
- [ ] Idempotency replay validated
- [ ] Orphan FK checks pass
