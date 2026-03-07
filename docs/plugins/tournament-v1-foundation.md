# Tournament Plugin V1 Foundation

Date: 2026-03-07

## Scope Implemented
- Isolated plugin data model (`tournament_templates`, `tournaments`) with RLS owner-only access.
- Premade template bootstrap:
  - Pokemon TCG
  - Beyblade X
  - Digimon
  - Custom
- Create Tournament wizard:
  - Step 1: choose template
  - Step 2: fill details (template-driven dynamic fields)
  - Step 3: review and create
- Bracket recommendation logic based on template + player size.
- Tournament list page and tournament detail placeholder page.

## Isolation Contract
- Plugin only reads/writes:
  - `public.tournament_templates`
  - `public.tournaments`
- No writes to:
  - invoices
  - wallets
  - dashboard snapshots
  - any other core financial table

## Data Model Notes
- Normalized columns keep core tournament setup queryable:
  - `name`, `category`, `bracket_type`, `status`, `event_date`, `venue`, `entry_fee`, `max_players`, `match_format`, `round_time_minutes`
- `settings_json` stores template-specific dynamic config and recommendation metadata for future bracket engine.

## Next Extension Points
1. `tournament_players` table + registration flow (manual + optional client prefill adapter).
2. `tournament_matches` table + bracket generator service layer.
3. Result submission + standings projection.
4. Optional invoice adapter for entry fee collection (explicit opt-in, no implicit writes).
5. Plugin-level analytics page (isolated from core dashboard by default).
