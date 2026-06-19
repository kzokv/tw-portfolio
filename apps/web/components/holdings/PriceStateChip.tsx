"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AppDictionary } from "../../lib/i18n/types";
import type { LocaleCode } from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import {
  describePriceStateTooltip,
  formatPriceStateLabel,
  getPriceStateToneClassName,
  type PriceStateDtoLike,
} from "../../features/price-state/priceState";
import { useIsMobile } from "../../lib/hooks/use-mobile";

export function PriceStateChip({
  activityPath,
  className,
  dict,
  interactive = true,
  locale,
  priceState,
  testId,
}: {
  activityPath?: string | null;
  className?: string;
  dict: AppDictionary;
  interactive?: boolean;
  locale: LocaleCode;
  priceState: PriceStateDtoLike | null | undefined;
  testId?: string;
}) {
  const [clientNow, setClientNow] = useState<number | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isChanged, setIsChanged] = useState(false);
  const [preferBottomPopover, setPreferBottomPopover] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closePopoverTimerRef = useRef<number | null>(null);
  const keyboardDismissedHoverRef = useRef(false);
  const popoverOpenRef = useRef(false);
  const touchPointerHandledRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);
  const changeSignatureRef = useRef<string | null>(null);
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
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    popoverOpenRef.current = isPopoverOpen;
  }, [isPopoverOpen]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!popoverOpenRef.current) return;
      keyboardDismissedHoverRef.current = true;
      if (closePopoverTimerRef.current !== null) {
        window.clearTimeout(closePopoverTimerRef.current);
        closePopoverTimerRef.current = null;
      }
      setIsPopoverOpen(false);
    };
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("keyup", onEscape, true);
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("keyup", onEscape, true);
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("keyup", onEscape, true);
      document.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("keyup", onEscape, true);
    };
  }, []);
  useEffect(() => {
    if (!isPopoverOpen) return;
    const onPointerDownOutside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      if (closePopoverTimerRef.current !== null) {
        window.clearTimeout(closePopoverTimerRef.current);
        closePopoverTimerRef.current = null;
      }
      setIsPopoverOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
    };
  }, [isPopoverOpen]);
  useEffect(() => {
    const signature = priceState
      ? [priceState.chipState, priceState.basis, priceState.asOfTimestamp, priceState.observedAt, priceState.marketState].join("|")
      : null;
    if (signature && changeSignatureRef.current && changeSignatureRef.current !== signature) {
      setIsChanged(true);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        setIsChanged(false);
        flashTimerRef.current = null;
      }, 1_050);
    }
    changeSignatureRef.current = signature;
  }, [priceState]);
  useEffect(() => {
    if (!isPopoverOpen) return;
    const updatePosition = () => {
      setPanelStyle(buildPanelStyle(triggerRef.current, isMobile || preferBottomPopover));
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isMobile, isPopoverOpen, preferBottomPopover]);
  if (!priceState || !label) return null;
  const tooltip = describePriceStateTooltip(dict, locale, priceState);
  const resolvedActivityPath = activityPath ?? tooltip.activityPath;
  const chipClassName = cn(
    "mt-1 inline-flex items-center gap-1.5 rounded-sm bg-transparent p-0 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:transition-[background-color,box-shadow,color] motion-safe:duration-700",
    isChanged && "bg-warning/10 shadow-[0_0_0_1px_hsl(var(--warning)/0.2)] motion-safe:animate-pulse",
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
  const closePopover = () => {
    clearPopoverCloseTimer();
    setIsPopoverOpen(false);
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
    if (keyboardDismissedHoverRef.current) return;
    setPreferBottomPopover(false);
    setPanelStyle(buildPanelStyle(triggerRef.current, false));
    openPopover();
  };
  const closePopoverForMousePointer = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    keyboardDismissedHoverRef.current = false;
    closePopoverSoon();
  };
  const openPopoverForClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (touchPointerHandledRef.current) {
      touchPointerHandledRef.current = false;
      return;
    }
    keyboardDismissedHoverRef.current = false;
    const useViewportPanel = typeof window !== "undefined" && window.innerWidth < 768;
    if (isPopoverOpen && useViewportPanel) {
      closePopover();
      return;
    }
    if (useViewportPanel) {
      setPreferBottomPopover(true);
    }
    setPanelStyle(buildPanelStyle(triggerRef.current, useViewportPanel));
    openPopover();
  };
  const openPopoverForTouchPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    touchPointerHandledRef.current = true;
    if (isPopoverOpen) {
      closePopover();
      return;
    }
    keyboardDismissedHoverRef.current = false;
    setPreferBottomPopover(true);
    setPanelStyle(buildPanelStyle(triggerRef.current, true));
    openPopover();
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
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isPopoverOpen}
        aria-haspopup="dialog"
        aria-label={label}
        className={chipClassName}
        data-testid={testId}
        onClick={openPopoverForClick}
        onPointerDown={openPopoverForTouchPointer}
        onPointerEnter={openPopoverForMousePointer}
        onPointerLeave={closePopoverForMousePointer}
      >
        {dot}
        <span>{label}</span>
      </button>
      {isPopoverOpen ? (
        <PriceStateDetailsPanel
          activityLabel={dict.holdings.priceStateActivityHintLabel}
          activityPath={resolvedActivityPath}
          closeLabel={dict.holdings.priceStateCloseDetailsLabel}
          onClose={closePopover}
          onPointerEnter={openPopoverForMousePointer}
          onPointerLeave={closePopoverForMousePointer}
          panelRef={panelRef}
          rows={tooltip.rows}
          style={panelStyle ?? buildPanelStyle(triggerRef.current, isMobile || preferBottomPopover)}
        />
      ) : null}
    </>
  );
}

function PriceStateDetailsPanel({
  activityLabel,
  activityPath,
  closeLabel,
  onClose,
  onPointerEnter,
  onPointerLeave,
  panelRef,
  rows,
  style,
}: {
  activityLabel: string;
  activityPath: string | null;
  closeLabel: string;
  onClose: () => void;
  onPointerEnter: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
  panelRef: RefObject<HTMLDivElement>;
  rows: Array<{ label: string; value: string }>;
  style: CSSProperties;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      data-radix-popper-content-wrapper=""
      role="dialog"
      className="fixed z-50 overflow-y-auto overscroll-contain rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={style}
    >
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          {closeLabel}
        </button>
      </div>
      <PriceStateDetailsRows activityLabel={activityLabel} activityPath={activityPath} rows={rows} />
    </div>,
    document.body,
  );
}

function buildPanelStyle(trigger: HTMLButtonElement | null, useViewportPanel: boolean): CSSProperties {
  if (typeof window === "undefined") return {};
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const horizontalPadding = 16;
  const width = Math.min(320, Math.max(240, viewportWidth - horizontalPadding * 2));
  const fallbackTop = horizontalPadding;
  const fallbackLeft = horizontalPadding;

  if (useViewportPanel || !trigger) {
    return {
      left: fallbackLeft,
      maxHeight: Math.max(240, viewportHeight - horizontalPadding * 2),
      top: fallbackTop,
      width: viewportWidth - horizontalPadding * 2,
    };
  }

  const rect = trigger.getBoundingClientRect();
  const top = Math.min(
    Math.max(horizontalPadding, rect.bottom + 8),
    Math.max(horizontalPadding, viewportHeight - 160),
  );
  const maxLeft = Math.max(horizontalPadding, viewportWidth - width - horizontalPadding);
  const left = Math.min(Math.max(horizontalPadding, rect.left), maxLeft);

  return {
    left,
    maxHeight: Math.max(160, viewportHeight - top - horizontalPadding),
    top,
    width,
  };
}

function PriceStateDetailsRows({
  activityLabel,
  activityPath,
  rows,
}: {
  activityLabel: string;
  activityPath: string | null;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="flex flex-col gap-2 text-xs leading-relaxed">
      {rows.map((row) => (
        <div key={`${row.label}:${row.value}`} className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-2">
          <span className="sr-only">{`${row.label}: ${row.value}`}</span>
          <div className="text-muted-foreground">{row.label}</div>
          <div className="break-words text-foreground">{row.value}</div>
        </div>
      ))}
      {activityPath ? (
        <div className="border-t border-border/70 pt-2">
          <span className="sr-only">{`${activityLabel}: ${activityPath}`}</span>
          <Link className="text-[11px] font-medium text-primary underline-offset-4 hover:underline" href={activityPath}>
            {activityLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function getInitialPriceStateNow(priceState: PriceStateDtoLike | null | undefined): number {
  const timestamp = priceState?.observedAt ?? priceState?.asOfTimestamp;
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
