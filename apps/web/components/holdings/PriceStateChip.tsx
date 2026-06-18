"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AppDictionary } from "../../lib/i18n/types";
import type { LocaleCode } from "@vakwen/shared-types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/shadcn/popover";
import { cn } from "../../lib/utils";
import {
  formatPriceStateLabel,
  formatPriceStateTooltip,
  getPriceStateToneClassName,
  type PriceStateDtoLike,
} from "../../features/price-state/priceState";

export function PriceStateChip({
  className,
  dict,
  interactive = true,
  locale,
  priceState,
  testId,
}: {
  className?: string;
  dict: AppDictionary;
  interactive?: boolean;
  locale: LocaleCode;
  priceState: PriceStateDtoLike | null | undefined;
  testId?: string;
}) {
  const [clientNow, setClientNow] = useState<number | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const closePopoverTimerRef = useRef<number | null>(null);
  const label = formatPriceStateLabel(dict, locale, priceState, clientNow ?? getInitialPriceStateNow(priceState));
  useEffect(() => {
    if (!priceState || !priceState.chipState.startsWith("open_")) return;
    setClientNow(Date.now());
    const timer = window.setInterval(() => setClientNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [priceState]);
  useEffect(() => {
    return () => {
      if (closePopoverTimerRef.current !== null) {
        window.clearTimeout(closePopoverTimerRef.current);
      }
    };
  }, []);

  if (!priceState || !label) return null;
  const tooltipRows = formatPriceStateTooltip(dict, locale, priceState);
  const chipClassName = cn(
    "mt-1 inline-flex items-center gap-1.5 rounded-sm bg-transparent p-0 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    className,
  );
  const dot = (
    <span
      aria-hidden="true"
      className={`h-2 w-2 rounded-full ${getPriceStateToneClassName(priceState)}`}
    />
  );
  const clearPopoverCloseTimer = () => {
    if (closePopoverTimerRef.current === null) return;
    window.clearTimeout(closePopoverTimerRef.current);
    closePopoverTimerRef.current = null;
  };
  const openPopover = () => {
    clearPopoverCloseTimer();
    setIsPopoverOpen(true);
  };
  const closePopoverSoon = () => {
    clearPopoverCloseTimer();
    closePopoverTimerRef.current = window.setTimeout(() => {
      setIsPopoverOpen(false);
      closePopoverTimerRef.current = null;
    }, 120);
  };
  const openPopoverForMousePointer = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    openPopover();
  };
  const closePopoverForMousePointer = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    closePopoverSoon();
  };

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
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={chipClassName}
          data-testid={testId}
          onPointerEnter={openPopoverForMousePointer}
          onPointerLeave={closePopoverForMousePointer}
        >
          {dot}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(20rem,calc(100vw-2rem))] p-3"
        onPointerEnter={openPopoverForMousePointer}
        onPointerLeave={closePopoverForMousePointer}
      >
        <PriceStateDetailsRows rows={tooltipRows} />
      </PopoverContent>
    </Popover>
  );
}

function PriceStateDetailsRows({ rows }: { rows: string[] }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
      {rows.map((row) => (
        <div key={row}>{row}</div>
      ))}
    </div>
  );
}

function getInitialPriceStateNow(priceState: PriceStateDtoLike | null | undefined): number {
  const timestamp = priceState?.observedAt ?? priceState?.asOfTimestamp;
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
