"use client";

import type { AppDictionary } from "../../lib/i18n/types";
import { collectCalendarUnknownWarnings, type CalendarUnknownWarning, type PriceStateCarrierLike, type DashboardMarketStateLike } from "../../features/price-state/priceState";
import { cn } from "../../lib/utils";

export function CalendarUnknownWarnings<T extends { marketCode: string } & PriceStateCarrierLike>({
  className,
  dict,
  rows,
  marketStates,
}: {
  className?: string;
  dict: AppDictionary;
  rows: T[] | null | undefined;
  marketStates?: DashboardMarketStateLike[] | null;
}) {
  const warnings = collectCalendarUnknownWarnings(rows, marketStates);
  if (warnings.length === 0) return null;
  return (
    <div className={cn("rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900", className)} data-testid="calendar-unknown-warnings" role="status">
      <div className="font-medium">{dict.holdings.calendarUnknownWarningTitle}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {warnings.map((warning) => (
          <li key={`${warning.marketCode}:${warning.calendarYear || "unknown"}`}>
            {formatCalendarUnknownWarning(dict, warning)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatCalendarUnknownWarning(dict: AppDictionary, warning: CalendarUnknownWarning): string {
  const unknown = dict.holdings.priceStateUnknownValue;
  return dict.holdings.calendarUnknownWarningMessage
    .replace("{market}", warning.marketCode)
    .replace("{year}", warning.calendarYear || unknown)
    .replace("{location}", warning.locationLabel)
    .replace("{date}", warning.localDate || unknown);
}
