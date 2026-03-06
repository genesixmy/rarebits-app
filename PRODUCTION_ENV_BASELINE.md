# Production Env Baseline (RareBits)

## Scope
- Frontend env (`.env`)
- Supabase Edge Function secrets

## 1) Frontend `.env` baseline
Gunakan fail template:
- `.env.example`

Minimum wajib:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ENABLE_DEBUG_LOGS=false` (production)

## 2) Supabase secrets wajib
Pastikan secrets ini wujud:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `ALLOWED_ORIGINS`

Semak:
```bash
npx supabase secrets list
```

## 3) CORS allowlist rule
`ALLOWED_ORIGINS` mesti domain sebenar app (tanpa wildcard `*` untuk production).

Contoh:
```bash
npx supabase secrets set 'ALLOWED_ORIGINS=https://app.rarebits.my,https://admin.rarebits.my'
```

Untuk local dev, boleh tambah localhost:
```bash
npx supabase secrets set 'ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002,https://app.rarebits.my,https://admin.rarebits.my'
```

## 4) Verification quick check
1. Restore/backup request dari origin dibenarkan -> success.
2. Restore/backup request dari origin tidak dibenarkan -> blocked.
3. Tiada `NetworkError` CORS mismatch pada UI.

## 5) Release manifest snapshot
Simpan metadata berikut setiap release:
- Git commit hash
- Edge function versions:
  - `export-full-backup`
  - `restore-full-backup-to-account`
  - `restore-media-from-backup`
- Migration terakhir yang telah apply
