# Playwright dnd-kit Drag Readiness

dnd-kit `Locator.dragTo` can complete without changing sortable order when the pointer lands back inside the source card or another non-target collision area. This is most visible with uneven card heights and `pointerWithin`-first collision detection: the Playwright action succeeds, but `onDragEnd` sees `active.id === over.id`, no PATCH fires, and a persistence poll times out.

## Rule

For Playwright tests that verify dnd-kit sortable behavior, do not assert persisted state immediately after a single drag command. First prove that the drag actually produced a reorder by waiting for one of these readiness signals:

- The expected DOM order is visible.
- The expected `/user-preferences` PATCH response is observed and `response.ok()` is true.
- A narrow test harness such as `sortable-card-grid._testOnDragEnd(...)` is used when the test is about persist/render state rather than physical pointer mechanics.

If the spec uses a real pointer drag, wrap it in a bounded retry that checks DOM order after each attempt and throws the current DOM order on failure.

```ts
async function moveCard(page: Page, drag: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await drag();
    if (await expectedDomOrderIsVisible(page)) return;
  }

  throw new Error(`card did not move after drag attempts; DOM order: ${(await getDomOrder(page)).join(", ")}`);
}
```

## Why

Two KZO-162 reorder surfaces hit the same class:

- `transactions-card-reorder-aaa.spec.ts` already needed a retry + DOM-order readiness wrapper for `transactions-add` vs `transactions-status`.
- `portfolio-card-reorder-aaa.spec.ts` later failed in the full OAuth suite because `dividends-section` was dropped over itself, so no card-order PATCH occurred.

The stable assertion sequence is `seed -> navigate -> drag-with-readiness -> persisted-state poll`. Persistence polling alone is not a drag-readiness signal.

## Companion Rules

- `e2e-oauth-seed-as-browser.md` for OAuth user-preference seeding before navigation.
- `playwright-request-cookie-jar-isolation.md` for isolated API reads in browser-state assertions.
