import type { ValuationHealthDto } from "@vakwen/shared-types";

const ADMIN_MARKET_DATA_ROOT = "/admin/market-data";
const SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT = 20;

export interface ValuationHealthAdminRepairLink {
  href: string;
  marketCode: string;
  tickers: string[];
  truncated: boolean;
}

export function getValuationHealthAdminRepairHref(
  valuationHealth: ValuationHealthDto | null | undefined,
): string | null {
  return getValuationHealthAdminRepairLinks(valuationHealth)[0]?.href ?? null;
}

export function getValuationHealthAdminRepairLinks(
  valuationHealth: ValuationHealthDto | null | undefined,
): ValuationHealthAdminRepairLink[] {
  if (!valuationHealth) return [];

  const actionableHoldings = valuationHealth.affectedHoldings.filter((holding) =>
    holding.recommendedAction === "run_backfill" || holding.recommendedAction === "run_snapshot_repair",
  );

  if (actionableHoldings.length === 0) return [];

  const byMarket = new Map<string, typeof actionableHoldings>();
  for (const holding of actionableHoldings) {
    byMarket.set(holding.marketCode, [...(byMarket.get(holding.marketCode) ?? []), holding]);
  }

  return [...byMarket.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([marketCode, holdings]) => buildMarketRepairLinks(
      marketCode,
      holdings,
      valuationHealth.expectedLatestValuationDate ?? null,
      valuationHealth.latestPartialSnapshotDate ?? null,
      valuationHealth.latestBarAsOf ?? null,
    ));
}

function buildMarketRepairLinks(
  marketCode: string,
  holdings: ValuationHealthDto["affectedHoldings"],
  expectedLatestValuationDate: string | null,
  latestPartialSnapshotDate: string | null,
  latestBarAsOf: string | null,
): ValuationHealthAdminRepairLink[] {
  const tickers = [...new Set(holdings.map((holding) => holding.ticker))].sort();
  const latestBarRepairDate = holdings
    .map((holding) => holding.latestBarDate)
    .filter((date): date is string => date !== null)
    .reduce<string | null>((max, date) => (max === null || date > max ? date : max), null);
  const needsBackfill = holdings.some((holding) => holding.recommendedAction === "run_backfill");
  const targetRepairDate = needsBackfill
    ? maxDate(expectedLatestValuationDate, latestPartialSnapshotDate, latestBarAsOf, latestBarRepairDate)
    : latestBarRepairDate ?? expectedLatestValuationDate;
  const fromDate = holdings
    .map((holding) => holding.latestSnapshotDate ?? holding.latestBarDate)
    .filter((date): date is string => date !== null)
    .reduce<string | null>((min, date) => (min === null || date < min ? date : min), null);

  const links: ValuationHealthAdminRepairLink[] = [];
  for (let index = 0; index < tickers.length; index += SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT) {
    const batch = tickers.slice(index, index + SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT);
    const params = new URLSearchParams();
    params.set("repair", "valuation");
    params.set("tickers", batch.join(","));
    if (targetRepairDate) {
      params.set("targetDate", targetRepairDate);
      params.set("endDate", targetRepairDate);
    }
    if (fromDate) {
      params.set("fromDate", fromDate);
      params.set("startDate", fromDate);
    }
    if (tickers.length > SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT) {
      params.set("truncated", "true");
      params.set("batch", `${Math.floor(index / SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT) + 1}`);
    }
    links.push({
      href: `${ADMIN_MARKET_DATA_ROOT}/${marketCode}/backfill?${params.toString()}`,
      marketCode,
      tickers: batch,
      truncated: tickers.length > SNAPSHOT_REPAIR_DEEP_LINK_TICKER_LIMIT,
    });
  }
  return links;
}

function maxDate(...dates: Array<string | null>): string | null {
  return dates
    .filter((date): date is string => date !== null)
    .reduce<string | null>((max, date) => (max === null || date > max ? date : max), null);
}
