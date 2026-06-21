import type { ReportQueryStateDto, ReportSummaryTotalsDto } from "@vakwen/shared-types";

export function buildRealizedPnlTransactionsHref({
  query,
  returnTo,
}: {
  query: Pick<ReportQueryStateDto, "rangeEndDate" | "rangeStartDate" | "scope">;
  returnTo: string;
}): string {
  const params = new URLSearchParams({
    type: "SELL",
    pnl: "realized",
    from: query.rangeStartDate,
    to: query.rangeEndDate,
    returnTo,
  });

  if (query.scope !== "all") {
    params.set("marketCode", query.scope.toUpperCase());
  }

  return `/transactions?${params.toString()}`;
}

export function hasRealizedPnlTransactionDrilldown(summary: Pick<ReportSummaryTotalsDto, "realizedPnlTransactionCount">): boolean {
  return summary.realizedPnlTransactionCount > 0;
}
