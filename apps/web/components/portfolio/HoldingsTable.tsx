"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import type {
  AccountDto,
  DashboardOverviewHoldingDto,
  InstrumentOptionDto,
  LocaleCode,
} from "@vakwen/shared-types";
import { Building2, ChevronDown, ChevronRight, Columns3, Search, SlidersHorizontal } from "lucide-react";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { buildAllocationPercentages, getAmountForAllocationBasis, resolveHoldingGroups, type DashboardOverviewHoldingChildDto, type DashboardOverviewHoldingGroupDto, type HoldingAllocationBasis } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";
import { Checkbox } from "../ui/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/shadcn/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../ui/shadcn/toggle-group";

type HoldingsDisplayMode = "aggregated" | "expanded" | "accounts";
type HoldingsColumn =
  | "accounts"
  | "avgCost"
  | "price"
  | "dailyChange"
  | "marketValue"
  | "pnl"
  | "costBasis"
  | "allocation"
  | "nextDividend"
  | "lastDividend";

interface HoldingsTableProps {
  holdings: DashboardOverviewHoldingDto[];
  holdingGroups?: DashboardOverviewHoldingGroupDto[];
  instruments?: InstrumentOptionDto[];
  accounts?: AccountDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  recomputingSymbols?: Set<string>;
  showFreshnessBadge?: boolean;
  variant?: "default" | "compact";
  allocationBasis?: HoldingAllocationBasis;
  onAllocationBasisChange?: (basis: HoldingAllocationBasis) => void;
}

const DEFAULT_COLUMNS: HoldingsColumn[] = [
  "accounts",
  "avgCost",
  "price",
  "dailyChange",
  "marketValue",
  "pnl",
  "costBasis",
  "allocation",
  "nextDividend",
  "lastDividend",
];
const toolbarButtonClassName = "inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition hover:bg-muted";

function groupLinkHref(group: DashboardOverviewHoldingGroupDto) {
  return `/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`;
}

function childLinkHref(child: DashboardOverviewHoldingChildDto) {
  return `/tickers/${encodeURIComponent(child.ticker)}?marketCode=${encodeURIComponent(child.marketCode)}&accountId=${encodeURIComponent(child.accountId)}`;
}

function holdingMatchesQuery(group: DashboardOverviewHoldingGroupDto, query: string): boolean {
  if (!query) return true;
  const normalized = query.toUpperCase();
  if (group.ticker.toUpperCase().includes(normalized) || group.marketCode.toUpperCase().includes(normalized)) {
    return true;
  }

  return group.children.some((child) =>
    (child.accountName ?? child.accountId).toUpperCase().includes(normalized)
    || child.accountId.toUpperCase().includes(normalized),
  );
}

function hasRecomputingChild(group: DashboardOverviewHoldingGroupDto, recomputingSymbols?: Set<string>): boolean {
  if (!recomputingSymbols) return false;
  return group.children.some((child) => recomputingSymbols.has(`${child.accountId}:${child.ticker}`));
}

function getStatusLabel(dict: AppDictionary, status: DashboardOverviewHoldingDto["quoteStatus"]) {
  if (status === "current") return dict.holdings.statusCurrent;
  if (status === "provisional") return dict.holdings.statusProvisional;
  return dict.holdings.statusMissing;
}

export function HoldingsTable({
  holdings,
  holdingGroups,
  instruments = [],
  accounts = [],
  dict,
  locale,
  recomputingSymbols,
  showFreshnessBadge = true,
  variant = "default",
  allocationBasis,
  onAllocationBasisChange,
}: HoldingsTableProps) {
  const { allocationBasis: storedBasis, setAllocationBasis: setStoredBasis } = useHoldingAllocationBasis();
  const effectiveAllocationBasis = allocationBasis ?? storedBasis;
  const setEffectiveAllocationBasis = onAllocationBasisChange ?? setStoredBasis;

  const [query, setQuery] = useState("");
  const [displayMode, setDisplayMode] = useState<HoldingsDisplayMode>(variant === "compact" ? "aggregated" : "expanded");
  const [marketFilter, setMarketFilter] = useState<string>("ALL");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<DashboardOverviewHoldingDto["quoteStatus"][]>([]);
  const [visibleColumns, setVisibleColumns] = useState<HoldingsColumn[]>(DEFAULT_COLUMNS);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const deferredQuery = useDeferredValue(query);

  const groups = useMemo(
    () => resolveHoldingGroups({ holdings, holdingGroups, instruments, accounts }),
    [accounts, holdingGroups, holdings, instruments],
  );

  const marketOptions = useMemo(
    () => ["ALL", ...new Set(groups.map((group) => group.marketCode))],
    [groups],
  );

  const accountOptions = useMemo(
    () => groups.flatMap((group) => group.children).reduce<Array<{ id: string; label: string }>>((acc, child) => {
      if (acc.some((entry) => entry.id === child.accountId)) return acc;
      acc.push({ id: child.accountId, label: child.accountName?.trim() || child.accountId });
      return acc;
    }, []),
    [groups],
  );

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (marketFilter !== "ALL" && group.marketCode !== marketFilter) return false;
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(group.quoteStatus)) return false;
      if (selectedAccountIds.length > 0 && !group.children.some((child) => selectedAccountIds.includes(child.accountId))) return false;
      return holdingMatchesQuery(group, deferredQuery.trim());
    });
  }, [deferredQuery, groups, marketFilter, selectedAccountIds, selectedStatuses]);

  const visibleGroupKeys = useMemo(
    () => new Set(filteredGroups.map((group) => `${group.ticker}::${group.marketCode}`)),
    [filteredGroups],
  );

  const expandedState = useMemo(() => {
    if (displayMode === "expanded") {
      return visibleGroupKeys;
    }
    return expandedKeys;
  }, [displayMode, expandedKeys, visibleGroupKeys]);

  const visibleChildRows = useMemo(() => {
    return filteredGroups.flatMap((group) =>
      group.children.filter((child) => {
        if (selectedAccountIds.length > 0 && !selectedAccountIds.includes(child.accountId)) return false;
        if (selectedStatuses.length > 0 && !selectedStatuses.includes(child.quoteStatus)) return false;
        if (!deferredQuery.trim()) return true;
        const normalized = deferredQuery.trim().toUpperCase();
        return child.ticker.toUpperCase().includes(normalized)
          || (child.accountName ?? child.accountId).toUpperCase().includes(normalized)
          || child.accountId.toUpperCase().includes(normalized);
      }),
    );
  }, [deferredQuery, filteredGroups, selectedAccountIds, selectedStatuses]);

  const groupAllocationMap = useMemo(
    () => buildAllocationPercentages(filteredGroups, effectiveAllocationBasis),
    [effectiveAllocationBasis, filteredGroups],
  );

  const childAllocationMap = useMemo(() => {
    const values = visibleChildRows.map((child) => ({
      key: `${child.accountId}:${child.ticker}:${child.marketCode}`,
      ...getAmountForAllocationBasis(child, effectiveAllocationBasis),
    }));
    const total = values.reduce((sum, value) => sum + value.amount, 0);
    return new Map(values.map((value) => [value.key, total > 0 ? (value.amount / total) * 100 : 0]));
  }, [effectiveAllocationBasis, visibleChildRows]);

  function toggleGroup(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleStatus(status: DashboardOverviewHoldingDto["quoteStatus"]) {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }

  function toggleAccount(accountId: string) {
    setSelectedAccountIds((current) =>
      current.includes(accountId) ? current.filter((item) => item !== accountId) : [...current, accountId],
    );
  }

  function toggleColumn(column: HoldingsColumn) {
    setVisibleColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    );
  }

  const isCompact = variant === "compact";
  const visibleGroupCountLabel = dict.holdings.showingTickers
    .replace("{visible}", String(filteredGroups.length))
    .replace("{total}", String(groups.length));

  return (
    <Tooltip.Provider delayDuration={150}>
      <Card data-testid="dashboard-holdings-section">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">{dict.holdings.title}</p>
              <h2 className="mt-2 text-2xl text-foreground sm:text-3xl">{dict.holdings.title}</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{dict.holdings.description}</p>
            </div>
            <div className="text-sm text-muted-foreground">{visibleGroupCountLabel}</div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(220px,1.2fr)_auto_auto_auto_auto_auto] lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">{dict.dashboardHome.holdingsSearchPlaceholder}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={dict.dashboardHome.holdingsSearchPlaceholder}
                className={cn(fieldClassName, "pl-10")}
                data-testid="holdings-filter-input"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <span className="sr-only">{dict.holdings.displayModeLabel}</span>
              <ToggleGroup
                type="single"
                value={displayMode}
                onValueChange={(value) => setDisplayMode(value as HoldingsDisplayMode)}
                className="w-fit"
              >
                <ToggleGroupItem value="aggregated" data-testid="holdings-display-mode-grouped">{dict.holdings.displayModeAggregated}</ToggleGroupItem>
                <ToggleGroupItem value="expanded" data-testid="holdings-display-mode-expanded">{dict.holdings.displayModeExpanded}</ToggleGroupItem>
                <ToggleGroupItem value="accounts" data-testid="holdings-display-mode-account">{dict.holdings.displayModeAccounts}</ToggleGroupItem>
              </ToggleGroup>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-market">
                  {dict.holdings.marketFilterLabel}: {marketFilter === "ALL" ? dict.holdings.allMarketsOption : marketFilter}
                  <ChevronDown className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{dict.holdings.marketFilterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {marketOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option}
                    checked={marketFilter === option}
                    onCheckedChange={() => setMarketFilter(option)}
                  >
                    {option === "ALL" ? dict.holdings.allMarketsOption : option}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-account">
                  <Building2 className="size-4" />
                  {dict.holdings.accountFilterLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>{dict.holdings.accountFilterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedAccountIds.length === 0}
                      onCheckedChange={() => setSelectedAccountIds([])}
                    />
                    {dict.holdings.allAccountsOption}
                  </label>
                </div>
                {accountOptions.map((option) => (
                  <div key={option.id} className="px-2 py-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedAccountIds.includes(option.id)}
                        onCheckedChange={() => toggleAccount(option.id)}
                      />
                      {option.label}
                    </label>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-status">
                  <SlidersHorizontal className="size-4" />
                  {dict.holdings.statusFilterLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{dict.holdings.statusFilterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedStatuses.length === 0}
                      onCheckedChange={() => setSelectedStatuses([])}
                    />
                    {dict.holdings.allStatusesOption}
                  </label>
                </div>
                {(["current", "provisional", "missing"] as const).map((status) => (
                  <div key={status} className="px-2 py-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedStatuses.includes(status)}
                        onCheckedChange={() => toggleStatus(status)}
                      />
                      {getStatusLabel(dict, status)}
                    </label>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-columns">
                    <Columns3 className="size-4" />
                    {dict.holdings.columnsLabel}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{dict.holdings.columnsLabel}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {DEFAULT_COLUMNS.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column}
                      checked={visibleColumns.includes(column)}
                      onCheckedChange={() => toggleColumn(column)}
                    >
                      {columnLabel(dict, column)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{dict.dashboardHome.allocationBasisLabel}</span>
                <ToggleGroup
                  type="single"
                  value={effectiveAllocationBasis}
                  onValueChange={(value) => setEffectiveAllocationBasis(value as HoldingAllocationBasis)}
                >
                  <ToggleGroupItem value="market_value" data-testid="holdings-allocation-basis-market-value">{dict.dashboardHome.allocationBasisMarketValue}</ToggleGroupItem>
                  <ToggleGroupItem value="cost_basis" data-testid="holdings-allocation-basis-cost-basis">{dict.dashboardHome.allocationBasisCostBasis}</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-sm text-muted-foreground">
            {dict.holdings.noResults}
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-card">
            <table className={cn("min-w-[1320px] border-collapse text-sm text-muted-foreground", isCompact && "min-w-[1180px]")} data-testid="holdings-table">
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="w-[280px] px-4 py-3 text-left font-medium">{dict.holdings.tickerTerm}</th>
                  {visibleColumns.includes("accounts") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.parentAccountCountLabel}</th>
                  ) : null}
                  <th className="px-4 py-3 text-right font-medium">{dict.holdings.quantityTerm}</th>
                  {visibleColumns.includes("avgCost") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.avgCostTerm}</th>
                  ) : null}
                  {visibleColumns.includes("price") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.priceTerm}</th>
                  ) : null}
                  {visibleColumns.includes("dailyChange") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.dailyChangeLabel}</th>
                  ) : null}
                  {visibleColumns.includes("marketValue") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.marketValueTerm}</th>
                  ) : null}
                  {visibleColumns.includes("pnl") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.pnlTerm}</th>
                  ) : null}
                  {visibleColumns.includes("costBasis") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.totalCostTerm}</th>
                  ) : null}
                  {visibleColumns.includes("allocation") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.holdings.allocationTerm}</th>
                  ) : null}
                  {visibleColumns.includes("nextDividend") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.nextDividendLabel}</th>
                  ) : null}
                  {visibleColumns.includes("lastDividend") ? (
                    <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.lastDividendLabel}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {displayMode === "accounts"
                  ? visibleChildRows.map((child) => (
                    <HoldingChildRow
                      key={`${child.accountId}:${child.ticker}:${child.marketCode}`}
                      child={child}
                      dict={dict}
                      locale={locale}
                      visibleColumns={visibleColumns}
                      allocationPercent={childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null}
                      allocationBasis={effectiveAllocationBasis}
                      showFreshnessBadge={showFreshnessBadge}
                      isRecomputing={recomputingSymbols?.has(`${child.accountId}:${child.ticker}`) ?? false}
                    />
                  ))
                  : filteredGroups.map((group) => {
                    const groupKey = `${group.ticker}::${group.marketCode}`;
                    const showChildren = expandedState.has(groupKey);
                    const visibleChildren = group.children.filter((child) =>
                      selectedAccountIds.length === 0 || selectedAccountIds.includes(child.accountId),
                    );

                    return (
                      <React.Fragment key={groupKey}>
                        <HoldingGroupRow
                          group={group}
                          dict={dict}
                          locale={locale}
                          visibleColumns={visibleColumns}
                          allocationPercent={groupAllocationMap.get(groupKey) ?? null}
                          allocationBasis={effectiveAllocationBasis}
                          expanded={showChildren}
                          onToggle={() => toggleGroup(groupKey)}
                          showFreshnessBadge={showFreshnessBadge}
                          isRecomputing={hasRecomputingChild(group, recomputingSymbols)}
                        />
                        {showChildren
                          ? visibleChildren.map((child) => (
                            <HoldingChildRow
                              key={`${child.accountId}:${child.ticker}:${child.marketCode}`}
                              child={child}
                              dict={dict}
                              locale={locale}
                              visibleColumns={visibleColumns}
                              allocationPercent={childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null}
                              allocationBasis={effectiveAllocationBasis}
                              showFreshnessBadge={showFreshnessBadge}
                              isRecomputing={recomputingSymbols?.has(`${child.accountId}:${child.ticker}`) ?? false}
                              nested
                            />
                          ))
                          : null}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Tooltip.Provider>
  );
}

function HoldingGroupRow({
  group,
  dict,
  locale,
  visibleColumns,
  allocationPercent,
  allocationBasis,
  expanded,
  onToggle,
  showFreshnessBadge,
  isRecomputing,
}: {
  group: DashboardOverviewHoldingGroupDto;
  dict: AppDictionary;
  locale: LocaleCode;
  visibleColumns: HoldingsColumn[];
  allocationPercent: number | null;
  allocationBasis: HoldingAllocationBasis;
  expanded: boolean;
  onToggle: () => void;
  showFreshnessBadge: boolean;
  isRecomputing: boolean;
}) {
  const allocation = getAmountForAllocationBasis(group, allocationBasis);
  const marketValueAmount = group.reportingMarketValueAmount ?? group.marketValueAmount;
  const costBasisAmount = group.reportingCostBasisAmount ?? group.costBasisAmount;
  const unrealizedPnlAmount = group.reportingUnrealizedPnlAmount ?? group.unrealizedPnlAmount;
  const reportingCurrency = group.reportingCurrency ?? group.currency;

  return (
    <tr className={cn("border-b border-border align-top", isRecomputing && "animate-pulse opacity-50")} data-testid={`holding-group-row-${group.ticker}-${group.marketCode}`}>
      <td className="px-4 py-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
            data-testid={`holding-group-toggle-${group.ticker}-${group.marketCode}`}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <div className="min-w-0">
            <Link href={groupLinkHref(group)} className="font-semibold text-foreground hover:text-primary">
              {group.ticker}
            </Link>
            <p className="text-xs text-muted-foreground">{group.marketCode} · {group.currency}</p>
          </div>
        </div>
      </td>
      {visibleColumns.includes("accounts") ? (
        <td className="px-4 py-3 text-right text-foreground">{formatNumber(group.accountCount, locale)}</td>
      ) : null}
      <td className="px-4 py-3 text-right text-foreground">{formatNumber(group.quantity, locale)}</td>
      {visibleColumns.includes("avgCost") ? (
        <td className="px-4 py-3 text-right">{formatCurrencyAmount(group.averageCostPerShare, group.currency, locale)}</td>
      ) : null}
      {visibleColumns.includes("price") ? (
        <td className={cn("px-4 py-3 text-right font-medium", getCurrentPriceTone(group.currentUnitPrice, group.averageCostPerShare))}>
          {group.currentUnitPrice != null ? formatCurrencyAmount(group.currentUnitPrice, group.currency, locale) : dict.holdings.quoteMissing}
          {showFreshnessBadge && group.freshness !== "current" ? <FreshnessBadge freshness={group.freshness} tooltip={group.freshnessTooltip} testId={`holdings-freshness-badge-${group.ticker}-${group.marketCode}`} /> : null}
        </td>
      ) : null}
      {visibleColumns.includes("dailyChange") ? (
        <DailyChangeCell
          change={group.change}
          changePercent={group.changePercent}
          quoteStatus={group.quoteStatus}
          currency={group.currency}
          dict={dict}
          locale={locale}
          testId={`holding-group-daily-change-${group.ticker}-${group.marketCode}`}
        />
      ) : null}
      {visibleColumns.includes("marketValue") ? (
        <td className="px-4 py-3 text-right">
          {marketValueAmount == null ? "-" : formatCurrencyAmount(marketValueAmount, reportingCurrency, locale)}
        </td>
      ) : null}
      {visibleColumns.includes("pnl") ? (
        <td className={cn("px-4 py-3 text-right font-medium", getUnrealizedPnlTone(unrealizedPnlAmount))}>
          {unrealizedPnlAmount != null ? formatCurrencyAmount(unrealizedPnlAmount, reportingCurrency, locale) : "-"}
          {group.changePercent != null ? <div className="text-xs">{formatPercent(group.changePercent, locale)}</div> : null}
        </td>
      ) : null}
      {visibleColumns.includes("costBasis") ? (
        <td className="px-4 py-3 text-right">{formatCurrencyAmount(costBasisAmount, reportingCurrency, locale)}</td>
      ) : null}
      {visibleColumns.includes("allocation") ? (
        <td className="px-4 py-3 text-right">
          {allocationPercent != null ? formatPercent(allocationPercent, locale) : "-"}
          {allocation.usedFallback ? (
            <div className="text-xs text-amber-600" data-testid={`holding-allocation-fallback-${group.ticker}-${group.marketCode}`}>
              {dict.dashboardHome.allocationFallbackLabel}
            </div>
          ) : null}
        </td>
      ) : null}
      {visibleColumns.includes("nextDividend") ? (
        <td className="px-4 py-3 text-right">
          {group.nextDividendDate ? formatDateLabel(group.nextDividendDate, locale) : "-"}
        </td>
      ) : null}
      {visibleColumns.includes("lastDividend") ? (
        <td className="px-4 py-3 text-right">
          {group.lastDividendPostedDate ? formatDateLabel(group.lastDividendPostedDate, locale) : "-"}
        </td>
      ) : null}
    </tr>
  );
}

function HoldingChildRow({
  child,
  dict,
  locale,
  visibleColumns,
  allocationPercent,
  allocationBasis,
  showFreshnessBadge,
  isRecomputing,
  nested = false,
}: {
  child: DashboardOverviewHoldingChildDto;
  dict: AppDictionary;
  locale: LocaleCode;
  visibleColumns: HoldingsColumn[];
  allocationPercent: number | null;
  allocationBasis: HoldingAllocationBasis;
  showFreshnessBadge: boolean;
  isRecomputing: boolean;
  nested?: boolean;
}) {
  const allocation = getAmountForAllocationBasis(child, allocationBasis);
  const marketValueAmount = child.reportingMarketValueAmount ?? child.marketValueAmount;
  const costBasisAmount = child.reportingCostBasisAmount ?? child.costBasisAmount;
  const unrealizedPnlAmount = child.reportingUnrealizedPnlAmount ?? child.unrealizedPnlAmount;
  const reportingCurrency = child.reportingCurrency ?? child.currency;

  return (
    <tr className={cn("border-b border-border/70 bg-muted/[0.18] align-top", isRecomputing && "animate-pulse opacity-50")} data-testid={`holding-child-row-${child.ticker}-${child.marketCode}-${child.accountId}`}>
      <td className="px-4 py-3">
        <div className={cn("min-w-0", nested && "pl-8")}>
          <Link href={childLinkHref(child)} className="font-medium text-primary hover:underline">
            {child.accountName?.trim() || child.accountId}
          </Link>
          <p className="text-xs text-muted-foreground">{child.ticker} · {child.marketCode}</p>
        </div>
      </td>
      {visibleColumns.includes("accounts") ? (
        <td className="px-4 py-3 text-right text-muted-foreground">-</td>
      ) : null}
      <td className="px-4 py-3 text-right">{formatNumber(child.quantity, locale)}</td>
      {visibleColumns.includes("avgCost") ? (
        <td className="px-4 py-3 text-right">{formatCurrencyAmount(child.averageCostPerShare, child.currency, locale)}</td>
      ) : null}
      {visibleColumns.includes("price") ? (
        <td className={cn("px-4 py-3 text-right font-medium", getCurrentPriceTone(child.currentUnitPrice, child.averageCostPerShare))}>
          {child.currentUnitPrice != null ? formatCurrencyAmount(child.currentUnitPrice, child.currency, locale) : dict.holdings.quoteMissing}
          {showFreshnessBadge && child.freshness !== "current" ? <FreshnessBadge freshness={child.freshness} tooltip={child.freshnessTooltip} testId={`holdings-freshness-badge-${child.accountId}-${child.ticker}`} /> : null}
        </td>
      ) : null}
      {visibleColumns.includes("dailyChange") ? (
        <DailyChangeCell
          change={child.change}
          changePercent={child.changePercent}
          quoteStatus={child.quoteStatus}
          currency={child.currency}
          dict={dict}
          locale={locale}
          testId={`holding-child-daily-change-${child.ticker}-${child.marketCode}-${child.accountId}`}
        />
      ) : null}
      {visibleColumns.includes("marketValue") ? (
        <td className="px-4 py-3 text-right">
          {marketValueAmount == null ? "-" : formatCurrencyAmount(marketValueAmount, reportingCurrency, locale)}
        </td>
      ) : null}
      {visibleColumns.includes("pnl") ? (
        <td className={cn("px-4 py-3 text-right font-medium", getUnrealizedPnlTone(unrealizedPnlAmount))}>
          {unrealizedPnlAmount != null ? formatCurrencyAmount(unrealizedPnlAmount, reportingCurrency, locale) : "-"}
          {child.changePercent != null ? <div className="text-xs">{formatPercent(child.changePercent, locale)}</div> : null}
        </td>
      ) : null}
      {visibleColumns.includes("costBasis") ? (
        <td className="px-4 py-3 text-right">{formatCurrencyAmount(costBasisAmount, reportingCurrency, locale)}</td>
      ) : null}
      {visibleColumns.includes("allocation") ? (
        <td className="px-4 py-3 text-right">
          {allocationPercent != null ? formatPercent(allocationPercent, locale) : "-"}
          {allocation.usedFallback ? (
            <div className="text-xs text-amber-600" data-testid={`holding-allocation-fallback-${child.ticker}-${child.marketCode}-${child.accountId}`}>
              {dict.dashboardHome.allocationFallbackLabel}
            </div>
          ) : null}
        </td>
      ) : null}
      {visibleColumns.includes("nextDividend") ? (
        <td className="px-4 py-3 text-right">{child.nextDividendDate ? formatDateLabel(child.nextDividendDate, locale) : "-"}</td>
      ) : null}
      {visibleColumns.includes("lastDividend") ? (
        <td className="px-4 py-3 text-right">{child.lastDividendPostedDate ? formatDateLabel(child.lastDividendPostedDate, locale) : "-"}</td>
      ) : null}
    </tr>
  );
}

function columnLabel(dict: AppDictionary, column: HoldingsColumn) {
  switch (column) {
    case "accounts":
      return dict.holdings.columnAccounts;
    case "avgCost":
      return dict.holdings.columnAvgCost;
    case "price":
      return dict.holdings.columnPrice;
    case "dailyChange":
      return dict.dashboardHome.dailyChangeLabel;
    case "marketValue":
      return dict.holdings.columnMarketValue;
    case "pnl":
      return dict.holdings.columnPnl;
    case "costBasis":
      return dict.holdings.totalCostTerm;
    case "allocation":
      return dict.holdings.columnAllocation;
    case "nextDividend":
      return dict.dashboardHome.nextDividendLabel;
    case "lastDividend":
      return dict.dashboardHome.lastDividendLabel;
  }
}

function DailyChangeCell({
  change,
  changePercent,
  quoteStatus,
  currency,
  dict,
  locale,
  testId,
}: {
  change: number | null;
  changePercent: number | null;
  quoteStatus: DashboardOverviewHoldingDto["quoteStatus"];
  currency: string;
  dict: AppDictionary;
  locale: LocaleCode;
  testId: string;
}) {
  if (quoteStatus === "missing") {
    return (
      <td className="px-4 py-3 text-right font-medium text-amber-600" data-testid={testId}>
        {dict.dashboardHome.quoteStatusMissing}
      </td>
    );
  }

  if (change === null) {
    return (
      <td className="px-4 py-3 text-right font-medium text-muted-foreground" data-testid={testId}>
        <div>-</div>
        <div className="text-xs">
          {changePercent != null ? formatPercent(changePercent, locale) : "-"}
          {quoteStatus === "provisional" ? (
            <span className="ml-1" aria-label={dict.dashboardHome.quoteStatusProvisional}>{"\u23f1"}</span>
          ) : null}
        </div>
      </td>
    );
  }

  return (
    <td className={cn("px-4 py-3 text-right font-medium", getDailyChangeTone(change))} data-testid={testId}>
      <div>{formatCurrencyAmount(change, currency, locale)}</div>
      <div className="text-xs">
        {changePercent != null ? formatPercent(changePercent, locale) : "-"}
        {quoteStatus === "provisional" ? (
          <span className="ml-1" aria-label={dict.dashboardHome.quoteStatusProvisional}>{"\u23f1"}</span>
        ) : null}
      </div>
    </td>
  );
}

function getCurrentPriceTone(currentUnitPrice: number | null, averageCostPerShare: number): string {
  if (currentUnitPrice == null) return "text-slate-500";
  if (currentUnitPrice > averageCostPerShare) return "text-emerald-600";
  if (currentUnitPrice < averageCostPerShare) return "text-rose-600";
  return "text-foreground";
}

function getDailyChangeTone(change: number): string {
  if (change > 0) return "text-emerald-600";
  if (change < 0) return "text-rose-600";
  return "text-foreground";
}

function getUnrealizedPnlTone(value: number | null): string {
  if (value == null) return "text-slate-500";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-rose-600";
  return "text-foreground";
}

function FreshnessBadge({
  freshness,
  tooltip,
  testId,
}: {
  freshness: DashboardOverviewHoldingDto["freshness"];
  tooltip: string | null;
  testId: string;
}) {
  const className = freshness === "stale_red" ? "bg-rose-500" : "bg-amber-500";
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className={cn("ml-1 inline-flex h-2.5 w-2.5 rounded-full", className)} data-testid={testId} />
      </Tooltip.Trigger>
      {tooltip ? (
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={6} className="rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            {tooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      ) : null}
    </Tooltip.Root>
  );
}
