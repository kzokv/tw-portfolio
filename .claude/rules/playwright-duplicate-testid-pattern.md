# Playwright Duplicate Test ID Pattern

Two components in this project render `data-testid="mutation-status"`: `AppShell.tsx` (global layout) and `SymbolHistoryClient.tsx` (page-level status toast). Both read from the same mutations state.

When both elements are present, Playwright's strict mode rejects `getByTestId("mutation-status")` as ambiguous.

**Solution:**
Always use `.first()` to select the first matching element:

```ts
// ❌ Wrong — ambiguous in strict mode
await expect(page.getByTestId("mutation-status")).toContainText(/recomputed/i);

// ✅ Correct — explicitly select first occurrence
await expect(page.getByTestId("mutation-status").first()).toContainText(/recomputed/i);
```

**Pattern:**
```ts
const statusEl = page.getByTestId("mutation-status").first();
await expect(statusEl).toBeVisible();
await expect(statusEl).toContainText(/expected text/i);
```

**Prevention for new code:**
When adding new mutation status elements or similar duplicated testids:
- Use distinct testids to avoid ambiguity: `mutation-status-global`, `mutation-status-page`
- Or keep duplicate testids intentional and document the pattern
- Test the `.first()` pattern consistently

**Why:** Discovered in KZO-114 when SSE fix made both elements update simultaneously. Before that, usually only one was populated, masking the duplicate testid issue.

**How to apply:**
- Always use `.first()` for the current `mutation-status` testid in E2E tests
- Consider using a test selector helper to enforce this pattern:
  ```ts
  const getMutationStatus = (page: Page) =>
    page.getByTestId("mutation-status").first();
  ```
