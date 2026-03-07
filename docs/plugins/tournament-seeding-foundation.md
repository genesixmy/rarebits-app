# Tournament Seeding Foundation (SAFETY-5)

Date: 2026-03-07  
Scope: Seeding preparation layer for Tournament plugin (standalone, low risk).

## What Was Added
- Centralized seeding helpers in plugin config:
  - `isParticipantActiveForSeeding`
  - `normalizeSeedNumberInput`
  - `getEligibleParticipantsForBracket`
  - `getParticipantsSortedBySeed`
  - `buildAutoSeedAssignments`
  - `validateTournamentSeedingReadiness`
- Seeding operations in tournament service:
  - manual seed update (existing participant update path)
  - auto assign seed numbers
  - clear all seed numbers
- Participants UI now includes:
  - Seeding summary panel
  - Readiness state (`ready`, `warning`, `not_ready`)
  - Auto Assign Seeds action
  - Clear All Seeds action
  - Inline manual seed edit/clear per participant
  - Current seed order preview

## Seeding Eligibility (v1)
- Eligible for seeding:
  - `registration_status = registered`
- Not eligible:
  - `registration_status = dropped`

When participant is marked dropped, seed is cleared.

## Auto-Seed Rule (v1)
- Deterministic order by registration timestamp (`created_at` ASC), then `id`.
- Seed assigned sequentially from `1..N`.
- No ranking model and no randomization in this phase.

## Validation/Readiness Signals
- Minimum active participants check
- Duplicate seed detection
- Unseeded active participants warning
- Dropped participants with seed (invalid state)

## Database Safety Hardening
- Added plugin-only migration to enforce seed safety:
  - unique seed number per tournament (partial unique index on non-null seed)
  - dropped participant must not keep seed
  - cleanup step for legacy duplicates before enforcing index

## Intentionally Not Implemented
- Bracket generation
- Match creation/progression
- Standings/leaderboard
- Core RareBits integration (customer/invoice/wallet/sales/dashboard)
- Public share mode
