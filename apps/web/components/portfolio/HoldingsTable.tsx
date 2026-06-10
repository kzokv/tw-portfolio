"use client";

import React, { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import type {
  AccountDto,
  DashboardOverviewHoldingDto,
  InstrumentOptionDto,
  LocaleCode,
} from "@vakwen/shared-types";
import { Building2, ChevronDown, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
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
import {
  HoldingsColumnHeaderContent,
  HoldingsColumnSettingsMenu,
  holdingsColumnCellStyle,
  useHoldingsColumnSettings,
  type HoldingsColumnSettingsState,
  type HoldingsGridColumnDefinition,
} from "../holdings/HoldingsColumnSettings";
import { HoldingsDataHealthBadges } from "../holdings/HoldingsDataHealth";

type HoldingsDisplayMode = "aggregated" | "expanded" | "accounts";
type HoldingsColumn =
  | "ticker"
  | "accounts"
  | "quantity"
  | "avgCost"
  | "price"
  | "dailyChange"
  | "marketValue"
  | "pnl"
  | "health"
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

const PORTFOLIO_HOLDINGS_COLUMNS: Array<HoldingsGridColumnDefinition<HoldingsColumn>> = [
  { id: "ticker", label: "Ticker", defaultWidth: 224, canHide: false },
  { id: "accounts", label: "Accounts", defaultWidth: 112, align: "right" },
  { id: "quantity", label: "Quantity", defaultWidth: 128, canHide: false, align: "right" },
  { id: "avgCost", label: "Average cost", defaultWidth: 144, align: "right" },
  { id: "price", label: "Price", defaultWidth: 144, align: "right" },
  { id: "dailyChange", label: "Daily change", defaultWidth: 144, align: "right" },
  { id: "marketValue", label: "Market value", defaultWidth: 160, align: "right" },
  { id: "pnl", label: "P&L", defaultWidth: 144, align: "right" },
  { id: "health", label: "Data health", defaultWidth: 192 },
  { id: "costBasis", label: "Cost basis", defaultWidth: 160, align: "right" },
  { id: "allocation", label: "Allocation", defaultWidth: 148, align: "right" },
  { id: "nextDividend", label: "Next dividend", defaultWidth: 152, align: "right" },
  { id: "lastDividend", label: "Last dividend", defaultWidth: 152, align: "right" },
];

function isHoldingsDisplayMode(value: string): value is HoldingsDisplayMode {
  return value === "aggregated" || value === "expanded" || value === "accounts";
}

function isHoldingAllocationBasis(value: string): value is HoldingAllocationBasis {
  return value === "market_value" || value === "cost_basis";
}
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
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const deferredQuery = useDeferredValue(query);
  const columnSettings = useHoldingsColumnSettings<HoldingsColumn>({
    columns: PORTFOLIO_HOLDINGS_COLUMNS,
    contextKey: "portfolio.holdings",
    defaultLayoutStyle: variant === "compact" ? "dashboard" : "portfolio",
  });
  const visibleColumnDefs = columnSettings.orderedColumns.filter((column) => columnSettings.visibleColumns.includes(column.id));
  const visibleColumns = visibleColumnDefs.map((column) => column.id);

  useEffect(() => {
    setDisplayMode(columnSettings.layoutStyle === "dashboard" ? "aggregated" : "expanded");
  }, [columnSettings.layoutStyle]);

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

  const isCompact = columnSettings.layoutStyle === "dashboard";
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
                onValueChange={(value) => {
                  if (isHoldingsDisplayMode(value)) setDisplayMode(value);
                }}
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
              <div data-testid="holdings-filter-columns">
                <HoldingsColumnSettingsMenu dict={dict} enableLayoutStyle settings={columnSettings} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{dict.dashboardHome.allocationBasisLabel}</span>
                <ToggleGroup
                  type="single"
                  value={effectiveAllocationBasis}
                  onValueChange={(value) => {
                    if (isHoldingAllocationBasis(value)) setEffectiveAllocationBasis(value);
                  }}
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
            <table className={cn("w-full table-fixed border-collapse text-sm text-muted-foreground [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal [&_th]:break-words", isCompact && "text-xs")} data-testid="holdings-table">
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {visibleColumnDefs.map((column) => (
                    <th
                      key={column.id}
                      className={cn("px-4 py-3 align-top font-medium", column.align === "right" ? "text-right" : "text-left")}
                      style={holdingsColumnCellStyle(columnSettings, column.id)}
                    >
                      <HoldingsColumnHeaderContent
                        align={column.align}
                        column={column.id}
                        dict={dict}
                        label={portfolioColumnLabel(dict, column.id)}
                        settings={columnSettings}
                      />
                    </th>
                  ))}
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
                      columnSettings={columnSettings}
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
                          columnSettings={columnSettings}
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
                              columnSettings={columnSettings}
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
  columnSettings,
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
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
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
  const reportingCurrency = group.reportingCurrency;

  return (
    <tr className={cn("border-b border-border align-top", isRecomputing && "animate-pulse opacity-50")} data-testid={`holding-group-row-${group.ticker}-${group.marketCode}`}>
      {visibleColumns.map((column) => (
        <HoldingGroupCell
          key={column}
          allocation={allocation}
          allocationPercent={allocationPercent}
          column={column}
          columnSettings={columnSettings}
          costBasisAmount={group.reportingCostBasisAmount}
          dict={dict}
          expanded={expanded}
          group={group}
          locale={locale}
          marketValueAmount={group.reportingMarketValueAmount}
          onToggle={onToggle}
          reportingCurrency={reportingCurrency}
          showFreshnessBadge={showFreshnessBadge}
          unrealizedPnlAmount={group.reportingUnrealizedPnlAmount}
        />
      ))}
    </tr>
  );
}

function HoldingChildRow({
  columnSettings,
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
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
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
  const reportingCurrency = child.reportingCurrency;

  return (
    <tr className={cn("border-b border-border/70 bg-muted/[0.18] align-top", isRecomputing && "animate-pulse opacity-50")} data-testid={`holding-child-row-${child.ticker}-${child.marketCode}-${child.accountId}`}>
      {visibleColumns.map((column) => (
        <HoldingChildCell
          key={column}
          allocation={allocation}
          allocationPercent={allocationPercent}
          child={child}
          column={column}
          columnSettings={columnSettings}
          costBasisAmount={child.reportingCostBasisAmount}
          dict={dict}
          locale={locale}
          marketValueAmount={child.reportingMarketValueAmount}
          nested={nested}
          reportingCurrency={reportingCurrency}
          showFreshnessBadge={showFreshnessBadge}
          unrealizedPnlAmount={child.reportingUnrealizedPnlAmount}
        />
      ))}
    </tr>
  );
}

function portfolioColumnLabel(dict: AppDictionary, column: HoldingsColumn) {
  switch (column) {
    case "ticker":
      return dict.holdings.tickerTerm;
    case "accounts":
      return dict.holdings.parentAccountCountLabel;
    case "quantity":
      return dict.holdings.quantityTerm;
    case "avgCost":
      return dict.holdings.avgCostTerm;
    case "price":
      return dict.holdings.priceTerm;
    case "dailyChange":
      return dict.dashboardHome.dailyChangeLabel;
    case "marketValue":
      return dict.holdings.marketValueTerm;
    case "pnl":
      return dict.holdings.pnlTerm;
    case "health":
      return dict.holdings.dataHealthTerm;
    case "costBasis":
      return dict.holdings.totalCostTerm;
    case "allocation":
      return dict.holdings.allocationTerm;
    case "nextDividend":
      return dict.dashboardHome.nextDividendLabel;
    case "lastDividend":
      return dict.dashboardHome.lastDividendLabel;
  }
}

function HoldingGroupCell({
  allocation,
  allocationPercent,
  column,
  columnSettings,
  costBasisAmount,
  dict,
  expanded,
  group,
  locale,
  marketValueAmount,
  onToggle,
  reportingCurrency,
  showFreshnessBadge,
  unrealizedPnlAmount,
}: {
  allocation: ReturnType<typeof getAmountForAllocationBasis>;
  allocationPercent: number | null;
  column: HoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
  costBasisAmount: number | null;
  dict: AppDictionary;
  expanded: boolean;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  marketValueAmount: number | null;
  onToggle: () => void;
  reportingCurrency: string;
  showFreshnessBadge: boolean;
  unrealizedPnlAmount: number | null;
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  if (column === "ticker") {
    return (
      <td className="px-4 py-3" style={style}>
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
            data-testid={`holding-group-toggle-${group.ticker}-${group.marketCode}`}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <div className="min-w-0">
            <Link href={groupLinkHref(group)} className="break-words font-semibold text-foreground hover:text-primary">
              {group.ticker}
            </Link>
            <p className="text-xs text-muted-foreground">{group.marketCode} · {group.currency}</p>
          </div>
        </div>
      </td>
    );
  }
  if (column === "accounts") {
    return <td className="px-4 py-3 text-right text-foreground" style={style}>{formatNumber(group.accountCount, locale)}</td>;
  }
  if (column === "quantity") {
    return <td className="px-4 py-3 text-right text-foreground" style={style}>{formatNumber(group.quantity, locale)}</td>;
  }
  if (column === "avgCost") {
    return <td className="px-4 py-3 text-right" style={style}>{formatCurrencyAmount(group.averageCostPerShare, group.currency, locale)}</td>;
  }
  if (column === "price") {
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getCurrentPriceTone(group.currentUnitPrice, group.averageCostPerShare))} style={style}>
        {group.currentUnitPrice != null ? formatCurrencyAmount(group.currentUnitPrice, group.currency, locale) : dict.holdings.quoteMissing}
        {showFreshnessBadge && group.freshness !== "current" ? <FreshnessBadge freshness={group.freshness} tooltip={group.freshnessTooltip} testId={`holdings-freshness-badge-${group.ticker}-${group.marketCode}`} /> : null}
      </td>
    );
  }
  if (column === "dailyChange") {
    return (
      <DailyChangeCell
        change={group.change}
        changePercent={group.changePercent}
        quoteStatus={group.quoteStatus}
        currency={group.currency}
        dict={dict}
        locale={locale}
        style={style}
        testId={`holding-group-daily-change-${group.ticker}-${group.marketCode}`}
      />
    );
  }
  if (column === "marketValue") {
    return <td className="px-4 py-3 text-right" style={style}>{marketValueAmount == null ? "-" : formatCurrencyAmount(marketValueAmount, reportingCurrency, locale)}</td>;
  }
  if (column === "pnl") {
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getUnrealizedPnlTone(unrealizedPnlAmount))} style={style}>
        {unrealizedPnlAmount != null ? formatCurrencyAmount(unrealizedPnlAmount, reportingCurrency, locale) : "-"}
        {group.changePercent != null ? <div className="text-xs">{formatPercent(group.changePercent, locale)}</div> : null}
      </td>
    );
  }
  if (column === "health") {
    return (
      <td className="px-4 py-3" style={style}>
        <HoldingsDataHealthBadges dict={dict} row={group} showAllocationFallback />
      </td>
    );
  }
  if (column === "costBasis") {
    return <td className="px-4 py-3 text-right" style={style}>{costBasisAmount == null ? "-" : formatCurrencyAmount(costBasisAmount, reportingCurrency, locale)}</td>;
  }
  if (column === "allocation") {
    return (
      <td className="px-4 py-3 text-right" style={style}>
        {allocationPercent != null ? formatPercent(allocationPercent, locale) : "-"}
        {allocation.usedFallback ? (
          <div className="text-xs text-warning" data-testid={`holding-allocation-fallback-${group.ticker}-${group.marketCode}`}>
            {dict.dashboardHome.allocationFallbackLabel}: {formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}
          </div>
        ) : null}
      </td>
    );
  }
  if (column === "nextDividend") {
    return <td className="px-4 py-3 text-right" style={style}>{group.nextDividendDate ? formatDateLabel(group.nextDividendDate, locale) : "-"}</td>;
  }
  return <td className="px-4 py-3 text-right" style={style}>{group.lastDividendPostedDate ? formatDateLabel(group.lastDividendPostedDate, locale) : "-"}</td>;
}

function HoldingChildCell({
  allocation,
  allocationPercent,
  child,
  column,
  columnSettings,
  costBasisAmount,
  dict,
  locale,
  marketValueAmount,
  nested,
  reportingCurrency,
  showFreshnessBadge,
  unrealizedPnlAmount,
}: {
  allocation: ReturnType<typeof getAmountForAllocationBasis>;
  allocationPercent: number | null;
  child: DashboardOverviewHoldingChildDto;
  column: HoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
  costBasisAmount: number | null;
  dict: AppDictionary;
  locale: LocaleCode;
  marketValueAmount: number | null;
  nested: boolean;
  reportingCurrency: string;
  showFreshnessBadge: boolean;
  unrealizedPnlAmount: number | null;
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  if (column === "ticker") {
    return (
      <td className="px-4 py-3" style={style}>
        <div className={cn("min-w-0", nested && "pl-8")}>
          <Link href={childLinkHref(child)} className="break-words font-medium text-primary hover:underline">
            {child.accountName?.trim() || child.accountId}
          </Link>
          <p className="text-xs text-muted-foreground">{child.ticker} · {child.marketCode}</p>
        </div>
      </td>
    );
  }
  if (column === "accounts") {
    return <td className="px-4 py-3 text-right text-muted-foreground" style={style}>-</td>;
  }
  if (column === "quantity") {
    return <td className="px-4 py-3 text-right" style={style}>{formatNumber(child.quantity, locale)}</td>;
  }
  if (column === "avgCost") {
    return <td className="px-4 py-3 text-right" style={style}>{formatCurrencyAmount(child.averageCostPerShare, child.currency, locale)}</td>;
  }
  if (column === "price") {
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getCurrentPriceTone(child.currentUnitPrice, child.averageCostPerShare))} style={style}>
        {child.currentUnitPrice != null ? formatCurrencyAmount(child.currentUnitPrice, child.currency, locale) : dict.holdings.quoteMissing}
        {showFreshnessBadge && child.freshness !== "current" ? <FreshnessBadge freshness={child.freshness} tooltip={child.freshnessTooltip} testId={`holdings-freshness-badge-${child.accountId}-${child.ticker}`} /> : null}
      </td>
    );
  }
  if (column === "dailyChange") {
    return (
      <DailyChangeCell
        change={child.change}
        changePercent={child.changePercent}
        quoteStatus={child.quoteStatus}
        currency={child.currency}
        dict={dict}
        locale={locale}
        style={style}
        testId={`holding-child-daily-change-${child.ticker}-${child.marketCode}-${child.accountId}`}
      />
    );
  }
  if (column === "marketValue") {
    return <td className="px-4 py-3 text-right" style={style}>{marketValueAmount == null ? "-" : formatCurrencyAmount(marketValueAmount, reportingCurrency, locale)}</td>;
  }
  if (column === "pnl") {
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getUnrealizedPnlTone(unrealizedPnlAmount))} style={style}>
        {unrealizedPnlAmount != null ? formatCurrencyAmount(unrealizedPnlAmount, reportingCurrency, locale) : "-"}
        {child.changePercent != null ? <div className="text-xs">{formatPercent(child.changePercent, locale)}</div> : null}
      </td>
    );
  }
  if (column === "health") {
    return (
      <td className="px-4 py-3" style={style}>
        <HoldingsDataHealthBadges dict={dict} row={child} showAllocationFallback />
      </td>
    );
  }
  if (column === "costBasis") {
    return <td className="px-4 py-3 text-right" style={style}>{costBasisAmount == null ? "-" : formatCurrencyAmount(costBasisAmount, reportingCurrency, locale)}</td>;
  }
  if (column === "allocation") {
    return (
      <td className="px-4 py-3 text-right" style={style}>
        {allocationPercent != null ? formatPercent(allocationPercent, locale) : "-"}
        {allocation.usedFallback ? (
          <div className="text-xs text-warning" data-testid={`holding-allocation-fallback-${child.ticker}-${child.marketCode}-${child.accountId}`}>
            {dict.dashboardHome.allocationFallbackLabel}: {formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}
          </div>
        ) : null}
      </td>
    );
  }
  if (column === "nextDividend") {
    return <td className="px-4 py-3 text-right" style={style}>{child.nextDividendDate ? formatDateLabel(child.nextDividendDate, locale) : "-"}</td>;
  }
  return <td className="px-4 py-3 text-right" style={style}>{child.lastDividendPostedDate ? formatDateLabel(child.lastDividendPostedDate, locale) : "-"}</td>;
}

function DailyChangeCell({
  change,
  changePercent,
  quoteStatus,
  currency,
  dict,
  locale,
  style,
  testId,
}: {
  change: number | null;
  changePercent: number | null;
  quoteStatus: DashboardOverviewHoldingDto["quoteStatus"];
  currency: string;
  dict: AppDictionary;
  locale: LocaleCode;
  style?: CSSProperties;
  testId: string;
}) {
  if (quoteStatus === "missing") {
    return (
      <td className="px-4 py-3 text-right font-medium text-warning" data-testid={testId} style={style}>
        {dict.dashboardHome.quoteStatusMissing}
      </td>
    );
  }

  if (change === null) {
    return (
      <td className="px-4 py-3 text-right font-medium text-muted-foreground" data-testid={testId} style={style}>
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
    <td className={cn("px-4 py-3 text-right font-medium", getDailyChangeTone(change))} data-testid={testId} style={style}>
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
  if (currentUnitPrice == null) return "text-muted-foreground";
  if (currentUnitPrice > averageCostPerShare) return "text-success";
  if (currentUnitPrice < averageCostPerShare) return "text-destructive";
  return "text-foreground";
}

function getDailyChangeTone(change: number): string {
  if (change > 0) return "text-success";
  if (change < 0) return "text-destructive";
  return "text-foreground";
}

function getUnrealizedPnlTone(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
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
  const className = freshness === "stale_red" ? "bg-destructive" : "bg-warning";
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
