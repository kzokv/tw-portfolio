# Taiwan Bookkeeping Worked Examples

Use this file when the task needs ledger-ready Taiwan bookkeeping examples, concrete holdings state after trade events, or source-aware dividend examples that can be mapped into UI or API read models.

Last refreshed: March 12, 2026

## Example 1. Stock Trade Timeline With Holdings-After-Each-Event

Assumptions:

- account default board commission rate: `1.425‰`
- commission discount: `100%`
- minimum commission: `NT$20`
- stock sell transaction tax: `0.3%`
- weighted-average cost is the default holdings view
- `current price/share` is an illustrative market-data point captured after each trade event

Trade events for symbol `2330`:

| Event | Timestamp | Side | Quantity | Unit Price | Current Price After Event |
| --- | --- | --- | --- | --- | --- |
| `T1` | `2026-03-01T09:00:00+08:00` | `BUY` | `1000` | `600` | `610` |
| `T2` | `2026-03-05T09:30:00+08:00` | `BUY` | `1000` | `620` | `618` |
| `T3` | `2026-03-10T10:15:00+08:00` | `SELL` | `800` | `650` | `645` |
| `T4` | `2026-03-18T13:20:00+08:00` | `SELL` | `200` | `660` | `655` |

Transaction view:

| Event | Gross | Commission | Tax | Net Cash | Notes |
| --- | --- | --- | --- | --- | --- |
| `T1` | `600000.00` | `855.00` | `0.00` | `-600855.00` | buy cash outflow |
| `T2` | `620000.00` | `883.50` | `0.00` | `-620883.50` | buy cash outflow |
| `T3` | `520000.00` | `741.00` | `1560.00` | `517699.00` | sell cash inflow |
| `T4` | `132000.00` | `188.10` | `396.00` | `131415.90` | sell cash inflow |

Holdings view after each event:

| After Event | Current Holdings | Total Cost | Average Cost / Share | Current Price / Share | Market Value | Unrealized P&L | Cumulative Realized P&L |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `T1` | `1000` | `600855.00` | `600.8550` | `610` | `610000.00` | `9145.00` | `0.00` |
| `T2` | `2000` | `1221738.50` | `610.8693` | `618` | `1236000.00` | `14261.50` | `0.00` |
| `T3` | `1200` | `733043.10` | `610.8693` | `645` | `774000.00` | `40956.90` | `29003.60` |
| `T4` | `1000` | `610869.25` | `610.8693` | `655` | `655000.00` | `44130.75` | `38245.65` |

Use this example when the user asks for:

- average cost/share after buys and sells
- holdings quantity after each trade
- per-symbol transaction display
- unrealized P&L from current price and current holdings
- realized P&L derived from disposal cost rather than manual input

## Example 2. Cash Dividend Expected vs Posted Receipt With NHI Deduction

Declared event:

| Field | Value |
| --- | --- |
| symbol | `0056` |
| ex-dividend date | `2026-07-15` |
| payment date | `2026-08-10` |
| cash dividend per share | `1.2` |
| eligible quantity | `2000` |
| expected cash amount | `2400` |

Posted receipt:

| Field | Value |
| --- | --- |
| received cash amount | `2280` |
| deduction type | `NHI_SUPPLEMENTAL_PREMIUM` |
| deduction amount | `120` |
| net received | `2280` |
| gross comparison basis | `2400 = 2280 + 120` |

Bookkeeping points:

- the declared `DividendEvent` is reference data
- expected and actual amounts remain visible side by side
- the deduction is its own booked entry rather than a silent reduction of the expected amount
- a UI can show `gross expected`, `deductions`, and `net received` together without losing the original event declaration

## Example 3. Stock Dividend Adds Quantity Through The Position Path

Inputs:

| Field | Value |
| --- | --- |
| symbol | `1101` |
| stock dividend per share | `0.1` |
| eligible quantity | `1000` |
| stock shares received | `100` |
| premium base amount | `1000` |
| premium base currency | `TWD` |
| holdings before posting | `1000` shares |
| total cost before posting | `600000` |

Derived holdings state:

| Metric | Value |
| --- | --- |
| holdings after posting | `1100` shares |
| total cost after posting | `600000` |
| average cost/share after posting | `545.4545` |
| cash receipt created at posting | `none` |

Bookkeeping points:

- stock dividends are non-cash inventory events
- quantity changes flow through the stock-position path
- any cash in lieu or deduction must be booked separately
- store the premium base used by the statement instead of collapsing everything into net quantity only

## Example 4. ETF Distribution Keeps Source Composition

Posted receipt for symbol `00919`:

| Field | Value |
| --- | --- |
| eligible quantity | `3000` |
| received cash amount | `1500` |
| cash currency | `TWD` |

Issuer or broker source lines:

| Source Bucket | Amount |
| --- | --- |
| `股利所得` | `900` |
| `利息所得` | `300` |
| `收益平準金` | `200` |
| `其他資本返還性質項目` | `100` |

Bookkeeping points:

- keep source lines on the receipt or linked detail model
- do not flatten all ETF payouts into one dividend-income bucket
- if only the net receipt is known, book the receipt and mark source as `unknown pending issuer disclosure`
- tax and NHI interpretation should use the stored source composition when later available
