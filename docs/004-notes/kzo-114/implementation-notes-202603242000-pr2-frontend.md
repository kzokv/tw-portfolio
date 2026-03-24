---
slug: kzo-114-pr2-verified
type: implementation-notes
created: 2026-03-24T20:00:00
tickets: [KZO-114]
wave: 2
pr: 2
status: merged
supersedes: implementation-notes-202603241900-pr2-frontend.md
---

# Implementation Notes: KZO-114 PR 2 — Frontend Transaction Mutations (Verified)

> **Frozen snapshot.** Records what was built and verified against the actual code. Do not update after merge.
>
> **Supersedes** `implementation-notes-202603241900-pr2-frontend.md` (design-doc-based draft with several inaccuracies — see §4).
>
> Related artifacts:
> - Scope todo: `docs/004-notes/kzo-114/scope-todo-202603241600-transaction-mutations.md`
> - Technical design: `.worklog/team/technical-design-pr2.md`
> - PR1 notes: `docs/004-notes/kzo-114/implementation-notes-202603241800-pr1-backend-infrastructure.md`

---

## 1. Files Changed (19 Total)

### New Files (7)

| File | Purpose |
|---|---|
| `apps/web/app/symbols/[symbol]/SymbolHistoryClient.tsx` | `"use client"` wrapper: instantiates `useTransactionMutations`, wires callbacks to `TransactionHistoryTable`, renders dialogs and status banners |
| `apps/web/components/portfolio/DeleteConfirmationDialog.tsx` | Radix dialog: trade summary, negative lots warning, impact counts, rose-styled confirm button |
| `apps/web/components/portfolio/EditableTransactionRow.tsx` | 6-state per-row component (viewing/editing/validating/submitting/recompute-pending/recompute-complete). Fields: date, quantity, price, side. Symbol/account hint below inputs. |
| `apps/web/components/portfolio/FeeRecalcConfirmDialog.tsx` | Radix dialog: two-path choice ("Recalculate Fees" / "Keep Manual Fees") shown when `fees_source=MANUAL` and quantity/price changed |
| `apps/web/features/portfolio/hooks/useTransactionMutations.ts` | Central mutation hook: delete/edit state, SSE subscription, timeout guard, disable guard |
| `apps/web/features/portfolio/services/transactionMutationService.ts` | API wrappers: `previewImpact`, `deleteTransaction`, `patchTransaction` |
| `apps/web/tests/e2e/specs/transaction-mutations.spec.ts` | 8 E2E tests in dev_bypass mode |

### Modified Files (12)

| File | Change |
|---|---|
| `apps/api/src/routes/registerRoutes.ts` | Map `feesSource` from `BookedTradeEvent` into `TransactionHistoryItemDto` in `GET /portfolio/transactions` |
| `apps/web/app/symbols/[symbol]/page.tsx` | Delegate interactive table rendering to `SymbolHistoryClient` |
| `apps/web/components/layout/AppShell.tsx` | Import `useTransactionMutations`, pass `mutations.recomputingSymbols` to `HoldingsTable` |
| `apps/web/components/portfolio/HoldingsTable.tsx` | Accept `recomputingSymbols: Set<string>` prop, apply `animate-pulse opacity-40` skeleton overlay to matching rows |
| `apps/web/components/portfolio/TransactionHistoryTable.tsx` | Add `"use client"`, action buttons column, `EditableTransactionRow` integration, `recomputingIds` skeleton |
| `apps/web/features/dashboard/i18n.ts` | Add `mutations` section (22 keys) in `en` and `zh-TW`; update `holdings.entries` to string template |
| `apps/web/features/portfolio/i18n.ts` | Supporting i18n changes |
| `apps/web/hooks/useEventStream.ts` | Multi-event support (`eventTypes: string[]`), backward-compat `eventType` deprecated, `typesKey` dependency stabilization |
| `apps/web/lib/api.ts` | `getAuthHeaders()` made `async`; `getRuntimeDevUserId()` reads `tw_e2e_user` cookie from `next/headers` on server side |
| `apps/web/lib/i18n/types.ts` | Extend `AppDictionary` with `mutations` section; `holdings.entries: string` (was `(count: number) => string`) |
| `apps/web/test/features/dashboard/components.test.tsx` | Update unit tests for `AppDictionary` type and `holdings.entries` string template |
| `libs/shared-types/src/index.ts` | `feesSource: "CALCULATED" | "MANUAL"` on `TransactionHistoryItemDto`; 4 new response types |

---

## 2. Key Design Decisions

### 2.1. Server/Client Boundary: `SymbolHistoryClient` Wrapper

`page.tsx` at `app/symbols/[symbol]/page.tsx` is a React Server Component that fetches `transactions` server-side. Client mutation hooks require browser state and the `useRouter` API, which cannot exist in an RSC.

The wrapper pattern:
```
page.tsx (RSC, fetches transactions)
  → <SymbolHistoryClient transactions={...} dict={...} locale={...} />
       → useTransactionMutations (client-only hook)
       → <TransactionHistoryTable ... />
       → <DeleteConfirmationDialog ... />
       → <FeeRecalcConfirmDialog ... />
```

Server-side data fetching is preserved. The client wrapper hydrates after the server HTML lands, then React event handlers become active.

---

### 2.2. SSE Always-On (`enabled: true`)

The design doc proposed gating the SSE connection on `recomputingSymbols.size > 0` to avoid unnecessary connections. The implementation uses `enabled: true` (the hook's default):

```ts
useEventStream({
  eventTypes: ["recompute_complete", "recompute_failed"],
  onEvent: handleSSEEvent,
  enabled: true,   // ← always on
});
```

**Why always-on:** Gating on `recomputingSymbols.size > 0` introduces a race condition. The sequence is:
1. User confirms delete → HTTP DELETE returns 202
2. In the same tick, `recomputingSymbols.set(key)` — which would `enabled: true`
3. But `useEffect` for SSE re-subscription runs *after* the render, so EventSource opens **after** the API has already dispatched `setImmediate` for recompute

In the in-memory test backend, recompute is so fast that the SSE event is published before the EventSource connection is even established. The always-on approach means the connection is already open before the mutation fires, eliminating the race.

---

### 2.3. Soft-Wait Pattern: SSE Incompatible with `networkidle`

The E2E symbol page helper uses the soft-wait pattern from KZO-116 rather than `waitForNetworkIdle`:

```ts
// Soft-wait for hydration — SSE keeps a persistent connection so networkidle never resolves
await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
```

`EventSource` establishes a persistent HTTP/1.1 connection to `/events/stream` that Playwright counts as an open network request. `waitUntil: "networkidle"` would wait indefinitely for it to close. The `waitForAppReady` helper in `flows.ts` (which waits for `data-testid="app-shell-ready"`) is also not used here — the symbol history page has no app-shell-ready marker (it's a different page structure from the dashboard). Instead, `gotoSymbol` waits for `data-testid="symbol-history-section"` to be visible.

---

### 2.4. `reloadAfterMutation` Pattern (SSE Race in Memory Backend)

The E2E tests do not poll for `mutation-status` text then verify updated state. Instead they use a `reloadAfterMutation` helper:

```ts
async function reloadAfterMutation(page: Page) {
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("symbol-history-section")).toBeVisible({ timeout: 20_000 });
}
```

**Why:** In the memory backend, `replayPositionHistory` runs inside `setImmediate` and completes synchronously before any browser can open an EventSource connection. The `recompute_complete` event is published to Redis/memory bus before the test's browser has established its SSE connection — the event is lost. Reloading the page forces a fresh SSR fetch that picks up the already-recomputed server state. This is reliable in both memory and Postgres backends.

---

### 2.5. i18n: String Templates Instead of Functions

`holdings.entries` in `AppDictionary` was changed from a function signature `(count: number) => string` to a string template:

```ts
// Before:
holdings: { entries: (count: number) => string; }

// After:
holdings: { entries: string; }  // e.g., "{count} positions"
```

Usage: `dict.holdings.entries.replace("{count}", String(n))`

**Why:** React Server Components serialize `dict` as a prop passed across the server/client boundary. Functions are not serializable — passing a function in an RSC prop causes a runtime error. The `mutations` section in `AppDictionary` also uses string templates with `{placeholder}` syntax for the same reason:

```ts
deleteImpactDetail: "{cashEntries} cash entries and {lotAllocations} lot allocations will be recalculated"
deleteNegativeLotsWarning: "...negative position of {quantity} for {symbol}..."
```

All placeholders are substituted at render time using `.replace()`.

---

### 2.6. `getAuthHeaders` Made Async for Server-Side Cookie Reading

`lib/api.ts` — `getAuthHeaders()` was synchronous. It needed to become `async` to support reading the `tw_e2e_user` cookie via `next/headers` on the server side:

```ts
async function getRuntimeDevUserId(): Promise<string> {
  // Client-side: read from document.cookie
  if (typeof document !== "undefined") {
    // ... document.cookie parsing
  }

  // Server-side (RSC/SSR): read from next/headers cookies()
  try {
    const { cookies } = require("next/headers") as typeof import("next/headers");
    const cookieStore = await cookies();
    const e2eRaw = cookieStore.get("tw_e2e_user")?.value;
    if (e2eRaw?.trim()) return decodeURIComponent(e2eRaw.trim());
  } catch {
    // next/headers not available outside of RSC render — ignore
  }

  return "";
}
```

All callers of `getJson`, `postJson`, `patchJson`, `putJson`, `deleteJson` already `await getAuthHeaders()` — the change is transparent to consumers. The `require("next/headers")` pattern (dynamic require vs static import) prevents a build error in environments where `next/headers` is not available (e.g., Edge Runtime).

---

## 3. API Contract

### DELETE `/portfolio/transactions/:tradeEventId`
- Response: `202 { accountId, symbol, deletedTradeEventId, deletedChildRows: { cashLedgerEntries, lotAllocations } }`
- Side effect: fires `scheduleReplayWithRetry` in `setImmediate` (async, response returns first)

### PATCH `/portfolio/transactions/:tradeEventId`
- Body: `{ date?, quantity?, price?, side?, confirmFeeRecalculation?, keepManualFees? }`
- Happy path: `202 { accountId, symbol, updatedTradeEventId, changedFields }`
- Fee confirmation gate: `200 { requiresFeeConfirmation: true, tradeEventId }` — frontend must re-submit with one of the two fee flags

### GET `/portfolio/transactions/:tradeEventId/preview-impact`
- Query params: `action=delete|patch`, plus optional `quantity`, `price`, `side`, `date`
- Side-effect free — does not modify any data
- Response: `{ affectedRows: { cashLedgerEntries, lotAllocations, feePolicySnapshots }, negativeLots: { wouldOccur, resultingQuantity, symbol } }`

The frontend calls `previewImpact` twice in the delete flow: once on `startDelete` (to populate the dialog) and does NOT call it again on `confirmDelete`. The delete confirmation uses the cached preview from `deletePreview` state.

---

## 4. Bugs Found and Fixed

### Bug 1 — SSE Race Condition (EventSource Opens Too Late)

**Symptom:** E2E tests occasionally showed the mutation toast but holdings never updated — the `recompute_complete` SSE event was silently dropped.

**Root cause:** The design had `enabled: recomputingSymbols.size > 0`. When a mutation completes (202 response), the code sets `recomputingSymbols` and the next render enables SSE. But `useEffect` for the new EventSource runs after the render — at which point the in-memory backend has already published and discarded the event.

**Fix:** `enabled: true` (always-on). The EventSource is open before any mutation fires.

**Residual:** In E2E tests the memory backend still completes recompute before the browser's EventSource processes the event even with always-on SSE. The `reloadAfterMutation` pattern handles this (§2.4). In production with Postgres + Redis pub/sub, SSE delivery is delayed enough that the EventSource is reliably connected before the event arrives.

---

### Bug 2 — Timeout Handler Missing `refreshRef.current()`

**Symptom:** After a 30s timeout, the skeleton cleared and the timeout message appeared, but the table still showed stale data (the trade that was deleted/edited was still visible or showed old values).

**Root cause:** The timeout handler called `clearAllRecomputing()` and `setMessage(...)` but did not call `refresh()`. The in-flight recompute may have completed successfully on the server — the timeout only means the SSE event wasn't received. Without a refresh, the client never picks up the server state.

**Fix:** Added `void refreshRef.current()` in the timeout handler:

```ts
const timer = setTimeout(() => {
  clearAllRecomputing();
  setMessage(dictRef.current.mutations.recomputeTimeoutMessage);
  void refreshRef.current();   // ← added
}, TIMEOUT_MS);
```

---

### Bug 3 — `networkidle` Incompatible with SSE Connections

**Symptom:** E2E test `gotoSymbol` helper hung indefinitely on symbol pages.

**Root cause:** `useEventStream` opens an `EventSource` to `/events/stream`. Playwright's `networkidle` waits until there are no network requests for 500ms — but an SSE connection is a persistent open request that never closes naturally. `waitUntil: "networkidle"` on `page.goto` or `page.waitForLoadState("networkidle")` never resolves on pages with active SSE.

**Fix:** Replaced `networkidle` with the soft-wait pattern: `page.waitForLoadState("load", { timeout: 5000 }).catch(() => {})`. The `gotoSymbol` helper waits for `symbol-history-section` visibility instead.

---

### Bug 4 — `holdings.entries` Function Not Serializable Across RSC Boundary

**Symptom:** TypeScript compilation error: "Functions are not allowed as RSC props".

**Root cause:** `AppDictionary.holdings.entries` was typed as `(count: number) => string`. The `AppShell` passes `dict` (which includes `holdings.entries`) to child components, some of which are client components. Serializing a function across the RSC/client boundary is not allowed.

**Fix:** Changed type to `string` (a template with `{count}` placeholder). All call sites updated to `dict.holdings.entries.replace("{count}", String(n))`.

---

## 5. E2E Test Strategy

### Test file: `apps/web/tests/e2e/specs/transaction-mutations.spec.ts`

- **Mode:** `dev_bypass`, in-memory backend (standard `specs/` suite)
- **Per-test isolation:** Each test uses `e2eUserId` from the `tw_e2e_user` cookie set per-test by the `test.ts` fixture. API seed calls pass `x-user-id: userId` so each test operates on a clean user namespace.

### File-local helpers

**`seedTrade(request, userId, overrides?)`**
Direct API call to `POST /portfolio/transactions` with a `x-user-id` header and auto-generated idempotency key. Not promoted to `flows.ts` — too mutation-specific to be reusable across the test suite.

**`gotoSymbol(page, symbol?)`**
- Navigates with `waitUntil: "domcontentloaded"`
- Waits for `data-testid="symbol-history-section"` to be visible (20s timeout)
- Soft-wait for hydration: `waitForLoadState("load", { timeout: 5000 }).catch(() => {})`
- Does **not** call `waitForAppReady` (no `app-shell-ready` marker on the symbol page)

**`reloadAfterMutation(page)`**
- Waits for `load` state (soft), reloads with `domcontentloaded`, then waits for `symbol-history-section`
- Used after every mutation to pick up server-recomputed state (memory backend recompute is synchronous with the request)

### 8 Tests

| Test | Key assertions |
|---|---|
| Delete flow: dialog → confirm → toast → table refresh | Dialog with summary, no negative lots warning, 202 response, 2 rows remain after reload |
| Edit flow: change quantity → save → toast → table refresh | PATCH response, quantity 200 visible after reload |
| Edit cancel does not persist changes | Editable row hidden after cancel, original quantity still shown |
| Negative lots warning appears when deleting a BUY consumed by sells | `delete-negative-lots-warning` visible in dialog |
| BUY→SELL side flip via edit | `SELL` visible in row after reload |
| Weighted-average cost correctness after delete | Holdings table shows 200 qty, no longer shows 567 avg cost |
| Delete all trades shows empty state | `symbol-history-empty` testid visible after reload |
| Edit price change persists after recompute | Price 750 visible in row after reload |

### Selector conventions

All selectors use `data-testid` attributes:
- `transaction-row` — each static transaction row (desktop table)
- `delete-transaction-button`, `edit-transaction-button` — action buttons per row
- `delete-confirmation-dialog`, `delete-trade-summary`, `delete-impact-counts`, `delete-negative-lots-warning`, `delete-confirm-button`
- `editable-transaction-row` — desktop edit-mode row
- `edit-quantity-input`, `edit-price-input`, `edit-side-select`, `edit-save-button`
- `mutation-status`, `mutation-error` — inline status banners
- `symbol-history-section`, `symbol-history-empty`
- `holdings-table`, `dashboard-holdings-section`

---

## 6. Infrastructure Changes in `lib/api.ts`

### `getAuthHeaders()` made async

Previously synchronous. Now returns `Promise<Record<string, string>>`. All callers (`getJson`, `postJson`, etc.) already awaited it — the change is backward compatible at the call site.

The `getRuntimeDevUserId()` function branches on environment:
- **Browser**: reads `tw_e2e_user` from `document.cookie` (synchronous path wrapped in async)
- **Server (RSC/SSR)**: dynamically requires `next/headers` and awaits `cookies()`. Uses `require()` (not `import`) to avoid a build failure in environments where `next/headers` is unavailable (Edge Runtime, non-Next.js contexts).

### E2E per-test isolation via `tw_e2e_user`

The `tw_e2e_user` cookie (set by the test fixture) propagates through the full request path:
1. Browser: `getAuthHeaders()` reads it from `document.cookie` → `x-user-id` header
2. Server (SSR page fetch): `getAuthHeaders()` reads it via `next/headers` → `x-user-id` header
3. Fastify API: `resolveUserId` picks up `x-user-id` in dev_bypass mode

This ensures that even server-rendered fetches (the RSC `page.tsx` fetching `transactions` on initial load) use the test user's data.
