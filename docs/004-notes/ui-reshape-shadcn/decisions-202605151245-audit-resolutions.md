# Audit-driven decisions

**Frozen 2026-05-15.** Captures decisions taken after reviewing `audit-202605151230-current-ui.md`. Updates the locked design at `design-202605151200-locked-scope.md` for the listed items. Pre-merge corrections allowed; post-merge immutable.

## Decisions

| # | Topic | Decision | Affects |
|---|---|---|---|
| 1 | Dashboard hero | Collapse to **1 hero (portfolio total) + day Δ chip + reporting-currency badge**. Drop the 5-tile `RouteHeroPanel`. Movers strip below hero; integrity issues demoted to inline alert. | `/dashboard` |
| 2 | Add transaction | **`AddTransactionCard` becomes a Dialog.** `/transactions` header gets a `+ Add transaction` button that opens shadcn `Dialog` (mobile = `Sheet`). Form fields preserved. | `/transactions` |
| 3 | DividendsSection placement | **Keep on `/dashboard`, drop from `/portfolio`.** Portfolio page adds "View dividends →" link in hero subtitle. | `/dashboard`, `/portfolio` |
| 4 | NHI rollup | **Stay as conditional section in `/dividends`** rendered when user has NHI-applicable income. Sub-anchor `/dividends#nhi`. No sub-route. | `/dividends` |
| 5 | Recompute action | **Move to topbar overflow + per-ticker row action.** Global "Recompute all" lives in avatar menu and ⌘K. Per-ticker recompute moves into holdings-row action menu. Delete `RecomputeCard.tsx`. | `/transactions`, `/portfolio`, `/dashboard` |
| 6 | Public share theme | **Visitor theme toggle stays.** Small theme button next to "Powered by Vakwen" in `/share/[token]` strip. Persists per-device only. | `/share/[token]` |
| 7 | Admin visual distinction | **Sidebar accent rail.** Thin colored rail on sidebar's right edge in `--warning` hue + small "Admin" badge next to breadcrumb. Card backgrounds stay `--card` (revises design §8.8 — the `--secondary` tinted card variant is rejected). | All `/admin/*` |
| 8 | FloatingStatsBubble | **Keep.** Power-user affordance on `/tickers/[ticker]`. Modernize visuals (flat surface, token-driven) but preserve scroll-following behavior. | `/tickers/[ticker]` |
| 9 | Sidebar in admin mode | **Switch to admin-only nav** on `/admin/*`. Sidebar contents replace with `Back to app` + admin items. Accent rail (decision #7) reinforces. | All `/admin/*` |
| 10 | `/sharing` layout | **Three top-level Tabs:** `Outbound (n)` · `Inbound (n)` · `Anonymous links (n)`. URL state `?tab=outbound`. One table per tab. | `/sharing` |
| 11 | `/transactions` filters | **Type chips visible + "More filters" Sheet** for advanced (date range, account, ticker, amount range). Persistent filter state. | `/transactions` |
| 12 | `/admin/settings` layout | **Horizontal Tabs at top** (Display defaults, Provider keys, Rate limits, Sharing policy, etc.). URL state `?tab=`. Matches sibling admin pages. Revises design §8 — the prior "vertical settings nav" intent applies only to user-side `/settings`. | `/admin/settings` |

## Carry-over from earlier

These decisions were already locked in `design-202605151200-locked-scope.md` (recorded here for traceability):

- Light + Dark + System theme via `next-themes`, defaultTheme `system`, persisted per-device.
- 8 accent presets (Indigo default), persisted per-account via `user_preferences.themeAccent`.
- Density (compact default, comfortable optional), per-account via `user_preferences.density`.
- Sidebar block as primary nav; collapsible; ⌘K command palette in TopBar.
- `/dividends/review` merges into `/dividends` (`?status=needs-review`).
- Unified `AuthShell` for `/login`, `/auth/error`, `/invite/[code]`.
- Single-DOM `DataTable` replaces dual-DOM table+card pattern.
- shadcn `Sonner` replaces the 5-banner toast pile.
- Sortable cards preserved (load-bearing on `user_preferences.cardOrder.*`).

## What this unlocks

Decisions above are sufficient to generate mockups for every remaining route without further user input. Phase 0 + Phase 1 implementation can proceed against this combined record.
