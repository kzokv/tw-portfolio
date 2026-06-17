"use client";

import { useEffect, useState } from "react";
import type { AppDictionary } from "../../lib/i18n/types";
import type { LocaleCode } from "@vakwen/shared-types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";
import {
  formatPriceStateLabel,
  formatPriceStateTooltip,
  getPriceStateToneClassName,
  type PriceStateDtoLike,
} from "../../features/price-state/priceState";

export function PriceStateChip({
  dict,
  interactive = true,
  locale,
  priceState,
  testId,
}: {
  dict: AppDictionary;
  interactive?: boolean;
  locale: LocaleCode;
  priceState: PriceStateDtoLike | null | undefined;
  testId?: string;
}) {
  const [clientNow, setClientNow] = useState<number | null>(null);
  const label = formatPriceStateLabel(dict, locale, priceState, clientNow ?? getInitialPriceStateNow(priceState));
  useEffect(() => {
    if (!priceState || !priceState.chipState.startsWith("open_")) return;
    setClientNow(Date.now());
    const timer = window.setInterval(() => setClientNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [priceState]);

  if (!priceState || !label) return null;
  const tooltipRows = formatPriceStateTooltip(dict, locale, priceState);
  const chipClassName = "mt-1 inline-flex items-center gap-1.5 rounded-sm bg-transparent p-0 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const dot = (
    <span
      aria-hidden="true"
      className={`h-2 w-2 rounded-full ${getPriceStateToneClassName(priceState)}`}
    />
  );

  if (!interactive) {
    return (
      <span
        aria-label={label}
        className={chipClassName}
        data-testid={testId}
      >
        {dot}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={chipClassName}
            data-testid={testId}
          >
            {dot}
            <span>{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-xs">
          <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
            {tooltipRows.map((row) => (
              <div key={row}>{row}</div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getInitialPriceStateNow(priceState: PriceStateDtoLike | null | undefined): number {
  const timestamp = priceState?.observedAt ?? priceState?.asOfTimestamp;
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
