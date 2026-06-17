"use client";

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
  locale,
  priceState,
  testId,
}: {
  dict: AppDictionary;
  locale: LocaleCode;
  priceState: PriceStateDtoLike | null | undefined;
  testId?: string;
}) {
  const label = formatPriceStateLabel(dict, locale, priceState);
  if (!priceState || !label) return null;
  const tooltipRows = formatPriceStateTooltip(dict, locale, priceState);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="mt-1 inline-flex items-center gap-1.5 rounded-sm bg-transparent p-0 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid={testId}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${getPriceStateToneClassName(priceState)}`}
            />
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
