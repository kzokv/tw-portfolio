# Taiwan Stock Bookkeeping Rules

Use this file when the task requires current Taiwan stock or ETF bookkeeping rules. Treat all items here as a dated baseline and re-check official sources if the user asks for the latest position.

Last refreshed: March 11, 2026

## Scope

This reference is for individual investors bookkeeping Taiwan listed stocks, ETFs, and bond ETFs. It is not a substitute for personalized tax, legal, or filing advice.

## Trade Rules

### Settlement

- TWSE states stock trades settle on `T+2`.
- For bookkeeping, recognize trade date and settlement date separately.

Source:
- TWSE trading guide: https://www.twse.com.tw/en/page/about/company/guide.html

### Trading Units and Sessions

- Regular trading is for board lots.
- Intraday odd-lot trading is handled in separate matching sessions.
- If a user records odd-lot buys or sells, keep them in the same position ledger but preserve the session type if reconciliation depends on statement detail.

Source:
- TWSE trading guide: https://www.twse.com.tw/en/page/about/company/guide.html

## Fees and Transaction Taxes

### Brokerage Commission

- The exchange guide states brokers may charge transaction commission and the market commonly uses a standard rate of `0.1425%` (`1.425‰`) before any broker discount.
- Many retail brokers discount the standard rate, but the minimum commission per order often still matters in bookkeeping.
- Use the actual broker statement if available. If not, state the assumed discount and minimum fee.
- For a practical public comparison of broker-disclosed or publicly compiled discount rates, also read [tw-broker-public-commission-rates.md](tw-broker-public-commission-rates.md).

Bookkeeping guidance:
- Preserve the common board-rate baseline as an exact assumption of `1.425‰` unless the user explicitly overrides it for that trade.
- Store the board rate, broker discount, and minimum fee as separate assumptions. Do not flatten them into one implied rate if the original assumption matters for audit or later review.
- If the broker statement gives an actual booked commission amount, that statement amount controls the posted trade fact even if it differs from the assumption model.
- If a broker campaign charges the board rate first and rebates part of it later, do not treat the later rebate as if the original trade was charged at the discounted rate. Book the trade using the actual charged commission, then treat the rebate as a separate later cash event unless the statement itself already nets it into the trade fee.

Source:
- TWSE trading guide: https://www.twse.com.tw/en/page/about/company/guide.html

### Securities Transaction Tax

- Stock sell transactions: `0.3%`
- ETF sell transactions: `0.1%`
- Bond ETF sell transactions: `0%` through `December 31, 2026`
- Eligible stock day trades: reduced `0.15%` through `December 31, 2027`
- Buy-side trades do not pay securities transaction tax.

Bookkeeping pattern:
- Buy: `gross + commission`
- Sell stock: `gross - commission - 0.3% tax`
- Sell ETF: `gross - commission - 0.1% tax`
- Sell bond ETF during exemption window: `gross - commission`

Sources:
- TWSE trading guide: https://www.twse.com.tw/en/page/about/company/guide.html
- Ministry of Finance tax overview: https://www.mof.gov.tw/singlehtml/384?cntId=d02e8424db8d4fd8a4bc5d99be058cef

## Capital Gains

- For Taiwan individual investors, gains from securities transactions in listed shares and ETFs are generally not included in regular income tax.
- This does not remove the obligation to pay securities transaction tax on sale when that tax applies.

Use this distinction in answers:
- "資本利得通常不計入綜合所得稅"
- "賣出時仍可能有證交稅"

Source:
- Ministry of Finance tax overview: https://www.mof.gov.tw/singlehtml/384?cntId=d02e8424db8d4fd8a4bc5d99be058cef

## Cash Dividends and Stock Dividends

### Personal Income Tax

- For resident individuals, dividend income from domestic companies is generally reported under one of two systems:
  - combined taxation with a dividend tax credit ratio of `8.5%`, capped at `NT$80,000`
  - separate single tax rate of `28%` on dividend income
- The investor chooses the more suitable method when filing annual individual income tax.

Do not choose one for the user unless they explicitly ask for a rough comparison and provide enough income context.

Sources:
- National Taxation Bureau of Taipei: https://www.ntbt.gov.tw/singlehtml/5f7032d2498a4f1c81a272dedf36d737?cntId=1cc5036f4d44417cb1a95165d2945208
- Ministry of Finance tax topic page: https://www.mof.gov.tw/multiplehtml/6?parentCntId=120

### Stock Dividends

- Stock dividends are still taxable to the shareholder even though the distribution is in shares instead of cash.
- For bookkeeping and supplemental premium checks, the common official handling uses par value as the basis for stock dividend supplemental premium calculations.

Source:
- Ministry of Health and Welfare, NHI supplemental premium examples: https://www.nhi.gov.tw/ch/cp-3145-6c0f2-2082-1.html

## 2nd-Generation NHI Supplemental Premium

### Current Baseline

- Supplemental premium rate: `2.11%`
- Dividend income is one of the supplemental premium categories.
- The withholding threshold is generally when a single payment reaches `NT$20,000`.
- Stock dividends are also within scope, with the premium base generally calculated using par value.

Important bookkeeping practice:
- Track gross dividend amount, deductible item, and net received separately.
- For stock dividends, store both share quantity and the premium base used by the statement.

Source:
- NHI administration page: https://www.nhi.gov.tw/ch/cp-3145-6c0f2-2082-1.html

### What To Tell Users

- A cash distribution can have one of several different treatments:
  - taxable dividend for income tax
  - included in supplemental premium
  - non-taxable or differently treated items depending on source composition
- Do not assume the entire ETF payout is subject to the same treatment.

## ETF Distribution Source Handling

### Why Source Breakdown Matters

- Taiwan ETF distributions can be composed of different sources, and the tax treatment follows the disclosed source composition rather than the marketing label "配息".
- SITCA and fund disclosure materials emphasize source-based breakdowns, including equalization mechanisms.

In bookkeeping, capture the issuer-disclosed source lines if available, such as:
- 股利所得
- 利息所得
- 證券交易所得
- 收益平準金
- 資本平準金
- 其他資本返還性質項目

If the user only has the net cash received:
- record the cash receipt
- mark source as "unknown pending issuer disclosure"
- avoid firm tax conclusions

Sources:
- SITCA TISA tax notes on ETF distributions: https://www.tisa.org.tw/qa
- NHI supplemental premium page: https://www.nhi.gov.tw/ch/cp-3145-6c0f2-2082-1.html

## Bookkeeping Correction Modeling Baseline

These items are modeling guidance for bookkeeping systems. They are not Taiwan legal requirements by themselves.

- Once a trade, cash entry, or dividend posting is posted, do not silently edit it in place. Correct it through reversal plus replacement.
- Correct posted facts at the parent-fact level. If a dividend posting is economically wrong, reverse the posted dividend fact and its generated cash effects together, then create a replacement.
- Preserve the original economic date and record the actual correction booking time separately.
- For stock dividends, reverse quantity through the stock or inventory path, not only through cash. Reverse cash-in-lieu or deduction cash effects separately.
- Use `explained` only when the booked fact is still economically correct and the difference is a presentation, cut-off, or accepted-tolerance issue. Wrong quantity or wrong money values require corrective reversal plus replacement.
- Execute reversal and replacement atomically across the generated chain so partial corrected states do not remain visible.
- Keep broker or import source references separate from internal correction-chain linkage. Do not rely on one reused source reference value to represent original, reversal, and replacement rows.

Sources:
- Microsoft Learn reverse journal posting: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-reverse-journal-posting
- Oracle reconciliation tolerance rules: https://docs.oracle.com/en/cloud/saas/financials/25c/fairp/overview-of-tolerance-rules.html
- Oracle Account Reconciliation explained balance and formats: https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/suarc/setup_formats_properties.html
- Oracle Account Reconciliation overview: https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/suarc/setup_formats_rc_about.html
- PostgreSQL partial index documentation: https://www.postgresql.org/docs/current/indexes-partial.html

## Recommended Ledger Fields

For trades:
- trade date
- settlement date
- ticker
- instrument type
- side
- quantity
- unit price
- gross amount
- commission
- transaction tax
- net cash
- fee profile assumptions

For dividends / distributions:
- record date
- payment date
- ticker
- distribution type
- gross cash amount
- stock dividend shares
- source breakdown
- taxable bucket
- NHI supplemental premium base
- NHI deduction amount
- net received
- notes and source URL

## High-Risk Cases To Flag

Do not answer with certainty without more facts when the user asks about:
- non-resident tax treatment
- corporate investor treatment
- AMT interactions
- overseas securities or foreign-source income
- margin, short sale, securities lending, warrants, options, futures
- estate, gift, inheritance, or trust structures

## Response Template

Use this template for tax or legal-adjacent bookkeeping answers:

1. Facts used
2. Calculation
3. Tax and NHI treatment
4. Assumptions / unknowns
5. Official sources
6. Compliance note

Compliance note:

`僅供記帳與規劃參考，重大稅務、申報或法律判斷請再向會計師、稅務機關或律師確認。`
