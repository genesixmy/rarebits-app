# Day 4-5 Extract-Only Refactor (Low Risk)

Date: 2026-03-07  
Owner: Codex + User

## Objective
- Reduce monolith pressure in `InvoiceDetailsPage` without changing behavior.
- Move stable pure functions to dedicated invoice utility module.

## Changes Done
- Added:
  - `src/lib/invoices/invoiceDetailUtils.js`
- Updated:
  - `src/components/invoices/InvoiceDetailsPage.jsx`

## Functions Extracted
- `INVOICE_ADJUSTMENT_TYPES`
- `normalizeAdjustmentType`
- `resolveInvoiceAdjustmentType`
- `getSellerCollectedShippingCharged`
- `getInvoiceFinancialSummary`
- `normalizeWhatsAppPhone`
- `getPrimaryClientPhone`
- `buildInvoiceWhatsAppMessage`
- `getInvoiceExportFileName`

## Safety Notes
- Extract-only: logic retained verbatim.
- No API/DB contract changes.
- No route/UI behavior intended to change.

## Verification
- `npm run guardrail:check` passed after extraction.

## Remaining Refactor Candidate (Future, optional)
- Move WhatsApp short-link/upload helper cluster out of component.
- Move print-layout generation helpers into `src/lib/invoices/print*`.

