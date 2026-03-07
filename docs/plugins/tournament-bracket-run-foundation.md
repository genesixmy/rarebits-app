# Tournament Bracket Run Foundation (SAFETY-7)

Date: 2026-03-07  
Scope: Normalized match entities for Single Elimination, read-only progression skeleton.

## Model Separation
- **Snapshot** (`tournament_bracket_snapshots`):
  - frozen participant + seeding input
  - immutable historical input source
- **Run** (`tournament_bracket_runs`):
  - generated structural output from one prepared snapshot
- **Matches** (`tournament_bracket_matches`):
  - normalized round/match entities under one run

This separation is intentional to keep future engine logic maintainable.

## What Was Added
- Plugin-owned tables:
  - `public.tournament_bracket_runs`
  - `public.tournament_bracket_matches`
- Owner-only RLS for both tables.
- Centralized generation helpers:
  - `generateSingleEliminationMatchSkeleton`
  - `groupMatchesByRound`
- Safe service flow to generate run from latest prepared snapshot:
  - reuses run if already prepared for same snapshot
  - requires explicit regenerate for different snapshot
  - archives previous prepared run before creating new one

## Read-Only Limitation (Intentional)
- Match rows are generated and viewable by round.
- First round carries seeded participants / BYE states.
- Downstream rounds are generated as locked placeholders.
- No winner assignment.
- No progression propagation.
- No live match updates.

## BYE Handling
- BYE state is represented via `match_status = 'bye'` in first-round rows where one slot is empty.
- No auto-advance is performed in this phase.

## Next Engine Step Enabled by This Foundation
- set winner on match
- propagate winner to `winner_slot_target_id`
- round progression lifecycle
