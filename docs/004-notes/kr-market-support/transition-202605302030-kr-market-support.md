---
slug: kr-market-support
type: transition-note
created: 2026-05-30T20:30
status: draft
---

# Transition Note - KR Market Support

This note records the implementation shape for KR market support without a paid data plan.

## Scope

- Full market parity means users can create KRW accounts, select KR instruments, book trades, monitor KR tickers, backfill daily bars/dividends, view provider health, use reporting currency `KRW`, and query through MCP/API market filters.
- Canonical app tickers are bare KRX codes such as `005930`. Yahoo suffixes (`.KS`, `.KQ`) are internal provider details only.
- Supported KR catalog instruments are KRX and KOSDAQ common stocks, preferred stocks, REITs, and ETFs.
- Excluded KR catalog instruments are ETNs, warrants/ELWs, indices, mutual funds, derivatives, and any unsupported Twelve Data instrument type.
- FX is intentionally minimal: KRW is added to the existing Frankfurter stored-currency loop, with no new FX product work.

## Provider Decision

KR uses two providers:

| Purpose | Provider | Reason |
|---|---|---|
| Catalog | Twelve Data Basic/free | `/stocks` and `/etf` reference endpoints can enumerate KRX and KOSDAQ instruments by exchange. |
| Bars, dividends, metadata, live search | Yahoo Finance via `yahoo-finance2` | Twelve Data price/time-series data for KRX is not usable on the no-paid plan; Yahoo returns KRW quote/chart data for `.KS` and `.KQ` symbols. |

Official references used:
- Twelve Data pricing: Basic exposes 8 API credits/minute and 800/day; Grow removes daily limits but is paid: https://twelvedata.com/pricing
- Twelve Data symbol discovery: stocks and ETF reference catalogs are the supported way to list instruments: https://support.twelvedata.com/en/articles/5620513-how-to-find-all-available-symbols-at-twelve-data
- Twelve Data instrument types include Common Stock, Preferred Stock, REIT, ETF, Exchange-Traded Note, and Warrant, which is why the KR catalog filters explicitly: https://twelvedata.com/docs/supporting-metadata/instrument-type

## Implementation Highlights

- `MarketCode` adds `KR`; `AccountDefaultCurrency` adds `KRW`; `currencyFor`/`marketCodeFor` map `KR <-> KRW`.
- Migration `062_kr_market_support.sql` extends account currency checks, `currency_to_market`, ticker fundamentals checks, and provider-health seed rows.
- `YahooFinanceKrMarketDataProvider` resolves `.KS` / `.KQ` lazily, validates KRW/Korea exchange metadata, caches the suffix per bare ticker, and strips suffixes before returning app-facing records.
- `TwelveDataKrCatalogProvider` fetches `/stocks` and `/etf` for `exchange=KRX` plus `exchange=KOSDAQ`, validates `mic_code = "XKRX"` / `"XKOS"`, filters unsupported rows, and delegates metadata/search to the Yahoo KR provider.
- Provider health now includes `yahoo-finance-kr` and `twelve-data-kr`. Yahoo KR reruns share the longer Yahoo rerun cooldown because the admin rerun path triggers both catalog warm-up and monitored refresh.
- KR trading freshness uses `Asia/Seoul` and 15:30 local close. Empty-market bootstrap uses the existing weekday fallback plus learned bar dates.
- The web add-transaction, account creation, reporting currency, command palette, and instrument catalog flows now use shared market/currency constants so KR remains in parity with future markets.
- UI mockups are captured in `docs/004-notes/kr-market-support/ui-mockups.md`.

## Intentional Gaps

- No paid Twelve Data, EODHD, or other paid provider path.
- No automatic KR corporate actions beyond basic cash dividends.
- No withholding-source automation.
- No hardcoded Korean broker fee/tax preset.
- No sector/GICS filter in the KR instrument catalog sheet, because the no-paid KR catalog path does not provide reliable sector data.
- No automatic FX product expansion beyond storing KRW crosses.

## Operational Notes

- `twelve-data-kr` catalog rerun refreshes KR metadata only and does not fetch bars.
- `yahoo-finance-kr` rerun dispatches catalog bars warm-up for pending/failed KR instruments plus monitored KR daily refresh.
- Manual entries are not blocked when providers fail; provider failures follow the same retry and health aggregation pattern as AU.
- Yahoo Finance is delayed/best-effort and unofficial. Production/commercial usage still needs a separate provider decision.
