import type { ValuationHealthDto } from "@vakwen/shared-types";

const ADMIN_MARKET_DATA_ROOT = "/admin/market-data";
const SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT = 20;

export function getValuationHealthAdminRepairHref(
  valuationHealth: ValuationHealthDto | null | undefined,
): string | null {
  if (!valuationHealth) return null;

  const actionableHoldings = valuationHealth.affectedHoldings.filter((holding) =>
    holding.recommendedAction === "run_backfill" || holding.recommendedAction === "run_snapshot_repair",
  );

  if (actionableHoldings.length === 0) return null;

  const markets = [...new Set(actionableHoldings.map((holding) => holding.marketCode))];
  if (markets.length !== 1) {
    return ADMIN_MARKET_DATA_ROOT;
  }

  const hasBackfillAction = actionableHoldings.some((holding) => holding.recommendedAction === "run_backfill");
  const tickers = [...new Set(actionableHoldings.map((holding) => holding.ticker))];
  const snapshotRepairFromDate = actionableHoldings
    .filter((holding) => holding.recommendedAction === "run_snapshot_repair")
    .map((holding) => holding.latestSnapshotDate ?? holding.latestBarDate)
    .filter((date): date is string => date !== null)
    .reduce<string | null>((min, date) => (min === null || date < min ? date : min), null);
  const params = new URLSearchParams();
  if (!hasBackfillAction && tickers.length > 1) {
    const deepLinkTickers = tickers.slice(0, SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT);
    params.set("tickers", deepLinkTickers.join(","));
    if (tickers.length > SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT) {
      params.set("truncated", "true");
    }
  } else if (tickers.length === 1) {
    params.set("search", tickers[0]);
  }
  if (!hasBackfillAction) {
    params.set("repair", "snapshots");
    if (snapshotRepairFromDate) {
      params.set("fromDate", snapshotRepairFromDate);
    }
  }

  const query = params.toString();
  return query
    ? `${ADMIN_MARKET_DATA_ROOT}/${markets[0]}/backfill?${query}`
    : `${ADMIN_MARKET_DATA_ROOT}/${markets[0]}/backfill`;
}
