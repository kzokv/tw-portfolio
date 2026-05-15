// Money — locked Phase 1 primitive for currency rendering.
// Uses Geist Mono + tabular-nums so digits column-align (design §4).
// Wrap every currency value with <Money> going forward. The legacy
// `formatCurrencyAmount(...) → plain string` path stays valid as a fallback
// for non-React contexts (CSV export, error messages, etc.).

import type { HTMLAttributes } from "react";
import type { CurrencyCode, LocaleCode } from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import { formatCurrencyAmount } from "../../lib/utils";

interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  value: number;
  currency: CurrencyCode;
  locale?: LocaleCode;
  /** Apply success/destructive color based on sign. Default false. */
  signed?: boolean;
  /** Render with leading + sign for positive values. Default false. */
  explicitPlus?: boolean;
}

export function Money({
  value,
  currency,
  locale = "en",
  signed = false,
  explicitPlus = false,
  className,
  ...rest
}: MoneyProps) {
  const formatted = formatCurrencyAmount(Math.abs(value), currency, locale);
  const sign = value < 0 ? "−" : explicitPlus ? "+" : "";
  const tone = signed ? (value < 0 ? "text-destructive" : value > 0 ? "text-success" : "") : "";
  return (
    <span
      className={cn("font-mono tabular-nums", tone, className)}
      {...rest}
    >
      {sign}
      {formatted}
    </span>
  );
}
