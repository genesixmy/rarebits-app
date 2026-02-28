# FIN-AUDIT-1 Dev Note

## Source of truth
Financial formulas are centralized in `src/lib/financialDefinitions.js`.

Core definitions used:
- `Revenue Item` = item subtotal from sale lines (net of item-return refund lines only).
- `Caj Pos Dikutip` = shipping charged to customer (seller-collected mode only).
- `Kos Pos` = shipping cost paid/recorded by seller.
- `Caj Platform` = sum of effective invoice fees (`amount_override ?? amount`).
- `Untung Item` = `Revenue Item - Kos Item`.
- `Untung Pos` = `Caj Pos Dikutip - Kos Pos`.
- `Pelarasan` = invoice goodwill adjustment (`invoice.adjustment_total`).
- `Untung Bersih` = `Untung Item + Untung Pos - Caj Platform - Pelarasan`.

## Consistency changes
- Dashboard summary now uses `buildFinancialMetricsFromSalesLines(...)`.
- Sales summary now uses `buildFinancialMetricsFromSalesLines(...)`.
- Row-level profit on Dashboard and Sales now uses `getSaleLineFinancialBreakdown(...)`.
- Customer totals now use `resolveInvoiceCollectedSummary(...)` in:
  - `src/components/clients/ClientDetailPage.jsx`
  - `src/components/clients/ClientsPage.jsx`

## Guardrails applied
- Revenue Item no longer depends on `invoice.final_total`.
- Platform fee is deducted once via shared net-profit formula.
- Shipping cost is deducted once via shared shipping-profit formula.
- Customer totals remain customer-facing (`final_total` fallback logic), not reduced by platform fee.

## FIN-AUDIT-2c (Adjustment Type Normalization)
- Added migration `supabase/migrations/20260228000043_fin_audit_adjustment_type_normalization.sql`.
- Backfills legacy `invoice_refunds` rows with NULL/blank/invalid type to a valid type (`goodwill` fallback, `return` when inventory-affected).
- Enforces required type via:
  - `invoice_refunds.refund_type` NOT NULL + allowed check
  - `invoice_refunds.type` NOT NULL + allowed check
  - trigger guard that raises `Jenis adjustment wajib dipilih.` when missing
- Added `process_refund(..., p_adjustment_type)` overload with server validation:
  - missing type -> fail with clear message
  - invalid type -> fail
  - `return` type is blocked in this flow and directed to item-return flow
- Invoice adjustment modal now requires `Jenis Adjustment` and sends explicit type to RPC.
- Reporting fallback hardened:
  - when `invoice.adjustment_total` is 0 but refund rows exist, goodwill can be inferred from `invoice_refunds` (including legacy NULL-type courtesy hints).
