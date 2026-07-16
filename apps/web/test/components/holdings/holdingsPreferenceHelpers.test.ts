import { afterEach, describe, expect, it, vi } from "vitest";
import type { HoldingsTableContextPreferenceDto } from "@vakwen/shared-types";
import {
  DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY,
  LEGACY_SHARED_HOLDINGS_CONTEXT_KEY,
  PORTFOLIO_HOLDINGS_CONTEXT_KEY,
  REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY,
  REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY,
  REPORTS_MARKET_DETAIL_CONTEXT_KEY,
  REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY,
  REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY,
  buildHoldingsTickerId,
  defaultHoldingsSelectionPreference,
  fetchHoldingsPreferences,
  fetchHoldingsSelectionUniverseTickerIds,
  normalizeHoldingsSelectionPreference,
  persistHoldingsSelectionPreference,
  persistHoldingsTableContexts,
  resolveHoldingsTableContextPreference,
  resolveHoldingsTableSettingsPreference,
} from "../../../components/holdings/holdingsPreferenceHelpers";
import { getJson, patchJson } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
}));

describe("holdingsPreferenceHelpers", () => {
  function buildContext(
    overrides: HoldingsTableContextPreferenceDto = {},
  ): HoldingsTableContextPreferenceDto {
    return {
      columnOrder: ["ticker", "marketValue"],
      hiddenColumns: [],
      columnWidths: { ticker: 180 },
      rowOrder: ["TW:2330"],
      selectedMarketCodes: ["TW"],
      selectedAccountIds: ["acc-1"],
      topHoldingsLimit: 8,
      layoutStyle: "portfolio",
      mobileSummaryCount: 3,
      ...overrides,
    };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds canonical market:ticker identities with uppercased tickers", () => {
    expect(buildHoldingsTickerId("tw", "2330")).toBe("tw:2330");
    expect(buildHoldingsTickerId("US", "msft")).toBe("US:MSFT");
  });

  it("falls back to the default all-selection preference when stored data is invalid", () => {
    expect(defaultHoldingsSelectionPreference()).toEqual({ version: 1, mode: "all" });
    expect(normalizeHoldingsSelectionPreference({ mode: "custom" })).toEqual({ version: 1, mode: "all" });
  });

  it("reuses the legacy shared holdings context for migrated table keys", () => {
    const sharedContext = buildContext();

    expect(resolveHoldingsTableContextPreference({
      [LEGACY_SHARED_HOLDINGS_CONTEXT_KEY]: sharedContext,
    }, PORTFOLIO_HOLDINGS_CONTEXT_KEY)).toEqual(sharedContext);
    expect(resolveHoldingsTableContextPreference({
      [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: sharedContext,
    }, DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY)).toEqual(sharedContext);
  });

  it("materializes all missing stable contexts from the legacy shared holdings context deterministically", () => {
    const sharedContext = buildContext();

    expect(resolveHoldingsTableSettingsPreference({
      version: 1,
      contexts: {
        [LEGACY_SHARED_HOLDINGS_CONTEXT_KEY]: sharedContext,
        [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: buildContext({ topHoldingsLimit: 5, layoutStyle: "dashboard" }),
      },
    })).toEqual({
      migrated: true,
      contexts: {
        [LEGACY_SHARED_HOLDINGS_CONTEXT_KEY]: sharedContext,
        [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: sharedContext,
        [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: buildContext({ topHoldingsLimit: 5, layoutStyle: "dashboard" }),
        [REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY]: sharedContext,
        [REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY]: sharedContext,
        [REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY]: sharedContext,
        [REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY]: sharedContext,
        [REPORTS_MARKET_DETAIL_CONTEXT_KEY]: sharedContext,
      },
      preference: {
        version: 1,
        contexts: {
          [LEGACY_SHARED_HOLDINGS_CONTEXT_KEY]: sharedContext,
          [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: sharedContext,
          [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: buildContext({ topHoldingsLimit: 5, layoutStyle: "dashboard" }),
          [REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY]: sharedContext,
          [REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY]: sharedContext,
          [REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY]: sharedContext,
          [REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY]: sharedContext,
          [REPORTS_MARKET_DETAIL_CONTEXT_KEY]: sharedContext,
        },
      },
    });
  });

  it("hydrates holdings selection and table settings from /user-preferences", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsSelection: { version: 1, mode: "custom", tickerIds: ["TW:2330"] },
        holdingsTableSettings: {
          version: 1,
          contexts: {
            [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: buildContext({ topHoldingsLimit: 10 }),
          },
        },
      },
    });

    await expect(fetchHoldingsPreferences()).resolves.toEqual({
      holdingsSelection: { version: 1, mode: "custom", tickerIds: ["TW:2330"] },
      holdingsTableSettings: {
        version: 1,
        contexts: expect.objectContaining({
          [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: expect.objectContaining({
            topHoldingsLimit: 10,
          }),
        }),
      },
      migratedHoldingsTableSettings: false,
    });
    expect(getJson).toHaveBeenCalledWith("/user-preferences", { contextScope: "session" });
  });

  it("loads the full portfolio holdings universe for all-mode materialization", async () => {
    vi.mocked(getJson).mockResolvedValue({
      holdingGroups: [
        { marketCode: "TW", ticker: "2330" },
        { marketCode: "US", ticker: "aapl" },
        { marketCode: "US", ticker: "AAPL" },
        { marketCode: null, ticker: "INVALID" },
      ],
    });

    await expect(fetchHoldingsSelectionUniverseTickerIds()).resolves.toEqual(["TW:2330", "US:AAPL"]);
    expect(getJson).toHaveBeenCalledWith("/portfolio/primary");
  });

  it("hydrates a migrated in-memory holdings table view and retries persistence on a later fetch", async () => {
    const sharedContext = buildContext();
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            [LEGACY_SHARED_HOLDINGS_CONTEXT_KEY]: sharedContext,
          },
        },
      },
    });
    vi.mocked(patchJson)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ preferences: {} });

    const first = await fetchHoldingsPreferences();
    const second = await fetchHoldingsPreferences();

    expect(first.migratedHoldingsTableSettings).toBe(true);
    expect(first.holdingsTableSettings.contexts).toEqual(expect.objectContaining({
      [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: sharedContext,
      [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: sharedContext,
      [REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY]: sharedContext,
      [REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY]: sharedContext,
      [REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY]: sharedContext,
      [REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY]: sharedContext,
      [REPORTS_MARKET_DETAIL_CONTEXT_KEY]: sharedContext,
    }));
    expect(second.holdingsTableSettings.contexts).toEqual(first.holdingsTableSettings.contexts);
    expect(patchJson).toHaveBeenNthCalledWith(
      1,
      "/user-preferences",
      { holdingsTableSettings: first.holdingsTableSettings },
      { contextScope: "session" },
    );
    expect(patchJson).toHaveBeenNthCalledWith(
      2,
      "/user-preferences",
      { holdingsTableSettings: second.holdingsTableSettings },
      { contextScope: "session" },
    );
  });

  it("patches holdings selection and merges dirty contexts against the current saved preference", async () => {
    vi.mocked(getJson).mockResolvedValue({
      preferences: {
        holdingsTableSettings: {
          version: 1,
          contexts: {
            [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: buildContext({ topHoldingsLimit: 5, mobileSummaryCount: 2 }),
          },
        },
      },
    });

    await persistHoldingsSelectionPreference({ version: 1, mode: "custom", tickerIds: ["TW:2330"] });
    await expect(persistHoldingsTableContexts({
      [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: buildContext({ layoutStyle: "dashboard" }),
    })).resolves.toEqual({
      version: 1,
      contexts: expect.objectContaining({
        [PORTFOLIO_HOLDINGS_CONTEXT_KEY]: expect.objectContaining({ topHoldingsLimit: 5 }),
        [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: expect.objectContaining({ topHoldingsLimit: 8 }),
      }),
    });

    expect(patchJson).toHaveBeenNthCalledWith(
      1,
      "/user-preferences",
      { holdingsSelection: { version: 1, mode: "custom", tickerIds: ["TW:2330"] } },
      { contextScope: "session", keepalive: true },
    );
    expect(patchJson).toHaveBeenNthCalledWith(
      2,
      "/user-preferences",
      {
        holdingsTableSettings: expect.objectContaining({
          version: 1,
          contexts: {
            [DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY]: expect.any(Object),
          },
        }),
      },
      { contextScope: "session" },
    );
  });
});
