# KZO-197 Provider Console V2 Option 3 Mockups

This folder keeps the locked-in option 3 provider console mockups versioned separately from the earlier unversioned sketches.

## Files

- `provider-console-v2-option-3-mockup.html` - deterministic static HTML mockup.
- `render-provider-console-v2-option-3.mjs` - Playwright renderer for all screenshots.
- `screenshots/` - rendered desktop and mobile PNG screenshots.

The earlier locked renderer and its screenshots remain in this folder for comparison, but the Option 3 files above are the current review set.

## Screenshots

- `01-provider-console-overview-desktop.png` - provider rail, grouped providers, health overview, refresh notification.
- `02-unresolved-instruments-desktop.png` - durable unresolved items table with filters, row actions, and disabled Rerun reason.
- `03-select-all-matching-desktop.png` - select-all-matching across pages with clear bulk scope.
- `04-provider-fixer-desktop.png` - provider-owned Fixer tab with Renew, Repair, Rerun semantics.
- `05-ambiguous-candidate-selection-desktop.png` - KR candidate selection for ambiguous mappings.
- `06-dangerous-repair-preview-desktop.png` - dangerous Repair preview with snapshot guard and typed phrase.
- `07-operations-running-desktop.png` - running operations with SSE state, progress, queue, and budget.
- `08-operation-outcomes-desktop.png` - item-level operation outcomes and retryable failures.
- `09-incidents-desktop.png` - incident lifecycle view with open, acknowledged, and resolved states.
- `10-activity-logs-purge-desktop.png` - useful activity, raw logs, and typed-phrase purge preview.
- `11-kr-mappings-desktop.png` - durable Twelve Data identity to Yahoo Finance KR binding evidence.
- `12-provider-operations-settings-desktop.png` - Admin Settings Provider operations budgets, guardrails, thresholds, and retention.
- `13-finmind-shared-budget-desktop.png` - FinMind provider console using shared TW/US budget and capability-driven actions.
- `14-twelve-data-capability-evidence-desktop.png` - Twelve Data plan/capability evidence and explicit fallback guidance.
- `15-yahoo-finance-au-rerun-desktop.png` - Yahoo Finance AU provider-owned rerun/warm-up semantics and audit shape.
- `16-twelve-data-au-catalog-desktop.png` - Twelve Data AU catalog-only capability and disabled backfill affordance.
- `17-asx-gics-csv-enrichment-desktop.png` - ASX GICS CSV enrichment provider with repair, preview delta, and unsupported rerun.
- `18-frankfurter-fx-refresh-desktop.png` - Frankfurter FX provider with refresh/rerun semantics and no resolver mapping.
- `19-mobile-unresolved.png` - mobile unresolved table replacement with cards and bottom actions.
- `20-mobile-fixer-action-sheet.png` - mobile small Repair guardrail action sheet.
- `21-mobile-dangerous-preview.png` - mobile dangerous preview sheet with typed confirmation.

Regenerate from repo root:

```bash
node docs/004-notes/kzo-197/provider-console-v2/mockups/version-2/render-provider-console-v2-option-3.mjs
```
