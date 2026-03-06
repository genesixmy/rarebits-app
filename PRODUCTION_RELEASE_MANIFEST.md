# Production Release Manifest (Snapshot)

Date: 2026-03-06  
Project Ref: `girohykpugyiqzssmiio`

## Git
- Commit: `60a197a441733cf5f05bccf92d207d670f36ccb1`
- Branch: `claude/persist-form-data-tabs-011CV3DFjx8DLe4S8XuUjuvh`

## Edge Functions (deployed)
- `export-full-backup`: version `8` (ACTIVE)
- `restore-full-backup-to-account`: version `34` (ACTIVE)
- `restore-media-from-backup`: version `6` (ACTIVE)

## Migrations
- Local vs remote: **in sync**
- Latest applied migration: `20260305000058`

## Required Secrets
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `ALLOWED_ORIGINS`

## Notes
- CORS allowlist active via `ALLOWED_ORIGINS`.
- Production verbose logs reduced via `VITE_ENABLE_DEBUG_LOGS=false`.
