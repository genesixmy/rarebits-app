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

