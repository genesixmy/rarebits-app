# Tournament Public Spectator Mode (SAFETY-12)

Date: 2026-03-07  
Scope: Read-only spectator page for ongoing/completed Single Elimination tournaments.

## Public Route Model
- Public route: `/tournament/:publicCode`
- Organizer routes remain isolated under `/plugins/tournament/...`
- Spectator page is read-only and does not require login.

## Public Identity
- Added plugin-safe public identifier:
  - `tournaments.public_code` (unique)
- Existing tournaments are backfilled with generated `public_code`.
- New tournaments get `public_code` by default.

## Public Data Access Strategy
- No broad RLS relaxation on tournament tables.
- Public access is exposed through narrow RPC:
  - `public.get_tournament_public_view(p_public_code text)`
- RPC is `SECURITY DEFINER` and returns only spectator-safe fields:
  - tournament basic info
  - selected display run
  - read-only matches list

## Public Display Run Selection Rules
Selection priority is centralized in SQL:
1. Latest `prepared` or `draft` run (ongoing/current display)
2. Latest `completed` run (fallback if no active run)
3. No run state (public page shows "not available yet")

## Public View Scope
Included:
- tournament name/date/venue/bracket
- public run status
- grouped round/match bracket
- winner labels for completed matches
- champion/final summary if completed

Excluded:
- organizer controls (assign winner/rebuild/finalize/reset)
- audit trail internals
- organizer notes/settings JSON
- mutation endpoints

## Live-ish Behavior
- Public query refreshes every 15 seconds.
- Also refetches on mount and on window focus.

## Intentionally Not Implemented
- No public participant self-registration.
- No public score input.
- No spectator chat/comments.
- No QR generation.
- No core RareBits integration (wallet/invoice/customers/sales/dashboard).
