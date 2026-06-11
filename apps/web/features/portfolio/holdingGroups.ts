import type {
  AccountDto,
  AccountDefaultCurrency,
  CurrencyCode,
  DashboardOverviewHoldingChildDto as SharedDashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto as SharedDashboardOverviewHoldingGroupDto,
  DashboardOverviewHoldingDto,
  HoldingAllocationBasis as SharedHoldingAllocationBasis,
  InstrumentOptionDto,
  MarketCode,
} from "@vakwen/shared-types";
import { marketCodeFor } from "@vakwen/shared-types";

export type HoldingAllocationBasis = SharedHoldingAllocationBasis;
export type DashboardOverviewHoldingChildDto = SharedDashboardOverviewHoldingChildDto;
export type DashboardOverviewHoldingGroupDto = SharedDashboardOverviewHoldingGroupDto;

type HoldingSnapshotLike = {
  holdingGroups?: DashboardOverviewHoldingGroupDto[] | null;
  holdings: DashboardOverviewHoldingDto[];
  instruments?: InstrumentOptionDto[];
  accounts?: AccountDto[];
};

const ACCOUNT_TYPE_ORDER: Record<AccountDto["accountType"], number> = {
  broker: 0,
  bank: 1,
  wallet: 2,
};

const REPORTING_CURRENCIES = new Set(["TWD", "USD", "AUD", "KRW"]);

function resolveHoldingMarketCode(
  holding: DashboardOverviewHoldingDto,
  instruments: InstrumentOptionDto[],
): MarketCode {
  const resolvedMarketCode = (holding as { marketCode?: MarketCode }).marketCode;
  if (resolvedMarketCode) return resolvedMarketCode;

  const matches = instruments.filter((instrument) => instrument.ticker === holding.ticker);
  if (matches.length === 1) {
    return matches[0]!.marketCode as MarketCode;
  }
  try {
    return marketCodeFor(holding.currency);
  } catch {
    return "TW";
  }
}

function resolveReportingCurrency(currency: CurrencyCode): AccountDefaultCurrency {
  return REPORTING_CURRENCIES.has(currency) ? currency as AccountDefaultCurrency : "TWD";
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function maxFreshness(
  items: Array<DashboardOverviewHoldingDto["freshness"]>,
): DashboardOverviewHoldingDto["freshness"] {
  if (items.includes("stale_red")) return "stale_red";
  if (items.includes("stale_amber")) return "stale_amber";
  return "current";
}

function resolveQuoteStatus(
  items: Array<DashboardOverviewHoldingDto["quoteStatus"]>,
): DashboardOverviewHoldingDto["quoteStatus"] {
  if (items.includes("missing")) return "missing";
  if (items.includes("provisional")) return "provisional";
  return "current";
}

function weightedAverageCost(children: DashboardOverviewHoldingChildDto[]): number {
  const totalQuantity = children.reduce((sum, child) => sum + child.quantity, 0);
  if (totalQuantity <= 0) return 0;
  return children.reduce((sum, child) => sum + (child.averageCostPerShare * child.quantity), 0) / totalQuantity;
}

function sortChildren(
  children: DashboardOverviewHoldingChildDto[],
  accountsById: Map<string, AccountDto>,
): DashboardOverviewHoldingChildDto[] {
  return children.slice().sort((left, right) => {
    const leftAccount = accountsById.get(left.accountId);
    const rightAccount = accountsById.get(right.accountId);
    const leftOrder = leftAccount ? ACCOUNT_TYPE_ORDER[leftAccount.accountType] : 99;
    const rightOrder = rightAccount ? ACCOUNT_TYPE_ORDER[rightAccount.accountType] : 99;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return (left.accountName ?? left.accountId).localeCompare(right.accountName ?? right.accountId);
  });
}

export function buildHoldingGroupsFromHoldings({
  holdings,
  instruments = [],
  accounts = [],
}: Pick<HoldingSnapshotLike, "holdings" | "instruments" | "accounts">): DashboardOverviewHoldingGroupDto[] {
  const groups = new Map<string, DashboardOverviewHoldingChildDto[]>();
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  for (const holding of holdings) {
    const marketCode = resolveHoldingMarketCode(holding, instruments);
    const child: DashboardOverviewHoldingChildDto = {
      ...holding,
      marketCode,
      reportingCurrency: resolveReportingCurrency(holding.currency),
      reportingCostBasisAmount: holding.costBasisAmount,
      reportingMarketValueAmount: holding.marketValueAmount,
      reportingUnrealizedPnlAmount: holding.unrealizedPnlAmount,
      reportingDailyChangeAmount:
        holding.change === null || holding.previousClose === null ? null : holding.change * holding.quantity,
      reportingAllocationPercent: holding.allocationPct,
      fxStatus: "complete",
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: null,
    };
    const key = `${child.ticker}::${child.marketCode}::${child.currency}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(child);
    } else {
      groups.set(key, [child]);
    }
  }

  const built = Array.from(groups.values()).map((children) => {
    const sortedChildren = sortChildren(children, accountsById);
    const instrumentName = sortedChildren.find((child) => child.instrumentName?.trim())?.instrumentName ?? null;
    const quantity = sortedChildren.reduce((sum, child) => sum + child.quantity, 0);
    const costBasisAmount = sortedChildren.reduce((sum, child) => sum + child.costBasisAmount, 0);
    const marketValueAmount = sumNullable(sortedChildren.map((child) => child.marketValueAmount));
    const reportingCostBasisAmount = sortedChildren.reduce(
      (sum, child) => sum + (child.reportingCostBasisAmount ?? child.costBasisAmount),
      0,
    );
    const reportingMarketValueAmount = sumNullable(
      sortedChildren.map((child) => child.reportingMarketValueAmount ?? child.marketValueAmount),
    );
    const previousValue = sortedChildren.reduce((sum, child) => {
      if (child.previousClose == null) return sum;
      return sum + (child.previousClose * child.quantity);
    }, 0);
    const change = sumNullable(sortedChildren.map((child) => child.change));

    return {
      ticker: sortedChildren[0]!.ticker,
      instrumentName,
      marketCode: sortedChildren[0]!.marketCode,
      currency: sortedChildren[0]!.currency,
      quantity,
      accountCount: sortedChildren.length,
      averageCostPerShare: weightedAverageCost(sortedChildren),
      currentUnitPrice: sortedChildren.find((child) => child.currentUnitPrice != null)?.currentUnitPrice ?? null,
      costBasisAmount,
      marketValueAmount,
      unrealizedPnlAmount: sumNullable(sortedChildren.map((child) => child.unrealizedPnlAmount)),
      allocationPct: null,
      change,
      changePercent: change != null && previousValue > 0 ? (change / previousValue) * 100 : null,
      previousClose: previousValue > 0 ? previousValue / quantity : null,
      quoteStatus: resolveQuoteStatus(sortedChildren.map((child) => child.quoteStatus)),
      nextDividendDate: sortedChildren
        .map((child) => child.nextDividendDate)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
      lastDividendPostedDate: sortedChildren
        .map((child) => child.lastDividendPostedDate)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      freshness: maxFreshness(sortedChildren.map((child) => child.freshness)),
      freshnessTooltip: sortedChildren.find((child) => child.freshnessTooltip)?.freshnessTooltip ?? null,
      reportingCurrency: sortedChildren[0]!.reportingCurrency ?? sortedChildren[0]!.currency,
      reportingCostBasisAmount,
      reportingMarketValueAmount,
      reportingUnrealizedPnlAmount: sumNullable(
        sortedChildren.map((child) => child.reportingUnrealizedPnlAmount ?? child.unrealizedPnlAmount),
      ),
      reportingDailyChangeAmount: sortedChildren.some((child) => child.reportingDailyChangeAmount == null)
        ? null
        : sumNullable(sortedChildren.map((child) => child.reportingDailyChangeAmount)),
      reportingAllocationPercent: null,
      fxStatus: sortedChildren.every((child) => child.fxStatus === "complete") ? "complete" : "partial",
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: null,
      children: sortedChildren,
    } satisfies DashboardOverviewHoldingGroupDto;
  });

  const totalReportingMarket = built.reduce((sum, group) => sum + (group.reportingMarketValueAmount ?? 0), 0);
  const totalReportingCost = built.reduce((sum, group) => sum + (group.reportingCostBasisAmount ?? group.costBasisAmount), 0);

  return built
    .map((group) => ({
      ...group,
      allocationPct: totalReportingMarket > 0 && group.reportingMarketValueAmount != null
        ? (group.reportingMarketValueAmount / totalReportingMarket) * 100
        : null,
      reportingAllocationPercent: totalReportingMarket > 0 && group.reportingMarketValueAmount != null
        ? (group.reportingMarketValueAmount / totalReportingMarket) * 100
        : totalReportingCost > 0
          ? ((group.reportingCostBasisAmount ?? group.costBasisAmount) / totalReportingCost) * 100
          : null,
      children: group.children.map((child) => ({
        ...child,
        reportingAllocationPercent: totalReportingMarket > 0 && child.reportingMarketValueAmount != null
          ? ((child.reportingMarketValueAmount ?? 0) / totalReportingMarket) * 100
          : totalReportingCost > 0
            ? ((child.reportingCostBasisAmount ?? child.costBasisAmount) / totalReportingCost) * 100
            : null,
      })),
    }))
    .sort((left, right) => {
      const leftValue = left.reportingMarketValueAmount ?? left.reportingCostBasisAmount ?? left.costBasisAmount;
      const rightValue = right.reportingMarketValueAmount ?? right.reportingCostBasisAmount ?? right.costBasisAmount;
      return rightValue - leftValue;
    });
}

export function resolveHoldingGroups(snapshot: HoldingSnapshotLike): DashboardOverviewHoldingGroupDto[] {
  if (Array.isArray(snapshot.holdingGroups) && snapshot.holdingGroups.length > 0) {
    return snapshot.holdingGroups.map((group) => {
      const groupReportingCurrency = group.reportingCurrency ?? group.currency;
      return {
        ...group,
        reportingCurrency: groupReportingCurrency,
        reportingCostBasisAmount: resolveReportingAmount(
          group,
          "reportingCostBasisAmount",
          group.costBasisAmount,
          groupReportingCurrency,
          group.currency,
        ),
        reportingMarketValueAmount: resolveReportingAmount(
          group,
          "reportingMarketValueAmount",
          group.marketValueAmount,
          groupReportingCurrency,
          group.currency,
        ),
            reportingUnrealizedPnlAmount: resolveReportingAmount(
              group,
              "reportingUnrealizedPnlAmount",
              group.unrealizedPnlAmount,
              groupReportingCurrency,
              group.currency,
            ),
            reportingDailyChangeAmount: group.reportingDailyChangeAmount ?? null,
            children: group.children.map((child) => {
          const childReportingCurrency = child.reportingCurrency ?? groupReportingCurrency ?? resolveReportingCurrency(child.currency);
          return {
            ...child,
            reportingCurrency: childReportingCurrency,
            reportingCostBasisAmount: resolveReportingAmount(
              child,
              "reportingCostBasisAmount",
              child.costBasisAmount,
              childReportingCurrency,
              child.currency,
            ),
            reportingMarketValueAmount: resolveReportingAmount(
              child,
              "reportingMarketValueAmount",
              child.marketValueAmount,
              childReportingCurrency,
              child.currency,
            ),
            reportingUnrealizedPnlAmount: resolveReportingAmount(
              child,
              "reportingUnrealizedPnlAmount",
              child.unrealizedPnlAmount,
              childReportingCurrency,
              child.currency,
            ),
            reportingDailyChangeAmount: child.reportingDailyChangeAmount ?? null,
            marketCode: child.marketCode ?? group.marketCode,
          };
        }),
      };
    });
  }

  return buildHoldingGroupsFromHoldings(snapshot);
}

function resolveReportingAmount(
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
  key: "reportingCostBasisAmount" | "reportingMarketValueAmount" | "reportingUnrealizedPnlAmount",
  nativeValue: number | null,
  reportingCurrency: AccountDefaultCurrency,
  nativeCurrency: CurrencyCode,
): number | null {
  const value = row[key];
  if (value != null) return value;
  return reportingCurrency === nativeCurrency ? nativeValue : null;
}

export function getAmountForAllocationBasis(
  holding: Pick<
    DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
    "costBasisAmount" | "marketValueAmount" | "reportingCostBasisAmount" | "reportingMarketValueAmount"
  >,
  basis: HoldingAllocationBasis,
): { amount: number; usedFallback: boolean } {
  const costBasis = holding.reportingCostBasisAmount;
  const marketValue = holding.reportingMarketValueAmount;

  if (basis === "cost_basis") {
    return costBasis == null
      ? { amount: 0, usedFallback: true }
      : { amount: costBasis, usedFallback: false };
  }

  if (marketValue != null) {
    return { amount: marketValue, usedFallback: false };
  }

  return costBasis == null
    ? { amount: 0, usedFallback: true }
    : { amount: costBasis, usedFallback: true };
}

export function buildAllocationPercentages(
  groups: DashboardOverviewHoldingGroupDto[],
  basis: HoldingAllocationBasis,
): Map<string, number> {
  const values = groups.map((group) => ({
    key: `${group.ticker}::${group.marketCode}`,
    ...getAmountForAllocationBasis(group, basis),
  }));
  const total = values.reduce((sum, value) => sum + value.amount, 0);
  return new Map(
    values.map((value) => [value.key, total > 0 ? (value.amount / total) * 100 : 0]),
  );
}

export function findHoldingGroup(
  groups: DashboardOverviewHoldingGroupDto[],
  ticker: string,
  marketCode?: string,
): DashboardOverviewHoldingGroupDto | null {
  return groups.find(
    (group) => group.ticker === ticker && (marketCode ? group.marketCode === marketCode : true),
  ) ?? null;
}
