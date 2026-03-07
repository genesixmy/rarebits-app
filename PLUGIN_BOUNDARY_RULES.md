# Plugin Boundary Rules (SAFETY-0)

Date: 2026-03-07

## Purpose
Pastikan plugin boleh berkembang (10-20 modul) tanpa merosakkan kestabilan core RareBits.

## Allowed Boundaries
- Semua kod plugin berada di `src/plugins/`.
- Route plugin mesti guna namespace `/plugins/...`.
- Plugin boleh guna:
  - `src/plugins/registry/*`
  - `src/plugins/runtime/*`
  - `src/plugins/shared/*`
  - `src/shared/*` (apabila diwujudkan)
  - komponen UI generik (`src/components/ui/*`)

## Forbidden Boundaries (Current Phase)
- Plugin **tidak boleh** terus mutate domain core:
  - invois
  - wallet
  - pelanggan
  - sales
  - dashboard
- Plugin **tidak boleh** bypass RLS ownership model.
- Plugin **tidak boleh** tambah coupling ketat dari core ke implementation plugin.

## Folder Conventions
- `src/plugins/registry/`: manifest source of truth.
- `src/plugins/runtime/`: access helper, kill switch gating.
- `src/plugins/shared/`: constants/util merentas plugin.
- `src/plugins/<plugin-slug>/`: code plugin spesifik.
- Sidebar injection rule:
  - plugin declare menu metadata dalam manifest (`sidebarSectionLabel`, `sidebarItems`)
  - Sidebar shell render menu secara generic dari runtime helper
  - elak hardcode plugin-specific link dalam shell

## Lifecycle Model (Current)
- `available`: listed tetapi belum enabled untuk akses route.
- `enabled`: listed + boleh diakses.
- `disabled`: kill switch aktif, tidak dipaparkan.
- `coming_soon`: dipaparkan untuk visibility roadmap, route disekat.

## Monetization Readiness (Future)
- Manifest sedia menyokong metadata harga (`price`) dan `purchaseRequired`.
- Enforcement billing/license **belum diaktifkan**.
- Integrasi monetization akan masuk di runtime gate layer, bukan di setiap page plugin.

## Current Rule
Standalone plugin first. Integrasi dengan core hanya melalui adapter/bridge terkawal pada fasa seterusnya.
