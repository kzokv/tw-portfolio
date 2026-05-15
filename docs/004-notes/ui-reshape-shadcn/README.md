# UI Reshape — Notes Index

**Frozen 2026-05-15.** Pre-merge corrections allowed; post-merge immutable.

## Documents

| File | Purpose |
|---|---|
| [`design-202605151200-locked-scope.md`](./design-202605151200-locked-scope.md) | Locked design decisions: tokens, typography, IA, density, public share variant, text-wrap / responsive convention. |
| [`scope-todo-202605151201-phases.md`](./scope-todo-202605151201-phases.md) | Phase-by-phase delivery plan (Phase 0 → Phase 7), file lists, verification gates. |

## Mockups (HTML)

All mockups are self-contained static HTML referencing `_tokens.css` in this directory. Open with any browser. Append `?theme=dark` to the URL to toggle dark mode; append `?density=comfortable` (transactions only) to toggle density.

| File | Surface | Demonstrates |
|---|---|---|
| [`mockup-202605151210-dashboard.html`](./mockup-202605151210-dashboard.html) | Authenticated dashboard | Sidebar nav, decomposed TopBar with ⌘K, hero stats, trend chart, allocation ring, top movers, recent transactions, FAB. |
| [`mockup-202605151211-transactions.html`](./mockup-202605151211-transactions.html) | Transactions DataTable | Single-DOM responsive table, compact density default, filter chips, tabular numerics, density switch. |
| [`mockup-202605151212-public-share.html`](./mockup-202605151212-public-share.html) | Public share (visitor variant) | Distinct visitor chrome — no sidebar, no ⌘K, "Powered by Vakwen" strip, read-only, sign-up CTA in footer. |
| [`mockup-202605151213-auth-login.html`](./mockup-202605151213-auth-login.html) | Login (AuthShell) | Centered card, no app chrome, brand mark, Google sign-in. |
| [`mockup-202605151214-settings-display.html`](./mockup-202605151214-settings-display.html) | Settings → Display | Theme mode (3-state), 8-swatch accent picker, density switch with live preview, language toggle. |

## Screenshots

Rendered at 1440×900 (1280×900 for public share; 1100×800 for auth) via headless Chrome.

### Dashboard

| Light | Dark |
|---|---|
| ![](./screenshots/01-dashboard-light.png) | ![](./screenshots/02-dashboard-dark.png) |

### Transactions (compact)

| Light | Dark |
|---|---|
| ![](./screenshots/03-transactions-light.png) | ![](./screenshots/04-transactions-dark.png) |

### Public share (visitor variant)

| Light | Dark |
|---|---|
| ![](./screenshots/05-public-share-light.png) | ![](./screenshots/06-public-share-dark.png) |

### Auth / Sign in

| Light | Dark |
|---|---|
| ![](./screenshots/07-auth-login-light.png) | ![](./screenshots/08-auth-login-dark.png) |

### Settings → Display

| Light | Dark |
|---|---|
| ![](./screenshots/09-settings-display-light.png) | ![](./screenshots/10-settings-display-dark.png) |

## Re-rendering screenshots

From the worktree root:

```bash
bash docs/004-notes/ui-reshape-shadcn/render-screenshots.sh
```

(See script for the exact `--window-size` and URL list.)
