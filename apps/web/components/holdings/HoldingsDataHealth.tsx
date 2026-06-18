"use client";

import type { AppDictionary } from "../../lib/i18n/types";
import { Badge } from "../ui/shadcn/badge";
import { PriceStateChip } from "./PriceStateChip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";
import {
  formatPriceStateLabel,
  formatPriceStateTooltip,
  getPriceState,
  type PriceStateCarrierLike,
} from "../../features/price-state/priceState";
import { holdingsWarningBadgeClassName } from "./holdingsStyle";

type QuoteStatus = "current" | "missing" | "provisional";
type FxStatus = "complete" | "missing" | "partial";

export interface HoldingsDataHealthRowLike extends PriceStateCarrierLike {
  allocationBasisFallbackReason?: "missing_quote" | null;
  allocationBasisUsed?: "cost_basis" | "market_value" | null;
  fxStatus: FxStatus;
  quoteStatus: QuoteStatus;
}

export function HoldingsDataHealthBadges({
  dict,
  locale = "en",
  row,
  showAllocationFallback = false,
}: {
  dict: AppDictionary;
  locale?: "en" | "zh-TW";
  row: HoldingsDataHealthRowLike;
  showAllocationFallback?: boolean;
  /** Deprecated: price chips are now controlled by factual row.priceState. */
  showCurrentFreshness?: boolean;
}) {
  const priceState = getPriceState(row);
  const tooltipLines = priceState ? formatPriceStateTooltip(dict, locale, priceState) : [];

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex flex-wrap gap-1 rounded-md border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={formatHoldingsDataHealthTitle(dict, row, locale)}
          >
            <Badge
              variant={row.quoteStatus === "current" ? "secondary" : row.quoteStatus === "missing" ? "destructive" : "outline"}
              className={row.quoteStatus === "provisional" ? holdingsWarningBadgeClassName : undefined}
            >
              {getHoldingsQuoteStatusLabel(dict, row.quoteStatus)}
            </Badge>
            <Badge
              variant={row.fxStatus === "complete" ? "secondary" : row.fxStatus === "missing" ? "destructive" : "outline"}
              className={row.fxStatus === "partial" ? holdingsWarningBadgeClassName : undefined}
            >
              {getHoldingsFxStatusLabel(dict, row.fxStatus)}
            </Badge>
            {priceState ? (
              <PriceStateChip dict={dict} interactive={false} locale={locale} priceState={priceState} />
            ) : null}
            {showAllocationFallback && row.allocationBasisFallbackReason === "missing_quote" ? (
              <Badge variant="outline" className={holdingsWarningBadgeClassName}>
                {dict.dashboardHome.allocationFallbackLabel}
              </Badge>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-xs">
          <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
            <div className="font-medium text-foreground">{dict.holdings.dataHealthTerm}</div>
            <div>{dict.holdings.dataHealthDescription}</div>
            <div>{formatHoldingsDataHealthTitle(dict, row, locale)}</div>
            {tooltipLines.map((line) => <div key={line}>{line}</div>)}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function formatHoldingsDataHealthTitle(
  dict: AppDictionary,
  row: HoldingsDataHealthRowLike,
  locale: "en" | "zh-TW" = "en",
) {
  const priceState = getPriceState(row);
  const priceStateLabel = priceState ? formatPriceStateLabel(dict, locale, priceState) : null;
  const parts = [
    `${dict.holdings.dataHealthTerm}: ${getHoldingsQuoteStatusLabel(dict, row.quoteStatus)}`,
    getHoldingsFxStatusLabel(dict, row.fxStatus),
  ];
  if (priceStateLabel) parts.push(priceStateLabel);
  if (row.allocationBasisFallbackReason === "missing_quote") {
    parts.push(`${dict.dashboardHome.allocationBasisLabel}: ${dict.holdings.allocationFallbackMissingQuote}`);
  }
  return parts.join(", ");
}

export function getHoldingsQuoteStatusLabel(dict: AppDictionary, status: QuoteStatus) {
  if (status === "current") return dict.holdings.statusCurrent;
  if (status === "provisional") return dict.holdings.statusProvisional;
  return dict.holdings.statusMissing;
}

export function getHoldingsFxStatusLabel(dict: AppDictionary, status: FxStatus) {
  if (status === "complete") return dict.holdings.fxStatusComplete;
  if (status === "partial") return dict.holdings.fxStatusPartial;
  return dict.holdings.fxStatusMissing;
}
