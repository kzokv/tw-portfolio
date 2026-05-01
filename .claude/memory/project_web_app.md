---
name: web app structure and patterns
description: Next.js frontend architecture, feature modules, component organization, and service layer patterns
type: reference
---

## Framework
Next.js 16.1 with App Router, React 18.3, TypeScript strict, Tailwind CSS 3.4, Radix UI.

## App Router Pages (`apps/web/app/`)
- `/` — `redirect("/dashboard")` (server-side redirect, see `app/page.tsx`)
- `/dashboard` — Dashboard home
- `/portfolio` — Portfolio page
- `/transactions` — Transactions page
- `/tickers/[ticker]` — Ticker detail page
- `/sharing` — Outbound share grants UI (KZO-145)
- `/admin/` — Admin portal (role=admin only, gated in `layout.tsx`)
  - `/admin/users` — User management (KZO-144)
  - `/admin/invites` — Invite management (KZO-144)
  - `/admin/audit-log` — Audit log viewer (KZO-144)
  - `/admin/settings` — App config settings (KZO-142)
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

### `profile/`
- `hooks/useProfile.ts` — fetches `GET /api/profile`, returns `{ profile: ProfileDto | null, isLoading, error, refresh }`
- Used by `AppShell` to supply profile data to `TopBar` (avatar) and `SettingsDrawer` (Profile tab)

### `settings/`
- `components/` — includes `ProfileSection.tsx` (avatar preview, read-only Google fields, editable email with PATCH save)
- `hooks/` (`useSettingsForm`, `useSettingsSave`)
- `services/` (`settingsService`, `commissionDiscount`, `settingsDraft`)
- `mappers/`, `validators/`, `types/` (`SettingsTab` includes `"profile"` | `"general"` | `"fees"`), `i18n.ts`

## Next.js API Proxy Routes (`apps/web/app/api/`)
- `profile/route.ts` — `GET` and `PATCH` handlers: validate session server-side, forward to API with trusted header

## Component Organization (`apps/web/components/`)
- `ui/` — Base components (Card, Button, TooltipInfo, etc.)
- `layout/` — AppShell (calls `useProfile()`, wires profile to TopBar + SettingsDrawer), TopBar, SideNavigation
- `dashboard/` — Dashboard-specific
- `portfolio/` — HoldingsTable, TransactionHistoryTable, etc.
- `profile/` — `UserAvatarButton` (renders Google picture or display-name initials; identity header in dropdown)
- `settings/` — Settings drawer (Profile tab renders outside form; General/Fees tabs use existing form flow)
- `admin/` — Admin portal components:
  - `AdminShell.tsx` — layout shell with `ADMIN_TITLES` map (must add entry for every new admin subpage)
  - `AdminSidebar.tsx` — nav items (`adminNavItems`); add entry for every new admin subpage
  - `AdminAuditLogClient.tsx` — audit log viewer with `ACTION_LABELS` + `ACTION_CATEGORIES`
  - `AdminSettingsClient.tsx` — app config settings (KZO-142); toggle + number input for `repairCooldownMinutes`

## Patterns
- API calls live in `features/*/services/` (not in components)
- Hooks encapsulate data fetching and state management
- i18n support with locale codes `en` | `zh-TW`
- API client in `lib/api.ts`

## Testing
- Unit tests: `apps/web/test/features/` (Vitest)
- E2E tests: `apps/web/tests/e2e/` (Playwright)
