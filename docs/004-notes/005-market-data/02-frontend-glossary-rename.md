---
step: 2 of 5
commit_name: "1b: Frontend glossary rename + route migration"
depends_on: 01-backend-glossary-rename.md
ticket: KZO-82
---

# Step 02 — Frontend glossary rename + route migration

**Depends on:** Step 01 (backend types and shared DTOs must be renamed first)

## 2.1 — Route directory rename

- [x] Rename `apps/web/app/symbols/[symbol]/` → `apps/web/app/tickers/[ticker]/`
- [x] Update `page.tsx` — `params.symbol` → `params.ticker`
- [x] Update `SymbolHistoryClient.tsx` — prop/param references

## 2.2 — Legacy route redirect

- [x] Create `apps/web/app/symbols/[symbol]/page.tsx` as a server-side redirect:
  ```tsx
  import { redirect } from "next/navigation";
  export default async function LegacySymbolRedirect({
    params,
    searchParams,
  }: {
    params: Promise<{ symbol: string }>;
    searchParams: Promise<Record<string, string>>;
  }) {
    const [{ symbol }, query] = await Promise.all([params, searchParams]);
    const qs = new URLSearchParams(query).toString();
    redirect(`/tickers/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ""}`);
  }
  ```
- [x] Verify redirect preserves query parameters

## 2.3 — Component link updates

- [x] `HoldingsTable.tsx` line ~194: `/symbols/${...}` → `/tickers/${...}`
- [x] `AppShell.tsx` line ~224: `/symbols/${...}` → `/tickers/${...}`
- [x] `RecentTransactionsCard.tsx` lines ~63, ~92: `/symbols/${...}` → `/tickers/${...}`
- [x] All other components linking to the ticker detail page

## 2.4 — Web app field renames

- [x] `apps/web/features/portfolio/services/portfolioService.ts` — `.symbol` → `.ticker`, `.sourceType` → `.source`
- [x] `apps/web/features/portfolio/hooks/useTransactionMutations.ts` — field references (~12 sites)
- [x] `apps/web/features/settings/services/settingsDraft.ts` — field references
- [x] `apps/web/features/settings/mappers/settingsMappers.ts` — field references
- [x] `apps/web/features/settings/validators/settingsValidation.ts` — field references
- [x] `apps/web/features/settings/components/SecurityBindingsSection.tsx` — field references
- [x] `apps/web/features/settings/hooks/useSettingsForm.ts` — field references
- [x] `apps/web/features/dashboard/types.ts` — field references
- [x] `apps/web/components/portfolio/TransactionHistoryTable.tsx` — field references
- [x] `apps/web/components/portfolio/HoldingsTable.tsx` — field references
- [x] `apps/web/components/portfolio/AddTransactionCard.tsx` — field references
- [x] `apps/web/components/portfolio/DeleteConfirmationDialog.tsx` — field references
- [x] `apps/web/components/portfolio/EditConfirmationDialog.tsx` — field references
- [x] `apps/web/components/portfolio/types.ts` — field references
- [x] `apps/web/components/layout/AppShell.tsx` — field references
- [x] `apps/web/components/layout/TopBar.tsx` — field references
- [x] `apps/web/components/dashboard/AllocationSnapshotCard.tsx` — field references
- [x] `apps/web/components/dashboard/RecentTransactionsCard.tsx` — field references
- [x] `apps/web/components/dashboard/DividendsSection.tsx` — field references
- [x] `apps/web/components/dashboard/QuickTransactionSection.tsx` — field references

## 2.5 — i18n labels

> **Decision needed (NH-1):** user-facing labels ("Symbol" vs "Ticker") are a copy decision. Does NOT block implementation. For now, keep existing English labels as-is. zh-TW already uses correct terms. Note this for a follow-up copy review.

- [x] `apps/web/features/portfolio/i18n.ts` — update any code-level `symbol` keys if needed (user-facing strings can stay)
- [x] `apps/web/features/dashboard/i18n.ts` — same
- [x] `apps/web/features/settings/i18n.ts` — same

## 2.6 — Frontend tests

- [x] `apps/web/test/hooks/useEventStream.test.ts` — `.symbol` → `.ticker` (~15 sites)
- [x] `apps/web/test/features/portfolio/hooks/useTransactionMutations.test.ts` — field renames
- [x] `apps/web/test/features/dashboard/types.test.ts` — field renames
- [x] `apps/web/test/features/dashboard/components.test.tsx` — field renames + `href="/symbols/2330"` → `href="/tickers/2330"`
- [x] `apps/web/test/features/settings/services/settingsDraft.test.ts` — field renames
- [x] `apps/web/test/features/settings/validators/settingsValidation.test.ts` — field renames
- [x] `apps/web/test/features/settings/mappers/settingsMappers.test.ts` — field renames

## 2.7 — E2E tests

- [x] `apps/web/tests/e2e/specs/transaction-mutations.spec.ts` line ~47: `/symbols/${symbol}` → `/tickers/${ticker}`
- [x] `apps/web/tests/e2e/specs-oauth/demo-symbol-history.spec.ts` lines ~11, ~54: `/symbols/2330` → `/tickers/2330`
- [x] `apps/web/tests/e2e/specs/shell-navigation.spec.ts` — any `/symbols/` references
- [x] All other E2E specs referencing `/symbols/` paths or `.symbol` field assertions

## 2.8 — Verify (full suite + Playwright MCP)

- [x] `npx eslint .` passes
- [x] `npm run typecheck` passes
- [x] `npm run test --prefix apps/web` passes
- [x] `npm run test:integration:full:host` passes
- [x] `npm run test:e2e:bypass:mem --prefix apps/web` passes
- [x] `npm run test:e2e:oauth:mem --prefix apps/web` passes
- [x] **Playwright MCP — demo session:**
  - Navigate to app root as demo user
  - Verify dashboard loads — holdings table shows tickers (not "symbol" column headers in data)
  - Click a holding row → verify navigates to `/tickers/{ticker}` (not `/symbols/`)
  - Verify ticker detail page loads with history
- [x] **Playwright MCP — dev_bypass session:**
  - Navigate to app root as dev_bypass user
  - Open "Add Transaction" form → verify the ticker input field works
  - Submit a transaction → verify the transaction appears in history with correct ticker
  - Navigate to `/tickers/2330` → verify page loads
  - Navigate to legacy `/symbols/2330` → verify redirect to `/tickers/2330`
  - Check dividend section on dashboard → verify tickers display correctly
