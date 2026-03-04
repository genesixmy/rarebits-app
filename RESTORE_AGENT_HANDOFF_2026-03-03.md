# Restore Handoff (2026-03-03)

## Scope
- Project: `rarebits-app/rarebit`
- Branch: `claude/persist-form-data-tabs-011CV3DFjx8DLe4S8XuUjuvh`
- Focus: hardening `restore-full-backup-to-account` for disaster restore in production.

## What Has Been Completed

### Core hardening (lock/idempotency/observability)
- `6380ab48` feat: harden disaster restore with lock, idempotency, observability.
- `b94bf6e4` + `13c43ca2` fix restore event idempotency upsert/update behavior.
- `20260303000050_restore_locks.sql` added restore lock primitives.
- `20260303000052_restore_events_idempotency.sql` added `idempotency_key` + indexes/unique scope.

### Restore data compatibility + FK safety
- `678699c4` prefer `clients` over `customers`.
- `df84d3f0` remap legacy customer identifier candidates (`id`/`client_id`/`customer_id`).
- `9e08dbce` force `customers` export key to target `clients`.
- `1078a656` fallback unknown client refs for FK integrity.
- `e5064178` force tenant ownership (`user_id`) remap for all rows that carry `user_id`.
- `e6fbeb14` ensure at least one client row from legacy payload.
- `cd025295` post-restore sync `customers -> clients` when clients empty.
- `eccc12a6` backfill clients from `invoices.client_id`.
- `b49517bd` seed missing client parents before child writes (fixes missing parent for `client_phones`/`client_addresses`).

### Deduplication and linter fixes
- `7b919da2` client/contact dedupe guard for replay.
- `20260303000054_clients_email_uniqueness_guard.sql` uniqueness guard.
- `20260303000053_snapshot_health_monitor_security_invoker.sql` set `security_invoker=true`.
- `dcbeefbc` migration filename normalization for `supabase db push`.

## Deployment Status
- Function deployed repeatedly and latest deployed: `restore-full-backup-to-account`.
- Latest fix deployed includes commit `b49517bd`.
- Migrations already pushed include `20260303000054_clients_email_uniqueness_guard.sql`.

## Latest Verified Runtime Behavior
- Disaster restore now completes with:
  - `Data inserted: 74`
  - `Data skip missing parent: 0`
  - `Data skip locked: 0`
  - Reconciliation DB/media accounted = 100%.
- Remaining user-visible issue:
  - Some restored clients have fallback name `"Pelanggan Restore"`.
  - This is from intentional parent seeding fallback to preserve FK integrity.

## Current Known Limitation
- If parent client row is missing, restore seeds placeholder client with:
  - `name = "Pelanggan Restore"`
  - `email = null`
- This keeps invoices/items/contacts restorable but name fidelity may drop.

## Files Most Relevant For Next Work
- `supabase/functions/restore-full-backup-to-account/index.ts`
- `RESTORE_PRODUCTION_RUNBOOK.md`
- `PR_RESTORE_HARDENING.md`

## Suggested Next Engineering Target
- Implement post-restore rehydration:
  - Replace placeholder `"Pelanggan Restore"` with real customer names from backup payload when available.
  - Keep placeholder only when source name truly absent.
