"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  AccountDefaultCurrency,
  CurrencyCode,
  DashboardOverviewHoldingGroupDto,
  FxConversionRateDto,
  LocaleCode,
} from "@vakwen/shared-types";
import { ChevronRight, Search } from "lucide-react";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatNumber, formatPercent } from "../../lib/utils";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";

type HoldingsPreviewSort = "value" | "daily" | "pnl" | "ticker";

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
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DashboardOverviewHoldingGroupDto | null>(null);
  const [sortMode, setSortMode] = useState<HoldingsPreviewSort>("value");
  const marketOptions = useMemo(
    () => ["ALL", ...new Set(groups.map((group) => group.marketCode))],
    [groups],
  );
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    return groups.filter((group) => {
      const marketMatches = marketFilter === "ALL" || group.marketCode === marketFilter;
      const queryMatches = normalizedQuery === ""
        || group.ticker.toUpperCase().includes(normalizedQuery)
        || group.marketCode.toUpperCase().includes(normalizedQuery);
      return marketMatches && queryMatches;
    });
  }, [groups, marketFilter, query]);
  const visibleGroups = useMemo(
    () => filteredGroups
      .slice()
      .sort((left, right) => compareHoldingGroups(left, right, sortMode))
      .slice(0, 12),
    [filteredGroups, sortMode],
  );
  const reportScope = marketFilter === "ALL" ? "all" : marketFilter;

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
              <div className="grid gap-2 sm:grid-cols-3">
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
  const reportingPrice = getReportingUnitPrice(group);
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
  fxRates,
  groups,
  locale,
  onOpen,
  reportingCurrency,
}: {
  fxRates: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  onOpen: (group: DashboardOverviewHoldingGroupDto) => void;
  reportingCurrency: AccountDefaultCurrency;
}) {
  return (
    <div className="hidden max-h-[34rem] overflow-auto rounded-md border border-border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 top-0 z-30 min-w-36 bg-card">Ticker</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card">Position</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Price</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Market value</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Daily</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">P&amp;L</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card">Health</TableHead>
            <TableHead className="sticky top-0 z-20 bg-card text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const fxRate = findFxRate(fxRates, group.currency, reportingCurrency);
            const reportingPrice = getReportingUnitPrice(group);
            const reportingDailyMove = getReportingDailyMove(group, fxRate);
            return (
              <TableRow key={`${group.ticker}-${group.marketCode}`}>
                <TableCell className="sticky left-0 z-10 bg-card">
                  <div className="flex min-w-36 flex-col gap-1">
                    <Link
                      href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
                      className="font-semibold text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
                    >
                      {group.ticker}
                    </Link>
                    <span className="text-xs text-muted-foreground">{group.marketCode}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-32 flex-col gap-1">
                    <span className="font-mono text-sm tabular-nums">{formatNumber(group.quantity, locale, 2)} units</span>
                    <span className="text-xs text-muted-foreground">
                      {formatNumber(group.accountCount, locale)} acct
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
            );
          })}
        </TableBody>
      </Table>
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
  const reportingPrice = getReportingUnitPrice(group);
  const reportingDailyMove =
    group.change === null || fxRate === null
      ? null
      : group.change * group.quantity * fxRate;
  const nativeDailyMove = group.change === null ? null : group.change * group.quantity;
  const rows = [
    ["Reporting market value", group.reportingMarketValueAmount === null ? "-" : formatCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale), null],
    ["Reporting price", reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale), null],
    ["Native price", group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale), null],
    ["Native market value", group.marketValueAmount === null ? "-" : formatCurrencyAmount(group.marketValueAmount, group.currency, locale), null],
    ["Cost basis", group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale), null],
    ["Unrealized P&L", group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale), group.reportingUnrealizedPnlAmount],
    ["Reporting daily move", reportingDailyMove === null ? "-" : formatFinanceCurrencyAmount(reportingDailyMove, reportingCurrency, locale), reportingDailyMove],
    ["Native daily move", nativeDailyMove === null ? "-" : formatCurrencyAmount(nativeDailyMove, group.currency, locale), nativeDailyMove],
    ["Native unit change", group.change === null ? "-" : formatCurrencyAmount(group.change, group.currency, locale), group.change],
    ["Daily change %", group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale), group.changePercent],
    ["Allocation", group.reportingAllocationPercent === null ? "-" : formatPercent(group.reportingAllocationPercent, locale), null],
    ["FX rate", group.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate), null],
  ] satisfies Array<[string, string, number | null]>;

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <span className="text-sm text-muted-foreground">Ticker page</span>
        <Link
          href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </div>
      {rows.map(([label, value, toneValue]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={cn("text-right font-mono text-sm font-semibold tabular-nums", financeToneClass(toneValue))}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function compareHoldingGroups(
  left: DashboardOverviewHoldingGroupDto,
  right: DashboardOverviewHoldingGroupDto,
  sortMode: HoldingsPreviewSort,
): number {
  if (sortMode === "ticker") {
    return `${left.marketCode}:${left.ticker}`.localeCompare(`${right.marketCode}:${right.ticker}`);
  }
  if (sortMode === "daily") {
    return Math.abs(right.changePercent ?? 0) - Math.abs(left.changePercent ?? 0);
  }
  if (sortMode === "pnl") {
    return (right.reportingUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY)
      - (left.reportingUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY);
  }
  return (right.reportingMarketValueAmount ?? Number.NEGATIVE_INFINITY)
    - (left.reportingMarketValueAmount ?? Number.NEGATIVE_INFINITY);
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

function getReportingUnitPrice(group: DashboardOverviewHoldingGroupDto): number | null {
  if (group.reportingMarketValueAmount === null || group.quantity <= 0) return null;
  return group.reportingMarketValueAmount / group.quantity;
}

function getReportingDailyMove(group: DashboardOverviewHoldingGroupDto, fxRate: number | null): number | null {
  if (group.change === null || fxRate === null) return null;
  return group.change * group.quantity * fxRate;
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
  if (value > 0) return "text-emerald-600";
  return "text-rose-600";
}
