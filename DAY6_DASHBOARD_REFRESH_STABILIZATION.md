# Day 6 Dashboard Refresh Stabilization

Date: 2026-03-07  
Owner: Codex + User

## Objective
- Reduce inconsistent refresh behavior caused by broad cache refetching.
- Keep mutation refresh deterministic for invoice creation path.

## Change Implemented
- File updated: `src/hooks/useInvoices.js`
- In `useCreateInvoice.onSuccess`:
  - Removed global `queryClient.refetchQueries({ type: 'all' })`
  - Replaced with targeted invalidation + targeted refetch for high-impact domains:
    - `invoices`
    - `items`
    - `available-items`
    - `uninvoiced-items`
    - `clients`
    - `wallets`
    - `transactions`
    - `dashboard`
    - `sales`

## Why This Is Safer
- Avoids noisy global refetch storms.
- Reduces race side-effects across unrelated pages.
- Keeps operational flows explicit and auditable.

## Verification
- `npm run guardrail:check` passed.

