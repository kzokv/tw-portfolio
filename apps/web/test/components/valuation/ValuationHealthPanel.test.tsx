import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValuationHealthDto } from "@vakwen/shared-types";
import { ValuationHealthPanel } from "../../../components/valuation/ValuationHealthPanel";
import {
  getValuationHealthAdminRepairHref,
  getValuationHealthAdminRepairLinks,
} from "../../../components/valuation/valuationHealthAdminLink";
import { getDictionary } from "../../../lib/i18n";

function buildValuationHealth(
  overrides: Partial<ValuationHealthDto> = {},
): ValuationHealthDto {
  return {
    status: "material",
    reason: "missing_snapshot_value",
    reportingCurrency: "USD",
    currentValueAmount: 1200,
    snapshotValueAmount: 1100,
    deltaAmount: 100,
    relativeDeltaBps: 833,
    minorUnitTolerance: 0.01,
    thresholds: {
      relativeBps: 50,
      absoluteAud: 10,
      absoluteUsd: 10,
      absoluteTwd: 300,
      absoluteKrw: 9000,
    },
    latestBarAsOf: "2026-06-13",
    latestSnapshotDate: "2026-06-12",
    latestUsableSnapshotDate: "2026-06-12",
    latestComparableSnapshotDate: "2026-06-12",
    latestPartialSnapshotDate: "2026-06-13",
    expectedLatestValuationDate: "2026-06-13",
    title: "Market data out of sync",
    marketFreshness: [{
      marketCode: "US",
      latestBarDate: "2026-06-13",
      latestSnapshotDate: "2026-06-12",
      staleTickerCount: 1,
      missingTickerCount: 0,
    }],
    affectedHoldings: [
      {
        ticker: "VRT",
        marketCode: "US",
        currentReportingValueAmount: 1200,
        latestBarDate: "2026-06-13",
        latestSnapshotDate: "2026-06-12",
        backfillStatus: "ready",
        status: "stale_snapshot",
        recommendedAction: "run_snapshot_repair",
      },
    ],
    recommendedActions: ["run_snapshot_repair"],
    ...overrides,
  };
}

describe("ValuationHealthPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows guidance only for non-admin users even when a repair link exists", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='valuation-health-user-tip']")?.textContent).toContain("Admin repair required");
    expect(document.body.textContent).toContain("8.3%");
    expect(document.body.textContent).toContain("No repair action is available here.");
    expect(document.body.textContent).not.toContain("Repair snapshots");
    expect(document.body.textContent).not.toContain("Run admin backfill");
    expect(document.querySelector("[data-testid='valuation-health-admin-repair']")).toBeNull();
    expect(Array.from(document.querySelectorAll("a")).some((link) => link.textContent?.includes("Repair"))).toBe(false);
  });

  it("surfaces comparable, partial, and per-market freshness details", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Market data out of sync");
    expect(document.body.textContent).toContain("Comparable snapshot");
    expect(document.body.textContent).toContain("Partial snapshot");
    expect(document.querySelector("[data-testid='valuation-health-market-freshness']")?.textContent).toContain("US");
    expect(document.querySelector("[data-testid='valuation-health-market-freshness']")?.textContent).toContain("Stale");
    expect(document.querySelector("[data-testid='valuation-health-market-freshness']")?.textContent).toContain("Missing");
  });

  it("localizes the unhealthy title instead of rendering the server literal", async () => {
    const valuationHealth = buildValuationHealth({ title: "Market data out of sync" });

    act(() => {
      root.render(
        <ValuationHealthPanel
          copy={getDictionary("zh-TW").valuationHealth}
          locale="zh-TW"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("市場資料不同步");
    expect(document.body.textContent).not.toContain("Market data out of sync");
  });

  it("can rerender from loading null state to a loaded valuation health payload", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={null}
        />,
      );
    });

    await act(async () => {});
    expect(document.querySelector("[data-testid='valuation-health-panel']")).toBeNull();

    act(() => {
      root.render(
        <ValuationHealthPanel
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});
    expect(document.querySelector("[data-testid='valuation-health-panel']")).not.toBeNull();
    expect(document.body.textContent).toContain("Market data out of sync");
  });

  it("copies admin-help text with an absolute deep link for non-admin users", async () => {
    const valuationHealth = buildValuationHealth();
    const writeText = vi.mocked(navigator.clipboard.writeText);

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='valuation-health-copy-admin-link-US']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Admins can open the affected-holdings repair flow");
    expect(writeText.mock.calls[0]?.[0]).toContain("Market: US");
    expect(writeText.mock.calls[0]?.[0]).toContain("Tickers: VRT");
    expect(writeText.mock.calls[0]?.[0]).toContain("Admin repair link: http://localhost:3000/admin/market-data/US/backfill?repair=valuation");
    expect(document.querySelector("[data-testid='valuation-health-copy-admin-link-US']")?.textContent).toContain("Admin link copied");
  });

  it("does not derive Settings repair returnTo from window when omitted", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    const repairLink = document.querySelector<HTMLAnchorElement>("[data-testid='valuation-health-settings-repair-US']");
    expect(repairLink?.getAttribute("href")).toBe(
      "/settings/tickers?repair=1&origin=data-health&market=US&healthReason=missing_snapshot&tickers=VRT",
    );
  });

  it("uses the caller-provided Settings repair returnTo", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          tickerRepairReturnTo="/dashboard"
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    const repairLink = document.querySelector<HTMLAnchorElement>("[data-testid='valuation-health-settings-repair-US']");
    expect(repairLink?.getAttribute("href")).toBe(
      "/settings/tickers?repair=1&origin=data-health&market=US&healthReason=missing_snapshot&tickers=VRT&returnTo=%2Fdashboard",
    );
  });

  it("uses neutral non-admin guidance when no repair is recommended", async () => {
    const valuationHealth = buildValuationHealth({
      status: "healthy",
      reason: "within_threshold",
      deltaAmount: 0.5,
      relativeDeltaBps: 4,
      affectedHoldings: [],
      recommendedActions: [],
    });

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='valuation-health-user-tip']")?.textContent).toContain("No action needed");
    expect(document.body.textContent).toContain("within the configured threshold");
    expect(document.body.textContent).not.toContain("Admin repair required");
    expect(document.body.textContent).not.toContain("No repair action is available here.");
    expect(document.querySelector("[data-testid='valuation-health-admin-repair']")).toBeNull();
  });

  it("can explain strict valuation totals without introducing a separate page-level banner", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          strictTotalsNotice="Main valuation KPIs stay unavailable instead of showing partial totals while one or more affected holdings are still waiting for current reportable valuations."
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='valuation-health-strict-totals-alert']")?.textContent).toContain("partial totals");
    expect(document.querySelector("[data-testid='valuation-health-panel']")).not.toBeNull();
  });

  it("explains material gaps that are waiting for the next market bar", async () => {
    const valuationHealth = buildValuationHealth({
      affectedHoldings: [
        {
          ticker: "VRT",
          marketCode: "US",
          currentReportingValueAmount: 1200,
          latestBarDate: "2026-06-13",
          latestSnapshotDate: null,
          backfillStatus: "ready",
          status: "awaiting_latest_bar",
          recommendedAction: "none",
        },
      ],
      recommendedActions: [],
    });

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions={false}
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='valuation-health-user-tip']")?.textContent).toContain("Waiting for market data");
    expect(document.body.textContent).toContain("Awaiting latest bar");
    expect(document.body.textContent).toContain("No repair action is available yet.");
    expect(document.body.textContent).not.toContain("Admin repair required");
    expect(document.querySelector("[data-testid='valuation-health-admin-repair']")).toBeNull();
  });

  it("renders an admin repair CTA with the targeted label instead of generic snapshot generation", async () => {
    const valuationHealth = buildValuationHealth();

    act(() => {
      root.render(
        <ValuationHealthPanel
          adminRepairHref={getValuationHealthAdminRepairHref(valuationHealth)}
          copy={getDictionary("en").valuationHealth}
          locale="en"
          showAdminActions
          valuationHealth={valuationHealth}
        />,
      );
    });

    await act(async () => {});

    const repairButton = document.querySelector("[data-testid='valuation-health-admin-repair-US']");
    expect(repairButton?.textContent).toContain("Repair snapshots");
    expect(repairButton?.textContent).not.toContain("Generate snapshots");
    expect(repairButton?.getAttribute("href")).toBe("/admin/market-data/US/backfill?repair=valuation&tickers=VRT&targetDate=2026-06-13&endDate=2026-06-13&fromDate=2026-06-12&startDate=2026-06-12");
  });
});

describe("getValuationHealthAdminRepairHref", () => {
  it("returns a market-scoped backfill route for a single actionable holding", () => {
    expect(getValuationHealthAdminRepairHref(buildValuationHealth())).toBe(
      "/admin/market-data/US/backfill?repair=valuation&tickers=VRT&targetDate=2026-06-13&endDate=2026-06-13&fromDate=2026-06-12&startDate=2026-06-12",
    );
  });

  it("preserves same-market mixed repair tickers in the admin repair link", () => {
    expect(
      getValuationHealthAdminRepairHref(
        buildValuationHealth({
          affectedHoldings: [
            {
              ticker: "VRT",
              marketCode: "US",
              currentReportingValueAmount: 1200,
              latestBarDate: "2026-06-13",
              latestSnapshotDate: "2026-06-12",
              backfillStatus: "ready",
              status: "stale_snapshot",
              recommendedAction: "run_snapshot_repair",
            },
            {
              ticker: "V",
              marketCode: "US",
              currentReportingValueAmount: 800,
              latestBarDate: "2026-06-13",
              latestSnapshotDate: "2026-06-12",
              backfillStatus: "failed",
              status: "backfill_failed",
              recommendedAction: "run_backfill",
            },
          ],
          recommendedActions: ["run_backfill", "run_snapshot_repair"],
        }),
      ),
    ).toBe("/admin/market-data/US/backfill?repair=valuation&tickers=V%2CVRT&targetDate=2026-06-13&endDate=2026-06-13&fromDate=2026-06-12&startDate=2026-06-12");
  });

  it("uses the expected valuation date for stale-bar backfill without using newer other-market data", () => {
    expect(
      getValuationHealthAdminRepairHref(
        buildValuationHealth({
          expectedLatestValuationDate: "2026-06-15",
          latestPartialSnapshotDate: "2026-06-16",
          latestBarAsOf: "2026-06-16",
          affectedHoldings: [
            {
              ticker: "VRT",
              marketCode: "US",
              currentReportingValueAmount: 1200,
              latestBarDate: "2026-06-13",
              latestSnapshotDate: "2026-06-12",
              backfillStatus: "ready",
              status: "missing_latest_bar",
              recommendedAction: "run_backfill",
            },
          ],
          recommendedActions: ["run_backfill"],
        }),
      ),
    ).toBe("/admin/market-data/US/backfill?repair=valuation&tickers=VRT&targetDate=2026-06-15&endDate=2026-06-15&fromDate=2026-06-12&startDate=2026-06-12");
  });

  it("uses the latest market bar as the guided repair target for snapshot-only repairs", () => {
    expect(
      getValuationHealthAdminRepairHref(
        buildValuationHealth({
          expectedLatestValuationDate: "2026-06-16",
          affectedHoldings: [
            {
              ticker: "VRT",
              marketCode: "US",
              currentReportingValueAmount: 1200,
              latestBarDate: "2026-06-13",
              latestSnapshotDate: "2026-06-12",
              backfillStatus: "ready",
              status: "stale_snapshot",
              recommendedAction: "run_snapshot_repair",
            },
          ],
          recommendedActions: ["run_snapshot_repair"],
        }),
      ),
    ).toBe("/admin/market-data/US/backfill?repair=valuation&tickers=VRT&targetDate=2026-06-13&endDate=2026-06-13&fromDate=2026-06-12&startDate=2026-06-12");
  });

  it("preserves same-market snapshot repair tickers in the admin repair link", () => {
    expect(
      getValuationHealthAdminRepairHref(
        buildValuationHealth({
          affectedHoldings: [
            {
              ticker: "VRT",
              marketCode: "US",
              currentReportingValueAmount: 1200,
              latestBarDate: "2026-06-13",
              latestSnapshotDate: "2026-06-12",
              backfillStatus: "ready",
              status: "stale_snapshot",
              recommendedAction: "run_snapshot_repair",
            },
            {
              ticker: "V",
              marketCode: "US",
              currentReportingValueAmount: 800,
              latestBarDate: "2026-06-13",
              latestSnapshotDate: "2026-06-12",
              backfillStatus: "ready",
              status: "stale_snapshot",
              recommendedAction: "run_snapshot_repair",
            },
          ],
          recommendedActions: ["run_snapshot_repair"],
        }),
      ),
    ).toBe("/admin/market-data/US/backfill?repair=valuation&tickers=V%2CVRT&targetDate=2026-06-13&endDate=2026-06-13&fromDate=2026-06-12&startDate=2026-06-12");
  });

  it("caps snapshot repair deep links at the admin API ticker limit", () => {
    const affectedHoldings = Array.from({ length: 21 }, (_, index) => ({
      ticker: `T${index + 1}`,
      marketCode: "US" as const,
      currentReportingValueAmount: 100,
      latestBarDate: "2026-06-13",
      latestSnapshotDate: "2026-06-12",
      backfillStatus: "ready" as const,
      status: "stale_snapshot" as const,
      recommendedAction: "run_snapshot_repair" as const,
    }));

    const href = getValuationHealthAdminRepairHref(
      buildValuationHealth({
        affectedHoldings,
        recommendedActions: ["run_snapshot_repair"],
      }),
    );

    expect(href).toContain("repair=valuation");
    expect(href).toContain("fromDate=2026-06-12");
    expect(href).toContain("targetDate=2026-06-13");
    expect(href).toContain("truncated=true");
    expect(new URLSearchParams(href?.split("?")[1]).get("tickers")?.split(",")).toHaveLength(20);
  });

  it("returns one deep link per affected market", () => {
    const links = getValuationHealthAdminRepairLinks(
      buildValuationHealth({
        affectedHoldings: [
          {
            ticker: "VRT",
            marketCode: "US",
            currentReportingValueAmount: 1200,
            latestBarDate: "2026-06-13",
            latestSnapshotDate: "2026-06-12",
            backfillStatus: "ready",
            status: "stale_snapshot",
            recommendedAction: "run_snapshot_repair",
          },
          {
            ticker: "0050",
            marketCode: "TW",
            currentReportingValueAmount: 900,
            latestBarDate: "2026-06-13",
            latestSnapshotDate: "2026-06-11",
            backfillStatus: "failed",
            status: "backfill_failed",
            recommendedAction: "run_backfill",
          },
        ],
        recommendedActions: ["run_backfill", "run_snapshot_repair"],
      }),
    );

    expect(links.map((link) => link.marketCode)).toEqual(["TW", "US"]);
    expect(links[0]?.href).toContain("/admin/market-data/TW/backfill?repair=valuation");
    expect(links[1]?.href).toContain("/admin/market-data/US/backfill?repair=valuation");
  });
});
