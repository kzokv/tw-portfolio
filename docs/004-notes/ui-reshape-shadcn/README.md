# UI Reshape — Notes Index

**Frozen 2026-05-15.** Pre-merge corrections allowed; post-merge immutable.

## Documents

| File | Purpose |
|---|---|
| [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md) | Locked design decisions: tokens, typography, IA, density, public share variant, text-wrap / responsive convention. |
| [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md) | Phase-by-phase delivery plan (Phase 0 → Phase 7), file lists, verification gates. |
| [`audit-202605151230-current-ui.md`](./audit-202605151230-current-ui.md) | Per-route audit of current UI: 20 routes + cross-cutting findings. |
| [`decisions-202605151245-audit-resolutions.md`](./decisions-202605151245-audit-resolutions.md) | 12 audit-driven decisions that supersede / extend `design-…-locked-scope.md`. |
| [`phase-2-spec-202605160815-theme-density.md`](./phase-2-spec-202605160815-theme-density.md) | Phase 2 sub-spec — theme · accent · density. |
| [`phase-2-status-202605160950-handoff.md`](./phase-2-status-202605160950-handoff.md) | Phase 2 status handoff. |
| [`phase-3-spec-202605161110-shell-decomp.md`](./phase-3-spec-202605161110-shell-decomp.md) | Phase 3 sub-spec — shell decomposition (sidebar · breadcrumb · command palette · TopBar split). |
| [`transition-202605161250-phase-3ab.md`](./transition-202605161250-phase-3ab.md) | Transition note — Phase 3a (substrate) + 3b (children-driven AppShell). |
| [`review-202605161200-phase-3ab.md`](./review-202605161200-phase-3ab.md) | Code review — Phase 3a + 3b. Verdict: CLEAN. |
| [`review-202605161330-phase-3c.md`](./review-202605161330-phase-3c.md) | Code review — Phase 3c (sidebar + TopBar decomp). Verdict: FIX-REQUIRED → all four findings resolved pre-merge (see addendum). |

## Mockups (HTML)

All mockups are self-contained static HTML that load `_tokens.css` (design tokens) and `_shell.js` (sidebar + topbar renderer) from this directory. Open with any browser. URL params:

| Param | Effect |
|---|---|
| `?theme=dark` | Forces dark mode |
| `?sidebar=collapsed` | Renders sidebar in collapsed (icon-only) state |
| `?density=comfortable` | Forces comfortable density on tables (transactions only) |
| `?menu=open` | Opens the avatar profile menu (dashboard only) |

### Authenticated app

| File | Surface |
|---|---|
| [`mockup-202605151210-dashboard.html`](./mockup-202605151210-dashboard.html) | Dashboard (hero + trend + allocation + movers + recent) |
| [`mockup-202605151211-transactions.html`](./mockup-202605151211-transactions.html) | Transactions DataTable (sortable, compact density, filter chips + Sheet) |
| [`mockup-202605151220-portfolio.html`](./mockup-202605151220-portfolio.html) | Portfolio (holdings primary, slim hero, currency filter chips) |
| [`mockup-202605151221-cash-ledger.html`](./mockup-202605151221-cash-ledger.html) | Cash ledger (balance grid + running-balance table) |
| [`mockup-202605151222-dividends.html`](./mockup-202605151222-dividends.html) | Dividends (merged review · NHI conditional section) |
| [`mockup-202605151223-sharing.html`](./mockup-202605151223-sharing.html) | Sharing (3 tabs: Outbound · Inbound · Anonymous links) |
| [`mockup-202605151224-ticker-detail.html`](./mockup-202605151224-ticker-detail.html) | Ticker detail (header + stats strip + chart + fundamentals + floating bubble) |
| [`mockup-202605151214-settings-display.html`](./mockup-202605151214-settings-display.html) | Settings · Display (theme · accent picker · density · language) |

### Auth / public

| File | Surface |
|---|---|
| [`mockup-202605151213-auth-login.html`](./mockup-202605151213-auth-login.html) | Login (AuthShell · Google sign-in) |
| [`mockup-202605151225-invite.html`](./mockup-202605151225-invite.html) | Invite landing (inviter card · accept / decline) |
| [`mockup-202605151226-auth-error.html`](./mockup-202605151226-auth-error.html) | Sign-in error |
| [`mockup-202605151212-public-share.html`](./mockup-202605151212-public-share.html) | Public share view (visitor variant) |

### Admin

| File | Surface |
|---|---|
| [`mockup-202605151227-admin-overview.html`](./mockup-202605151227-admin-overview.html) | Admin overview (KPIs · provider health · activity) |
| [`mockup-202605151228-admin-settings.html`](./mockup-202605151228-admin-settings.html) | Admin · Settings (horizontal tabs · save bar) |
| [`mockup-202605151229-admin-users.html`](./mockup-202605151229-admin-users.html) | Admin · Users (roles · status · invite) |
| [`mockup-202605151230-admin-instruments.html`](./mockup-202605151230-admin-instruments.html) | Admin · Instruments (catalog · backfill state · GICS) |
| [`mockup-202605151231-admin-invites.html`](./mockup-202605151231-admin-invites.html) | Admin · Invites (issue form + status table) |
| [`mockup-202605151232-admin-providers.html`](./mockup-202605151232-admin-providers.html) | Admin · Providers (health cards · rotate token · error trail) |
| [`mockup-202605151233-admin-audit-log.html`](./mockup-202605151233-admin-audit-log.html) | Admin · Audit log (immutable record) |

## Screenshots

Rendered at 1440×900 (1280×900 for public share; 1100×800 for auth pages; 1440×1100 for dividends) via headless Chrome. Each surface has both light and dark variants.

### Dashboard

| Light | Dark |
|---|---|
| ![](./screenshots/01-dashboard-light.png) | ![](./screenshots/02-dashboard-dark.png) |

| Sidebar collapsed | Profile menu open |
|---|---|
| ![](./screenshots/11-dashboard-sidebar-collapsed.png) | ![](./screenshots/12-dashboard-profile-menu-open.png) |

### Portfolio

| Light | Dark |
|---|---|
| ![](./screenshots/13-portfolio-light.png) | ![](./screenshots/14-portfolio-dark.png) |

### Transactions

| Light | Dark |
|---|---|
| ![](./screenshots/03-transactions-light.png) | ![](./screenshots/04-transactions-dark.png) |

### Cash ledger

| Light | Dark |
|---|---|
| ![](./screenshots/15-cash-ledger-light.png) | ![](./screenshots/16-cash-ledger-dark.png) |

### Dividends (merged · NHI)

| Light | Dark |
|---|---|
| ![](./screenshots/17-dividends-light.png) | ![](./screenshots/18-dividends-dark.png) |

### Sharing (3 tabs)

| Light | Dark |
|---|---|
| ![](./screenshots/19-sharing-light.png) | ![](./screenshots/20-sharing-dark.png) |

### Ticker detail

| Light | Dark |
|---|---|
| ![](./screenshots/21-ticker-detail-light.png) | ![](./screenshots/22-ticker-detail-dark.png) |

### Settings → Display

| Light | Dark |
|---|---|
| ![](./screenshots/09-settings-display-light.png) | ![](./screenshots/10-settings-display-dark.png) |

### Login (AuthShell)

| Light | Dark |
|---|---|
| ![](./screenshots/07-auth-login-light.png) | ![](./screenshots/08-auth-login-dark.png) |

### Invite landing

| Light | Dark |
|---|---|
| ![](./screenshots/23-invite-light.png) | ![](./screenshots/24-invite-dark.png) |

### Sign-in error

| Light | Dark |
|---|---|
| ![](./screenshots/25-auth-error-light.png) | ![](./screenshots/26-auth-error-dark.png) |

### Public share (visitor variant)

| Light | Dark |
|---|---|
| ![](./screenshots/05-public-share-light.png) | ![](./screenshots/06-public-share-dark.png) |

### Admin · Overview

| Light | Dark |
|---|---|
| ![](./screenshots/27-admin-overview-light.png) | ![](./screenshots/28-admin-overview-dark.png) |

### Admin · Settings

| Light | Dark |
|---|---|
| ![](./screenshots/29-admin-settings-light.png) | ![](./screenshots/30-admin-settings-dark.png) |

### Admin · Users

| Light | Dark |
|---|---|
| ![](./screenshots/31-admin-users-light.png) | ![](./screenshots/32-admin-users-dark.png) |

### Admin · Instruments

| Light | Dark |
|---|---|
| ![](./screenshots/33-admin-instruments-light.png) | ![](./screenshots/34-admin-instruments-dark.png) |

### Admin · Invites

| Light | Dark |
|---|---|
| ![](./screenshots/35-admin-invites-light.png) | ![](./screenshots/36-admin-invites-dark.png) |

### Admin · Providers

| Light | Dark |
|---|---|
| ![](./screenshots/37-admin-providers-light.png) | ![](./screenshots/38-admin-providers-dark.png) |

### Admin · Audit log

| Light | Dark |
|---|---|
| ![](./screenshots/39-admin-audit-log-light.png) | ![](./screenshots/40-admin-audit-log-dark.png) |

## Re-rendering screenshots

From the worktree root:

```bash
bash docs/004-notes/ui-reshape-shadcn/render-screenshots.sh
```

40 PNGs land in `screenshots/`. ~30 seconds on macOS host.
