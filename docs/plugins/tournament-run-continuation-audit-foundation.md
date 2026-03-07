# Tournament Run Continuation + Audit Foundation (SAFETY-11)

Date: 2026-03-07  
Scope: Start fresh run from prepared snapshot with preserved run history and minimal lifecycle audit trail.

## What Was Added
- Explicit **Start New Run** flow from latest prepared snapshot.
- Preserved historical runs (no silent overwrite).
- Minimal plugin-owned lifecycle audit table:
  - `tournament_run_audit_events`
- Lightweight run history UI and lifecycle event list in Results tab.

## Status Truth Model (SAFETY-11.5)
- `tournaments.status` is treated as a mirrored root status from run transitions:
  - run `prepared`/`draft` -> tournament `ongoing`
  - run `completed` -> tournament `completed`
- Service layer owns this sync invariant (non-blocking if sync fails, with warning log).
- Tournament header badge is run-aware:
  - prefer latest run status for display truth
  - fallback to `tournaments.status` only when no run exists
- Data correction migration backfills historical tournament rows:
  - `supabase/migrations/20260307000070_tournament_status_backfill.sql`

## Rebuild vs Start New Run
- **Rebuild From Snapshot**
  - correction/recovery action for the current run context
  - archives current prepared run and regenerates structure
- **Start New Run**
  - intentional new run creation
  - archives current prepared run (if any), then creates a fresh run
  - previous completed/archived runs stay preserved as history

## Run Lifecycle Transitions
- Centralized run statuses:
  - `draft`
  - `prepared`
  - `completed`
  - `archived`
- Centralized allowed transitions:
  - `draft -> prepared | archived`
  - `prepared -> completed | archived`
  - `completed -> (no direct transition in this phase)`
  - `archived -> (historical)`

## Minimal Audit Event Scope
Logged from service layer only (never directly from UI):
- `run_created`
- `run_archived`
- `run_completed`
- `run_rebuilt_from_snapshot`
- `new_run_started_from_snapshot`

## Intentionally Not Implemented
- No public spectator mode.
- No per-match full audit explorer.
- No advanced analytics/reporting.
- No integration with RareBits core domains (invoice/wallet/customers/sales/dashboard).

## Regression Smoke Checklist (SAFETY-11.5)
1. Prepare snapshot (`Prepare Snapshot`) on Single Elimination tournament.
2. Generate run (`Generate Bracket Structure`).
3. Set winners until final match winner is present.
4. Finalize tournament (`Finalize Tournament`).
5. Verify after finalize:
   - run status = `completed`
   - champion is populated
   - `completed_at` is populated
   - audit event `run_completed` exists
6. Start New Run from completed context:
   - completed run preserved in history
   - new run created as current prepared run
   - audit events logged (`run_archived`, `run_created`, `new_run_started_from_snapshot`)
7. Rebuild flow:
   - current prepared run archived
   - replacement prepared run created from latest prepared snapshot
8. Unsupported bracket safety:
   - non-Single Elimination still blocked for run generation/preview
9. Header badge consistency:
   - when latest run exists, header reflects run-aware status (not stale tournament row)
10. Build gate:
   - run `npm -C d:\\Development\\Rarebits\\rarebits-app\\rarebit run build`
