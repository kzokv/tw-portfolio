# Mobile Holdings Column Settings

When changing Dashboard, Portfolio, or Reports holdings cards at mobile viewports, treat the shared holdings column settings as the source of truth for configurable data fields.

## Required Pattern

- The mobile summary renders the first `N` visible, ordered, mobile-supported data columns.
- The mobile Details section renders the remaining visible, ordered, mobile-supported data columns before any structural context.
- Hidden configurable columns must not reappear through hardcoded metric blocks, Details rows, status summaries, or "extra context" sections.
- Do not render the same configurable field through both the column-driven Details path and a legacy hardcoded Details row.
- If a mobile card keeps non-column structural context such as identity, actions, or data-health status, make that boundary explicit in code and tests.
- Add or update tests that hide and reorder at least one mobile-supported column, then assert both summary and Details reflect the saved preference.

## Why

The mobile holdings UI issue pass added configurable mobile summary counts and ordered mobile card fields across Dashboard, Portfolio, and Reports. Code review found that legacy hardcoded Details blocks could still leak hidden columns and duplicate fields after the new column-driven rendering path. That makes the settings UI appear to work while the mobile card still exposes stale or duplicated data fields.

## How To Apply

Before marking a holdings mobile-card change complete:

1. Grep the card render for hardcoded labels or metric arrays that overlap configurable column IDs.
2. Verify those rows are either generated from the normalized visible column list or explicitly documented as structural context.
3. Add a narrow test that hides one visible mobile-supported column and confirms it is absent from both the summary and Details.
