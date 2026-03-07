# AI Code Rules — RareBits

Date: 2026-03-07  
Scope: Mandatory guardrails for AI coding assistants working in RareBits.

## A) Purpose
This file defines enforceable architecture rules for AI-driven code changes in RareBits.  
Its purpose is to prevent unsafe coupling, reduce spaghetti code, and keep the system scalable as plugin count grows.

## B) Core Principle
RareBits code must remain:
- modular
- predictable
- scalable
- maintainable

## C) Core Business Protection
The following core business domains are protected:
- Inventory
- Sales
- Invoices
- Customers
- Wallets
- Dashboard analytics

AI must not modify these domains unless the task explicitly requests it.

## D) Plugin Architecture Rules
- All plugin code must live under `src/plugins/<plugin-name>/`.
- Plugin routes must stay in `/plugins/...` namespace.
- Plugins must stay isolated from core business internals.
- Plugins must not directly import or mutate internal core business domains.
- Any future plugin-to-core integration must go through controlled adapters/bridges.

## E) Manifest Rules
Plugin manifest/registry is the single source of truth for:
- metadata
- sidebar config
- visibility
- capabilities
- lifecycle state

Use current registry/runtime terms consistently (`manifest`, `registry`, `runtime`, `status`).

## F) Sidebar / Navigation Rules
- Plugins declare their own menu in manifest (for example `sidebarSectionLabel`, `sidebarItems`).
- Sidebar renders normalized config generically.
- Do not hardcode plugin-specific menu logic in sidebar.
- Do not implement `if plugin A / if plugin B / if plugin C` navigation chains.

## G) Runtime Helper Rules
- Plugin visibility/access checks must go through centralized runtime helpers.
- Do not scatter plugin checks across many components/files.
- Route gating and kill switch behavior must be runtime-driven, not ad hoc.

## H) Anti-Spaghetti Rules (Mandatory)
1. Avoid hardcoded feature logic.
  - Do not hardcode plugin-specific behavior in core shell components.
  - Prefer manifest/config-driven rendering.
2. Centralize feature checks.
  - Plugin enable/disable checks must use runtime helpers.
3. Maintain single source of truth.
  - Do not duplicate plugin metadata in multiple files.
4. Keep boundaries strict.
  - Plugin code stays in `src/plugins`.
  - No direct plugin mutation of core business domains.
5. Keep App Shell lightweight.
  - Sidebar/routing/layout should render config, not plugin business internals.
6. Avoid uncontrolled conditional growth.
  - Replace plugin-specific branching with normalized iteration over config.
7. Prefer small targeted refactors.
  - Keep changes minimal and reversible.
8. Build for scale.
  - Structure must remain manageable with 10–20 plugins.

If a request increases coupling or scatters logic, stop and propose a safer structure first.

## I) App Shell Responsibility
App shell (`Sidebar`, `Layout`, top-level routing) may know that plugins exist, but must remain generic.  
App shell must not contain plugin-specific business logic.

## J) Feature Flag / Kill Switch Rule
Plugins must be disable-safe:
- plugin nav can be hidden safely
- plugin route access can be gated safely
- core app remains unaffected when plugin is disabled

No plugin failure should break core business flows.

## K) Refactor Safety
- Prefer incremental, low-risk changes over broad rewrites.
- Do not perform large architecture migrations unless explicitly requested.
- Avoid introducing new architecture layers unless necessary for current task scope.

## L) Scalability Requirement
RareBits must support 10–20 plugins without turning core shell into a plugin-specific code hub.  
New plugin additions should require minimal shell changes.

## M) Documentation Expectation
For architecture-impacting tasks, update lightweight documentation alongside code changes:
- boundary rules
- runtime behavior
- manifest expectations
- extension points

## N) When Unsure
If a requested change risks:
- plugin boundary violation
- core business coupling
- scattered runtime checks
- duplicated plugin metadata

AI must pause implementation and propose a safer structure before coding.

