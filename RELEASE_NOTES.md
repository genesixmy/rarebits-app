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
- Production promotion remains pending final burn-in and negative-test sign-off.
