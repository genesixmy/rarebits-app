# Day 1 Baseline And Guardrail

Date: 2026-03-07  
Owner: Codex + User

## Objective
- Freeze a factual baseline before further hardening/refactor.
- Confirm minimum guardrails pass on current working branch.

## Baseline Snapshot
- Branch: `claude/persist-form-data-tabs-011CV3DFjx8DLe4S8XuUjuvh`
- Commit: `cc099587`
- Working tree state (pre-Day-1):
  - Modified: `supabase/.temp/cli-latest`
  - Untracked: `-`

## Guardrail Checks Executed

### 1) Frontend Build
Command:
```powershell
npm -C d:\Development\Rarebits\rarebits-app\rarebit run build
```
Result: PASS (`exit code 0`)

### 2) SQL Lint (Public Schema)
Command:
```powershell
npx supabase db lint --linked --schema public --fail-on error
```
Result: PASS (`No schema errors found`)

## Day-1 Risk Register (Current)
- `High`: Large files still carry mixed responsibilities:
  - `src/components/invoices/InvoiceDetailsPage.jsx` (~4.5k lines)
  - `src/components/AddItemForm.jsx` (~3k lines)
  - `src/components/invoices/InvoiceFormPage.jsx` (~2.3k lines)
  - `src/components/Dashboard.jsx` (~2.3k lines)
- `Medium`: App-level automated tests are still minimal (regression risk remains).
- `Low`: Workspace hygiene noise from temp/untracked artifacts.

## Day-1 Acceptance Status
- [x] Baseline branch/commit captured
- [x] Build guardrail passes
- [x] SQL lint guardrail passes
- [x] Risks documented for Day-2 onward

## Gate For Day 2
- Start Day-2 only if:
  - Build still green before first code change
  - SQL lint still clean before first code change
  - No unexpected working-tree changes beyond known temp artifacts

## Core Smoke Checklist (Use Before/After Each Day)
1. Login/logout works without redirect loop.
2. Create item + edit item + save success.
3. Create invoice + mark paid + wallet updates.
4. Refund/return updates dashboard without manual refresh (or documented known gap).
5. Backup export + restore disaster basic path works.
6. Catalog edit/save works after first load.
7. Wallet receipt preview/download flow works.
