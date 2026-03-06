# Production Data Integrity Gates (Post-Restore)

Jalankan selepas setiap `disaster restore`.

## Gate A: lock state

```sql
select count(*) as active_lock
from public.restore_locks
where expires_at > now();
```

Pass:
- `active_lock = 0` selepas restore selesai.

## Gate B: orphan foreign key checks

```sql
select
  (select count(*) from public.invoice_items ii left join public.invoices i on i.id = ii.invoice_id where i.id is null) as orphan_invoice_items,
  (select count(*) from public.invoice_fees f left join public.invoices i on i.id = f.invoice_id where i.id is null) as orphan_invoice_fees,
  (select count(*) from public.shipment_invoices si left join public.invoices i on i.id = si.invoice_id where i.id is null) as orphan_shipment_invoices;
```

Pass:
- semua orphan = `0`.

## Gate C: client-link integrity

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

Pass:
- `clients_count > 0`
- `invoices_with_client_id > 0`
- `placeholder_clients = 0` (atau exception documented).

## Gate D: restore event integrity

```sql
select
  created_at,
  idempotency_key,
  restore_mode,
  coalesce(summary->>'phase', 'unknown') as phase,
  coalesce((summary->>'data_failed_count')::int, 0) as data_failed_count,
  coalesce((summary->>'media_failed_count')::int, 0) as media_failed_count
from public.restore_events
where new_user_id = '<USER_ID>'
order by created_at desc
limit 5;
```

Pass:
- latest event phase `completed` atau `replayed`.
- failed count = `0`.

