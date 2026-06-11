import type {
  AccountDefaultCurrency,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  LocaleCode,
  ReportHoldingRowDto,
} from "@vakwen/shared-types";
import { formatCurrencyAmount, formatPercent } from "./utils";

type HoldingWithReportingPrice = DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto;

export function getDashboardReportingUnitPrice(
  holding: HoldingWithReportingPrice,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  if (holding.reportingCurrentUnitPrice != null) return holding.reportingCurrentUnitPrice;
  if (holding.fxStatus === "missing") return null;
  return holding.currency === reportingCurrency ? holding.currentUnitPrice : null;
}

export function getDashboardReportingAverageCost(
  holding: HoldingWithReportingPrice,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  if (holding.quantity <= 0) return null;
  if (holding.reportingCostBasisAmount != null) {
    return holding.reportingCostBasisAmount / holding.quantity;
  }
  if (holding.fxStatus === "missing") return null;
  return holding.currency === reportingCurrency ? holding.averageCostPerShare : null;
}

export function getDashboardUnitPnl(
  holding: HoldingWithReportingPrice,
  reportingCurrency: AccountDefaultCurrency,
): { amount: number | null; percent: number | null } {
  const price = getDashboardReportingUnitPrice(holding, reportingCurrency);
  const avgCost = getDashboardReportingAverageCost(holding, reportingCurrency);
  return getUnitPnlMetrics(price, avgCost);
}

export function getReportUnitPnl(row: ReportHoldingRowDto): { amount: number | null; percent: number | null } {
  return getUnitPnlMetrics(row.reportingCurrentUnitPrice, row.reportingAverageCostPerShare);
}

export function getNativeUnitPnl(amountCurrent: number | null, avgCost: number | null): { amount: number | null; percent: number | null } {
  return getUnitPnlMetrics(amountCurrent, avgCost);
}

export function formatUnitPnlValue(options: {
  amount: number | null;
  currency: string;
  locale: LocaleCode;
  percent: number | null;
}): { amount: string; percent: string } {
  return {
    amount: options.amount == null ? "-" : formatCurrencyAmount(options.amount, options.currency, options.locale),
    percent: options.percent == null ? "-" : formatPercent(options.percent, options.locale),
  };
}

function getUnitPnlMetrics(
  currentUnitPrice: number | null,
  averageCostPerShare: number | null,
): { amount: number | null; percent: number | null } {
  if (currentUnitPrice == null || averageCostPerShare == null) {
    return { amount: null, percent: null };
  }
  const amount = currentUnitPrice - averageCostPerShare;
  const percent = averageCostPerShare === 0 ? null : (amount / averageCostPerShare) * 100;
  return { amount, percent };
}
