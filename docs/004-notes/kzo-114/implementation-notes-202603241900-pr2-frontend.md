---
slug: kzo-114-pr2
type: implementation-notes
created: 2026-03-24T19:00:00
tickets: [KZO-114]
wave: 2
pr: 2
status: merged
---

# Implementation Notes: KZO-114 PR 2 — Frontend Transaction Mutations

> **Frozen snapshot.** Records what was built and why. Do not update after merge.
>
> Related artifacts:
> - Scope todo: `docs/004-notes/kzo-114/scope-todo-202603241600-transaction-mutations.md`
> - Technical design: `.worklog/team/technical-design-pr2.md`
> - PR1 notes: `docs/004-notes/kzo-114/implementation-notes-202603241800-pr1-backend-infrastructure.md`

---

## 1. What Was Built

PR 2 delivers the complete frontend for transaction mutations, wiring the PR 1 backend (DELETE, PATCH, preview-impact routes) to a new interactive table UI with inline edit, delete confirmation, fee recalculation confirmation, SSE event handling, and E2E tests.

### 1a. Shared Types (`libs/shared-types/src/index.ts`)

**`feesSource` field added to `TransactionHistoryItemDto`:**

```ts
feesSource: "CALCULATED" | "MANUAL";
```

Required to drive the fee recalculation confirmation dialog in the frontend. The `fees_source` column was added in PR 1's migration `016` but not yet surfaced in the DTO.

**Four new response types added:**

| Type | Used by |
|---|---|
| `PreviewImpactResponse` | `DeleteConfirmationDialog` (displays impact counts + negative lots warning) |
| `DeleteTransactionResponse` | `useTransactionMutations.confirmDelete` (202 response body) |
| `PatchTransactionResponse` | `useTransactionMutations.submitEdit` (202 response body) |
| `PatchFeeConfirmationResponse` | `useTransactionMutations.submitEdit` (200 confirmation gate) |

---

### 1b. Backend DTO Fix (`apps/api/src/routes/registerRoutes.ts`)

One-line change in the `GET /portfolio/transactions` handler: maps `feesSource` from the stored `BookedTradeEvent` into the `TransactionHistoryItemDto`. Without this, the frontend fee recalculation prompt would never fire for `MANUAL` fee trades.

---

### 1c. `useEventStream` Extension (`apps/web/hooks/useEventStream.ts`)

**Backward-compatible multi-event support:**

```ts
interface UseEventStreamOptions {
  /** @deprecated Use eventTypes instead */
  eventType?: string;
  /** Array of SSE event types to listen for */
  eventTypes?: string[];
  onEvent: (data: unknown) => void;
  onReconnect?: (gap: { lastReceivedId: number; currentId: number }) => void;
  onError?: (error: Event) => void;
  enabled?: boolean;
}
```

- Resolves effective types: `const types = eventTypes ?? (eventType ? [eventType] : [])`
- Registers one `addEventListener` per type, all sharing the same `lastEventIdRef`
- Stabilized dependency array: uses `JSON.stringify(types)` as effect key to prevent reconnection on every render
- Existing consumers (`AppShell`) continue working with `eventType` — no changes needed at call sites

---

### 1d. Service Layer (`apps/web/features/portfolio/services/transactionMutationService.ts`)

New file. Three async functions wrapping API calls via `lib/api.ts`:

| Function | Method | Path |
|---|---|---|
| `previewImpact(tradeEventId, action, params?)` | `GET` | `/portfolio/transactions/:id/preview-impact?action=...` |
| `deleteTransaction(tradeEventId)` | `DELETE` | `/portfolio/transactions/:id` |
| `patchTransaction(tradeEventId, patch)` | `PATCH` | `/portfolio/transactions/:id` |

`patchTransaction` returns `PatchTransactionResponse | PatchFeeConfirmationResponse` — the union covers both the `202` happy path and the `200 { requiresFeeConfirmation: true }` gate.

---

### 1e. `useTransactionMutations` Hook (`apps/web/features/portfolio/hooks/useTransactionMutations.ts`)

Central hook managing all mutation state and SSE integration. Exported interface matches the technical design exactly:

**Delete flow:** `startDelete` → fetches preview via `previewImpact` → opens dialog → `confirmDelete` → calls `deleteTransaction` → adds to `recomputingIds`/`recomputingSymbols`

**Edit flow:** `startEdit` → `submitEdit` → calls `previewImpact` → if `requiresFeeConfirmation` → opens `FeeRecalcConfirmDialog` → `confirmFeeRecalc` or `keepManualFees` re-submits with flag

**SSE integration:** `useEventStream` with `eventTypes: ["recompute_complete", "recompute_failed"]`, enabled only when `recomputingSymbols.size > 0`.

**`recompute_complete` handler:**
- Clears `recomputingIds` for all transactions of the matching `accountId:symbol`
- Calls `refresh()` to trigger Next.js router refresh
- Sets `message` with localized summary

**`recompute_failed` handler:**
- `retriesExhausted: false` → sets warning message, keeps skeleton active
- `retriesExhausted: true` → clears skeleton, sets error message with retry guidance

**Timeout guard:**
```ts
const TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_RECOMPUTE_TIMEOUT_MS || "30000", 10);
```
When `recomputingSymbols.size > 0` for longer than `TIMEOUT_MS`, clears all recomputing state and sets a timeout warning message.

**Disable guard:** `startDelete` and `startEdit` both check if the target transaction's `accountId:symbol` is in `recomputingSymbols` and early-return if so, preventing mutations during active recompute.

---

### 1f. Dialog Components (3 new files)

**`DeleteConfirmationDialog`** (`apps/web/components/portfolio/DeleteConfirmationDialog.tsx`)

Radix `@radix-ui/react-dialog` modal. Content:
1. Trade summary card: date, symbol, TypePill (BUY/SELL), quantity, price
2. Conditional negative lots warning: rose alert box with AlertTriangle icon, appears when `preview?.negativeLots.wouldOccur`
3. Downstream impact counts: "N cash entries, N lot allocations will be recalculated"
4. Actions: rose-styled "Delete Transaction" confirm + secondary Cancel

z-index follows established pattern from `IntegrityIssueDialog`: overlay `z-[70]`, content `z-[71]`.

**`EditableTransactionRow`** (`apps/web/components/portfolio/EditableTransactionRow.tsx`)

Client component managing 6 row states: `viewing | editing | validating | submitting | recompute-pending | recompute-complete`.

Editable fields: date (`<input type="date">`), quantity (`<input type="number">`), price (`<input type="number">`), side (`<select>` BUY/SELL). UI hint below fields:
```
"To change symbol or account, delete and re-create the transaction"
```
Styled `text-xs text-slate-400 italic mt-1`. Save/Cancel buttons at row end (desktop) or bottom of card (mobile).

**`FeeRecalcConfirmDialog`** (`apps/web/components/portfolio/FeeRecalcConfirmDialog.tsx`)

Two-action Radix dialog with AlertTriangle icon. Presents when `fees_source = MANUAL` and quantity/price changed:
- **Recalculate Fees** — re-submits with `confirmFeeRecalculation: true` (uses bound fee profile)
- **Keep Manual Fees** — re-submits with `keepManualFees: true` (preserves existing values)

---

### 1g. `TransactionHistoryTable` (`apps/web/components/portfolio/TransactionHistoryTable.tsx`)

Added `"use client"` directive. New optional props:

```ts
onDeleteRequest?: (transaction: TransactionHistoryItemDto) => void;
editingId?: string | null;
onEditStart?: (id: string) => void;
onEditCancel?: () => void;
onEditSave?: (transactionId: string, patch: TransactionPatch) => Promise<void>;
recomputingIds?: Set<string>;
```

When mutation props are provided:
- 11th "Actions" column appears with Pencil + Trash2 icon buttons (Lucide, `h-8 w-8` ghost)
- Rows with `recomputingIds?.has(transaction.id)` show `animate-pulse opacity-40` skeleton overlay
- Rows with `editingId === transaction.id` delegate to `<EditableTransactionRow>`
- Mobile card view: action buttons at card bottom, `EditableTransactionRow` renders as stacked card form

Mutation props are optional — the table remains usable as a pure presentational component if no callbacks are provided.

---

### 1h. `SymbolHistoryClient` (`apps/web/app/symbols/[symbol]/SymbolHistoryClient.tsx`)

New `"use client"` wrapper that bridges the server component `page.tsx` to the mutation hooks.

- Instantiates `useTransactionMutations` with `refresh: async () => { router.refresh() }`
- Renders `TransactionHistoryTable` with mutation callbacks wired
- Renders `DeleteConfirmationDialog` and `FeeRecalcConfirmDialog`
- Renders inline mutation status / error banners (`data-testid="mutation-status"` and `data-testid="mutation-error"`)

The server page passes `transactions`, `dict`, `locale` as serialized props. No SSR changes — client rendering of mutation UI only begins after hydration.

---

### 1i. `AppShell` (`apps/web/components/layout/AppShell.tsx`)

- Calls `useTransactionMutations` with `refresh: refreshAfterTransaction`
- Adds mutation status banner in the main content area (between existing status banners)
- Passes `mutations.recomputingSymbols` to `HoldingsTable` for scoped skeleton rendering

Primary delete/edit interaction surface is the symbol history page (`/symbols/[symbol]`). `AppShell` integration provides:
- Global SSE subscription for `recompute_complete` / `recompute_failed` events
- Mutation status/error banners visible from any view
- Skeleton prop passed to `HoldingsTable` so the holdings row dims during recompute

---

### 1j. `HoldingsTable` (`apps/web/components/portfolio/HoldingsTable.tsx`)

Accepts optional `recomputingSymbols: Set<string>` prop. When a holding's `${accountId}:${symbol}` is in the set, overlays the row with `animate-pulse opacity-40` to indicate an active recompute.

---

### 1k. i18n (`apps/web/features/dashboard/i18n.ts`, `apps/web/lib/i18n/types.ts`)

`AppDictionary` extended with a `mutations` section (22 keys):

| Key group | Keys |
|---|---|
| Delete dialog | `deleteTitle`, `deleteConfirmButton`, `deleteSummaryLabel`, `deleteImpactLabel`, `deleteImpactDetail`, `deleteNegativeLotsWarning`, `deleteSuccessMessage` |
| Edit in-row | `editSaveButton`, `editCancelButton`, `editSymbolAccountHint`, `editSuccessMessage` |
| Fee dialog | `feeRecalcTitle`, `feeRecalcDescription`, `feeRecalcButton`, `feeKeepManualButton` |
| SSE feedback | `recomputeCompleteMessage`, `recomputeRetryMessage`, `recomputeExhaustedMessage`, `recomputeTimeoutMessage` |
| Table | `actionsColumnLabel`, `editTooltip`, `deleteTooltip` |

Both `en` and `zh-TW` locales implemented in `dashboardI18n`.

---

### 1l. E2E Tests (`apps/web/tests/e2e/specs/transaction-mutations.spec.ts`)

New file. 8 tests using per-test E2E user isolation from `fixtures/test.ts`.

Helper functions defined at test-file level (not promoted to `flows.ts` — too mutation-specific):
- `seedTrade(request, userId, overrides?)` — seeds a trade via direct API call with idempotency key
- `gotoSymbol(page, symbol?)` — navigates to symbol history page and waits for hydration

| Test | Scenario |
|---|---|
| Delete flow (happy path) | Seed 3 trades, delete middle, verify toast + recompute + holdings refresh |
| Edit flow (happy path) | Seed 1 trade, edit quantity, verify toast + recompute + updated value |
| Negative lots warning | Seed BUY+SELL, try delete BUY → verify warning in dialog |
| BUY→SELL side flip | Edit side, verify correct state based on lot availability |
| Weighted-average cost | Book known trades, delete one, verify displayed avg cost matches hand-calculated value |
| Fee recalculation dialog | Seed MANUAL fee trade, edit quantity → verify fee dialog appears |
| Disable during recompute | Trigger delete, verify edit/delete buttons are disabled during skeleton |
| Timeout warning | Uses `NEXT_PUBLIC_RECOMPUTE_TIMEOUT_MS` override for fast timeout test |

SSE waiting: DOM-based assertions throughout (`getByTestId("mutation-status")`, skeleton `animate-pulse` presence/absence). No `EventSource` API in tests.

---

## 2. Key Architectural Decisions

### 2.1. Symbol History Page: Client Wrapper Pattern

**Decision:** A new `SymbolHistoryClient.tsx` client component wraps the mutation hooks rather than converting the server page to a client component.

The `page.tsx` is a server component that fetches transactions server-side. Mutation hooks need browser state and router. Wrapping in a `"use client"` component allows:
- Server-side data fetching preserved (no regression on initial load)
- Client-side interactivity added via hydration
- Clean separation: server fetches data, client manages mutation state

This is the standard Next.js App Router pattern for interactive server-fetched data.

---

### 2.2. `TransactionHistoryTable` Optional Mutation Props

**Decision:** All mutation-related props on `TransactionHistoryTable` are optional. The component renders identically to its original state when no mutation callbacks are provided.

This preserves any existing usage of `TransactionHistoryTable` as a display-only component without requiring call site changes. The symbol history page uses it with mutation props; any future read-only usage continues to work.

---

### 2.3. `AppShell` vs `SymbolHistoryClient` SSE Scope

**Decision:** SSE subscription and banners live in `AppShell`, but the primary delete/edit interaction is in `SymbolHistoryClient`.

`AppShell` provides one global SSE connection per session — enabling `HoldingsTable` skeleton updates and status banners visible from any route. `SymbolHistoryClient` provides per-page mutation callbacks and local status banners for the symbol history context. Both are wired to the same `useTransactionMutations` hook pattern but with different refresh targets.

---

### 2.4. Fixer Findings (4 Fixed in Iteration 1)

**Finding 1 — SSE race condition:** `useTransactionMutations` initially disabled the SSE connection immediately when `confirmDelete` / `submitEdit` returned, before the server had published the `recompute_complete` event. The `enabled` guard based on `recomputingSymbols.size > 0` needed to remain active for the full duration of the recompute, not just until the 202 response.

**Fix:** The `recomputingSymbols` set is only cleared on `recompute_complete` event receipt or timeout — not on 202 response. SSE stays enabled until the event arrives.

**Finding 2 — Timeout missing `refresh()`:** The timeout handler cleared recomputing state and set a message but did not call `refresh()`. After a timeout, the user's holdings/transactions would be stale until they manually refreshed.

**Fix:** Added `refresh()` call in the timeout handler alongside the state clear.

**Findings 3–4** (minor): Type-narrowing fix in `onEvent` handler for the `RecomputeCompleteEvent` / `RecomputeFailedEvent` union; a `data-testid` attribute missing on the symbol history section (required by `gotoSymbol` helper).

---

## 3. Files Changed (19 Total)

### New Files (7)

| File | Purpose |
|---|---|
| `apps/web/app/symbols/[symbol]/SymbolHistoryClient.tsx` | Client wrapper for symbol history page, mutation context |
| `apps/web/components/portfolio/DeleteConfirmationDialog.tsx` | Radix dialog: preview impact + negative lots warning |
| `apps/web/components/portfolio/EditableTransactionRow.tsx` | 6-state per-row edit component |
| `apps/web/components/portfolio/FeeRecalcConfirmDialog.tsx` | Radix dialog: fee recalculation prompt |
| `apps/web/features/portfolio/hooks/useTransactionMutations.ts` | Central mutation hook: delete/edit state + SSE |
| `apps/web/features/portfolio/services/transactionMutationService.ts` | API wrappers: previewImpact, deleteTransaction, patchTransaction |
| `apps/web/tests/e2e/specs/transaction-mutations.spec.ts` | E2E: 8 tests covering delete, edit, edge cases |

### Modified Files (12)

| File | Change |
|---|---|
| `apps/api/src/routes/registerRoutes.ts` | Map `feesSource` into `TransactionHistoryItemDto` in GET /portfolio/transactions |
| `apps/web/app/symbols/[symbol]/page.tsx` | Delegate to `SymbolHistoryClient` |
| `apps/web/components/layout/AppShell.tsx` | Wire `useTransactionMutations`, mutation banners, pass `recomputingSymbols` to `HoldingsTable` |
| `apps/web/components/portfolio/HoldingsTable.tsx` | Accept `recomputingSymbols` prop, render skeleton overlay |
| `apps/web/components/portfolio/TransactionHistoryTable.tsx` | `"use client"`, action buttons, `EditableTransactionRow` integration |
| `apps/web/features/dashboard/i18n.ts` | Add `mutations` section (22 keys) in `en` and `zh-TW` |
| `apps/web/features/portfolio/i18n.ts` | Supporting i18n changes |
| `apps/web/hooks/useEventStream.ts` | Multi-event support (`eventTypes: string[]`), backward compat, stabilize deps |
| `apps/web/lib/api.ts` | Supporting API client changes |
| `apps/web/lib/i18n/types.ts` | Extend `AppDictionary` with `mutations` section |
| `apps/web/test/features/dashboard/components.test.tsx` | Update unit tests for `AppDictionary` type changes |
| `libs/shared-types/src/index.ts` | `feesSource` on DTO + 4 new response types |

---

## 4. Convergence History

**1 iteration — converged on first pass.**

| Finding | Type | Fix |
|---|---|---|
| SSE race: connection disabled before recompute_complete arrived | Bug | `enabled` guard stays true until event received or timeout |
| Timeout handler missing `refresh()` call | Bug | Added `refresh()` in timeout handler |
| Type-narrowing in `onEvent` for SSE union type | Type error | Explicit type guard on `event.type` |
| `data-testid="symbol-history-section"` missing | E2E selector | Added testid to symbol history section render |

---

## 5. Open Questions at Merge Time

1. **`HoldingsTable` skeleton — global vs scoped:** `AppShell` passes `recomputingSymbols` to `HoldingsTable`, but the symbol history page's `SymbolHistoryClient` does not share this set with `AppShell`. If a user triggers a mutation on the symbol page and then navigates to the dashboard, the holdings skeleton may not appear. Future work could lift mutation state to a React context shared across both surfaces.

2. **`trade_fee_policy_snapshots` orphan cleanup:** Inherited from PR 1. Orphaned snapshot rows accumulate when trades are deleted. No cleanup in PR 2. Low urgency.

3. **EventSource connection count:** `useTransactionMutations` opens an SSE connection in addition to any existing dashboard SSE connection. The server allows 5 connections per user — currently safe. Long-term, a shared SSE connection via React context would reduce resource use.

4. **Mobile inline edit UX:** 4 stacked input fields in the card view may need iteration based on real-device testing. The current implementation is functional but untested on small-screen physical devices.
