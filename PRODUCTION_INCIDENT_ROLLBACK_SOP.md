# Production Incident & Rollback SOP (Backup/Restore)

## Severity
- `SEV-1`: data corruption risk / repeated failed restore.
- `SEV-2`: partial degradation (restore success rate turun, latency tinggi).
- `SEV-3`: cosmetic / non-blocking.

## Scenario A: CORS / Origin misconfiguration

Symptoms:
- UI `NetworkError when attempting to fetch resource`
- browser CORS mismatch.

Actions:
1. Verify `ALLOWED_ORIGINS` secret.
2. Re-set secret with exact domains (no trailing slash mismatch).
3. Re-test allowed origin and blocked origin.

Rollback:
- Set temporary safe allowlist including only trusted app origins.
- Do not revert to wildcard `*` in production.

## Scenario B: Migration drift / runtime SQL mismatch

Symptoms:
- function errors due to missing columns/tables.

Actions:
1. `npx supabase migration list`
2. reconcile local vs remote state.
3. apply missing migration only after review.

Rollback:
- rollback code deploy to last known good commit.
- keep DB at consistent migration boundary.

## Scenario C: Restore partial failure (failed_count > 0)

Symptoms:
- restore result has failed rows/media.

Actions:
1. capture response `phase` and `summary`.
2. run `PRODUCTION_DATA_INTEGRITY_GATES.md`.
3. if integrity fail -> mark incident `SEV-1`.

Rollback:
- stop repeated retries with different payload.
- retry with same idempotency scope only after root cause fixed.

## Scenario D: Lock contention spike

Symptoms:
- many `Restore sedang berjalan` responses.

Actions:
1. inspect active locks.
2. verify no stuck lock after expiry window.
3. inspect client behavior (duplicate clicks/retries).

Rollback:
- throttle restore trigger from UI.
- keep lock protection enabled.

## Mandatory incident artifact
- timestamp (UTC)
- user/account impacted
- request id / idempotency key
- restore_event row snapshot
- SQL integrity results
- remediation + follow-up action owner

