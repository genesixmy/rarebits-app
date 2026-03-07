# Tournament Bracket Snapshot Foundation (SAFETY-6)

Date: 2026-03-07  
Scope: Bracket input snapshot preparation (no live match engine yet).

## What Was Added
- Plugin-owned table: `public.tournament_bracket_snapshots`.
- Centralized bracket preflight/readiness helpers:
  - `validateBracketPreparationReadiness`
  - `getBracketEligibleParticipants`
  - `buildBracketInputSnapshot`
- Snapshot preparation service flow:
  - validates seeding readiness
  - archives existing `prepared` snapshot (if re-preparing)
  - saves new immutable snapshot input JSON
- Bracket tab upgraded with:
  - readiness panel
  - prepare snapshot action
  - confirmation on replacement
  - latest snapshot card
  - read-only single-elimination first-round draft preview
  - clear notice for unsupported bracket types

## Snapshot Lifecycle
- `prepared`: active snapshot used for current draft preview
- `archived`: older snapshot retained for history
- `draft`: reserved for future use

Current flow archives old prepared snapshot and creates a fresh prepared snapshot.

## Supported Bracket Type in This Phase
- Implemented: `single_elimination` draft preview only
- Not implemented (safe notice only):
  - `double_elimination`
  - `round_robin`
  - `swiss`

## Frozen Snapshot Intent
Snapshot JSON is treated as frozen historical bracket input:
- participant state is captured at preparation time
- later participant changes do not mutate old snapshots
- organizer must create a new snapshot to refresh bracket input

## Intentionally Not Implemented
- no winner progression
- no live match updates
- no editable match results
- no round advancement engine
- no public bracket sharing
- no integration with core RareBits domains
