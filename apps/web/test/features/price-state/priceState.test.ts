import { describe, expect, it } from "vitest";
import type { AppDictionary } from "../../../lib/i18n/types";
import {
  buildPriceStateActivityPath,
  describePriceStateTooltip,
  formatPriceStateLabel,
  getPriceStateToneClassName,
  hydrateDashboardMarketStates,
  isNonCurrentPrice,
  priceStateSortRank,
  type DashboardMarketStateLike,
} from "../../../features/price-state/priceState";
import { portfolioI18n } from "../../../features/portfolio/i18n";
import { testMarketState, testPriceState } from "../../fixtures/priceState";

const dict = { holdings: portfolioI18n.en.holdings } as AppDictionary;

describe("priceState freshness helpers", () => {
  it("treats pending today close as non-current even when rendered as a closed-market chip", () => {
    const pendingTodayClose = {
      priceState: testPriceState({
        basis: "pending_today_close",
        chipState: "closed_pending",
        marketState: "closed",
      }),
    };

    expect(isNonCurrentPrice(pendingTodayClose)).toBe(true);
    expect(priceStateSortRank(pendingTodayClose)).toBeGreaterThan(priceStateSortRank({
      priceState: testPriceState({ basis: "today_close", chipState: "closed" }),
    }));
  });

  it("keeps fresh intraday and current close states out of non-current filters", () => {
    expect(isNonCurrentPrice({
      priceState: testPriceState({ basis: "intraday", chipState: "open_fresh", marketState: "open" }),
    })).toBe(false);
    expect(isNonCurrentPrice({
      priceState: testPriceState({ basis: "today_close", chipState: "closed", marketState: "closed" }),
    })).toBe(false);
    expect(isNonCurrentPrice({
      priceState: testPriceState({
        basis: "fallback_eod_close",
        chipState: "fallback_eod",
        sourceKind: "eodhd_eod",
        fallbackStale: false,
      }),
    })).toBe(false);
    expect(isNonCurrentPrice({
      priceState: testPriceState({
        basis: "fallback_eod_close",
        chipState: "fallback_stale",
        sourceKind: "eodhd_eod",
        fallbackStale: true,
      }),
    })).toBe(true);
  });

  it("maps chip states to the scoped freshness tones", () => {
    expect(getPriceStateToneClassName(testPriceState({ chipState: "open_fresh" }))).toContain("success");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "open_delayed" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "open_previous_close" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ basis: "pending_today_close", chipState: "closed_pending" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ basis: "fallback_eod_close", chipState: "fallback_eod", sourceKind: "eodhd_eod" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ basis: "stale_close", chipState: "fallback_stale", sourceKind: "eodhd_eod" }))).toBe("bg-slate-400");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "closed" }))).toBe("bg-slate-400");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "missing", basis: "missing" }))).toBe("bg-destructive");
  });

  it("renders EODHD fallback labels and tooltip facts for fallback close states", () => {
    const priceState = testPriceState({
      basis: "fallback_eod_close",
      chipState: "fallback_eod",
      sourceKind: "eodhd_eod",
      source: "EODHD",
      providerSymbol: "ETPMAG.AU",
      asOfDate: "2026-07-04",
      marketLocalDate: "2026-07-04",
    });

    expect(formatPriceStateLabel(dict, "en", priceState, Date.now())).toBe("EODHD fallback");

    const tooltip = describePriceStateTooltip(dict, "en", priceState);
    expect(tooltip.rows).toEqual(expect.arrayContaining([
      { label: "Provider symbol", value: "ETPMAG.AU" },
      { label: "Source", value: "EODHD EOD" },
      { label: "Basis", value: "Fallback EOD close" },
    ]));
    expect(buildPriceStateActivityPath({
      marketCode: "AU",
      priceState,
      ticker: "ETPMAG",
    })).toBe("/admin/market-data/AU/activity?page=1&limit=25&timeRange=24h&search=ETPMAG&sourceKind=provider&category=daily_close");
  });

  it("hydrates dashboard market-state payloads with derived holding counts and calendar warnings", () => {
    const states = hydrateDashboardMarketStates(
      [{
        ...testMarketState({
          marketCode: "TW",
          marketState: "open",
          marketTimeZone: "Asia/Taipei",
        }),
        heldCount: 0,
        openCount: 0,
      } satisfies DashboardMarketStateLike],
      [
        {
          marketCode: "TW",
          priceState: testPriceState({
            marketState: "closed",
            marketStateReason: "calendar_unknown",
            calendarStatus: "calendar_unknown",
            marketLocalDate: "2026-06-19",
          }),
        },
        {
          marketCode: "TW",
          priceState: testPriceState({ marketState: "open" }),
        },
      ],
    );

    expect(states).toEqual([expect.objectContaining({
      marketCode: "TW",
      marketState: "open",
      heldCount: 2,
      openCount: 1,
      calendarStatus: "calendar_unknown",
      marketStateReason: "calendar_unknown",
      marketLocalDate: "2026-06-19",
      marketTimeZone: "Asia/Taipei",
    })]);
  });
});
