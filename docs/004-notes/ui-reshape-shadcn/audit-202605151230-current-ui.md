# Current UI Audit (per-route)

**Captured 2026-05-15** from worktree `ui-reshape-shadcn`. Used to drive per-page reshape decisions. Pre-merge corrections only; post-merge immutable.

## How to read this

Each route gets four blocks: **Current behavior** · **Key files** · **UX observations** · **Recommendation**. Recommendations are opinionated; the user decides which to ship. Cross-references to the locked design at `design-202605151200-locked-scope.md` use §-numbers from that doc.

The shell is shared: every signed-in route except `/share/[token]`, `/login`, `/auth/error`, `/invite/[code]` mounts `components/layout/AppShell.tsx` (1458 LOC), so most route-specific concerns are actually concerns about which branch of `renderSection()` runs. That coupling itself is the single biggest finding; it shows up in every section below.

---

## Routes

### `/` — landing/redirect

**Current behavior.** Five-line server component that `redirect("/dashboard")`. No render path.

**Key files.**
- `apps/web/app/page.tsx`

**UX observations.** Nothing to audit. There is no marketing page; auth lives on `/login`. Per design §12 this is explicitly out of scope.

**Recommendation.** **Preserve as-is.** Do not introduce a marketing surface in this reshape.

---

### `/dashboard`

**Current behavior.** The "home" page. Server entry fetches `requireSession()` + profile, then mounts `<AppShell section="dashboard">`. AppShell internally calls `useDashboardData`, `useDashboardPerformance`, `useRecentTransactions` and renders, in this order: a `RouteHeroPanel` with five metric tiles (market value, concentration, unrealized P/L, daily change, open issues), then a `SortableCardGrid` whose canonical slugs are `portfolio-trend`, `allocation-snapshot`, `return-percent`, `holdings-table`, `dividends-section`, `action-center`. Card order is persisted per-user via `user_preferences.cardOrder.dashboard`. `IntegrityIssueDialog` opens on demand; `CustomizeRangesPopover` opens from the perf card. Status toasts (`global-error-banner`, `transaction-status`, `mutation-status`, `recompute-status`, `snapshot-status`) stack at the top of `<main>`. SSE drives recompute/snapshot state via `useEventStream` inside hooks.

**Key files.**
- `apps/web/app/dashboard/page.tsx`
- `apps/web/components/layout/AppShell.tsx:1217–1373` (the dashboard branch + `RouteHeroPanel`)
- `apps/web/components/dashboard/{PortfolioTrendCard,AllocationSnapshotCard,ReturnPercentCard,RecentTransactionsCard,DividendsSection,ActionCenterSection,SummarySection}.tsx`
- `apps/web/features/dashboard/{hooks,services}`

**UX observations.**
- `RouteHeroPanel` at `AppShell.tsx:1383–1413` is the visual ringleader of the retired aesthetic: `glass-panel`, `rounded-[34px]`, `bg-[linear-gradient(135deg,…)]`, `shadow-[0_30px_70px_rgba(79,70,229,0.12)]`, uppercase `tracking-[0.34em]` eyebrows. All five tiles repeat the same eyebrow/value/detail shape — a perfect candidate for one `StatCard` primitive.
- The hero crowds five metrics at the top before any chart. Per design §8.7 the goal is portfolio total + day Δ + biggest movers above the fold; "open issues" and "concentration" are secondary and could move into a compact action strip or the trend card subtitle.
- Five distinct stacked status banners (lines 763–846) — each with its own copy of the same gradient/shadow class string. They are mutually exclusive but render redundant chrome. Should consolidate to one `Sonner` toast region.
- `ActionCenterSection` and `QuickTransactionSection` exist but `QuickTransactionSection.tsx` is not wired here (it's dead code on this route — only `ActionCenterSection` renders as a card slug). Design §8.7 calls for collapsing both into a floating + or `Sheet`; the dead component should just be deleted.
- Recompute/snapshot mutation status is rendered as a `<p>` paragraph banner instead of a toast. Design wants `sonner` for transient feedback.
- Card drag handles use `shadow-sm` plus inline `glass-panel` — the affordance is OK on desktop but the drop target visually competes with the chart card. Density preference not honored anywhere on the dashboard.

**Recommendation.** Treat the dashboard as the **reference reshape**. Mockup already exists at `mockup-202605151210-dashboard.html`. Preserve the sortable-card system (it's load-bearing for `user_preferences.cardOrder`). Redesign the hero into a single tight summary row (total + day Δ + reporting currency badge), drop the 5-tile pile, hoist movers from `AllocationSnapshotCard` into a top-row strip, and demote integrity-issues to a small inline alert above the cards.
- PRESERVE: `SortableCardGrid` + the 6 canonical card slugs + per-user order persistence.
- REDESIGN: `RouteHeroPanel` → flat `Card` with one `<Money>` hero + day-Δ chip + reporting-currency switch.
- REDESIGN: status banners → one `Sonner` region (per design §7 Wave A).
- DROP: `QuickTransactionSection.tsx` (dead) and the 5-tile metric grid on this route.
- MERGE: integrate `ActionCenterSection`'s "Recompute / Generate snapshots" into a single ⌘K-discoverable action or `Sheet`-quick-action.

---

### `/portfolio`

**Current behavior.** Same `<AppShell section="portfolio">` mount. Renders `RouteHeroPanel` with four metrics (largest position, concentration, holding count, quote coverage), then a `SortableCardGrid` with two full-width cards: `HoldingsTable` (328 LOC) and `DividendsSection`. Holdings table has its own freshness badge, per-row recompute affordance, and links into `/tickers/[ticker]`.

**Key files.**
- `apps/web/app/portfolio/page.tsx`
- `apps/web/components/layout/AppShell.tsx:1003–1083` (portfolio branch)
- `apps/web/components/portfolio/HoldingsTable.tsx`

**UX observations.**
- Hero panel is structurally identical to the dashboard's — same gradient, same 4-tile pattern. The page is essentially "Dashboard minus the chart and allocation"; the rationale for a separate route is the holdings table being primary, but the hero never says so.
- `HoldingsTable` is the busiest table in the app. It does double-DOM responsive (table on `lg+`, card-grid below) which is exactly the pattern design §9 retires.
- `DividendsSection` appears on BOTH `/dashboard` and `/portfolio` reading the same `dashboard.dividends.{upcoming,recent}`. Identical data, identical UI. Justifiable on UX grounds (different mental models), but maintenance cost is real.
- The "freshness badge" and recompute affordances are crammed into row hover state — discoverability is low on touch.
- No filter/search on holdings yet; once holdings count grows past ~20 (entirely plausible) the table will need column-hiding + filter.

**Recommendation.** Merge intent visually with the dashboard while keeping the route. Make holdings the loudest element on this route — table fills above the fold, hero collapses to a one-line "Holdings · {n} positions · {coverage}% quoted" subtitle. Retire dual-DOM responsive per design §9; single `DataTable` with sticky first column and column-priority hiding.
- PRESERVE: per-row link to `/tickers/[ticker]`, freshness badge, recompute affordance.
- REDESIGN: hero → subtitle-only; holdings table → shadcn `DataTable`; recompute affordance → row action menu (`dropdown-menu`).
- REDESIGN: density-aware row height (`--row-h` token, design §6).
- DROP: the duplicated `DividendsSection` card (link to `/dividends` from the hero instead) — or keep it; explicit decision needed.
- ADD: a header-level filter input + "Show: All / TWD / USD / AUD" segmented filter for multi-currency portfolios.

---

### `/transactions`

**Current behavior.** `<AppShell section="transactions">` with hero (account count, holding count, open issues, quote coverage), then a `SortableCardGrid` with `AddTransactionCard`, `RecomputeCard`, `TransactionHistoryTable`. `AddTransactionCard.tsx` is 667 LOC and contains its own inline form, currency chips, ticker combobox, instrument-create deep-link to settings, and validation. Edit/delete dialogs (`EditConfirmationDialog`, `DeleteConfirmationDialog`, `FeeRecalcConfirmDialog`) open from row actions. SSE drives mutation status toasts.

**Key files.**
- `apps/web/app/transactions/page.tsx`
- `apps/web/components/layout/AppShell.tsx:1084–1207` (transactions branch)
- `apps/web/components/portfolio/{AddTransactionCard,TransactionHistoryTable,RecomputeCard,EditableTransactionRow,InstrumentCombobox}.tsx`

**UX observations.**
- `AddTransactionCard` is too much of a card. It's a full form (ticker combobox, market chip, qty/price/currency, fee profile, date, type, day-trade flag) that takes most of the viewport even when collapsed. On a route called `/transactions`, the **transactions table** should lead; the form should be a Dialog or `Sheet` triggered by a header `+ Add transaction` button (this is already a partial mockup intent — `mockup-202605151211-transactions.html`).
- `InstrumentCombobox` is 488 LOC of bespoke logic — should be replaced by shadcn `Combobox` recipe (design §7 Wave C). Today it's tab-and-arrow accessible but has its own debounce/keyboard handling that will conflict with the shadcn version's idioms.
- `RecomputeCard` (89 LOC) is a one-action card. Should not be a card; should be a row action or a topbar dropdown item.
- `EditableTransactionRow` mixes inline-edit affordances into table rows. The "edit-confirm vs fee-recalc-confirm" two-dialog handoff is jarring; combine into a single confirm with a summary block.
- Transaction history table has the same dual-DOM pattern as holdings.

**Recommendation.** Reshape into a table-first page with header-actions + dialog form.
- PRESERVE: account-scoped inline edits, SSE-driven mutation toasts, ticker → `/tickers/[ticker]` link.
- REDESIGN: `AddTransactionCard` → shadcn `Dialog` opened from a header `+ Add transaction` button. Same fields, modal layout.
- REDESIGN: `RecomputeCard` → topbar/ row-menu action.
- REDESIGN: `InstrumentCombobox` → shadcn `Combobox` (Wave C).
- REDESIGN: `EditableTransactionRow` → drop inline editing, open same Dialog in "edit" mode.
- REDESIGN: dual-DOM table → single `DataTable`.

---

### `/cash-ledger`

**Current behavior.** `<AppShell section="cash-ledger">` wraps `CashLedgerClient` (705 LOC). Renders a summary block (per-currency cash balances from `summary`), a filter bar (entry type chips, account dropdown, date range), a sortable paginated table of cash ledger entries (50/page), and a row-action `DropdownMenu` (`@radix-ui/react-dropdown-menu` directly imported — pre-dating any internal `DropdownMenu` primitive). `CashLedgerDrawer` opens for view/edit of a single entry. `RecordFxTransferDialog` for FX transfers, `ConfirmDialog` for reverse-FX confirmations.

**Key files.**
- `apps/web/app/cash-ledger/page.tsx`
- `apps/web/features/cash-ledger/components/CashLedgerClient.tsx`
- `apps/web/features/cash-ledger/components/CashLedgerDrawer.tsx`
- `apps/web/components/fx-transfer/RecordFxTransferDialog.tsx`

**UX observations.**
- Bespoke `SortHeader` component reinvented from scratch (`CashLedgerClient.tsx:42–67`). Same pattern recurs in `TransactionHistoryTable`, `HoldingsTable`, `OutboundSharesTable`, `AnonymousLinksTable`. Five copies of the same arrow-toggle logic.
- Filter bar uses a manual chip row instead of `Toggle` group / `select`. Inconsistent with how `/dividends/review` filters work (it uses a date-preset select + status select). Same surface, different idioms.
- The "TRADE_SETTLEMENT_IN/OUT / DIVIDEND_RECEIPT / FX_TRANSFER_*" entry-type chips are all-caps SCREAMING_SNAKE strings on the wire and the UI never humanizes them past first-letter capitalization. Bilingual-aware? No — these strings are never translated.
- Direct `@radix-ui/react-dropdown-menu` import bypasses the `components/ui/` shim layer. When the shadcn migration adapter ships (§7), this file needs to switch — but right now it's an inconsistent special case.
- `CashLedgerClient act() warnings` already flagged in `.claude/rules/cash-ledger-act-warnings-cosmetic.md` — known noise, not a UX issue.

**Recommendation.** Reshape onto shadcn `DataTable` with proper column-sort headers; collapse filter bar into a single header strip; humanize entry-type labels via i18n.
- PRESERVE: drawer for view/edit, FX transfer flow, per-currency summary card.
- REDESIGN: `SortHeader` → `DataTable` `SortableHeader` recipe (one source of truth for all 5 tables).
- REDESIGN: entry-type filter chips → shadcn `Tabs` or `ToggleGroup` with humanized labels.
- REDESIGN: direct radix `DropdownMenu` → shadcn `dropdown-menu` primitive.
- REDESIGN: summary block → density-aware compact card matching design §6.

---

### `/dividends`

**Current behavior.** `<AppShell section="dividends">` wraps `DividendCalendarClient` (472 LOC). Month-navigator at top (prev/this/next month with month label), a per-row calendar table grouped by payment date showing event + ledger entry per holding. Each row has a status badge (`unposted`, `pendingReview`, `posted`, `postedVariance`, `resolved`, `matched`, `explained`). Row action opens a `Drawer` with `DividendPostingForm` (820 LOC) for posting/reconciling.

**Key files.**
- `apps/web/app/dividends/page.tsx`
- `apps/web/components/dividends/DividendCalendarClient.tsx`
- `apps/web/components/dividends/DividendPostingForm.tsx`

**UX observations.**
- Status badges (`statusBadgeClassName`, `DividendReviewClient.tsx:79–94`) are duplicated across this client AND `DividendReviewClient`. Two color tables, two `cn(...)` strings, drift waiting to happen.
- "Calendar" view is a table grouped by date — it's not really a calendar, more a date-bucketed list. Could become a real `Calendar`-component sibling (design §7 Wave C) for visual scan of the month.
- Month navigator (prev/next chevrons) is a custom triplet that should become shadcn `Pagination` or a `DatePicker` month-jumper.
- `DividendPostingForm` is the biggest single component in the app (820 LOC). It handles posting + reconciliation in one mega-form. This is correct on UX grounds (operators want everything together) but the layout is dense and lacks visual hierarchy — every field looks equally important.
- No empty state distinguished from "no dividends this month yet" vs "no monitored tickers" — both render a single muted paragraph.
- Per design §8.4 this route MERGES with `/dividends/review`. So the calendar shape lives, but inherits the review filters.

**Recommendation.** Merge with `/dividends/review` per design §8.4. The merged page should default to calendar view with a "Needs review" filter chip and a "Switch to review list" toggle. The posting/reconcile drawer is the load-bearing surface; preserve its content while reshaping its container.
- PRESERVE: `DividendPostingForm` field logic (single drawer for both post + reconcile), SSE-driven status updates.
- REDESIGN: status badges → one shared `<DividendStatusBadge>` consumed by both calendar and review views.
- REDESIGN: month nav → shadcn `DatePicker` month-jumper or `Pagination`.
- REDESIGN: drawer chrome → shadcn `Sheet` with the form refactored into 3 collapsible sections (event details, posting, reconciliation).
- MERGE with `/dividends/review` (design §8.4 already locked).

---

### `/dividends/review`

**Current behavior.** Server-component-routed: parses search params into a query, fetches `fetchDividendLedgerReview` + `fetchDividendLedgerYears`. Wraps `DividendReviewClient` (976 LOC — largest client component in the app). Top section: filter bar (date preset, year, account, ticker, status), aggregate summary (totals per currency, open count, by-month, by-ticker), `DividendReviewCharts` (dynamic import, Recharts), `NhiRollupSection` (Taiwan NHI tax rollup), then sortable paginated table of ledger entries with row → `DividendPostingForm` drawer.

**Key files.**
- `apps/web/app/dividends/review/page.tsx`
- `apps/web/components/dividends/DividendReviewClient.tsx`
- `apps/web/components/dividends/DividendReviewCharts.tsx`
- `apps/web/components/dividends/SourceCompositionTab.tsx`
- `apps/web/features/dividends/components/NhiRollupSection.tsx`

**UX observations.**
- Two routes (`/dividends` and `/dividends/review`) render the exact same posting form via two different mounts of the same drawer. Reuse is good; route split is artificial.
- Filter bar mixes idioms: date preset is `<select>`, status is `<select>`, ticker is a free-text input, account is `<select>`. No shadcn primitives — all native browser controls.
- Aggregates render per-currency in a stacked grid — same shape as `summaryValues` on the public-share page. Same primitive opportunity.
- `DividendReviewCharts` is dynamically imported with a 64px loading rectangle — good. Recharts settled per design §12.
- `NhiRollupSection` is Taiwan-specific and is shown unconditionally even for US-only users. Should be hidden when there are no TW holdings.
- 976 LOC client component badly needs decomposition; the filter state alone is ~10 useState calls.

**Recommendation.** Merge into `/dividends` per design §8.4. The reshape opportunity is the filter bar + summary + chart triad — make these the design-system "page-template" pattern that recurs on cash-ledger and transactions.
- PRESERVE: charts, NHI rollup logic, all filter dimensions.
- REDESIGN: filter bar → consistent shadcn `Select` + `DatePicker` + `Input` + `ToggleGroup` (status).
- REDESIGN: hide NHI rollup when no TW holdings; or move to a `/dividends/tax` sub-tab.
- REDESIGN: break `DividendReviewClient.tsx` into `DividendReviewFilters`, `DividendReviewAggregates`, `DividendReviewTable`, `DividendReviewDrawer`.
- MERGE with `/dividends` (route deleted; "Needs review" becomes a filter chip on `/dividends`).

---

### `/sharing`

**Current behavior.** Client route. Reads `useSharingRouteContext` (locale + profile), mounts `<AppShell>` and `<SharingClient>`. SharingClient renders three sections: outbound shares (active/pending/expired/revoked tabs via a `showHistory` toggle), inbound shares (cards), and `PublicLinksSection` (anonymous share-token table with create/revoke dialogs). Modals: `GrantShareDialog`, `ShareRevokeDialog`, `CreateAnonymousLinkDialog`, `RevokeAnonymousLinkDialog`.

**Key files.**
- `apps/web/app/sharing/page.tsx`
- `apps/web/components/sharing/SharingClient.tsx`
- `apps/web/components/sharing/{OutboundSharesTable,InboundSharesCards,PublicLinksSection,GrantShareDialog,CreateAnonymousLinkDialog}.tsx`

**UX observations.**
- The page has THREE distinct surfaces (outbound, inbound, public links) stacked vertically without any nav — long page, lots of scroll.
- "Show history" toggle on outbound is a binary collapse for expired + revoked rows; would be more discoverable as a Tabs control.
- `OutboundSharesTable` and `AnonymousLinksTable` both use bespoke sort headers (same drift as cash-ledger).
- `InboundSharesCards` deliberately renders cards instead of a table (the user is a recipient and the metaphor is different). Good UX call; preserve.
- `PortfolioSwitcher` in the TopBar is the actual surface where shares ARE consumed (you switch into a shared context). It lives in the shell, not on this page — discoverability gap; this page should mention it.
- Flash messages here use the same `<p role="status">` paragraph pattern as the shell — should consolidate to Sonner.
- The "shared by me" / "shared with me" mental-model split is implicit in section headings; should be explicit Tabs.

**Recommendation.** Reshape into a single Tabs page: `Outbound` · `Inbound` · `Public links`. Keep the dialog flows.
- PRESERVE: 3 dialog flows (grant, revoke, anonymous link create + revoke), `PortfolioSwitcher` context switching.
- REDESIGN: Tabs (shadcn `Tabs`) for the 3 surfaces.
- REDESIGN: history toggle → "Active / All" segmented control inside Outbound tab.
- REDESIGN: tables → `DataTable`; cards (inbound) preserve their distinct shape.
- ADD: a one-line callout linking to TopBar's PortfolioSwitcher for "view as".

---

### `/tickers/[ticker]`

**Current behavior.** Server entry fetches dashboard + transaction history + instrument metadata for a single ticker (optionally scoped to one account). Renders `<AppShell>` with a custom `statsBar` (7 `StatChip` tiles: account scope, entries, quantity, avg cost, market value, total cost, realized P/L) above `TickerHistoryClient` (425 LOC). The client shows the ticker history table + record-transaction dialog + repair-instrument modal + SSE-driven repair status. A `FloatingStatsBubble` sticks the stats to viewport scroll.

**Key files.**
- `apps/web/app/tickers/[ticker]/page.tsx`
- `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`
- `apps/web/components/ui/FloatingStatsBubble.tsx`
- `apps/web/components/ui/StatChip.tsx`

**UX observations.**
- 7-tile `statsBar` packed into one row at 2/4/7 columns — at 4 cols on `sm`, tiles wrap awkwardly; at 7 cols on `lg`, each tile has 3 fewer characters than its value.
- `FloatingStatsBubble` is the only "sticky-on-scroll" widget in the app — useful here, but it's its own primitive that may not survive density preferences.
- Page does not show a chart for the ticker. With a `/tickers/AAPL` URL the user reasonably expects price history; only transactions are listed.
- Repair modal flow has a cooldown timer (`getCooldownRemainingMinutes`) computed via `useEffect` — useful but the cooldown UI is text-only ("Retry in 12m"). Should be a more visible disabled-button-with-progress.
- Error states are minimal — `page.tsx` falls back to "Failed to load data for {ticker}. Back to portfolio" which dumps the user back to the start. Could retry inline.

**Recommendation.** Treat this as a true ticker-detail page: chart + position summary + transactions.
- PRESERVE: per-account scoping, repair modal, record-transaction reuse, SSE wiring.
- REDESIGN: stats bar → shadcn `Card` with a tight 3–4 tile layout (Position, Avg cost, Market value, Realized P/L). Drop "entries count" and "account scope" into the header chrome.
- ADD: a price chart (`PortfolioTrendCard` shape, ticker-scoped) — currently this is the only "detail" page without a chart and it's the one that should have one most.
- REDESIGN: `FloatingStatsBubble` → consider whether it's needed if the stats card sits above the table and scroll-stickying happens at the table header instead.
- REDESIGN: cooldown UI on repair → shadcn `Button` disabled with `Progress` or countdown badge.

---

### `/share/[token]`

**Current behavior.** Standalone server component, no AppShell. Fetches `${API_BASE}/share/${token}` with `cache: "no-store"`. Renders three cards: owner header (eyebrow + ownerDisplayName + read-only label + expiry + quote-as-of), summary card (total value per currency + return per currency), holdings card (table with ticker/shares/market value/allocation). 404s on missing/expired token. `robots: noindex,nofollow` metadata.

**Key files.**
- `apps/web/app/share/[token]/page.tsx`
- `apps/web/app/share/[token]/not-found.tsx`

**UX observations.**
- Same retired `glass-panel`-equivalent inline class strings: `rounded-[22px] border border-slate-200 bg-white/80` repeats five times in this one file. Tokenize.
- No header/footer/branding — looks like a leaked admin export. Per design §8.6 needs distinct visitor chrome with "Shared by {ownerName} · Powered by Vakwen" top strip and "Sign up for your own" CTA.
- Per-currency rows in the summary card are stacked `<li>`s — fine, but no visual distinction between primary (largest) and secondary currencies.
- Holdings table is single-DOM with a `min-w-[36rem]` forcing horizontal scroll under 576px. Better than dual-DOM, but still not mobile-first.
- No "as of" indicator next to numbers — only the page-level `quoteAsOf`. Each number could individually be stale.
- No language toggle — locale is inferred from `accept-language` only.

**Recommendation.** First-class redesign per design §8.6. Visitor chrome is non-negotiable; mockup at `mockup-202605151212-public-share.html`.
- PRESERVE: no-store fetch, robots noindex, expiry + quote-as-of display, per-currency summary.
- ADD: slim top strip with brand + "Shared by {name}" + footer CTA "Sign up for your own".
- REDESIGN: summary → one large primary-currency hero number, secondaries below.
- REDESIGN: holdings table → shadcn `DataTable` with mobile-first stack-on-`<sm` shape.
- ADD: language toggle (en / zh-TW) — currently locale is server-only.
- DROP: every hardcoded `rounded-[22px]` — use tokens.

---

### `/login`

**Current behavior.** 51-LOC server page. Centered `<Card>` with brand wordmark "Vakwen", subhead, `SignInButton` (Google OAuth start link), optional `DemoButton` divider when `DEMO_MODE_ENABLED=true`. Optional amber demo-expired banner above the card. Validates `returnTo` query param via `isValidReturnTo`.

**Key files.**
- `apps/web/app/login/page.tsx`
- `apps/web/components/SignInButton.tsx`
- `apps/web/components/DemoButton.tsx`

**UX observations.**
- Uses `font-display` (serif Noto Serif TC) — retired in design §4 (Geist Sans replaces). Will look noticeably different post-reshape.
- Card width fixed at `max-w-sm`; on a 4K monitor the card is a postage stamp in the center. Design §2 wants flat surfaces with proportional sizing.
- "demoExpired" banner uses inline `text-amber-700` — should be a `Sonner` toast or an `Alert` primitive.
- Hardcoded `bg-bg` (legacy token, design §3.4 bridge target).
- No "what is Vakwen" copy — first-time visitors who clicked an invite have no context here.
- No theme toggle on auth screens — the user may want dark mode before signing in.

**Recommendation.** Adopt the unified `AuthShell` per design §8.5.
- PRESERVE: SignIn + Demo button affordances, returnTo handling, demoExpired flag.
- REDESIGN: `<Card>` chrome → shadcn `Card` with tokens; brand uses Geist Sans heading per design §4.
- ADD: theme toggle and language toggle in a slim header strip.
- ADD: one-paragraph "what is Vakwen" subhead for non-demo first-time users.
- REDESIGN: demoExpired banner → shadcn `Alert` above the card.

Mockup exists at `mockup-202605151213-auth-login.html`.

---

### `/auth/error`

**Current behavior.** Server page reads `?reason=` query param and looks up copy in `authPageCopy[locale].errorReasons`. Renders the same centered `<Card>` shape as `/login` with title + description + "Try again" link back to `/login`. Reasons include `oauth_denied`, `session_expired`, `state_mismatch`, etc. (defined in `lib/authPages.ts`).

**Key files.**
- `apps/web/app/auth/error/page.tsx`
- `apps/web/lib/authPages.ts`

**UX observations.**
- Card chrome identical to `/login` — confirms the shared `AuthShell` opportunity.
- No support-contact CTA — user gets "Try again" and that's it.
- Error messages are bilingual but the heading is small (`text-2xl`); the page reads as "something happened, retry" without specific guidance for common reasons (e.g. ad-blocker, third-party cookies).
- Reason `?reason=foo` for an unknown reason falls back silently to `defaultError` with no telemetry signal.

**Recommendation.** Folds into `AuthShell` per design §8.5.
- PRESERVE: reason-based copy lookup, bilingual via `accept-language`.
- REDESIGN: same `AuthShell` container as `/login` and `/invite/[code]`.
- ADD: optional "Contact support" link or troubleshooting drawer for `state_mismatch` / `oauth_denied` reasons.
- ADD: client-side log of unknown reason for telemetry.

---

### `/invite/[code]`

**Current behavior.** Server page fetches invite status + current session in parallel. Three branches: (1) signed in as different user → "Sign out and try again" card with Sign-out + Dashboard buttons; (2) not signed in + invite pending → "Accept invite" card with SignIn link bound to `returnTo=/invite/CODE`; (3) invite used/expired/revoked → status-specific message card with link to /login. `authPageCopy[locale].invite` carries copy.

**Key files.**
- `apps/web/app/invite/[code]/page.tsx`
- `apps/web/lib/authPages.ts`

**UX observations.**
- Heavy server-rendered branching; each branch renders a slightly different Card layout. Repetitive.
- No display of inviter name / role / expiry — the user doesn't know what they're accepting before clicking "Continue".
- Same `font-display` + `bg-bg` legacy tokens as `/login`.
- The "signed in as different account" branch is a real source of confusion when the invite was sent to a different email — should surface the target email vs the current email.

**Recommendation.** `AuthShell` container, richer invite-card content.
- PRESERVE: 3 branches + returnTo wiring.
- REDESIGN: container → `AuthShell`.
- ADD: inviter name + role + expiry-in-X-days inside the card.
- ADD: in the "signed in as different account" branch, show both the current email AND the invited email side by side.

---

### `/admin`

**Current behavior.** 5-line redirect to `/admin/users`. No render.

**Key files.**
- `apps/web/app/admin/page.tsx`

**UX observations.** Nothing to render. Pure redirect.

**Recommendation.** Consider whether `/admin` should land on an overview dashboard (user count, recent audit entries, provider health summary) instead. Cheap to add post-reshape; not required.
- ADD (optional): an admin overview card grid landing page — defer to a later phase.

---

### `/admin/settings`

**Current behavior.** Server fetches `AppConfigDto`; mounts `<AdminSettingsClient>` (873 LOC). 7 tabs locked in code: `rate-limits`, `sharing`, `provider-health`, `backfill-repair`, `catalog-metadata`, `display-defaults`, `api-keys`. Tab slug syncs to `?tab=` URL via `router.replace` + `window.history.replaceState`. Each tab renders a flat list of `NumericOverrideRow` + `MaskedSecretInput` controls bound to `app_config` fields. `SortableRangeList` for the Dashboard Timeframe Defaults; `CustomizeRangesPopover` reused.

**Key files.**
- `apps/web/app/admin/settings/page.tsx`
- `apps/web/components/admin/AdminSettingsClient.tsx`
- `apps/web/components/admin/{NumericOverrideRow,MaskedSecretInput}.tsx`
- `apps/web/components/settings/SortableRangeList.tsx`

**UX observations.**
- 7 tabs is a lot on a `<TabsList>` row — they wrap or scroll horizontally below `md`. Could become a sidebar within the admin shell.
- `NumericOverrideRow` (231 LOC) renders a label + raw value + override input + reset button per knob. Visually dense; no grouping or progressive disclosure. Some knobs are admin-experiment-only and should be tucked behind a "Show advanced" toggle.
- `MaskedSecretInput` (298 LOC) is a bespoke "show/hide/rotate/replace" control — opportunity for `Input` + actions adapter rather than a one-off component.
- Display-defaults tab embeds `SortableRangeList` + `CustomizeRangesPopover` (reused from user-side dashboard) — UX is OK but admin and user share a primitive that has user-side affordances (drag-to-reorder) baked in.
- The page does not warn before navigating away with unsaved changes — every PATCH is immediate-apply rather than save-then-commit (intentional given the cache-coherency rules) but it's a hygiene gap for clumsy edits.
- Tab structure recently revised (admin-ui-bugs PR 2026-05-12). The `responsive-dual-layout-testid-prefixes.md` and `admin-tab-reversal-page-object-shim.md` rules document the testid concerns; reshape must preserve all `admin-settings-tab-{slug}` / `admin-settings-panel-{slug}` testids per design §11.

**Recommendation.** Reshape onto shadcn `Tabs` (Wave A) + `Card` panels. Mockup at `mockup-202605151214-settings-display.html` covers the display-defaults tab.
- PRESERVE: 7 tab slugs, testid contracts, every `NumericOverrideRow` knob, masked-secret flows.
- REDESIGN: tabs → shadcn `Tabs`; one tab content per panel.
- REDESIGN: `NumericOverrideRow` → tighter row layout using `Label` + `Input` + ghost `Button` reset. Honor density preference.
- REDESIGN: `MaskedSecretInput` → composed `Input` + `DropdownMenu` (show / regenerate / clear).
- ADD: optional "Show advanced" toggle per tab to hide experiment-only knobs.

---

### `/admin/users`

**Current behavior.** Server fetches current profile (for the impersonation banner). Mounts `<AdminUsersClient>` (493 LOC). Renders a header card with search + status filter (`all` / `active` / `disabled` / `deleted`), then a sortable paginated table of users (50/page) with email, role chip, status badge, last-seen relative timestamp, row-action menu. Row actions: `change role`, `disable`, `enable`, `delete`, `hard purge`, `impersonate`. Two confirm dialogs (`ConfirmDialog`, `HardPurgeDialog`) drive destructive flows.

**Key files.**
- `apps/web/app/admin/users/page.tsx`
- `apps/web/components/admin/AdminUsersClient.tsx`
- `apps/web/components/admin/{UserStatusBadge,ConfirmDialog,HardPurgeDialog,Pagination}.tsx`

**UX observations.**
- Hard-purge dialog is a separate component because the confirmation needs a typed confirmation string. Justified, but the visual distinction from the soft `ConfirmDialog` is subtle — could be `AlertDialog` with `variant="destructive"`.
- Role chip color scheme inline in this file; `UserStatusBadge` for status; two near-duplicate badge primitives.
- `formatRelativeTime` defined inline at the top of the file. The same function exists in slightly different forms across admin clients.
- Search input is a single text field — fine, but lacks the `Cmd+K` integration design §8.3 wants (jumping into admin users from anywhere).
- Impersonation start triggers a server-mutating action AND a navigation, but the user-facing affordance is a row-menu item indistinguishable from "disable". Should be more prominent (a labeled secondary button) or pinned to a per-row dropdown header.

**Recommendation.** `DataTable` + `AlertDialog` for destructives.
- PRESERVE: all 6 actions including hard-purge typed-string flow, status/role filtering, pagination.
- REDESIGN: confirm dialogs → shadcn `AlertDialog` with `variant="destructive"` on purge/delete.
- REDESIGN: badges → unified `Badge` variants (`role-admin`, `role-member`, `status-active`, etc.).
- REDESIGN: relative-time formatter → one shared util consumed by all admin clients.
- ADD: `Cmd+K` "Impersonate user…" command (design §8.3) that opens this list filtered.

---

### `/admin/instruments`

**Current behavior.** Server fetches `?marketCode=AU&page=1&limit=50` (AU is the only market currently doing absence-based delisting). Mounts `<AdminInstrumentsClient>` (569 LOC). Renders a read-only thresholds card (links to `/admin/settings`), a market selector chip row, a sortable paginated table of instruments with status badge (`listed` / `delisted` / `excluded`), absence-streak counter, last-seen / delisted-at timestamps. Row actions: `Undelete`, `Exclude from detection`, `Include in detection`. Confirms via `ConfirmDialog`.

**Key files.**
- `apps/web/app/admin/instruments/page.tsx`
- `apps/web/components/admin/AdminInstrumentsClient.tsx`

**UX observations.**
- Market is hardcoded `AU` in the server fetch; the UI has no market switcher (because no other market does absence detection yet). When US or TW joins, a switcher is needed.
- Thresholds card is read-only with a `{settingsLink}` inline replacement — a one-off render path.
- `StatusBadge` is another local copy of the badge pattern, third in admin alone.
- Empty / loading / error states present but use generic copy (`"No instruments to show."` / `"Loading instruments..."`).
- Status reason column exists but is hidden behind row hover/expand — operators have to click into a row to see why something was marked delisted.

**Recommendation.** Treat as a DataTable + audit log mini-view.
- PRESERVE: thresholds read-only with deep link to settings, 3 actions, market-scoped query.
- REDESIGN: status badges → unified `Badge` variants.
- REDESIGN: status reason → inline column or popover trigger on the status badge.
- ADD: market switcher (`Tabs` with `AU` / `US` / `TW`) — disabled tabs for markets without absence detection.
- ADD: link to `/admin/audit-log?action=instrument_undelete&entityId=…` from each row history.

---

### `/admin/invites`

**Current behavior.** Mounts `<AdminInvitesClient>` (338 LOC). Renders an inline "Issue invite" form (email, role, expiry preset: 1/7/14/30/custom) at top of page, then a sortable paginated table of invites with status badge (`pending` / `used` / `expired` / `revoked`), invitee, role, expiry. Row actions: copy code, revoke. Status filter at top.

**Key files.**
- `apps/web/app/admin/invites/page.tsx`
- `apps/web/components/admin/AdminInvitesClient.tsx`

**UX observations.**
- Issue-invite form lives inline at the top of the page — pushes the table down on first load. Should be a `Dialog` or `Sheet` triggered by a header button (same critique as `/transactions` AddTransactionCard).
- `EXPIRY_PRESETS` is a manual array of `{ label, days }`; should be a `Select` with the "Custom" option revealing a `DatePicker`.
- "Copy code" copies to clipboard but only shows a transient "Copied!" inline — no toast.
- Used invites disappear into pagination after a few weeks with no link to the resulting user.

**Recommendation.** Header-action dialog + DataTable.
- PRESERVE: 4 expiry presets + custom, status filter, copy-to-clipboard.
- REDESIGN: issue form → header `+ Issue invite` button → `Dialog`.
- REDESIGN: copy-feedback → `Sonner` toast.
- REDESIGN: table → `DataTable` with status badge variants.
- ADD: link from "used" invites to the resulting user row in `/admin/users`.

---

### `/admin/providers`

**Current behavior.** Server fetches `/admin/providers`. Mounts `<AdminProvidersClient>` (510 LOC). Renders a card per provider (FinMind-TW, FinMind-US, Yahoo Finance AU, Twelve Data AU, Frankfurter FX, ASX GICS CSV) with status badge (healthy/degraded/down/awaiting), last-success / last-failed timestamps, 24h/7d error counts, rate-limit counter, and a "Re-run now" button. Per-provider tooltip explains what the re-run does. Cooldown logic prevents rapid re-runs.

**Key files.**
- `apps/web/app/admin/providers/page.tsx`
- `apps/web/components/admin/AdminProvidersClient.tsx`
- `apps/web/lib/formatCooldownLabel.ts`

**UX observations.**
- Card-per-provider layout works visually but the cards are identical-looking shells with different stat values — could be a DataTable rows for at-a-glance scan, with the per-card details in a row drawer.
- Status colors are bespoke per-status (`text-emerald-600`, `text-amber-600`, `text-rose-600`) — same drift as elsewhere; unify to `--success` / `--warning` / `--destructive`.
- "Re-run now" cooldown is text-only ("Retry in 45s") — see `/tickers/[ticker]` repair-cooldown observation, same fix opportunity.
- Recent errors are collapsed behind an expand toggle, but they're the load-bearing UI for actual debugging — should be open-by-default for `down` providers.
- Tooltip dict is keyed by provider via PascalCase mapping (`rerunTooltipYahooFinanceAu`) — works, but a new provider needs both an API change AND an i18n entry, easy to miss.

**Recommendation.** Same DataTable + drawer pattern as the other admin tables.
- PRESERVE: 6 providers, status/error/rate-limit display, cooldown logic, per-provider tooltips.
- REDESIGN: card-per-provider → DataTable row, row click opens `Sheet` with detail (errors, last-runs, tooltip text inline).
- REDESIGN: status colors → tokens (`--success` / `--warning` / `--destructive`).
- REDESIGN: cooldown UI → disabled `Button` with countdown badge or `Progress`.
- ADD: for `down` providers, open errors panel by default.

---

### `/admin/audit-log`

**Current behavior.** Mounts `<AdminAuditLogClient>` (323 LOC). Server-side filter bar (action category dropdown grouped into 9 categories, actor email search, date range), sortable paginated table with timestamp, actor, action label, entity, details. Action labels mapped via local `ACTION_LABELS` record.

**Key files.**
- `apps/web/app/admin/audit-log/page.tsx`
- `apps/web/components/admin/AdminAuditLogClient.tsx`

**UX observations.**
- `ACTION_LABELS` (33 entries) is a local const — any new audit action requires updating this file (`.claude/rules/admin-new-subpage-checklist.md` already names this as a gotcha).
- `ACTION_CATEGORIES` is a hand-curated grouping; the dropdown of grouped categories is OK but on `<md` it collapses to a single long list.
- Details column is JSON-blob-ish prose — hard to scan; needs more structure (e.g. `{from: "viewer", to: "member"}` for role changes).
- No deep-linking from rows back to the entity they reference (`/admin/users/{id}`, `/admin/instruments/{ticker}`, etc.).
- Date range filter uses native `<input type="date">` — inconsistent with the shadcn `Calendar` design §7 wants.

**Recommendation.** DataTable + structured details + deep links.
- PRESERVE: 33 audit action labels, 9 categories, actor search, date range.
- REDESIGN: filter bar → shadcn `Select` (grouped action) + `DatePicker` (date range).
- REDESIGN: details column → key/value chip list rather than free text, with deep-link affordance to the affected entity.
- ADD: row click → `Sheet` showing full audit payload (currently you only see the summary).
- REDESIGN: `ACTION_LABELS` → either move to shared i18n dict or accept the per-page list with the existing checklist rule.

---

## Cross-cutting findings

### Patterns worth promoting to design system

1. **`StatCard` primitive.** The `RouteHeroPanel` tiles, `StatChip` row on `/tickers/[ticker]`, public-share summary cards, and dividend-review aggregate cards are five copies of the same eyebrow + value + detail block. One token-aware `<StatCard>` (or `<Stat>`) component would replace ~150 LOC across the codebase and make density-mode trivial.
2. **`DataTable` + `SortableHeader` recipe.** Every table currently reinvents sort headers (`SortHeader` in CashLedger, inline `<th>` in HoldingsTable, custom in OutboundSharesTable / AnonymousLinksTable / TransactionHistoryTable / AdminUsers / AdminInstruments / AdminInvites). Eight copies of the same toggle-and-arrow logic. shadcn `DataTable` recipe consolidates this.
3. **Status / Role / Reconciliation `Badge` variants.** Currently every page has its own inline `cn(...)` color tables: `UserStatusBadge`, `StatusBadge` in instruments, `StatusBadge` in providers, dividend `statusBadgeClassName`, share status colors, invite status map. Replace with one `<Badge variant="success|warning|destructive|info|muted">` + a small `mapStatusToVariant(domain, status)` indirection.
4. **`AuthShell` container.** `/login`, `/auth/error`, `/invite/[code]` all build a centered `<Card>` with brand wordmark. Already locked in design §8.5 — implementation will collapse ~120 LOC across three pages into one shell + three content blocks.
5. **Page header pattern: title + description + actions.** Every admin page and every signed-in page redoes a custom header. A `<PageHeader title description actions>` component would standardize the slot.
6. **Filter bar pattern.** `/cash-ledger`, `/dividends/review`, `/admin/users`, `/admin/invites`, `/admin/audit-log` all have a filter strip with search + status select + date range. Same surface, four different implementations. Worth a `<FilterBar>` recipe.
7. **`Money` component.** Every numeric currency render goes through `formatCurrencyAmount(...)` returning a plain string. Wrapping in `<Money amount currency locale tabular>` would let us inject `font-variant-numeric: tabular-nums` consistently (per design §4) AND mark up the value for selection/copy.

### Recurring UX issues worth fixing globally

- **Five-banner toast pile.** AppShell stacks `globalError` / `transactionMessage` / `mutationMessage` / `recomputeMessage` / `snapshotMessage` as separate `<p>` elements at the top of `<main>`. All five should flow through `Sonner` (design §7 Wave A).
- **Inline-form-as-card.** `AddTransactionCard`, `RecordTransactionDialog` (yes, both exist), `AdminInvitesClient`'s issue-invite block, and `DividendPostingForm`-via-drawer all use slightly different idioms for the same conceptual action. Standardize on: header `+ Action` button → `Dialog` for short forms, `Sheet` for long forms.
- **Hardcoded `rounded-[22px]` / `rounded-[24px]` / `rounded-[34px]`.** Spread across `RouteHeroPanel`, public-share cards, dashboard banners. Should all be `rounded-lg` / `rounded-xl` per the `--radius` token.
- **`bg-bg`, `text-ink`, `font-display` legacy tokens.** Used on `/login`, `/auth/error`, `/invite/[code]`, `/share/[token]`, and inside `RouteHeroPanel`. Design §3.4 covers the bridge but each call site needs touching.
- **Dual-DOM responsive tables.** Holdings, transactions, cash-ledger, dividends, sharing tables, audit log. All currently rendered through the dual-DOM table+cards pattern that `.claude/rules/responsive-dual-layout-testid-prefixes.md` guards. Design §9 retires this — single `DataTable` with column-priority and sticky-first-column replaces it.
- **Inconsistent relative-time formatters.** Each admin client has its own `formatRelativeTime`; the user-facing pages mostly use `formatDateLabel`. Two formatters in one app is fine; three different inline implementations of the same one is not.
- **Density unimplemented anywhere.** No page honors `--row-h` / `--row-px`. Design §6 introduces it; every table needs to start consuming it.
- **Sticky chrome is per-page.** `AppShell` has a sticky top chrome (TopBar + ImpersonationBanner); `/tickers/[ticker]` has its own `FloatingStatsBubble`; admin pages have nothing. Decide once: which scroll-stickying patterns survive?

### Components likely needing replacement vs reuse

| Component | Action |
|---|---|
| `components/ui/{Button,Card,Drawer,Popover,Tabs,TooltipInfo}.tsx` | **Adapter shim** per design §7 Phase 1, then delete in Phase 7. |
| `components/layout/AppShell.tsx` (1458) | **Decompose**: extract `RouteHeroPanel`, `StatusToastRegion`, `MobileNavSheet`, `DesktopSidebar`, per-section `<DashboardView>` / `<PortfolioView>` / `<TransactionsView>` / `<TickerView>` outer components. |
| `components/layout/TopBar.tsx` (532) | **Decompose** per design §8.2 — extract `BrandHeader`, `QuickSearchTrigger`, `NotificationCenter`, `UserMenu`, `ThemeToggle`, `Breadcrumbs`. |
| `components/portfolio/AddTransactionCard.tsx` (667) | **Move into Dialog**; keep the form logic; drop the card chrome. |
| `components/portfolio/InstrumentCombobox.tsx` (488) | **Replace** with shadcn `Combobox` recipe (Wave C). |
| `components/dividends/DividendPostingForm.tsx` (820) | **Decompose** into 3 sections inside a `Sheet`. |
| `components/dividends/DividendReviewClient.tsx` (976) | **Decompose** into 4 sub-components (filters/aggregates/table/drawer). |
| `features/cash-ledger/components/CashLedgerClient.tsx` (705) | **Decompose** + replace direct `@radix-ui/react-dropdown-menu` import. |
| `components/admin/AdminSettingsClient.tsx` (873) | **Tabs**: shadcn `Tabs`; preserve testid contract; extract per-tab panel files. |
| `components/admin/MaskedSecretInput.tsx` (298) | **Replace** with `Input` + actions adapter. |
| `components/admin/NumericOverrideRow.tsx` (231) | **Tighten** to a `Label` + `Input` + reset `Button` row, density-aware. |
| `components/ui/FloatingStatsBubble.tsx` | **Re-evaluate**: keep only if `/tickers/[ticker]` really needs scroll-following stats; otherwise drop and use a sticky card. |
| `components/dashboard/QuickTransactionSection.tsx` | **Delete** — dead. |
| `components/sharing/*Table.tsx` | **Migrate** to `DataTable`. |
| `components/portfolio/HoldingsTable.tsx` (328) | **Migrate** to `DataTable`. |

### Things the design doc doesn't yet cover

- **Sortable card persistence (`user_preferences.cardOrder.*`)** isn't named in §10. The reshape must keep `cardOrder.dashboard`, `cardOrder.portfolio`, and the `transactions` slot key alive — they're already in the schema and on disk.
- **NHI (Taiwan tax) rollup** under `/dividends/review` is the only Taiwan-specific UI surface. Decide whether NHI deserves its own `/dividends/tax` sub-route or stays a conditional section.
- **`FloatingStatsBubble`** affordance on `/tickers/[ticker]` — design §11 mentions sticky chrome on AppShell but doesn't pronounce on per-page scroll widgets.
- **Empty / loading / error copy** is currently per-page and inconsistent ("Loading instruments...", "Failed to load data for {ticker}.", "No instruments to show."). Worth a small i18n harmonization pass during Wave A.
- **Impersonation banner placement and dark-mode contrast** — banner uses amber today; in dark mode the contrast picker needs care. Not covered in §3.
- **Notification dropdown vs. command palette** — both live in TopBar per design §8.2 but the relationship isn't pinned (is a notification a ⌘K result? does opening one close the other?).
- **`AdminShell` distinct tint** is locked (design §8.8) but the spec is "use `--secondary` instead of `--card`" — verify this reads enough like "you're in admin" without becoming jarring; consider an accent rail on the sidebar instead.
- **Theme toggle on `/share/[token]`** — visitor chrome (§8.6) probably wants a passive theme toggle; not currently in scope.
- **Bilingual headings letter-spacing override** (§4 zh-TW rule) needs verification on `<h2>` and `<h3>` in card titles, not just `<h1>`.
- **Skeletons.** `DashboardLoading` is bespoke; shadcn `Skeleton` should replace it once Wave A lands. Public-share has no loading state at all (server-rendered) — fine, but consider a streaming skeleton if data fetches grow.
