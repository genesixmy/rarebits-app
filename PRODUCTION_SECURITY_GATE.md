# Production Security Gate (RareBits)

Tujuan: semakan cepat sebelum go-live / selepas perubahan besar.

## A) CORS allowlist check (Edge Functions)

### 1) Allowed origin
- Trigger backup/restore dari origin dibenarkan.
- Expected: request success / business response normal.

### 2) Blocked origin
- Trigger backup/restore dari origin yang tidak ada dalam `ALLOWED_ORIGINS`.
- Expected: blocked (`403`) dan tiada data diproses.

## B) SECURITY DEFINER audit (SQL)

Jalankan di Supabase SQL editor:

```sql
select
  n.nspname as schema_name,
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by 1, 2;
```

Semak fungsi SECURITY DEFINER yang tiada `set search_path`:

```sql
select
  n.nspname as schema_name,
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and pg_get_functiondef(p.oid) not ilike '%set search_path%'
order by 1, 2;
```

Pass criteria:
- Semua function SECURITY DEFINER telah disemak.
- Tiada function baru yang bypass expected access pattern.
- Yang tiada `set search_path` ada justifikasi atau backlog fix.

## C) View security mode check

```sql
select
  relname,
  reloptions
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'v'
order by relname;
```

Pass criteria:
- View sensitif yang sepatutnya caller-context guna `security_invoker=true`.

## D) Frontend log exposure check

Build production dan verify tiada spam `console.log/debug/info` operational:

```bash
npm run build
```

Pass criteria:
- Build lulus.
- Runtime production tidak flood log verbose.
