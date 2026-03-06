# Production Go-Live Signoff Checklist

Date: __________  
Owner: __________

## A) Build & deploy
- [ ] Frontend `npm run build` pass.
- [ ] Edge functions deployed:
  - [ ] `export-full-backup`
  - [ ] `restore-full-backup-to-account`
  - [ ] `restore-media-from-backup`
- [ ] Migration local/remote in sync.

## B) Security gate
- [ ] `ALLOWED_ORIGINS` configured with production domains only.
- [ ] CORS allowed-origin test pass.
- [ ] CORS blocked-origin test pass.
- [ ] SECURITY DEFINER audit reviewed.

## C) Restore test gate
- [ ] Disaster restore happy path pass.
- [ ] Idempotency replay test pass (`phase=replayed`).
- [ ] Concurrency lock test pass (1 blocked, 1 completed).
- [ ] Corrupt ZIP negative test pass.
- [ ] Missing metadata negative test pass.

## D) Data integrity gate
- [ ] Active lock returns `0` post-restore.
- [ ] Orphan checks all `0`.
- [ ] Client-link integrity pass.
- [ ] Placeholder client check pass.

## E) Observability gate
- [ ] Last 24h failed_pct acceptable.
- [ ] p95 duration acceptable.
- [ ] restore events query pack reviewed.

## F) Operational readiness
- [ ] Incident rollback SOP acknowledged.
- [ ] On-call owner named.
- [ ] Final release manifest archived.

Signoff:
- Engineering: __________
- Product/Ops: __________
- Date (UTC): __________

