---
name: tw-market-bookkeeping
description: Handle Taiwan stock and ETF bookkeeping questions.
---

# Taiwan Market Bookkeeping

Use this skill for Taiwan listed equity and ETF bookkeeping work where the output depends on market rules, fees, dividend handling, distribution source breakdowns, or Taiwan tax and NHI constraints.

## Read The Right Reference

- Always read `references/tw-market-rules.md` before answering.
- Read `references/tw-bookkeeping-examples.md` when the task needs concrete worked examples, ledger-ready tables, or UI-facing holdings and dividend state examples.
- Also read `references/tw-broker-public-commission-rates.md` when the task involves broker fee assumptions, public commission comparisons, discounts, or minimum-fee handling.
- Treat these references as dated baselines. If the user asks for the latest position or a rule may have changed, verify again with official sources before answering.

## Workflow

1. Scope the instrument before calculating anything.
   Identify whether the asset is a listed stock, ETF, bond ETF, odd-lot trade, or eligible day trade.
2. Extract the facts needed for bookkeeping:
   - trade date
   - settlement date, if known
   - payment date or record date for distributions
   - ticker and instrument type
   - side
   - quantity and unit price
   - gross amount
   - board commission rate assumption, if statement fee is not available
   - broker commission details or missing-fee assumptions
   - commission discount assumption
   - minimum commission assumption
   - fee charge mode: charged upfront as final fee, charged upfront then rebated later, or separately negotiated
   - statement source breakdown for dividends or ETF distributions
3. Calculate trade cash flow separately from annual tax reminders.
   Output, at minimum:
   - gross amount
   - commission
   - transaction tax
   - net cash inflow or outflow
   - settlement timing
4. Apply the rule set from the references precisely.
   Separate trade date from settlement date and state assumptions when the user has incomplete data.
5. Keep bookkeeping guidance distinct from filing or legal conclusions.
   Do not imply that transaction tax paid at trade time is the same as annual income-tax treatment.
6. Use `scripts/calc_trade_cashflow.py` when the task needs deterministic trade math.
   Prefer `--commission-amount` when a broker statement gives the actual fee.
   Otherwise use `--commission-rate`, `--commission-discount`, and `--minimum-commission` to make the assumption explicit.
   When no custom board rate is known, default the board-rate assumption to the common Taiwan listed-securities baseline `1.425‰` and keep any broker discount separate from that baseline.

## Dividends And ETF Distributions

- Record gross amount, deductions, and net received separately.
- For stock dividends, record both share quantity and the premium base used by the statement.
- Treat stock dividends as non-cash position changes. On payment date, update holdings or inventory bookkeeping through the stock path; only cash in lieu, withheld deductions, or explicit fees belong in a cash ledger.
- For ETF distributions, use source composition rather than the label `配息` alone.
- Ask for or extract the issuer, TDCC, or broker statement source lines when available.
- If the user has only the net cash received, record it and mark the source as unknown pending issuer disclosure.
- Do not flatten all ETF cash distributions into dividend income. Tax and NHI treatment depends on source classification.
- For cash dividends, keep the comparison basis explicit: `gross expected = net received + at-source withholdings`. Do not mix unrelated monthly fees or later manual adjustments into the dividend event comparison.

## Dividend Lifecycle Design Notes

Use these rules when the task is system design, ledger modeling, reconciliation workflow, or API semantics for Taiwan dividend bookkeeping:

- Materialize expected dividend entitlement before payment posting when the declared event and eligible quantity are known. Do not create first-time entitlement state only at posting time.
- Separate issuer-level declaration from account-level entitlement and from actual posted receipt.
- Keep expected and actual values visible side by side. Do not overwrite expected values after posting.
- Use reversal plus replacement for posted dividend corrections. Do not silently edit posted facts in place.
- Use `explained` only when a difference remains visible but is documented and accepted without changing booked facts, such as statement grouping or cut-off timing differences.
- Do not use `explained` for wrong quantities, wrong receipt amounts, or wrong deduction amounts. Those require corrective reversal and replacement.
- Enforce "only one active dividend entry per account per event" at the persistence layer, not only in service logic.
- Keep deduction modeling extensible. MVP summaries are acceptable, but long-term designs should allow typed deduction line items such as NHI supplemental premium, withholding tax, bank fee, cash-in-lieu adjustment, and rounding adjustment.
- Treat currency as explicit configuration or field data instead of baking NTD into lifecycle semantics. If the product later supports non-TWD cash flows, carry amount and currency separately.

## Posted-Fact Correction Modeling

Use these rules when the task asks how posted trades, cash entries, dividend postings, or stock-dividend effects should be corrected:

- Treat posted-fact correction at the parent-fact level. If any economically meaningful field is wrong, reverse the original posted fact and create a replacement instead of editing child rows in place.
- Keep the original economic date separate from the correction booking timestamp. Preserve the trade or event date semantics and record the actual correction moment separately, such as in `bookedAt`.
- For dividend corrections, reverse the `DividendLedgerEntry` and every generated related `CashLedgerEntry` together, then create a corrected replacement row.
- For stock-dividend corrections, reverse the quantity effect through the stock or inventory path, not only through cash. Reverse related cash-in-lieu or deduction entries separately.
- Preserve Taiwan-specific support values needed for bookkeeping, such as the premium base used for NHI or statement support, instead of collapsing everything into a single net amount.
- Use `explained` only for reconciliation cases where the booked fact is still economically correct and the remaining difference is presentation, cut-off timing, or accepted tolerance. Do not use `explained` for wrong quantity, wrong receipt amount, wrong withholding, wrong NHI deduction, wrong cash-in-lieu, wrong account, or wrong linked source fact.
- Make reversal and replacement atomic across the whole generated chain. Do not allow a state where the parent is reversed but generated child entries are left active.
- Keep external source references separate from internal correction-chain linkage. Each row keeps its own identity, while reversal or supersession fields express the correction relationship.

## Output Shape

Use this structure for substantive tax or legal-adjacent bookkeeping answers:

1. Facts used
2. Bookkeeping calculation
3. Tax and NHI treatment
4. Open assumptions or missing data
5. Official sources
6. Compliance note

Use this compliance note verbatim:

`僅供記帳與規劃參考，重大稅務、申報或法律判斷請再向會計師、稅務機關或律師確認。`

Prefer ledger-ready tables, formula-ready breakdowns, and reconciliations that can be pasted into app records.

## Guardrails

- Mention the rule date explicitly when relevant, for example `as of March 4, 2026`.
- Distinguish among transaction tax, annual income tax treatment, and 2nd-generation NHI supplemental premium treatment.
- If the user asks about broker fees without a statement or contract, store the exact board rate assumption, discount assumption, minimum-fee assumption, and whether fees are charged upfront, rebated later, or negotiated.
- Cite the relevant official source URL from the reference file when discussing a rule.
- For dividend system-design answers, distinguish official Taiwan market or NHI rules from general accounting-system design guidance. Label the latter as modeling guidance rather than Taiwan legal requirements.

Do not answer with certainty without more facts when the task involves:

- non-resident treatment
- corporate investor treatment
- AMT interactions
- overseas securities or foreign-source income
- margin, short sale, securities lending, warrants, options, or futures
- estate, gift, inheritance, or trust structures

State the assumptions clearly and advise checking an accountant, tax authority, or lawyer for filing-critical decisions.

## Official Sources And Modeling References

Use these sources when the task needs current rule verification or defensible modeling rationale:

- TWSE trading guide: https://www.twse.com.tw/en/page/about/company/guide.html
- Ministry of Finance tax overview: https://www.mof.gov.tw/singlehtml/384?cntId=d02e8424db8d4fd8a4bc5d99be058cef
- National Taxation Bureau of Taipei dividend tax page: https://www.ntbt.gov.tw/singlehtml/5f7032d2498a4f1c81a272dedf36d737?cntId=1cc5036f4d44417cb1a95165d2945208
- Ministry of Health and Welfare NHI supplemental premium page: https://www.nhi.gov.tw/ch/cp-3145-6c0f2-2082-1.html
- SITCA ETF tax and distribution notes: https://www.tisa.org.tw/qa
- Microsoft Learn reverse journal posting guidance: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-reverse-journal-posting
- Oracle reconciliation tolerance rules: https://docs.oracle.com/en/cloud/saas/financials/25c/fairp/overview-of-tolerance-rules.html
- Oracle Account Reconciliation explained balance and formats docs: https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/suarc/setup_formats_properties.html and https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/suarc/setup_formats_rc_about.html
- PostgreSQL partial index documentation for active-row uniqueness patterns: https://www.postgresql.org/docs/current/indexes-partial.html

## Scripts

### `scripts/calc_trade_cashflow.py`

Use this script for trade-level bookkeeping calculations covering:

- gross amount
- commission
- transaction tax
- net cash
- assumption capture for rate, discount, and minimum commission

Inputs:

- `--instrument stock|etf|bond-etf`
- `--side buy|sell`
- `--quantity` and `--unit-price`, or `--gross-amount`
- `--commission-amount` for statement-based fees
- or `--commission-rate`, `--commission-discount`, and `--minimum-commission` for assumption-based fees
- `--day-trade` to apply the reduced stock sell tax when eligible

Output:

- JSON with normalized values, calculation components, and assumptions used
