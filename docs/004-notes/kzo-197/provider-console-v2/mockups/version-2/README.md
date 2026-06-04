# KZO-197 Provider Console V2 Locked Mockups

This folder preserves the second locked visual version of the Provider Console V2 mockups. The older `mockups/screenshots/` set remains available for comparison.

## Files

- `provider-console-v2-locked-mockup.html` - deterministic HTML mockup for the locked provider-console direction.
- `render-provider-console-v2-locked.mjs` - Playwright renderer.
- `screenshots/` - rendered PNGs for desktop and mobile states.

## Screenshots

- `01-provider-console-overview-desktop.png` - provider rail, health overview, notification-aware refresh.
- `02-provider-tabs-capabilities-desktop.png` - provider-owned tabs/actions and disabled capability reasons.
- `03-provider-fixer-coverage-desktop.png` - provider-specific fixer coverage across Yahoo, Twelve Data, FinMind, Frankfurter, and ASX GICS CSV.
- `04-unresolved-instruments-desktop.png` - durable unresolved table, filters, select-all matching, disabled rerun reason.
- `05-fixer-normal-actions-desktop.png` - provider-owned fixer with Renew, Repair, Rerun semantics.
- `06-dangerous-preview-desktop.png` - typed-phrase preview for bulk repair.
- `07-operations-running-sse-desktop.png` - running operations with SSE status and persisted counters.
- `08-operations-queued-desktop.png` - queued operation phase, promotion rules, and cancel-only controls.
- `09-operation-outcomes-desktop.png` - per-item outcomes and retryable failures.
- `10-incidents-activity-logs-desktop.png` - useful incident, activity, and raw log surfaces.
- `11-logs-purge-preview-desktop.png` - destructive purge preview and durable-record boundaries.
- `12-kr-mappings-desktop.png` - durable KR resolver mappings and evidence.
- `13-settings-provider-budgets-desktop.png` - provider-operation budgets and shared caps.
- `14-settings-retention-desktop.png` - retention windows and purge limits.
- `15-mobile-provider-overview.png` - mobile provider overview and bottom action bar.
- `16-mobile-provider-switcher.png` - mobile provider list with statuses, counts, and provider-owned fixer access.
- `17-mobile-unresolved.png` - mobile unresolved cards.
- `18-mobile-operation-progress.png` - mobile operation progress.
- `19-mobile-dangerous-preview.png` - mobile destructive preview sheet.

Regenerate from repo root:

```bash
node docs/004-notes/kzo-197/provider-console-v2/mockups/version-2/render-provider-console-v2-locked.mjs
```
