# KZO-197 Provider Console V2

Version 2 retires the standalone Provider Fixer concept before rollout and replaces `/admin/providers` with a unified provider operations console.

## Files

- `scope-todo-202606041144-provider-console-v2.md` - locked scope, acceptance criteria, and implementation todo list.
- `mockups/provider-console-v2-mockup.html` - deterministic HTML mockup used for screenshots.
- `mockups/render-provider-console-v2.mjs` - Playwright renderer for all v2 screenshots.
- `mockups/screenshots/` - rendered desktop and mobile screenshots.
- `mockups/version-2/` - current locked-in mockup version with expanded desktop/mobile screenshots.

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
- `02-provider-tabs-capabilities-desktop.png`
- `03-provider-fixer-coverage-desktop.png`
- `04-unresolved-instruments-desktop.png`
- `05-fixer-normal-actions-desktop.png`
- `06-dangerous-preview-desktop.png`
- `07-operations-running-sse-desktop.png`
- `08-operations-queued-desktop.png`
- `09-operation-outcomes-desktop.png`
- `10-incidents-activity-logs-desktop.png`
- `11-logs-purge-preview-desktop.png`
- `12-kr-mappings-desktop.png`
- `13-settings-provider-budgets-desktop.png`
- `14-settings-retention-desktop.png`
- `15-mobile-provider-overview.png`
- `16-mobile-provider-switcher.png`
- `17-mobile-unresolved.png`
- `18-mobile-operation-progress.png`
- `19-mobile-dangerous-preview.png`

Regenerate the locked version:

```bash
node docs/004-notes/kzo-197/provider-console-v2/mockups/version-2/render-provider-console-v2-locked.mjs
```
