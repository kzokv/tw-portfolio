"use client";

import { useMemo, useState } from "react";
import type { CurrencyCode, HoldingsSelectionMode, LocaleCode } from "@vakwen/shared-types";
import { Check, ChevronDown, Globe2, Search, X } from "lucide-react";
import type { AppDictionary } from "../../lib/i18n/types";
import { cn, formatCurrencyAmount } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/shadcn/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/shadcn/popover";
import type { HoldingsSelectionMetricSummary, HoldingsSelectionVisibleSummary } from "./holdingsSelectionSummary";
import type { HoldingsSelectionUniverseItem } from "./useHoldingsSelection";

interface HoldingsSelectionCopy {
  selectionLabel: string;
  selectionAll: string;
  selectionSelectedCount: string;
  selectionReset: string;
  selectionSearchPlaceholder: string;
  selectionNoMatches: string;
  selectionUnavailable: string;
  selectionUnavailableHint: string;
  selectionRemoveAria: string;
  selectionOpenPickerAria: string;
  selectionVisibleOfSelected: string;
  selectionSummaryCost: string;
  selectionSummaryMarketValue: string;
  selectionSummaryUnrealizedPnl: string;
  selectionSummaryPartial: string;
  selectionToggleAria: string;
}

const FALLBACK_COPY: HoldingsSelectionCopy = {
  selectionLabel: "Selection",
  selectionAll: "All tickers",
  selectionSelectedCount: "{count} selected",
  selectionReset: "Reset to all",
  selectionSearchPlaceholder: "Search tickers",
  selectionNoMatches: "No tickers match the current search.",
  selectionUnavailable: "Unavailable",
  selectionUnavailableHint: "Unavailable tickers are saved until you remove them or reset to all.",
  selectionRemoveAria: "Remove {ticker} from saved selection",
  selectionOpenPickerAria: "Open ticker selection",
  selectionVisibleOfSelected: "{visible} visible of {selected} selected",
  selectionSummaryCost: "Total cost",
  selectionSummaryMarketValue: "Market value",
  selectionSummaryUnrealizedPnl: "Unrealized P&L",
  selectionSummaryPartial: "Partial · {included} of {eligible} included",
  selectionToggleAria: "Toggle {ticker} selection",
};

interface HoldingsSelectionToolbarProps {
  dict?: AppDictionary;
  mode: HoldingsSelectionMode;
  universeItems: Array<HoldingsSelectionUniverseItem & { tickerId: string }>;
  selectedTickerIds: string[];
  availableSelectedTickerIds: string[];
  unavailableTickerIds: string[];
  onReset: () => void;
  onToggleTicker: (tickerId: string) => void;
  onRemoveTicker: (tickerId: string) => void;
}

function formatTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(`{${key}}`, value),
    template,
  );
}

function resolveCopy(dict?: AppDictionary): HoldingsSelectionCopy {
  return { ...FALLBACK_COPY, ...dict?.holdings };
}

function parseTickerId(tickerId: string): { marketCode: string; ticker: string } {
  const [marketCode = "", ticker = tickerId] = tickerId.split(":", 2);
  return { marketCode, ticker };
}

export function HoldingsSelectionToolbar({
  dict,
  mode,
  universeItems,
  selectedTickerIds,
  availableSelectedTickerIds,
  unavailableTickerIds,
  onReset,
  onToggleTicker,
  onRemoveTicker,
}: HoldingsSelectionToolbarProps) {
  const copy = resolveCopy(dict);
  const [query, setQuery] = useState("");

  const groupedItems = useMemo(() => {
    const itemsByTickerId = new Map(universeItems.map((item) => [item.tickerId, item]));
    const unavailableItems = unavailableTickerIds.map((tickerId) => {
      const parsed = parseTickerId(tickerId);
      return {
        tickerId,
        marketCode: parsed.marketCode,
        ticker: parsed.ticker,
        label: parsed.ticker,
        searchText: `${parsed.marketCode} ${parsed.ticker}`.toLowerCase(),
      };
    });
    const allItems = [...universeItems, ...unavailableItems];
    const filteredItems = allItems.filter((item) => {
      const haystack = `${item.marketCode} ${item.ticker} ${item.label} ${item.searchText ?? ""}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
    return Array.from(
      filteredItems.reduce<Map<string, typeof filteredItems>>((acc, item) => {
        const list = acc.get(item.marketCode) ?? [];
        list.push(item);
        acc.set(item.marketCode, list);
        return acc;
      }, new Map()),
    ).sort(([left], [right]) => left.localeCompare(right)).map(([marketCode, items]) => ({
      marketCode,
      items: items.sort((left, right) => left.ticker.localeCompare(right.ticker)),
      totalAvailableCount: universeItems.filter((item) => item.marketCode === marketCode).length,
      selectedAvailableCount: availableSelectedTickerIds.filter((tickerId) => itemsByTickerId.get(tickerId)?.marketCode === marketCode).length,
    }));
  }, [availableSelectedTickerIds, query, unavailableTickerIds, universeItems]);

  const triggerLabel = mode === "all"
    ? copy.selectionAll
    : formatTemplate(copy.selectionSelectedCount, { count: String(selectedTickerIds.length) });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-w-[11rem] justify-between gap-3"
            aria-label={copy.selectionOpenPickerAria}
            data-testid="holdings-selection-picker-trigger"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Globe2 className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] rounded-lg p-0">
          <div className="border-b border-border px-3 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">{copy.selectionSearchPlaceholder}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.selectionSearchPlaceholder}
                className="h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="holdings-selection-picker-search"
              />
            </label>
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {groupedItems.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">{copy.selectionNoMatches}</p>
            ) : (
              groupedItems.map((group) => (
                <div key={group.marketCode} className="border-b border-border/70 last:border-b-0">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <span>{group.marketCode}</span>
                    <span>{group.selectedAvailableCount} / {group.totalAvailableCount}</span>
                  </div>
                  <div className="space-y-1 px-2 pb-2">
                    {group.items.map((item) => {
                      const isUnavailable = unavailableTickerIds.includes(item.tickerId);
                      const checked = !isUnavailable && (mode === "all" || selectedTickerIds.includes(item.tickerId));
                      return (
                        <div key={item.tickerId} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                          <Checkbox
                            checked={checked}
                            disabled={isUnavailable}
                            onCheckedChange={() => onToggleTicker(item.tickerId)}
                            aria-label={formatTemplate(copy.selectionToggleAria, { ticker: `${item.marketCode}:${item.ticker}` })}
                            data-testid={`holdings-selection-picker-item-${item.tickerId}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{item.ticker}</span>
                              {isUnavailable ? (
                                <span className="rounded-full border border-amber-300/80 bg-amber-100/70 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                                  {copy.selectionUnavailable}
                                </span>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{item.label}</p>
                          </div>
                          {isUnavailable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => onRemoveTicker(item.tickerId)}
                              aria-label={formatTemplate(copy.selectionRemoveAria, { ticker: `${item.marketCode}:${item.ticker}` })}
                              data-testid={`holdings-selection-picker-remove-${item.tickerId}`}
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {mode === "custom" ? (
              <Button
                type="button"
                variant="ghost"
                className="h-auto justify-start px-0 text-sm font-medium text-primary"
                onClick={onReset}
                data-testid="holdings-selection-reset"
              >
                {copy.selectionReset}
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">{copy.selectionUnavailableHint}</p>
          </div>
        </PopoverContent>
      </Popover>
      {mode === "custom" ? (
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={onReset}
          data-testid="holdings-selection-reset-toolbar"
        >
          {copy.selectionReset}
        </Button>
      ) : null}
    </div>
  );
}

export function HoldingsSelectionInlineToggle({
  dict,
  tickerId,
  checked,
  onToggle,
  className,
}: {
  dict?: AppDictionary;
  tickerId: string;
  checked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const copy = resolveCopy(dict);
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onToggle}
      className={className}
      aria-label={formatTemplate(copy.selectionToggleAria, { ticker: tickerId })}
      data-testid={`holdings-selection-toggle-${tickerId}`}
    />
  );
}

function HoldingsSelectionSummaryMetric({
  tone,
  copyLabel,
  currency,
  locale,
  summary,
}: {
  tone?: "default" | "profit" | "loss";
  copyLabel: string;
  currency: CurrencyCode;
  locale: LocaleCode;
  summary: HoldingsSelectionMetricSummary;
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{copyLabel}</p>
      <p className={cn(
        "mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl",
        tone === "profit" && summary.amount !== null && summary.amount > 0 && "text-success",
        tone === "profit" && summary.amount !== null && summary.amount < 0 && "text-destructive",
      )}>
        {summary.amount === null ? "—" : formatCurrencyAmount(summary.amount, currency, locale)}
      </p>
    </div>
  );
}

export function HoldingsSelectionSummaryStrip({
  className,
  dict,
  framed = true,
  locale,
  reportingCurrency,
  summary,
}: {
  className?: string;
  dict?: AppDictionary;
  framed?: boolean;
  locale: LocaleCode;
  reportingCurrency: CurrencyCode;
  summary: HoldingsSelectionVisibleSummary;
}) {
  const copy = resolveCopy(dict);
  return (
    <section
      className={cn(
        "grid gap-4 py-4",
        framed ? "border-y border-border/70" : null,
        className,
      )}
      aria-label={copy.selectionLabel}
      data-testid="holdings-selection-summary-strip"
    >
      <p className="text-sm font-medium text-foreground" data-testid="holdings-selection-summary-counts">
        {formatTemplate(copy.selectionVisibleOfSelected, {
          visible: String(summary.visibleSelectedCount),
          selected: String(summary.globalSelectedCount),
        })}
      </p>
      <div className="grid gap-4 md:grid-cols-3 md:gap-6">
        <div className="min-w-0 border-border/70 md:border-r md:pr-6">
          <HoldingsSelectionSummaryMetric
            copyLabel={copy.selectionSummaryCost}
            currency={reportingCurrency}
            locale={locale}
            summary={summary.cost}
          />
          {summary.cost.isPartial ? (
            <p className="mt-1 text-xs text-amber-700" data-testid="holdings-selection-summary-cost-partial">
              {formatTemplate(copy.selectionSummaryPartial, {
                included: String(summary.cost.includedCount),
                eligible: String(summary.cost.eligibleCount),
              })}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 border-border/70 md:border-r md:pr-6">
          <HoldingsSelectionSummaryMetric
            copyLabel={copy.selectionSummaryMarketValue}
            currency={reportingCurrency}
            locale={locale}
            summary={summary.marketValue}
          />
          {summary.marketValue.isPartial ? (
            <p className="mt-1 text-xs text-amber-700" data-testid="holdings-selection-summary-market-value-partial">
              {formatTemplate(copy.selectionSummaryPartial, {
                included: String(summary.marketValue.includedCount),
                eligible: String(summary.marketValue.eligibleCount),
              })}
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <HoldingsSelectionSummaryMetric
            copyLabel={copy.selectionSummaryUnrealizedPnl}
            currency={reportingCurrency}
            locale={locale}
            tone="profit"
            summary={summary.unrealizedPnl}
          />
          {summary.unrealizedPnl.isPartial ? (
            <p className="mt-1 text-xs text-amber-700" data-testid="holdings-selection-summary-pnl-partial">
              {formatTemplate(copy.selectionSummaryPartial, {
                included: String(summary.unrealizedPnl.includedCount),
                eligible: String(summary.unrealizedPnl.eligibleCount),
              })}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function HoldingsSelectionCheckmark({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center rounded border",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent",
        className,
      )}
      aria-hidden="true"
    >
      <Check className="size-3.5" />
    </span>
  );
}
