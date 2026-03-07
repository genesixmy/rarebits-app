# Plugin Foundation Safety-0 (Developer Note)

Date: 2026-03-07

## What Was Prepared
- Standardized plugin manifest schema under `src/plugins/registry/`.
- Added centralized runtime gate helpers:
  - `getAvailablePlugins()`
  - `isPluginEnabled(slug)`
  - `canAccessPlugin(slug)`
  - `getPluginAccessState(slug)`
- Added route-level guard fallback page (`PluginUnavailablePage`).
- Added nav kill-switch behavior:
  - disabled plugin is hidden from Plugin Center list
  - Plugin Center nav hides if no visible plugin exists
- Kept Tournament plugin route working under enabled status.
- Added sidebar plugin section injection:
  - plugin declares `sidebarSectionLabel`, `sidebarSectionOrder`, `sidebarItems[]` in manifest
  - sidebar renders plugin sections from runtime helper (`getEnabledPluginSidebarSections`)
  - no plugin-specific sidebar hardcoding is needed for future plugins

## What Was Intentionally NOT Done
- No payment, checkout, or license verification.
- No refactor to core invoices/wallet/customers/sales/dashboard.
- No plugin-to-core data bridge implementation.
- No full marketplace implementation.

## How To Add New Plugin Safely
1. Tambah raw manifest di `src/plugins/registry/manifests.js`.
2. Set `status` ikut lifecycle (`available/enabled/disabled/coming_soon`).
3. Isytiharkan menu sidebar plugin melalui `sidebarItems`.
4. Letakkan page/component plugin di `src/plugins/<slug>/`.
5. Daftarkan route `/plugins/<slug>` di App.
6. Gunakan runtime gate helper untuk access check.

## Where Future Purchase/License Checks Should Be Added
- Di `src/plugins/runtime/pluginRuntime.js` dalam `canAccessPlugin()` / `getPluginAccessState()`.
- Jangan tambah check billing di komponen page plugin secara direct.
