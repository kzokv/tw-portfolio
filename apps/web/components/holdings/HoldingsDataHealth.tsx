"use client";

import type { AppDictionary } from "../../lib/i18n/types";
import { Badge } from "../ui/shadcn/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";
import { holdingsWarningBadgeClassName } from "./holdingsStyle";

type QuoteStatus = "current" | "missing" | "provisional";
type FxStatus = "complete" | "missing" | "partial";
type FreshnessStatus = "current" | "stale_amber" | "stale_red";

export interface HoldingsDataHealthRowLike {
  allocationBasisFallbackReason?: "missing_quote" | null;
  allocationBasisUsed?: "cost_basis" | "market_value" | null;
  freshness: FreshnessStatus;
  freshnessTooltip?: string | null;
  fxStatus: FxStatus;
  quoteStatus: QuoteStatus;
}

export function HoldingsDataHealthBadges({
  dict,
  row,
  showAllocationFallback = false,
  showCurrentFreshness = true,
}: {
  dict: AppDictionary;
  row: HoldingsDataHealthRowLike;
  showAllocationFallback?: boolean;
  showCurrentFreshness?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-wrap gap-1" aria-label={formatHoldingsDataHealthTitle(dict, row)}>
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
            {showCurrentFreshness || row.freshness !== "current" ? (
              <Badge
                variant={row.freshness === "current" ? "secondary" : row.freshness === "stale_red" ? "destructive" : "outline"}
                className={row.freshness === "stale_amber" ? holdingsWarningBadgeClassName : undefined}
              >
                {getHoldingsFreshnessLabel(dict, row.freshness)}
              </Badge>
            ) : null}
            {showAllocationFallback && row.allocationBasisFallbackReason === "missing_quote" ? (
              <Badge variant="outline" className={holdingsWarningBadgeClassName}>
                {dict.dashboardHome.allocationFallbackLabel}
              </Badge>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-xs">
          <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
            <div className="font-medium text-foreground">{dict.holdings.dataHealthTerm}</div>
            <div>{dict.holdings.dataHealthDescription}</div>
            <div>{formatHoldingsDataHealthTitle(dict, row)}</div>
            {row.freshnessTooltip ? <div>{row.freshnessTooltip}</div> : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function formatHoldingsDataHealthTitle(dict: AppDictionary, row: HoldingsDataHealthRowLike) {
  const parts = [
    `${dict.holdings.dataHealthTerm}: ${getHoldingsQuoteStatusLabel(dict, row.quoteStatus)}`,
    getHoldingsFxStatusLabel(dict, row.fxStatus),
    getHoldingsFreshnessLabel(dict, row.freshness),
  ];
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

export function getHoldingsFreshnessLabel(dict: AppDictionary, status: FreshnessStatus) {
  if (status === "current") return dict.holdings.freshnessCurrent;
  if (status === "stale_amber") return dict.holdings.freshnessStale;
  return dict.holdings.freshnessDelayed;
}
