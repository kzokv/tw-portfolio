"use client";

import type { AppDictionary } from "../../lib/i18n/types";
import type {
  DailyBarQualityDto as PriceStateQuality,
  DashboardMarketStateDto,
  LocaleCode,
  PriceStateBasisDto as PriceStateBasis,
  PriceStateDto as PriceStateDtoLike,
  PriceStateMarketStateDto as PriceStateMarketState,
} from "@vakwen/shared-types";

export type { PriceStateDtoLike };

export interface PriceStateCarrierLike {
  priceState?: PriceStateDtoLike | null;
  quoteStatus?: "current" | "provisional" | "missing";
}

export interface DashboardMarketStateLike {
  marketCode: string;
  marketState: PriceStateMarketState | null;
  heldCount?: number | null;
  openCount?: number | null;
}

export function buildMissingPriceState(marketState: PriceStateMarketState = "closed"): PriceStateDtoLike {
  return {
    basis: "missing",
    chipState: "missing",
    marketState,
    source: null,
    sourceKind: "missing",
    asOfDate: null,
    asOfTimestamp: null,
    observedAt: null,
    delaySeconds: null,
    marketTimeZone: null,
    quality: null,
  };
}

export function getPriceState(value: PriceStateCarrierLike | null | undefined): PriceStateDtoLike | null {
  return value?.priceState ?? null;
}

export function hasOpenMarketPriceState(value: PriceStateCarrierLike | null | undefined): boolean {
  const priceState = getPriceState(value);
  return priceState?.marketState === "open";
}

export function isNonCurrentPrice(value: PriceStateCarrierLike | null | undefined): boolean {
  const priceState = getPriceState(value);
  if (priceState) {
    return priceState.basis !== "intraday" && priceState.basis !== "today_close";
  }
  return value?.quoteStatus === "missing" || value?.quoteStatus === "provisional";
}

export function priceStateSortRank(value: PriceStateCarrierLike | null | undefined): number {
  const priceState = getPriceState(value);
  if (priceState) {
    if (priceState.basis === "pending_today_close") return 3;
    switch (priceState.chipState) {
      case "missing":
        return 5;
      case "stale":
        return 4;
      case "open_previous_close":
        return 3;
      case "closed_pending":
        return 3;
      case "open_delayed":
        return 2;
      case "closed":
        return 1;
      case "open_fresh":
      default:
        return 0;
    }
  }
  if (value?.quoteStatus === "missing") return 5;
  if (value?.quoteStatus === "provisional") return 2;
  return 0;
}

export function shouldPollForOpenMarket<T extends PriceStateCarrierLike>(
  rows: T[] | null | undefined,
  marketStates?: DashboardMarketStateLike[] | null,
): boolean {
  if (Array.isArray(marketStates) && marketStates.some((state) => state.marketState === "open")) {
    return true;
  }
  return Array.isArray(rows) && rows.some((row) => hasOpenMarketPriceState(row));
}

export function sortDashboardMarketStates(states: DashboardMarketStateLike[] | DashboardMarketStateDto[]): DashboardMarketStateLike[] {
  const order = new Map([
    ["TW", 0],
    ["US", 1],
    ["AU", 2],
    ["KR", 3],
  ]);
  return states.slice().sort((left, right) => {
    const leftRank = order.get(left.marketCode) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = order.get(right.marketCode) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.marketCode.localeCompare(right.marketCode);
  });
}

export function summarizeDashboardMarketStates<T extends { marketCode: string } & PriceStateCarrierLike>(
  rows: T[],
): DashboardMarketStateLike[] {
  const grouped = new Map<string, DashboardMarketStateLike>();
  for (const row of rows) {
    const priceState = getPriceState(row);
    if (!priceState) continue;
    const current = grouped.get(row.marketCode) ?? {
      marketCode: row.marketCode,
      marketState: priceState.marketState,
      heldCount: 0,
      openCount: 0,
    };
    current.heldCount = (current.heldCount ?? 0) + 1;
    if (priceState.marketState === "open") {
      current.marketState = "open";
      current.openCount = (current.openCount ?? 0) + 1;
    }
    grouped.set(row.marketCode, current);
  }
  return sortDashboardMarketStates([...grouped.values()]);
}

export function formatPriceStateLabel(
  dict: AppDictionary,
  locale: LocaleCode,
  priceState: PriceStateDtoLike | null | undefined,
  now = Date.now(),
): string | null {
  if (!priceState) return null;
  switch (priceState.chipState) {
    case "open_fresh":
      return dict.holdings.priceStateUpdated.replace("{relative}", formatRelativeDate(priceState.asOfTimestamp ?? priceState.observedAt, locale, now, dict));
    case "open_delayed":
      return dict.holdings.priceStateDelayed.replace("{relative}", formatRelativeDate(priceState.asOfTimestamp ?? priceState.observedAt, locale, now, dict));
    case "open_previous_close":
      return dict.holdings.priceStatePreviousClose;
    case "closed_pending":
      return dict.holdings.priceStateBasisPendingTodayClose;
    case "closed":
      return dict.holdings.priceStateClosed;
    case "stale":
      return dict.holdings.priceStateStale;
    case "missing":
    default:
      return dict.holdings.priceStateUnavailable;
  }
}

export function formatPriceStateTooltip(
  dict: AppDictionary,
  locale: LocaleCode,
  priceState: PriceStateDtoLike | null | undefined,
): string[] {
  if (!priceState) return [];
  return [
    `${dict.holdings.priceStateBasisLabel}: ${formatBasisLabel(dict, priceState.basis)}`,
    `${dict.holdings.priceStateMarketStateLabel}: ${formatMarketStateLabel(dict, priceState.marketState)}`,
    `${dict.holdings.priceStateAsOfLabel}: ${formatTimestampValue(priceState.asOfTimestamp, priceState.asOfDate, locale, priceState.marketTimeZone, dict)}`,
    `${dict.holdings.priceStateObservedAtLabel}: ${formatTimestampValue(priceState.observedAt, null, locale, priceState.marketTimeZone, dict)}`,
    `${dict.holdings.priceStateSourceLabel}: ${priceState.source ?? dict.holdings.priceStateUnknownValue}`,
    `${dict.holdings.priceStateQualityLabel}: ${formatQualityLabel(dict, priceState.quality)}`,
    `${dict.holdings.priceStateDelayLabel}: ${formatDelayLabel(dict, priceState.delaySeconds)}`,
    `${dict.holdings.priceStateTimeZoneLabel}: ${priceState.marketTimeZone ?? dict.holdings.priceStateUnknownValue}`,
  ];
}

export function getPriceStateToneClassName(priceState: PriceStateDtoLike | null | undefined): string {
  switch (priceState?.chipState) {
    case "open_fresh":
      return "bg-[hsl(var(--success))]";
    case "open_delayed":
    case "open_previous_close":
    case "closed_pending":
      return "bg-warning";
    case "closed":
    case "stale":
      return "bg-slate-400";
    case "missing":
      return "bg-destructive";
    default:
      return "bg-slate-400";
  }
}

function formatRelativeDate(
  value: string | null,
  locale: LocaleCode,
  now: number,
  dict: AppDictionary,
): string {
  if (!value) return dict.holdings.priceStateUnknownValue;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dict.holdings.priceStateUnknownValue;
  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", { numeric: "auto" });
  if (Math.abs(diffSeconds) < 60) return formatter.format(diffSeconds, "second");
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
  return formatter.format(Math.round(diffHours / 24), "day");
}

function formatTimestampValue(
  timestamp: string | null,
  dateOnly: string | null,
  locale: LocaleCode,
  timeZone: string | null,
  dict: AppDictionary,
): string {
  if (timestamp) {
    const value = new Date(timestamp);
    if (Number.isNaN(value.getTime())) return dict.holdings.priceStateUnknownValue;
    return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: timeZone ?? undefined,
    }).format(value);
  }
  if (dateOnly) return dateOnly;
  return dict.holdings.priceStateUnknownValue;
}

function formatBasisLabel(dict: AppDictionary, basis: PriceStateBasis): string {
  switch (basis) {
    case "intraday":
      return dict.holdings.priceStateBasisIntraday;
    case "delayed_intraday":
      return dict.holdings.priceStateBasisDelayedIntraday;
    case "previous_close":
      return dict.holdings.priceStateBasisPreviousClose;
    case "today_close":
      return dict.holdings.priceStateBasisTodayClose;
    case "pending_today_close":
      return dict.holdings.priceStateBasisPendingTodayClose;
    case "stale_close":
      return dict.holdings.priceStateBasisStaleClose;
    case "missing":
    default:
      return dict.holdings.priceStateBasisMissing;
  }
}

function formatMarketStateLabel(dict: AppDictionary, marketState: PriceStateMarketState | null): string {
  if (marketState === "open") return dict.holdings.priceStateMarketOpen;
  if (marketState === "closed") return dict.holdings.priceStateMarketClosed;
  return dict.holdings.priceStateUnknownValue;
}

function formatQualityLabel(dict: AppDictionary, quality: PriceStateQuality | null): string {
  if (quality === "full_bar") return dict.holdings.priceStateQualityFullBar;
  if (quality === "close_only") return dict.holdings.priceStateQualityCloseOnly;
  return dict.holdings.priceStateUnknownValue;
}

function formatDelayLabel(dict: AppDictionary, delaySeconds: number | null): string {
  if (delaySeconds === null || !Number.isFinite(delaySeconds)) return dict.holdings.priceStateUnknownValue;
  if (delaySeconds < 60) return dict.holdings.priceStateDelaySeconds.replace("{count}", String(delaySeconds));
  const minutes = Math.round(delaySeconds / 60);
  return dict.holdings.priceStateDelayMinutes.replace("{count}", String(minutes));
}
