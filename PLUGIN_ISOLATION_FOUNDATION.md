# Plugin Isolation Foundation (Tournament)

Date: 2026-03-07

## Goal
Mulakan plugin tournament secara berasingan daripada core RareBits.

## Implemented Foundation
- Route baru:
  - `/plugins` (Plugin Center)
  - `/plugins/tournament` (Tournament sandbox page)
- Registry:
  - `src/plugins/registry.js`
- UI:
  - `src/components/plugins/PluginsPage.jsx`
  - `src/components/plugins/TournamentPluginPage.jsx`
- Sidebar entry:
  - `Plugin Center` (seksyen link berasingan, bukan core module)

## Isolation Rules
1. Plugin tidak ubah jadual core secara direct.
2. Integrasi invois/wallet mesti melalui adapter layer (fasa seterusnya).
3. Semua jadual plugin akan guna prefix/plugin namespace dan RLS sendiri.
4. Dashboard core tidak auto-campur data tournament tanpa filter/source tag.

## Next Step (Safe)
1. Create plugin DB tables (isolated).
2. Build tournament setup wizard.
3. Add client prefill adapter (read-only).
4. Add invoice adapter (explicit opt-in only).

