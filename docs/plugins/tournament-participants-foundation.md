# Tournament Participants Foundation (SAFETY-4)

Date: 2026-03-07  
Scope: Tournament plugin participant registration and management baseline.

## What Was Added
- Plugin-owned participant table: `public.tournament_participants`.
- Owner-only RLS policies tied to `auth.uid()` and tournament ownership.
- Participant CRUD service and React Query hooks inside tournament plugin.
- Participant management UI inside tournament detail page.
- Tournament detail sections now structured as:
  - `Overview`
  - `Participants`
  - `Bracket` (placeholder)
  - `Results` (placeholder)

## Participant Status Model (v1)
- `registration_status`: `registered` | `dropped`
- `payment_status`: `unpaid` | `paid`
- `check_in_status`: `not_checked_in` | `checked_in`

These explicit columns are intentionally normalized for future bracket/seeding queries.

## Current Delete Strategy
- Current implementation uses **hard delete** with confirmation dialog.
- Reason: no bracket/match dependency exists yet, so hard delete is low risk for this phase.
- Future phase may switch to soft delete/audit trail once match results exist.

## Future-Ready Notes
This foundation prepares the next tasks:
- active participant filtering (`registration_status = 'registered'`)
- seeding assignment (`seed_number`)
- bracket generation input source

## Intentionally Not Implemented
- No customer autofill from RareBits core.
- No invoice/wallet/sales integration.
- No payment collection flow.
- No bracket generation or standings engine.
- No public participant registration.
