import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ValuationHealthDto } from "@vakwen/shared-types";
import { ValuationHealthPanel } from "../../../components/valuation/ValuationHealthPanel";
import { getValuationHealthAdminRepairHref } from "../../../components/valuation/valuationHealthAdminLink";
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
    expectedLatestValuationDate: "2026-06-13",
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

    const repairButton = document.querySelector("[data-testid='valuation-health-admin-repair']");
    expect(repairButton?.textContent).toContain("Repair snapshots");
    expect(repairButton?.textContent).not.toContain("Generate snapshots");
    expect(repairButton?.getAttribute("href")).toBe("/admin/market-data/US/backfill?search=VRT");
  });
});

describe("getValuationHealthAdminRepairHref", () => {
  it("returns a market-scoped backfill route for a single actionable holding", () => {
    expect(getValuationHealthAdminRepairHref(buildValuationHealth())).toBe(
      "/admin/market-data/US/backfill?search=VRT",
    );
  });

  it("falls back to the market workspace without a search filter when multiple tickers need repair", () => {
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
    ).toBe("/admin/market-data/US/backfill");
  });

  it("falls back to the landing page when remediation spans multiple markets", () => {
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
      ),
    ).toBe("/admin/market-data");
  });
});
