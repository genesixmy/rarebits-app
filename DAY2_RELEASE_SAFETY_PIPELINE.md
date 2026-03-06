# Day 2 Release Safety Pipeline

Date: 2026-03-07  
Owner: Codex + User

## Objective
- Standardize pre-merge safety checks.
- Make release gate repeatable for every small PR.

## What Was Added
- NPM scripts:
  - `guardrail:build`
  - `guardrail:sql`
  - `guardrail:check`
- Guardrail runner:
  - `tools/guardrail-check.js`

## Standard Pre-Merge Gate
Run from project root (`rarebits-app/rarebit`):

```powershell
npm run guardrail:check
```

Expected:
- Build must pass.
- SQL lint must pass.
- Manual smoke checklist must be completed before merge.

## Manual Smoke Checklist (Required)
1. Login/logout flow.
2. Item create/edit/save.
3. Invoice create/paid and wallet update.
4. Refund/return reflected correctly.
5. Backup export and disaster restore basic path.
6. Catalog edit/save works on first load.
7. Wallet receipt preview/download works.

## Merge Rule
- Do not merge if any automated check fails.
- Do not merge if any smoke checklist item fails.
- If one smoke item is known issue, it must be documented in PR with impact + rollback note.

## Evidence Template For PR
- Guardrail command output: pass/fail
- Smoke checklist result: pass/fail
- Risk note: yes/no
- Rollback note: required for risky changes

## Day-2 Acceptance Status
- [x] Repeatable guardrail command exists
- [x] SQL lint included in standard pipeline
- [x] Manual smoke checklist standardized
- [x] Merge rule documented

