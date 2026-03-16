---
name: web app structure and patterns
description: Next.js frontend architecture, feature modules, component organization, and service layer patterns
type: reference
---

## Framework
Next.js 16.1 with App Router, React 18.3, TypeScript strict, Tailwind CSS 3.4, Radix UI.

## App Router Pages (`apps/web/app/`)
- `/` — Dashboard home (`page.tsx`)
- `/portfolio` — Portfolio page
- `/transactions` — Transactions page
- `/symbols/[symbol]` — Symbol detail page
- `layout.tsx` — Root layout

## Feature Modules (`apps/web/features/`)

### `dashboard/`
- `components/` — dashboard-specific UI
- `hooks/` — `useDashboardData`, `useDashboardPerformance`
- `services/` — `dashboardService` (API calls)
- `types.ts`, `i18n.ts`

### `portfolio/`
- `hooks/` — `useTransactionSubmission`, `useRecentTransactions`, `useRecomputeAction`
- `services/` — `portfolioService` (trade submission, holdings fetch)
- `i18n.ts`

### `settings/`
- `components/`, `hooks/` (`useSettingsForm`, `useSettingsSave`)
- `services/` (`settingsService`, `commissionDiscount`, `settingsDraft`)
- `mappers/`, `validators/`, `types/`, `i18n.ts`

## Component Organization (`apps/web/components/`)
- `ui/` — Base components (Card, Button, TooltipInfo, etc.)
- `layout/` — AppShell, TopBar, SideNavigation
- `dashboard/` — Dashboard-specific
- `portfolio/` — HoldingsTable, TransactionHistoryTable, etc.
- `profile/` — User profile
- `settings/` — Settings drawer

## Patterns
- API calls live in `features/*/services/` (not in components)
- Hooks encapsulate data fetching and state management
- i18n support with locale codes `en` | `zh-TW`
- API client in `lib/api.ts`

## Testing
- Unit tests: `apps/web/test/features/` (Vitest)
- E2E tests: `apps/web/tests/e2e/` (Playwright)
