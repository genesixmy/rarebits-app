# Release Notes

## 2026-03-03 - restore-hardening

### Added
- Disaster restore lock primitives to prevent concurrent restore per account.
- Idempotency support for restore requests and replay-safe behavior.
- Reconciliation report in restore response (`db` and `media` accounted vs unaccounted).
- Observability payload in restore response (`phase`, timings, duration).
- Production runbook for restore operations and validation checks.

### Changed
- Disaster restore UI now reflects actual behavior and displays:
  - idempotency key/replay status
  - reconciliation summary
  - observability summary
- Snapshot monitor view switched to `security_invoker=true` for safer permission model.

### Fixed
- Platform fee guard behavior during wipe/cleanup flows in disaster restore.
- Missing-parent and FK consistency handling during table restore ordering.

## 2026-03-05 - restore-client-rehydration (staging)

### Added
- Post-restore client rehydration for disaster restore:
  - placeholder client rows named `Pelanggan Restore` are updated back to real source names when hints are available from backup payload.
- Mandatory client integrity gate added to runbook:
  - `clients_count > 0`
  - `invoices_with_client_id > 0`
  - `placeholder_clients = 0` (or documented exception)

### Notes
- Staging function deploy completed for `restore-full-backup-to-account` version `30`.
- Staging sign-off completed:
  - Burn-in happy path, idempotency replay, concurrency lock tests passed.
  - Negative tests (`corrupt ZIP`, `missing metadata`) passed with expected validation errors.
  - Mandatory client integrity gate and orphan FK checks passed.

## 2026-03-05 - core-rpc-lint-fixes (staging)

### Fixed
- `create_or_update_invoice_for_sold_item`:
  - corrected `UPDATE items SET invoice_id = ...` syntax to avoid invalid qualified target column.
- `mark_shipment_courier_paid`:
  - resolved ambiguous `shipment_id` conflict target by using named PK constraint.

### Added
- Compatibility shim `public.gen_random_bytes(integer)` to stabilize legacy calls in SQL functions.
- Compatibility view `public.customers` (from `public.clients`) for legacy routines still reading `customers`.
- Compatibility view `public.wallet_transactions` (from `public.transactions`) for legacy routines still reading `wallet_transactions`.
- `public.refunds` compatibility columns:
  - `user_id` (if missing)
  - `issued_by` (if missing)

### Validation
- `npx supabase db lint --linked --schema public --fail-on error`:
  - no error-level findings (only non-blocking warnings remain).
