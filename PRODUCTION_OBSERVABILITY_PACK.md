# Production Observability Pack (Backup/Restore)

Gunakan pack ini untuk monitoring harian semasa burn-in dan selepas go-live.

## 1) Last 20 restore events

```sql
select
  created_at,
  restore_mode,
  idempotency_key,
  coalesce(summary->>'phase', 'unknown') as phase,
  coalesce((summary->>'data_failed_count')::int, 0) as data_failed_count,
  coalesce((summary->>'media_failed_count')::int, 0) as media_failed_count,
  coalesce((summary->>'duration_observed_ms')::int, null) as duration_observed_ms
from public.restore_events
order by created_at desc
limit 20;
```

## 2) 24h fail ratio

```sql
with last_24h as (
  select
    coalesce(summary->>'phase', 'unknown') as phase,
    coalesce((summary->>'data_failed_count')::int, 0) as data_failed_count,
    coalesce((summary->>'media_failed_count')::int, 0) as media_failed_count
  from public.restore_events
  where created_at >= now() - interval '24 hours'
)
select
  count(*) as total_events,
  count(*) filter (
    where phase = 'failed' or data_failed_count > 0 or media_failed_count > 0
  ) as failed_events,
  round(
    100.0 * count(*) filter (
      where phase = 'failed' or data_failed_count > 0 or media_failed_count > 0
    ) / nullif(count(*), 0),
    2
  ) as failed_pct
from last_24h;
```

## 3) 24h replay ratio (idempotency)

```sql
with last_24h as (
  select coalesce(summary->>'phase', 'unknown') as phase
  from public.restore_events
  where created_at >= now() - interval '24 hours'
)
select
  count(*) as total_events,
  count(*) filter (where phase = 'replayed') as replayed_events,
  round(
    100.0 * count(*) filter (where phase = 'replayed') / nullif(count(*), 0),
    2
  ) as replayed_pct
from last_24h;
```

## 4) 24h p95 duration (ms)

```sql
select
  percentile_cont(0.95) within group (
    order by coalesce((summary->>'duration_observed_ms')::numeric, 0)
  ) as p95_duration_ms
from public.restore_events
where created_at >= now() - interval '24 hours';
```

## 5) Suggested alert thresholds (manual)

- `failed_pct > 5%` (24h): investigate immediately.
- `p95_duration_ms > 15000`: check storage/network hot path.
- sudden spike `replayed_pct > 40%`: check duplicate request behavior in UI/client.
- any event with `data_failed_count > 0` or `media_failed_count > 0`: open incident ticket.

