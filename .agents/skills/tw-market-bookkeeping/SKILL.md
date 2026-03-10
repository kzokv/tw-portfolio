---
name: tw-market-bookkeeping
description: Handle Taiwan stock and ETF bookkeeping questions.
---

# Taiwan Market Bookkeeping

Use this skill for Taiwan listed equity and ETF bookkeeping work where the output depends on market rules, fees, dividend handling, distribution source breakdowns, or Taiwan tax and NHI constraints.

## Read The Right Reference

- Always read `references/tw-market-rules.md` before answering.
- Also read `references/tw-broker-public-commission-rates.md` when the task involves broker fee assumptions, public commission comparisons, discounts, or minimum-fee handling.
- Treat both references as dated baselines. If the user asks for the latest position or a rule may have changed, verify again with official sources before answering.

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
   - broker commission details or missing-fee assumptions
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

## Dividends And ETF Distributions

- Record gross amount, deductions, and net received separately.
- For stock dividends, record both share quantity and the premium base used by the statement.
- For ETF distributions, use source composition rather than the label `配息` alone.
- Ask for or extract the issuer, TDCC, or broker statement source lines when available.
- If the user has only the net cash received, record it and mark the source as unknown pending issuer disclosure.
- Do not flatten all ETF cash distributions into dividend income. Tax and NHI treatment depends on source classification.

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
- If the user asks about broker fees without a statement or contract, store the board rate assumption, discount assumption, minimum-fee assumption, and whether fees are charged upfront, rebated later, or negotiated.
- Cite the relevant official source URL from the reference file when discussing a rule.

Do not answer with certainty without more facts when the task involves:

- non-resident treatment
- corporate investor treatment
- AMT interactions
- overseas securities or foreign-source income
- margin, short sale, securities lending, warrants, options, or futures
- estate, gift, inheritance, or trust structures

State the assumptions clearly and advise checking an accountant, tax authority, or lawyer for filing-critical decisions.

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
