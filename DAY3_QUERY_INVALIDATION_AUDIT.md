# Day 3 Query Invalidation Audit

Date: 2026-03-07  
Owner: Codex + User

## Objective
- Audit query invalidation/refetch patterns.
- Define standard query-key map to reduce refresh inconsistency risk.

## Evidence (Current Hotspots)
- `src/hooks/useInvoices.js`
  - `invalidateQueries`: 129 calls
  - `refetchQueries`: 85 calls
- `src/components/wallet/WalletPage.jsx`
  - `invalidateQueries`: 19 calls
- `src/components/wallet/WalletAccountPage.jsx`
  - `invalidateQueries`: 4 calls

## Key Findings
1. Query-key naming is inconsistent in critical flows.
   - Both `clients` and `pelanggan` exist.
   - Both `wallet` and `wallets` and `allWallets` exist.
2. Invalidation scope is often broad and duplicated.
   - Same events trigger multiple overlapping invalidations + refetches.
3. Core mutation hub (`useInvoices.js`) has very high cache fan-out.
   - Main source of refresh timing drift/regression risk.
4. There is mixed legacy structure in repo (`rarebits-app/rarebit/rarebit/...`) that can confuse audit tooling and onboarding.

## Day-3 Deliverable
- Added canonical query key map:
  - `src/lib/queryKeys.js`
- This file is non-breaking and meant for gradual migration (no runtime behavior change today).

## Standard Key Families (Canonical)
- Auth/User
- Invoices
- Inventory
- Clients
- Wallet
- Dashboard
- Reminders

## Migration Rules (Starting Day 4)
1. New code must use `src/lib/queryKeys.js`.
2. Any edited module should migrate only touched query keys (incremental, low risk).
3. Keep legacy key invalidation where needed until all consumers are migrated.
4. Avoid `refetchQueries({ type: 'all' })` unless incident/debug scenario.

## Acceptance Status
- [x] Query invalidation hotspots identified
- [x] Canonical key map introduced
- [x] Migration rules defined for safe incremental adoption

