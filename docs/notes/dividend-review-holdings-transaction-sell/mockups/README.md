# Locked-scope mockups

Generated on 2026-07-22 with OpenAI image generation as visual implementation guidance for the adjacent locked scope todo. These are concept mockups, not pixel-exact snapshots of the running application.

## Prompt set

All prompts requested a polished, high-fidelity 16:10 desktop screenshot of the existing Taiwan portfolio product: restrained white and cool-gray surfaces, dark navy text, royal-blue controls, subtle borders and shadows, compact financial-data density, realistic English UI copy, and no browser chrome or device frame.

1. `dividend-review-consolidated-columns.png`
   - Dividends > Review with always-editable From/To native-style date controls; open checkbox multi-select filters; one non-sortable stacked Cash dividend column containing rate, expected gross, and received gross; one non-sortable stacked Stock dividend column containing normalized shares/share ratio and state, expected/received shares, variance, and cash in lieu; deductions, net amounts, variance, status, and actions remain separate.
2. `dividends-overview-recent-receipts.png`
   - Dividends > Overview showing a Recent Receipts table whose Ticker, Posted, Account, Net amount, and Status headers align exactly with every row.
3. `holdings-deselect-all-none-state.png`
   - Portfolio Holdings with the ticker picker open in intentional persisted zero-selection mode; unchecked tickers; footer actions Select all and Deselect all with Deselect all disabled because it is active; table empty state says no tickers are selected.
4. `transaction-sell-availability.png`
   - Shared Add transaction modal in SELL mode with account, ticker, market, and trade date selected; inline Available to sell count beneath Quantity; explicit Use max action; quantity above availability; red oversell error; and disabled Record transaction action.

## Review notes

- Copy, spacing, and exact component styling should be reconciled with the implemented design system.
- The Review mockup illustrates the intended information hierarchy; its generated table is wider than a typical viewport and should not be treated as a final responsive-width specification.
- Loading, transport-warning, authoritative-unavailable, and Traditional Chinese variants remain implementation states covered by the locked todo rather than separate mockups.
