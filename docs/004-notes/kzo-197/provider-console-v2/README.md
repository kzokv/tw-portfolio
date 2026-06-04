# KZO-197 Provider Console V2

Version 2 retires the standalone Provider Fixer concept before rollout and replaces `/admin/providers` with a unified provider operations console.

## Files

- `scope-todo-202606041144-provider-console-v2.md` - locked scope, acceptance criteria, and implementation todo list.
- `mockups/provider-console-v2-mockup.html` - deterministic HTML mockup used for screenshots.
- `mockups/render-provider-console-v2.mjs` - Playwright renderer for all v2 screenshots.
- `mockups/screenshots/` - rendered desktop and mobile screenshots.
- `mockups/version-2/` - current locked-in Option 3 mockup version with expanded desktop/mobile screenshots.

## Mockup Screenshots

- `01-provider-console-overview-desktop.png`
- `02-unresolved-instruments-desktop.png`
- `03-provider-fixer-desktop.png`
- `04-dangerous-preview-desktop.png`
- `05-operations-running-desktop.png`
- `06-operation-outcomes-desktop.png`
- `07-incidents-activity-logs-desktop.png`
- `08-kr-mappings-desktop.png`
- `09-provider-operations-settings-desktop.png`
- `10-mobile-unresolved.png`
- `11-mobile-dangerous-preview.png`

Regenerate from repo root:

```bash
node docs/004-notes/kzo-197/provider-console-v2/mockups/render-provider-console-v2.mjs
```

## Locked Version 2 Screenshots

Current review set: `mockups/version-2/screenshots/`.

- `01-provider-console-overview-desktop.png`
- `02-unresolved-instruments-desktop.png`
- `03-select-all-matching-desktop.png`
- `04-provider-fixer-desktop.png`
- `05-ambiguous-candidate-selection-desktop.png`
- `06-dangerous-repair-preview-desktop.png`
- `07-operations-running-desktop.png`
- `08-operation-outcomes-desktop.png`
- `09-incidents-desktop.png`
- `10-activity-logs-purge-desktop.png`
- `11-kr-mappings-desktop.png`
- `12-provider-operations-settings-desktop.png`
- `13-finmind-shared-budget-desktop.png`
- `14-twelve-data-capability-evidence-desktop.png`
- `15-yahoo-finance-au-rerun-desktop.png`
- `16-twelve-data-au-catalog-desktop.png`
- `17-asx-gics-csv-enrichment-desktop.png`
- `18-frankfurter-fx-refresh-desktop.png`
- `19-mobile-unresolved.png`
- `20-mobile-fixer-action-sheet.png`
- `21-mobile-dangerous-preview.png`

Regenerate the locked version:

```bash
node docs/004-notes/kzo-197/provider-console-v2/mockups/version-2/render-provider-console-v2-option-3.mjs
```
