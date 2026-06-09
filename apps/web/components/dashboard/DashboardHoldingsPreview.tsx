"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type {
  AccountDefaultCurrency,
  CurrencyCode,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  FxConversionRateDto,
  LocaleCode,
} from "@vakwen/shared-types";
import { ChevronRight, Search, Settings2 } from "lucide-react";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Badge } from "../ui/shadcn/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/shadcn/card";
import { Checkbox } from "../ui/shadcn/checkbox";
import { Input } from "../ui/shadcn/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/shadcn/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/shadcn/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/shadcn/table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../ui/shadcn/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";

type HoldingsPreviewSort = "value" | "daily" | "pnl" | "ticker";
type HoldingFocusPreset = "largest" | "worst-pnl" | "best-pnl" | "fx-exposure" | "stale-quotes";

const HOLDING_FOCUS_PRESETS: Array<{ id: HoldingFocusPreset; label: string; sortMode: HoldingsPreviewSort }> = [
  { id: "largest", label: "Largest", sortMode: "value" },
  { id: "worst-pnl", label: "Worst P&L", sortMode: "pnl" },
  { id: "best-pnl", label: "Best P&L", sortMode: "pnl" },
  { id: "fx-exposure", label: "FX exposure", sortMode: "value" },
  { id: "stale-quotes", label: "Stale quotes", sortMode: "daily" },
];

interface DashboardHoldingsPreviewProps {
  fxRates?: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
}

export function DashboardHoldingsPreview({
  fxRates = [],
  groups,
  locale,
  reportingCurrency,
}: DashboardHoldingsPreviewProps) {
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DashboardOverviewHoldingGroupDto | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<HoldingFocusPreset>("largest");
  const [sortMode, setSortMode] = useState<HoldingsPreviewSort>("value");
  const [visiblePresetIds, setVisiblePresetIds] = useState<Set<HoldingFocusPreset>>(
    () => new Set(HOLDING_FOCUS_PRESETS.map((preset) => preset.id)),
  );
  const marketOptions = useMemo(
    () => ["ALL", ...new Set(groups.map((group) => group.marketCode))],
    [groups],
  );
  const accountOptions = useMemo(() => {
    const accounts = new Map<string, string>();
    for (const group of groups) {
      for (const child of group.children) {
        accounts.set(child.accountId, child.accountName ?? child.accountId);
      }
    }
    return [{ id: "ALL", name: "All accounts" }, ...[...accounts.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name))];
  }, [groups]);
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    const baseGroups = groups.filter((group) => {
      const marketMatches = marketFilter === "ALL" || group.marketCode === marketFilter;
      const accountMatches = accountFilter === "ALL" || group.children.some((child) => child.accountId === accountFilter);
      const queryMatches = normalizedQuery === ""
        || group.ticker.toUpperCase().includes(normalizedQuery)
        || group.marketCode.toUpperCase().includes(normalizedQuery)
        || group.children.some((child) =>
          child.accountName?.toUpperCase().includes(normalizedQuery) ||
          child.accountId.toUpperCase().includes(normalizedQuery));
      return marketMatches && accountMatches && queryMatches;
    });
    return applyHoldingPreset(baseGroups, selectedPreset, reportingCurrency);
  }, [accountFilter, groups, marketFilter, query, reportingCurrency, selectedPreset]);
  const visibleGroups = useMemo(
    () => filteredGroups
      .slice()
      .sort((left, right) => compareHoldingGroups(left, right, sortMode, selectedPreset))
      .slice(0, 12),
    [filteredGroups, selectedPreset, sortMode],
  );
  const visiblePresets = HOLDING_FOCUS_PRESETS.filter((preset) => visiblePresetIds.has(preset.id));
  const reportScope = marketFilter === "ALL" ? "all" : marketFilter;
  const handlePresetChange = (value: string) => {
    if (!isHoldingFocusPreset(value)) return;
    setSelectedPreset(value);
    setSortMode(HOLDING_FOCUS_PRESETS.find((preset) => preset.id === value)?.sortMode ?? "value");
  };
  const toggleExpandedRow = (key: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const togglePresetVisibility = (presetId: HoldingFocusPreset) => {
    setVisiblePresetIds((current) => {
      const next = new Set(current);
      if (next.has(presetId) && next.size > 1) next.delete(presetId);
      else next.add(presetId);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div data-testid="dashboard-holdings-section">
        <Card data-testid="dashboard-holdings-preview">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardDescription>Holdings</CardDescription>
                  <Badge variant="secondary">Reporting {reportingCurrency}</Badge>
                  <Badge variant="outline">{formatNumber(groups.length, locale)} grouped</Badge>
                </div>
                <CardTitle className="mt-1 text-xl">Top holdings</CardTitle>
                <CardDescription className="mt-2">
                  Reporting values and prices are shown in {reportingCurrency}. Tap or click a price to inspect native pricing and FX.
                </CardDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Search</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Ticker or market"
                      className="pl-8"
                      data-testid="dashboard-holdings-search"
                    />
                  </div>
                </label>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Market</span>
                  <Select value={marketFilter} onValueChange={setMarketFilter}>
                    <SelectTrigger className="min-w-36" data-testid="dashboard-holdings-market-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {marketOptions.map((market) => (
                          <SelectItem key={market} value={market}>
                            {market === "ALL" ? "All markets" : market}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Account</span>
                  <Select value={accountFilter} onValueChange={setAccountFilter}>
                    <SelectTrigger className="min-w-36" data-testid="dashboard-holdings-account-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {accountOptions.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Sort by</span>
                  <Select value={sortMode} onValueChange={(value) => setSortMode(value as HoldingsPreviewSort)}>
                    <SelectTrigger className="min-w-36" data-testid="dashboard-holdings-sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="value">Value</SelectItem>
                        <SelectItem value="daily">Daily move</SelectItem>
                        <SelectItem value="pnl">P&amp;L</SelectItem>
                        <SelectItem value="ticker">Ticker</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {visibleGroups.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                No holdings are available for this market.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 overflow-x-auto pb-1">
                    <ToggleGroup
                      className="w-max"
                      type="single"
                      value={selectedPreset}
                      onValueChange={handlePresetChange}
                      aria-label="Holding Focus presets"
                      data-testid="dashboard-holdings-presets"
                    >
                      {visiblePresets.map((preset) => (
                        <ToggleGroupItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="ghost" data-testid="dashboard-holdings-preset-settings">
                        <Settings2 data-icon="inline-start" aria-hidden="true" />
                        Chips
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72">
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Chip visibility</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {HOLDING_FOCUS_PRESETS.map((preset) => (
                            <label key={preset.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                              <Checkbox
                                checked={visiblePresetIds.has(preset.id)}
                                onCheckedChange={() => togglePresetVisibility(preset.id)}
                              />
                              <span>{preset.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <HoldingsFxStrip
                  fxRates={fxRates}
                  groups={visibleGroups}
                  locale={locale}
                  reportingCurrency={reportingCurrency}
                />
                <div className="flex flex-col gap-3 md:hidden">
                  {visibleGroups.map((group) => (
                    <DashboardHoldingRow
                      key={`${group.ticker}-${group.marketCode}`}
                      fxRate={findFxRate(fxRates, group.currency, reportingCurrency)}
                      group={group}
                      locale={locale}
                      onOpen={() => setSelected(group)}
                      reportingCurrency={reportingCurrency}
                    />
                  ))}
                </div>
                <DashboardHoldingsTable
                  fxRates={fxRates}
                  groups={visibleGroups}
                  locale={locale}
                  onOpen={(group) => setSelected(group)}
                  expandedRows={expandedRows}
                  accountFilter={accountFilter}
                  onToggleExpanded={toggleExpandedRow}
                  reportingCurrency={reportingCurrency}
                />
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {formatNumber(visibleGroups.length, locale)} of {formatNumber(filteredGroups.length, locale)} matching grouped position(s).
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/reports?tab=portfolio&scope=${reportScope}&currencyMode=specified&currency=${reportingCurrency}&range=1Y`}>
                Open Portfolio Report
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected ? `${selected.ticker} · ${selected.marketCode}` : "Holding details"}</SheetTitle>
            <SheetDescription>Reporting and native price details for the selected holding.</SheetDescription>
          </SheetHeader>
          {selected ? (
            <DashboardHoldingDetail
              fxRate={findFxRate(fxRates, selected.currency, reportingCurrency)}
              group={selected}
              locale={locale}
              reportingCurrency={reportingCurrency}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

function DashboardHoldingRow({
  fxRate,
  group,
  locale,
  onOpen,
  reportingCurrency,
}: {
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  onOpen: () => void;
  reportingCurrency: AccountDefaultCurrency;
}) {
  const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
  const nativePrice = group.currentUnitPrice;
  const dailyMetric = getDailyMetric(group, locale);
  const allocationLabel = group.reportingAllocationPercent === null ? null : formatPercent(group.reportingAllocationPercent, locale);

  return (
    <div
      className="rounded-lg border border-border bg-background px-4 py-3 shadow-sm transition-colors hover:bg-muted/10"
      data-testid={`dashboard-holding-preview-${group.ticker}-${group.marketCode}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
            className="font-semibold text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
          >
            {group.ticker}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatNumber(group.quantity, locale, 2)} units</span>
            <span>{formatNumber(group.accountCount, locale)} account(s)</span>
            {allocationLabel ? <span>{allocationLabel} of portfolio</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline">{group.marketCode}</Badge>
            <Badge variant={group.fxStatus === "complete" ? "secondary" : "outline"}>FX {group.fxStatus}</Badge>
            <Badge variant={getQuoteStatusVariant(group.quoteStatus)}>
              {getQuoteStatusLabel(group.quoteStatus)}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {group.reportingMarketValueAmount === null ? "-" : formatCompactCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Value in {reportingCurrency}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <PricePreviewMetric
          fxRate={fxRate}
          group={group}
          locale={locale}
          reportingCurrency={reportingCurrency}
          reportingPrice={reportingPrice}
        />
        <PreviewMetric
          label="Daily change"
          labelTestId="dashboard-holdings-daily-change-label"
          testId={`holding-group-daily-change-${group.ticker}-${group.marketCode}`}
          title={dailyMetric.title}
          toneValue={dailyMetric.toneValue}
          value={dailyMetric.value}
        />
        <PreviewMetric
          label="P&L"
          toneValue={group.reportingUnrealizedPnlAmount}
          value={group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
        <p className="text-xs text-muted-foreground">
          {nativePrice !== null && group.currency !== reportingCurrency
            ? `Native ${formatUnitPrice(nativePrice, group.currency, locale)} available`
            : "Open details for exact reporting values"}
        </p>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Details
        </Button>
      </div>
    </div>
  );
}

function DashboardHoldingsTable({
  accountFilter,
  expandedRows,
  fxRates,
  groups,
  locale,
  onOpen,
  onToggleExpanded,
  reportingCurrency,
}: {
  accountFilter: string;
  expandedRows: Set<string>;
  fxRates: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  onOpen: (group: DashboardOverviewHoldingGroupDto) => void;
  onToggleExpanded: (key: string) => void;
  reportingCurrency: AccountDefaultCurrency;
}) {
  return (
    <div className="hidden max-h-[34rem] overflow-auto rounded-md border border-border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 top-0 z-30 min-w-36 bg-card">Ticker</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card">Position</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Price ({reportingCurrency})</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Market value ({reportingCurrency})</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Daily ({reportingCurrency})</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">P&amp;L ({reportingCurrency})</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card">Health</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const rowKey = holdingRowKey(group);
            const fxRate = findFxRate(fxRates, group.currency, reportingCurrency);
            const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
            const reportingDailyMove = getReportingDailyMove(group, fxRate);
            const visibleChildren = getVisibleAccountRows(group, accountFilter);
            const isExpanded = expandedRows.has(rowKey);
            return (
              <Fragment key={rowKey}>
                <TableRow data-testid={`dashboard-holding-table-row-${group.ticker}-${group.marketCode}`}>
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <div className="flex min-w-44 items-start gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onToggleExpanded(rowKey)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Hide" : "Show"} ${group.ticker} account rows`}
                        data-testid={`dashboard-holding-expand-${group.ticker}-${group.marketCode}`}
                      >
                        <ChevronRight
                          data-icon="inline-start"
                          aria-hidden="true"
                          className={cn("transition-transform", isExpanded && "rotate-90")}
                        />
                      </Button>
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
                          className="font-semibold text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
                        >
                          {group.ticker}
                        </Link>
                        <span className="text-xs text-muted-foreground">{group.marketCode}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-32 flex-col gap-1">
                      <span className="font-mono text-sm tabular-nums">{formatNumber(group.quantity, locale, 2)} units</span>
                      <span className="text-xs text-muted-foreground">
                        {formatNumber(visibleChildren.length, locale)} acct
                        {group.reportingAllocationPercent === null ? "" : ` · ${formatPercent(group.reportingAllocationPercent, locale)}`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <PriceTextButton
                      fxRate={fxRate}
                      group={group}
                      locale={locale}
                      reportingCurrency={reportingCurrency}
                      reportingPrice={reportingPrice}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {group.reportingMarketValueAmount === null ? "-" : formatCompactCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", financeToneClass(reportingDailyMove ?? group.changePercent))}>
                    <div className="flex flex-col items-end gap-1">
                      <span>{reportingDailyMove === null ? "-" : formatFinanceCurrencyAmount(reportingDailyMove, reportingCurrency, locale, true)}</span>
                      <span className="text-xs">{group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale)}</span>
                    </div>
                  </TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", financeToneClass(group.reportingUnrealizedPnlAmount))}>
                    {group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-36 flex-wrap gap-1">
                      <Badge variant={getQuoteStatusVariant(group.quoteStatus)}>{getQuoteStatusLabel(group.quoteStatus)}</Badge>
                      <Badge variant={group.fxStatus === "complete" ? "secondary" : "outline"}>FX {group.fxStatus}</Badge>
                      {group.freshness !== "current" ? <Badge variant="outline">{getFreshnessLabel(group.freshness)}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(group)}>
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
                {isExpanded
                  ? visibleChildren.map((child) => (
                    <TableRow key={`${rowKey}-${child.accountId}`} className="bg-muted/20" data-testid={`dashboard-holding-account-row-${group.ticker}-${child.accountId}`}>
                      <TableCell className="sticky left-0 z-10 bg-muted">
                        <div className="flex min-w-44 flex-col gap-1 pl-10">
                          <span className="font-medium text-foreground">{child.accountName ?? child.accountId}</span>
                          <span className="text-xs text-muted-foreground">Account position</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-32 flex-col gap-1">
                          <span className="font-mono text-sm tabular-nums">{formatNumber(child.quantity, locale, 2)} units</span>
                          <span className="text-xs text-muted-foreground">
                            {child.reportingAllocationPercent === null ? "-" : `${formatPercent(child.reportingAllocationPercent, locale)} portfolio`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {getReportingChildUnitPrice(child, reportingCurrency) === null
                          ? "-"
                          : formatUnitPrice(getReportingChildUnitPrice(child, reportingCurrency) ?? 0, reportingCurrency, locale)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {child.reportingMarketValueAmount === null ? "-" : formatCompactCurrencyAmount(child.reportingMarketValueAmount, reportingCurrency, locale)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono tabular-nums", financeToneClass(getReportingDailyMove(child, fxRate)))}>
                        {getReportingDailyMove(child, fxRate) === null ? "-" : formatFinanceCurrencyAmount(getReportingDailyMove(child, fxRate) ?? 0, reportingCurrency, locale, true)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono tabular-nums", financeToneClass(child.reportingUnrealizedPnlAmount))}>
                        {child.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(child.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-36 flex-wrap gap-1">
                          <Badge variant={child.fxStatus === "complete" ? "secondary" : "outline"}>FX {child.fxStatus}</Badge>
                          <Badge variant={getQuoteStatusVariant(child.quoteStatus)}>{getQuoteStatusLabel(child.quoteStatus)}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Open ticker
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                  : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function HoldingsFxStrip({
  fxRates,
  groups,
  locale,
  reportingCurrency,
}: {
  fxRates: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
}) {
  const rows = buildHoldingFxRows(groups, fxRates, reportingCurrency);
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="dashboard-holdings-fx-rates"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">FX used for visible holdings</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {rows.length === 0
            ? `No cross-currency conversion required for this ${reportingCurrency} view.`
            : `Prices and values below are converted to ${reportingCurrency}.`}
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {rows.map((row) => (
            <div key={`${row.fromCurrency}-${row.toCurrency}`} className="rounded-md border border-border bg-background px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {row.fromCurrency} to {row.toCurrency}
                </span>
                <Badge variant={row.rate === null ? "outline" : "secondary"}>
                  {row.rate === null ? "Missing" : formatFxRate(row.rate)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(row.holdingCount, locale)} visible holding{row.holdingCount === 1 ? "" : "s"}
                {row.asOf ? ` · ${formatDateLabel(row.asOf, locale)}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewMetric({
  label,
  labelTestId,
  testId,
  title,
  toneValue,
  value,
}: {
  label: string;
  labelTestId?: string;
  testId?: string;
  title?: string;
  toneValue?: number | null;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-left">
      <p className="text-xs text-muted-foreground" data-testid={labelTestId}>{label}</p>
      <p className={cn("mt-1 truncate font-mono text-sm font-semibold tabular-nums", financeToneClass(toneValue))} data-testid={testId} title={title}>
        {value}
      </p>
    </div>
  );
}

function PriceTextButton({
  fxRate,
  group,
  locale,
  reportingCurrency,
  reportingPrice,
}: {
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
}) {
  const tooltip = group.currentUnitPrice !== null && group.currency !== reportingCurrency
    ? `Native ${formatUnitPrice(group.currentUnitPrice, group.currency, locale)}${fxRate !== null ? ` · FX ${formatFxRate(fxRate)}` : ""}`
    : "Reporting and native price details";

  return (
    <Tooltip>
      <Popover>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex flex-col items-end rounded-md px-2 py-1 text-right font-mono tabular-nums text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Open ${group.ticker} price details`}
            >
              <span className="font-semibold">{reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}</span>
              {group.currency !== reportingCurrency && group.currentUnitPrice !== null ? (
                <span className="text-xs text-muted-foreground">Native available</span>
              ) : null}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
        <PricePopoverContent
          fxRate={fxRate}
          group={group}
          locale={locale}
          reportingCurrency={reportingCurrency}
          reportingPrice={reportingPrice}
        />
      </Popover>
    </Tooltip>
  );
}

function PricePreviewMetric({
  fxRate,
  group,
  locale,
  reportingCurrency,
  reportingPrice,
}: {
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
}) {
  const tooltip = group.currentUnitPrice !== null && group.currency !== reportingCurrency
    ? `Native ${formatCurrencyAmount(group.currentUnitPrice, group.currency, locale)}${fxRate !== null ? ` · FX ${formatFxRate(fxRate)}` : ""}`
    : "Reporting and native price details";

  return (
    <Tooltip>
      <Popover>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Open ${group.ticker} price details`}
            >
              <PreviewMetric
                label={`Price (${reportingCurrency})`}
                title={reportingPrice === null ? undefined : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
                value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
        <PricePopoverContent
          fxRate={fxRate}
          group={group}
          locale={locale}
          reportingCurrency={reportingCurrency}
          reportingPrice={reportingPrice}
        />
      </Popover>
    </Tooltip>
  );
}

function PricePopoverContent({
  fxRate,
  group,
  locale,
  reportingCurrency,
  reportingPrice,
}: {
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
}) {
  return (
    <PopoverContent align="start" className="w-80 p-3">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Price translation</p>
          <p className="text-xs text-muted-foreground">
            Reporting currency is {reportingCurrency}.
          </p>
        </div>
        <PriceDetailRow
          label={`Reporting price (${reportingCurrency})`}
          value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
        />
        <PriceDetailRow
          label={`Native price (${group.currency})`}
          value={group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale)}
        />
        <PriceDetailRow
          label="FX rate"
          value={group.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate)}
        />
        <PriceDetailRow
          label="Quote status"
          value={getQuoteStatusLabel(group.quoteStatus)}
        />
      </div>
    </PopoverContent>
  );
}

function PriceDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function DashboardHoldingDetail({
  fxRate,
  group,
  locale,
  reportingCurrency,
}: {
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
}) {
  const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
  const reportingDailyMove =
    group.change === null || fxRate === null
      ? null
      : group.change * group.quantity * fxRate;
  const nativeDailyMove = group.change === null ? null : group.change * group.quantity;
  const portfolioAllocation = group.reportingAllocationPercent === null ? "-" : formatPercent(group.reportingAllocationPercent, locale);
  const reportingAverageCost = getReportingAverageCost(group.reportingCostBasisAmount, group.quantity);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <span className="text-sm text-muted-foreground">Ticker page</span>
        <Link
          href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </div>

      <DetailSection title="Summary">
        <DetailGrid>
          <DetailMetric label="Market value" value={group.reportingMarketValueAmount === null ? "-" : formatCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)} />
          <DetailMetric label="Quantity" value={formatNumber(group.quantity, locale, 2)} />
          <DetailMetric label="Portfolio allocation" value={portfolioAllocation} />
          <DetailMetric label="Market allocation" value="-" />
          <DetailMetric label="Accounts" value={formatNumber(group.children.length, locale)} />
          <DetailMetric label="Lot count" value="-" />
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Accounts">
        <div className="flex flex-col gap-2">
          {group.children.map((child) => (
            <div key={child.accountId} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{child.accountName ?? child.accountId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatNumber(child.quantity, locale, 2)} units
                    {child.reportingAllocationPercent === null ? "" : ` · ${formatPercent(child.reportingAllocationPercent, locale)} portfolio`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold tabular-nums">
                    {child.reportingMarketValueAmount === null ? "-" : formatCompactCurrencyAmount(child.reportingMarketValueAmount, reportingCurrency, locale)}
                  </p>
                  <p className={cn("mt-1 font-mono text-xs tabular-nums", financeToneClass(child.reportingUnrealizedPnlAmount))}>
                    {child.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(child.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DetailMetric label="Book Cost" value={child.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(child.reportingCostBasisAmount, reportingCurrency, locale)} />
                <DetailMetric label="Average cost" value={formatUnitPrice(child.averageCostPerShare, child.currency, locale)} />
                <DetailMetric label="Latest price" value={child.currentUnitPrice === null ? "-" : formatUnitPrice(child.currentUnitPrice, child.currency, locale)} />
                <DetailMetric label="FX rate" value={child.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate)} />
              </div>
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title="Cost/P&L">
        <DetailGrid>
          <DetailMetric label="Book Cost" value={group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale)} />
          <DetailMetric label="FX-Translated Cost" value="-" />
          <DetailMetric label="Unrealized P&L" toneValue={group.reportingUnrealizedPnlAmount} value={group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale)} />
          <DetailMetric label="Daily move" toneValue={reportingDailyMove} value={reportingDailyMove === null ? "-" : formatFinanceCurrencyAmount(reportingDailyMove, reportingCurrency, locale)} />
        </DetailGrid>
      </DetailSection>

      <DetailSection title="FX/Price">
        <DetailGrid>
          <DetailMetric label="Reporting price" value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)} />
          <DetailMetric label="Native price" value={group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale)} />
          <DetailMetric label="Native market value" value={group.marketValueAmount === null ? "-" : formatCurrencyAmount(group.marketValueAmount, group.currency, locale)} />
          <DetailMetric label="Average cost" value={formatUnitPrice(group.averageCostPerShare, group.currency, locale)} />
          <DetailMetric label="Reporting average cost" value={reportingAverageCost === null ? "-" : formatUnitPrice(reportingAverageCost, reportingCurrency, locale)} />
          <DetailMetric label="Latest price" value={group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale)} />
          <DetailMetric label="FX rate" value={group.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate)} />
          <DetailMetric label="Native daily move" toneValue={nativeDailyMove} value={nativeDailyMove === null ? "-" : formatCurrencyAmount(nativeDailyMove, group.currency, locale)} />
          <DetailMetric label="Daily change %" toneValue={group.changePercent} value={group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale)} />
        </DetailGrid>
      </DetailSection>
    </div>
  );
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {children}
    </div>
  );
}

function DetailMetric({ label, toneValue, value }: { label: string; toneValue?: number | null; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-sm font-semibold tabular-nums text-foreground", financeToneClass(toneValue))}>
        {value}
      </p>
    </div>
  );
}
function compareHoldingGroups(
  left: DashboardOverviewHoldingGroupDto,
  right: DashboardOverviewHoldingGroupDto,
  sortMode: HoldingsPreviewSort,
  selectedPreset: HoldingFocusPreset,
): number {
  if (sortMode === "ticker") {
    return `${left.marketCode}:${left.ticker}`.localeCompare(`${right.marketCode}:${right.ticker}`);
  }
  if (sortMode === "daily") {
    return Math.abs(right.changePercent ?? 0) - Math.abs(left.changePercent ?? 0);
  }
  if (sortMode === "pnl") {
    if (selectedPreset === "worst-pnl") {
      return (left.reportingUnrealizedPnlAmount ?? Number.POSITIVE_INFINITY)
        - (right.reportingUnrealizedPnlAmount ?? Number.POSITIVE_INFINITY);
    }
    return (right.reportingUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY)
      - (left.reportingUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY);
  }
  return (right.reportingMarketValueAmount ?? Number.NEGATIVE_INFINITY)
    - (left.reportingMarketValueAmount ?? Number.NEGATIVE_INFINITY);
}

function isHoldingFocusPreset(value: string): value is HoldingFocusPreset {
  return HOLDING_FOCUS_PRESETS.some((preset) => preset.id === value);
}

function applyHoldingPreset(
  groups: DashboardOverviewHoldingGroupDto[],
  preset: HoldingFocusPreset,
  reportingCurrency: AccountDefaultCurrency,
): DashboardOverviewHoldingGroupDto[] {
  if (preset === "fx-exposure") {
    return groups.filter((group) => group.currency !== reportingCurrency);
  }
  if (preset === "stale-quotes") {
    return groups.filter((group) => group.quoteStatus !== "current" || group.freshness !== "current");
  }
  return groups;
}

function holdingRowKey(group: DashboardOverviewHoldingGroupDto): string {
  return `${group.marketCode}:${group.ticker}`;
}

function getVisibleAccountRows(group: DashboardOverviewHoldingGroupDto, accountFilter: string): DashboardOverviewHoldingChildDto[] {
  if (accountFilter === "ALL") return group.children;
  return group.children.filter((child) => child.accountId === accountFilter);
}

function buildHoldingFxRows(
  groups: DashboardOverviewHoldingGroupDto[],
  rates: FxConversionRateDto[],
  reportingCurrency: AccountDefaultCurrency,
): Array<{
  asOf: string | null;
  fromCurrency: CurrencyCode;
  holdingCount: number;
  rate: number | null;
  toCurrency: AccountDefaultCurrency;
}> {
  const counts = new Map<CurrencyCode, number>();
  for (const group of groups) {
    if (group.currency === reportingCurrency) continue;
    counts.set(group.currency, (counts.get(group.currency) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([fromCurrency, holdingCount]) => {
      const fxRate = rates.find((rate) => rate.fromCurrency === fromCurrency && rate.toCurrency === reportingCurrency);
      return {
        asOf: fxRate?.asOf ?? null,
        fromCurrency,
        holdingCount,
        rate: fxRate?.rate ?? null,
        toCurrency: reportingCurrency,
      };
    })
    .sort((left, right) => left.fromCurrency.localeCompare(right.fromCurrency));
}

function getDailyMetric(group: DashboardOverviewHoldingGroupDto, locale: LocaleCode): { title?: string; toneValue: number | null; value: string } {
  if (group.quoteStatus === "missing") {
    return {
      toneValue: null,
      value: "No market data",
    };
  }

  const suffix = group.quoteStatus === "provisional" ? " \u23f1" : "";
  return {
    title: group.change === null ? undefined : formatCurrencyAmount(group.change, group.currency, locale),
    toneValue: group.change ?? group.changePercent,
    value: `${group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale)}${suffix}`,
  };
}

function getQuoteStatusLabel(status: DashboardOverviewHoldingGroupDto["quoteStatus"]): string {
  if (status === "missing") return "No market data";
  if (status === "provisional") return "Provisional \u23f1";
  return "Current";
}

function getQuoteStatusVariant(status: DashboardOverviewHoldingGroupDto["quoteStatus"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "current") return "secondary";
  return "outline";
}

function getFreshnessLabel(status: DashboardOverviewHoldingGroupDto["freshness"]): string {
  if (status === "current") return "Current";
  if (status === "stale_amber") return "Stale";
  return "Delayed";
}

function findFxRate(
  rates: FxConversionRateDto[],
  fromCurrency: string,
  toCurrency: AccountDefaultCurrency,
): number | null {
  if (fromCurrency === toCurrency) return 1;
  return rates.find((rate) => rate.fromCurrency === fromCurrency && rate.toCurrency === toCurrency)?.rate ?? null;
}

function getReportingUnitPrice(
  group: DashboardOverviewHoldingGroupDto,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  const explicitReportingUnitPrice = getExplicitReportingUnitPrice(group, reportingCurrency);
  if (explicitReportingUnitPrice !== null) return explicitReportingUnitPrice;
  if (group.reportingCurrency !== reportingCurrency) return null;
  if (group.reportingMarketValueAmount === null || group.quantity <= 0) return null;
  return group.reportingMarketValueAmount / group.quantity;
}

function getExplicitReportingUnitPrice(
  group: DashboardOverviewHoldingGroupDto,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  if (group.reportingCurrency !== reportingCurrency) return null;
  const candidate = group.reportingCurrentUnitPrice;
  return typeof candidate === "number" ? candidate : null;
}

function getReportingChildUnitPrice(
  child: DashboardOverviewHoldingChildDto,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  if (child.reportingCurrency !== reportingCurrency) return null;
  if (typeof child.reportingCurrentUnitPrice === "number") return child.reportingCurrentUnitPrice;
  if (child.reportingMarketValueAmount === null || child.quantity <= 0) return null;
  return child.reportingMarketValueAmount / child.quantity;
}

function getReportingDailyMove(
  row: Pick<DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto, "change" | "quantity">,
  fxRate: number | null,
): number | null {
  if (row.change === null || fxRate === null) return null;
  return row.change * row.quantity * fxRate;
}

function getReportingAverageCost(costBasisAmount: number | null, quantity: number): number | null {
  if (costBasisAmount === null || quantity <= 0) return null;
  return costBasisAmount / quantity;
}

function formatFxRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}

function formatUnitPrice(value: number, currency: CurrencyCode, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatFinanceCurrencyAmount(
  value: number,
  currency: CurrencyCode,
  locale: LocaleCode,
  compact = false,
): string {
  const formatted = compact
    ? formatCompactCurrencyAmount(Math.abs(value), currency, locale)
    : formatCurrencyAmount(Math.abs(value), currency, locale);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatSignedPercent(value: number, locale: LocaleCode): string {
  const formatted = formatPercent(Math.abs(value), locale);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function financeToneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-foreground";
  if (value > 0) return "text-[hsl(var(--success))]";
  return "text-[hsl(var(--destructive))]";
}
