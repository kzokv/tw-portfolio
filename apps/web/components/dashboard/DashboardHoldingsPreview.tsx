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
import { ChevronRight } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";

type HoldingsPreviewSort = "value" | "daily" | "pnl";

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
  const [selected, setSelected] = useState<DashboardOverviewHoldingGroupDto | null>(null);
  const [sortMode, setSortMode] = useState<HoldingsPreviewSort>("value");
  const marketOptions = useMemo(
    () => ["ALL", ...new Set(groups.map((group) => group.marketCode))],
    [groups],
  );
  const visibleGroups = useMemo(() => {
    const filtered = groups.filter((group) => marketFilter === "ALL" || group.marketCode === marketFilter);
    return filtered
      .slice()
      .sort((left, right) => compareHoldingGroups(left, right, sortMode))
      .slice(0, 8);
  }, [groups, marketFilter, sortMode]);

  return (
    <TooltipProvider delayDuration={150}>
      <Card data-testid="dashboard-holdings-preview">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <CardDescription>Holdings</CardDescription>
              <CardTitle className="mt-1 text-xl">Top holdings</CardTitle>
              <CardDescription className="mt-2">
                Reporting values and prices are shown in {reportingCurrency}; native prices are available in details.
              </CardDescription>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
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
              <Select value={sortMode} onValueChange={(value) => setSortMode(value as HoldingsPreviewSort)}>
                <SelectTrigger className="min-w-36" data-testid="dashboard-holdings-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="value">Value</SelectItem>
                    <SelectItem value="daily">Daily move</SelectItem>
                    <SelectItem value="pnl">P&amp;L</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {visibleGroups.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
              No holdings are available for this market.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
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
          )}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {formatNumber(visibleGroups.length, locale)} of {formatNumber(groups.length, locale)} grouped position(s).
          </p>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/reports?tab=portfolio&scope=all&currencyMode=specified&currency=${reportingCurrency}&range=1Y`}>
              Open Portfolio Report
            </Link>
          </Button>
        </CardFooter>
      </Card>
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

  return (
    <div className="rounded-md border border-border bg-background px-4 py-3" data-testid={`dashboard-holding-preview-${group.ticker}-${group.marketCode}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
            className="font-semibold text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
          >
            {group.ticker}
          </Link>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline">{group.marketCode}</Badge>
            <Badge variant={group.fxStatus === "complete" ? "secondary" : "outline"}>FX {group.fxStatus}</Badge>
            <Badge variant={group.quoteStatus === "current" ? "secondary" : "outline"}>{group.quoteStatus}</Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {group.reportingMarketValueAmount === null ? "-" : formatCompactCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{formatNumber(group.quantity, locale, 2)} units</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <PreviewMetric
          label="Price"
          value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
          title={reportingPrice === null ? undefined : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
          onOpen={onOpen}
          tooltip={nativePrice !== null && group.currency !== reportingCurrency
            ? `Native ${formatCurrencyAmount(nativePrice, group.currency, locale)}${fxRate !== null ? ` · FX ${formatFxRate(fxRate)}` : ""}`
            : "Open price details"}
        />
        <PreviewMetric
          label="Daily"
          toneValue={group.changePercent}
          value={group.changePercent === null ? "-" : formatPercent(group.changePercent, locale)}
        />
        <PreviewMetric
          label="P&L"
          toneValue={group.reportingUnrealizedPnlAmount}
          value={group.reportingUnrealizedPnlAmount === null ? "-" : formatCompactCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale)}
        />
      </div>
    </div>
  );
}

function PreviewMetric({
  label,
  onOpen,
  title,
  toneValue,
  tooltip,
  value,
}: {
  label: string;
  onOpen?: () => void;
  title?: string;
  toneValue?: number | null;
  tooltip?: string;
  value: string;
}) {
  const content = (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-left">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate font-mono text-sm font-semibold tabular-nums", financeToneClass(toneValue))} title={title}>
        {value}
      </p>
    </div>
  );

  if (!onOpen) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="block w-full" onClick={onOpen} aria-label={tooltip ?? label}>
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
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
  const rows = [
    ["Reporting market value", group.reportingMarketValueAmount === null ? "-" : formatCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale), null],
    ["Reporting price", reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale), null],
    ["Native price", group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale), null],
    ["Native market value", group.marketValueAmount === null ? "-" : formatCurrencyAmount(group.marketValueAmount, group.currency, locale), null],
    ["Cost basis", group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale), null],
    ["Unrealized P&L", group.reportingUnrealizedPnlAmount === null ? "-" : formatCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale), group.reportingUnrealizedPnlAmount],
    ["Daily change", group.change === null ? "-" : formatCurrencyAmount(group.change, group.currency, locale), group.change],
    ["Daily change %", group.changePercent === null ? "-" : formatPercent(group.changePercent, locale), group.changePercent],
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

function financeToneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-foreground";
  if (value > 0) return "text-emerald-600";
  return "text-rose-600";
}
