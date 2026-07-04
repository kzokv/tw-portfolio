import { describe, expect, it } from "vitest";
import {
  buildDashboardReportsHealthHref,
  buildReportsHealthHref,
  buildTickerRepairHref,
  parseReportHealthQuery,
} from "../../../features/reports/reportHealthDeepLinks";
import { parseReportRouteState } from "../../../features/reports/reportState";

describe("reportHealthDeepLinks", () => {
  it("parses single and multi reason health query parameters", () => {
    const parsed = parseReportHealthQuery(new URLSearchParams("health=1&healthReason=missing_quote&healthReasons=missing_fx,stale_snapshot&healthReason=unknown"));

    expect(parsed.open).toBe(true);
    expect(parsed.reasons).toEqual(["missing_quote", "missing_fx", "stale_snapshot"]);
  });

  it("preserves report route state while appending health query", () => {
    const href = buildReportsHealthHref({
      state: parseReportRouteState({
        tab: "market",
        scope: "TW",
        range: "1Y",
      }),
      reasons: ["missing_quote"],
    });

    expect(href).toBe("/reports?tab=market&scope=TW&range=1Y&health=1&healthReason=missing_quote");
  });

  it("builds dashboard health links with global report scope", () => {
    expect(buildDashboardReportsHealthHref(["missing_fx"])).toBe(
      "/reports?tab=portfolio&scope=all&health=1&healthReason=missing_fx",
    );
  });

  it("builds ticker repair links with suggested ticker guidance and returnTo", () => {
    const href = buildTickerRepairHref({
      marketCode: "TW",
      reason: "missing_snapshot",
      returnTo: "/reports?tab=portfolio&scope=all&health=1",
      tickers: ["2330", "2317", "2330"],
    });

    expect(href).toBe(
      "/settings/tickers?repair=1&origin=data-health&healthReason=missing_snapshot&market=TW&tickers=2330%2C2317&returnTo=%2Freports%3Ftab%3Dportfolio%26scope%3Dall%26health%3D1",
    );
  });
});
