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
