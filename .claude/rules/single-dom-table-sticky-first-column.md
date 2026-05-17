# Single-DOM Tables: Sticky `left: 0` Must Be On the Visually First Column

Any cell with `position: sticky; left: 0` MUST be the **leftmost column in the visual rendering order**, not just an arbitrary "important" column. Sticking the second column at `left: 0` causes it to overlap the actual first column during horizontal scrolling — the sticky cell pins to the table-wrapper's left edge while the first column scrolls underneath it.

## The trap

```tsx
// ❌ Wrong — ticker is the 2nd column; sticky left-0 makes it slide
//          OVER the payment-date column on horizontal scroll.
<thead>
  <tr>
    <th>{paymentDate}</th>                     {/* col 1 (no sticky) */}
    <th className="sticky left-0 z-10 ...">    {/* col 2 (sticky) ❌ */}
      {ticker}
    </th>
    ...
  </tr>
</thead>
```

```tsx
// ✅ Correct — date is the visually first column; sticky aligns with the
//             table-wrapper's left edge. No overlap.
<thead>
  <tr>
    <th className="sticky left-0 z-10 ...">    {/* col 1 (sticky) ✅ */}
      {paymentDate}
    </th>
    <th>{ticker}</th>                          {/* col 2 (no sticky) */}
    ...
  </tr>
</thead>
```

## Resolving the design tension

When the desired anchor column (e.g. ticker) is NOT the leftmost column, you have two choices:

1. **Reorder columns** so the anchor IS first. Higher-effort but matches design intent.
2. **Make the actual first column sticky** even if it's not the design's primary anchor. Lower-effort; usually fine because the leftmost column tends to BE the row identifier (date, timestamp, id) anyway.

Pre-Phase-4 lock notes in `scope-todo-202605171244-phase-4.md` sometimes named the "sticky col" abstractly; the implementer must verify that named column IS the leftmost visually before applying the sticky styling.

## Canonical sticky-cell classes

```
sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0
```

- `z-10` keeps the sticky cell BELOW shadcn `Popover` / `Tooltip` (default `z-50`).
- Opaque `bg-card` is required — without it the underneath column shows through.
- `md:static md:bg-transparent md:border-r-0` releases the sticky behavior once the table has room to display all columns at ≥md.

## Why this is a rule

ui-reshape-shadcn Phase 4 (commit 7 — DividendReview migration) initially marked the ticker column (2nd) as `sticky left-0`. Codex review caught it: at tablet widths between sm and md, horizontal scroll caused the ticker cells to overlay the payment-date cells. Fix: swap the `sticky` flag to the date column (col 1), drop it from ticker.

This bug class is invisible to typecheck and unit tests. It surfaces only in browser rendering at the narrow-but-not-mobile viewport range where horizontal scroll is active.

## How to apply

Any table that opts into sticky-column behavior:

1. Identify the visually leftmost column in the rendered output (NOT the column you intuitively want to anchor).
2. Apply `sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0` to both the `<th>` AND the matching `<td>` cells.
3. Do NOT apply the sticky class to any other column.
4. Pre-PR: visually verify in the browser at a tight viewport (≥640px, <1024px) by scrolling horizontally — the sticky column must stay anchored without overlap.

Canonical references: `apps/web/features/cash-ledger/components/CashLedgerClient.tsx`, `apps/web/components/portfolio/TransactionHistoryTable.tsx`, `apps/web/components/portfolio/HoldingsTable.tsx`, `apps/web/components/dividends/DividendReviewClient.tsx`.

Companion: `.claude/rules/responsive-dual-layout-testid-prefixes.md` (now superseded) for the broader single-DOM responsive pattern.
