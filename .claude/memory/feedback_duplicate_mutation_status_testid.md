---
name: duplicate_mutation_status_testid
description: AppShell.tsx and SymbolHistoryClient.tsx both render data-testid="mutation-status" — use .first() in E2E tests
type: feedback
---

Two components render `data-testid="mutation-status"`: `AppShell.tsx:385` (global layout) and `SymbolHistoryClient.tsx:190` (page-level StatusToast). Both read from the same mutations state. When both have content, Playwright strict mode rejects `getByTestId("mutation-status")`.

**Why:** Discovered in this fix. Before SSE worked, only one element was typically populated. Once SSE delivers recompute_complete, both update simultaneously.

**How to apply:** Always use `page.getByTestId("mutation-status").first()` in E2E tests. If adding new mutation status elements, consider using distinct testids to avoid this ambiguity.
