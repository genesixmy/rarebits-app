# Tournament Single Elimination Engine — Production Pass

Date: 2026-03-07  
Scope: Complete Single Elimination organizer + spectator usability before adding new formats.

## What Was Hardened
- Added score-based match model on `tournament_bracket_matches`:
  - `score_a`, `score_b`
- Added centralized scoring rules:
  - `BO1`: only `1-0` / `0-1`
  - `BO3`: winner must reach `2` (`2-0`, `2-1`)
  - `BO5`: winner must reach `3` (`3-0`, `3-1`, `3-2`)
  - no tie, non-negative, bounded by series max games
- Winner propagation now supports:
  - score-derived winner for BO3/BO5
  - manual winner fallback for BO1
  - BYE advancement as explicit safe action

## Organizer UX
- Bracket controls now support two modes:
  - BO1: quick winner buttons
  - BO3/BO5: score input with valid-result auto-commit
- Inline score validation errors added.
- Match score is shown in organizer action cards and visual bracket cards.
- Added clear status indicators in Bracket tab:
  - Tournament Status
  - Bracket Status (`NOT GENERATED`, `PREPARED`, `ACTIVE`, `COMPLETED`)
  - Match Format display

## Inline Bracket Scoring (SAFETY-12.75)
- Organizer scoring moved into visual bracket cards (primary event-day flow).
- BO3/BO5 no longer needs Save button:
  - score stays local while incomplete/invalid
  - auto-commit only triggers when score becomes valid and complete
  - winner resolves and propagates through existing service logic
- BO1 keeps quick winner buttons for speed.
- Reopen safety action remains available inline per eligible match.
- Separate organizer control panel was removed as primary workflow to prevent duplicated scoring surfaces.

## Spectator Stability
- Public payload model now includes:
  - score fields (`score_a`, `score_b`)
  - run candidates array (`runs`)
- Public run selection is centralized:
  - `resolvePublicDisplayRun()`
  - priority: ongoing (`prepared/draft`) -> completed -> no run
- Public page remains strictly read-only.

## Visual Bracket
- Renderer remains presentation-only.
- Card view now displays score pills.
- Connector positioning switched to measured DOM center points (round-column local measurement) to reduce drift across zoom/sizing.
- Mobile horizontal scroll behavior preserved.

## Boundaries Kept
- No integration with RareBits core modules (`inventory`, `sales`, `invoices`, `wallet`, `dashboard`, `customers`).
- No new bracket formats.
- No public mutation endpoints.

## Regression Checklist
1. Create tournament with `BO1`, run full flow to completion.
2. Create tournament with `BO3`, input valid scores (`2-0`, `2-1`), verify auto winner propagation.
3. Create tournament with `BO5`, verify score validation rejects invalid states (`3-3`, `4-2`, tie).
4. Reopen completed match and confirm score reset.
5. Finalize run and verify lock behavior remains enforced.
6. Start new run and verify history preservation.
7. Open public URL and verify:
   - latest ongoing run appears if exists
   - else latest completed run
   - bracket is read-only
   - scores/winners are visible
8. Build gate:
   - `npm -C d:\\Development\\Rarebits\\rarebits-app\\rarebit run build`

## Intentionally Not Implemented
- Double Elimination / Round Robin / Swiss engines
- Participant self-registration
- Public score input
- Analytics integration
- Core business integrations
