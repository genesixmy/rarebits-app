# Tournament Match Correction Foundation (SAFETY-9)

Date: 2026-03-07  
Scope: Guarded correction flow for Single Elimination bracket runs (plugin-isolated).

## What Was Added
- Guarded `Reopen Match` action for completed matches.
- Dependency safety checks before reset:
  - block reset if downstream already has conflicting participant data
  - block reset if downstream match is already confirmed/completed with dependency
- Safe one-step downstream cleanup:
  - clear propagated slot in direct downstream match only when it still matches current winner
  - no recursive rollback
- Explicit run utility: **Rebuild From Snapshot**
  - archives prepared run
  - regenerates fresh run from latest prepared snapshot
  - snapshot history remains immutable

## Reset/Reopen Rule
- Only completed matches with winner can be reopened.
- Reopen clears:
  - `winner_participant_name`
  - `winner_seed_number`
  - `winner_source_slot`
  - `winner_snapshot_ref`
  - `completed_at`
- Match status is recalculated via centralized status resolver.

## Downstream Safety Model
- Reopen is allowed only when direct downstream dependency is safe.
- Reopen is blocked when:
  - downstream slot no longer matches the winner being reopened
  - downstream progression is already confirmed and depends on that winner
- For major correction cases, organizer should use **Rebuild From Snapshot**.

## Intentionally Not Implemented
- No full recursive rollback engine.
- No tournament finalization/champion flow.
- No advanced scoring.
- No core RareBits integration (invoice/wallet/customers/sales/dashboard).
