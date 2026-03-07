# Tournament Single Elimination Winner Progression (SAFETY-8)

Date: 2026-03-07  
Scope: First playable bracket flow for Tournament plugin (plugin-isolated, low risk).

## What Was Added
- Winner assignment flow for normalized `tournament_bracket_matches`.
- Controlled winner propagation from current match into next-round target slot.
- BYE advancement action through explicit winner selection (`BYE` action option).
- Match status model aligned for playable progression:
  - `pending`
  - `ready`
  - `bye`
  - `completed`
  - `locked`
- Bracket tab upgraded from read-only skeleton to organizer action flow with clear status badges.

## Progression Rules (v1)
- Winner can only be assigned when match is eligible (`ready`, `bye`, or safe correction on `completed`).
- Winner source is restricted to:
  - Slot A
  - Slot B
  - BYE (resolved to A/B from available participant slot)
- Winner is propagated to next match slot by deterministic mapping:
  - odd `match_index` -> target Slot A
  - even `match_index` -> target Slot B

## Safety Guards
- Downstream overwrite is blocked when target slot already contains a conflicting participant.
- Correction is blocked when downstream progression is already locked/completed with conflicting dependency.
- No free-text winner input; winner must come from existing participant slots only.
- Progression logic is centralized in Tournament plugin config/service layer (not UI component logic).

## Match Model Extension
- Added minimal winner fields to `tournament_bracket_matches`:
  - `winner_participant_name`
  - `winner_seed_number`
  - `winner_source_slot`
  - `winner_snapshot_ref`
  - `completed_at`

## Intentionally Not Implemented
- No advanced scoring model.
- No full rollback/reset engine.
- No tournament finalization/champion workflow.
- No public spectator/share mode.
- No integration with RareBits core modules (inventory/invoices/wallet/customers/sales/dashboard).
