# Ticker Price Freshness UI Mockups

Created: 2026-06-17

## Files

- `ticker-price-freshness-mockups.html` - editable static mockup source.
- `screenshots/dashboard-desktop.png` - desktop dashboard market-state summary.
- `screenshots/holdings-desktop.png` - desktop holdings price-cell states.
- `screenshots/ticker-report-desktop.png` - ticker detail and reports data-health states.
- `screenshots/portfolio-mobile.png` - narrow viewport price-cell behavior.
- `screenshots/admin-settings.png` - admin settings configuration surface.

## Scope Covered

- Dashboard held-market open/closed summary.
- Row-level price chips in dashboard, portfolio, ticker detail, and reports contexts.
- Fresh intraday, delayed intraday, open previous close, and closed close-price states.
- Aggregate valuation note placement without overloading `summary.asOf`.
- Admin grouped ticker-price-freshness settings surface.

## Design Notes

- The freshness indicator sits in the price cell, not beside ticker identity.
- Relative labels are visible; exact timestamps/source facts live in tooltip-style metadata.
- Row-level `priceState` remains distinct from valuation-health market freshness.
- Color is restrained to status dots and small chips to avoid making ticker rows look erroneous.
