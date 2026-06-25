"use client";

import type { AppDictionary } from "../../lib/i18n/types";
import type {
  DailyBarQualityDto as PriceStateQuality,
  DashboardMarketStateDto,
  LocaleCode,
  PriceStateBasisDto as PriceStateBasis,
  PriceStateDto as PriceStateDtoLike,
  PriceStateMarketStateDto as PriceStateMarketState,
  PriceStateMarketStateReasonDto as PriceStateMarketStateReason,
} from "@vakwen/shared-types";

export type { PriceStateDtoLike };

export interface PriceStateCarrierLike {
  priceState?: PriceStateDtoLike | null;
  quoteStatus?: "current" | "provisional" | "missing";
}

export interface DashboardMarketStateLike {
  marketCode: string;
  marketState: PriceStateMarketState | null;
  marketStateReason?: PriceStateMarketStateReason | string | null;
  calendarStatus?: string | null;
  marketLocalDate?: string | null;
  heldCount?: number | null;
  openCount?: number | null;
}

export interface CalendarUnknownWarning {
  marketCode: string;
  calendarYear: string;
  localDate: string;
  locationLabel: string;
}

export interface PriceStateTooltipRow {
  label: string;
  value: string;
}

export interface PriceStateTooltipDetails {
  rows: PriceStateTooltipRow[];
  activityPath: string | null;
}

export function buildPriceStateActivityPath({
  marketCode,
  priceState,
  ticker,
}: {
  marketCode: string | null | undefined;
  priceState: PriceStateDtoLike | null | undefined;
  ticker?: string | null;
}): string | null {
  if (!marketCode || !["TW", "US", "AU", "KR", "JP"].includes(marketCode)) return null;
  if (!priceState || priceState.sourceKind === "missing") return null;

  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("limit", "25");
  params.set("timeRange", "24h");
  if (ticker?.trim()) params.set("search", ticker.trim());
  const activitySourceKind = priceStateActivitySourceKind(priceState.sourceKind);
  if (activitySourceKind) params.set("sourceKind", activitySourceKind);
  const category = activitySourceKind === "yahoo_chart"
    ? "intraday_price"
    : activitySourceKind === "twse_close" || activitySourceKind === "finmind"
      ? "daily_close"
      : null;
  if (category) params.set("category", category);

  return `/admin/market-data/${encodeURIComponent(marketCode)}/activity?${params.toString()}`;
}

function priceStateActivitySourceKind(sourceKind: PriceStateDtoLike["sourceKind"]): string | null {
  switch (sourceKind) {
    case "yahoo_chart":
    case "intraday_yahoo_chart":
      return "yahoo_chart";
    case "twse_stock_day_close":
      return "twse_close";
    case "primary_daily":
      return "finmind";
    case "yahoo_chart_close":
      return "yahoo_chart";
    case "missing":
    default:
      return null;
  }
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
    marketStateReason: "market_closed",
    marketLocalDate: null,
    calendarStatus: null,
    latestIntradayAttempt: null,
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
      marketStateReason: priceState.marketStateReason ?? null,
      calendarStatus: priceState.calendarStatus ?? null,
      marketLocalDate: priceState.marketLocalDate ?? null,
      heldCount: 0,
      openCount: 0,
    };
    current.heldCount = (current.heldCount ?? 0) + 1;
    if (priceState.marketState === "open") {
      current.marketState = "open";
      current.marketStateReason = priceState.marketStateReason ?? current.marketStateReason ?? null;
      current.calendarStatus = priceState.calendarStatus ?? current.calendarStatus ?? null;
      current.marketLocalDate = priceState.marketLocalDate ?? current.marketLocalDate ?? null;
      current.openCount = (current.openCount ?? 0) + 1;
    } else if (priceState.marketStateReason === "calendar_unknown" || priceState.calendarStatus === "calendar_unknown") {
      current.marketStateReason = "calendar_unknown";
      current.calendarStatus = priceState.calendarStatus ?? current.calendarStatus ?? null;
      current.marketLocalDate = priceState.marketLocalDate ?? current.marketLocalDate ?? null;
    }
    grouped.set(row.marketCode, current);
  }
  return sortDashboardMarketStates([...grouped.values()]);
}

export function hydrateDashboardMarketStates<T extends { marketCode: string } & PriceStateCarrierLike>(
  payloadStates: DashboardMarketStateLike[] | DashboardMarketStateDto[] | null | undefined,
  rows: T[],
): DashboardMarketStateLike[] {
  const derivedStates = summarizeDashboardMarketStates(rows);
  if (!payloadStates || payloadStates.length === 0) return derivedStates;

  const derivedByMarket = new Map(derivedStates.map((state) => [state.marketCode, state]));
  const merged = payloadStates.map((payloadState): DashboardMarketStateLike => {
    const payload = payloadState as DashboardMarketStateLike;
    const derivedState = derivedByMarket.get(payloadState.marketCode);
    const payloadHeldCount = payload.heldCount ?? 0;
    const payloadOpenCount = payload.openCount ?? 0;
    const derivedHeldCount = derivedState?.heldCount ?? 0;
    const derivedOpenCount = derivedState?.openCount ?? 0;
    return {
      ...payloadState,
      heldCount: Math.max(payloadHeldCount, derivedHeldCount),
      openCount: Math.max(payloadOpenCount, derivedOpenCount),
      marketStateReason: payload.marketStateReason ?? derivedState?.marketStateReason ?? null,
      calendarStatus: payload.calendarStatus ?? derivedState?.calendarStatus ?? null,
      marketLocalDate: payload.marketLocalDate ?? derivedState?.marketLocalDate ?? null,
    };
  });
  const payloadMarkets = new Set(payloadStates.map((state) => state.marketCode));
  for (const derivedState of derivedStates) {
    if (!payloadMarkets.has(derivedState.marketCode)) merged.push(derivedState);
  }
  return sortDashboardMarketStates(merged);
}

export function collectCalendarUnknownWarnings<T extends { marketCode: string } & PriceStateCarrierLike>(
  rows: T[] | null | undefined,
  marketStates?: DashboardMarketStateLike[] | null,
): CalendarUnknownWarning[] {
  const warnings = new Map<string, CalendarUnknownWarning>();
  const addWarning = (marketCode: string, localDate: string | null | undefined) => {
    const normalizedDate = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : "";
    const calendarYear = normalizedDate ? normalizedDate.slice(0, 4) : "";
    const key = `${marketCode}:${calendarYear || "unknown"}`;
    if (warnings.has(key)) return;
    warnings.set(key, {
      marketCode,
      calendarYear,
      localDate: normalizedDate,
      locationLabel: marketLocationLabel(marketCode),
    });
  };

  for (const state of marketStates ?? []) {
    if (state.marketStateReason === "calendar_unknown" || state.calendarStatus === "calendar_unknown") {
      addWarning(state.marketCode, state.marketLocalDate);
    }
  }

  for (const row of rows ?? []) {
    const priceState = getPriceState(row);
    if (!priceState) continue;
    if (priceState.marketStateReason === "calendar_unknown" || priceState.calendarStatus === "calendar_unknown") {
      addWarning(row.marketCode, priceState.marketLocalDate);
    }
  }

  return [...warnings.values()].sort((left, right) => left.marketCode.localeCompare(right.marketCode));
}

function marketLocationLabel(marketCode: string): string {
  switch (marketCode) {
    case "TW":
      return "Taipei";
    case "US":
      return "New York";
    case "AU":
      return "Sydney";
    case "KR":
      return "Seoul";
    default:
      return `${marketCode} local time`;
  }
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
  return describePriceStateTooltip(dict, locale, priceState).rows.map((row) => `${row.label}: ${row.value}`);
}

export function describePriceStateTooltip(
  dict: AppDictionary,
  locale: LocaleCode,
  priceState: PriceStateDtoLike | null | undefined,
): PriceStateTooltipDetails {
  if (!priceState) return { rows: [], activityPath: null };
  const isClosedCloseOnlyRow = priceState.marketState === "closed" && priceState.quality === "close_only";
  const rows: PriceStateTooltipRow[] = [
    { label: dict.holdings.priceStateBasisLabel, value: formatBasisLabel(dict, priceState.basis) },
    { label: dict.holdings.priceStateMarketStateLabel, value: formatMarketStateLabel(dict, priceState.marketState) },
    { label: dict.holdings.priceStateAsOfLabel, value: formatTimestampValue(priceState.asOfTimestamp, priceState.asOfDate, locale, priceState.marketTimeZone, dict) },
    { label: dict.holdings.priceStateObservedAtLabel, value: formatTimestampValue(priceState.observedAt, null, locale, priceState.marketTimeZone, dict) },
    { label: dict.holdings.priceStateSourceLabel, value: formatSourceLabel(dict, priceState) },
    { label: dict.holdings.priceStateQualityLabel, value: formatQualityLabel(dict, priceState.quality) },
    { label: dict.holdings.priceStateDelayLabel, value: formatDelayLabel(dict, priceState.delaySeconds) },
    { label: dict.holdings.priceStateTimeZoneLabel, value: priceState.marketTimeZone ?? dict.holdings.priceStateUnknownValue },
  ];
  if (isClosedCloseOnlyRow) {
    rows.push({
      label: dict.holdings.priceStateFullDailyBarLabel,
      value: dict.holdings.priceStatePendingValue,
    });
  }
  const calendarStatus = readStringFact(priceState, "calendarStatus");
  const calendarReason = readStringFact(priceState, "calendarReason") ?? readStringFact(priceState, "marketStateReason");
  const marketLocalDate = readStringFact(priceState, "marketLocalDate") ?? readStringFact(priceState, "localMarketDate");
  const yahooSymbol = readStringFact(priceState, "yahooSymbol");
  const cadenceMinutes = readNumberFact(priceState, "refreshCadenceMinutes");
  const latestAttemptAt = readStringFact(priceState, "latestAttemptAt")
    ?? readStringFact(priceState, "latestRefreshAttemptAt")
    ?? readNestedStringFact(priceState, "latestIntradayAttempt", "requestedAt");
  const latestOutcome = readStringFact(priceState, "latestAttemptOutcome")
    ?? readStringFact(priceState, "latestRefreshOutcome")
    ?? readNestedStringFact(priceState, "latestIntradayAttempt", "outcome");
  const activityPath = readStringFact(priceState, "activityPath");
  if (calendarReason) rows.push({ label: holdingLabel(dict, "priceStateMarketReasonLabel", "priceStateCalendarReasonLabel", "Market reason"), value: formatReasonFact(calendarReason, dict) });
  if (calendarStatus) rows.push({ label: holdingLabel(dict, "priceStateCalendarStatusLabel", "priceStateCalendarLabel", "Calendar status"), value: formatReasonFact(calendarStatus, dict) });
  if (marketLocalDate) rows.push({ label: holdingLabel(dict, "priceStateLocalMarketDateLabel", "priceStateMarketLocalDateLabel", "Local market date"), value: marketLocalDate });
  if (yahooSymbol) rows.push({ label: dict.holdings.priceStateYahooSymbolLabel, value: yahooSymbol });
  if (cadenceMinutes !== null) rows.push({ label: dict.holdings.priceStateCadenceLabel, value: `${cadenceMinutes}m` });
  if (latestAttemptAt) rows.push({
    label: holdingLabel(dict, "priceStateLatestRefreshAttemptLabel", "priceStateLatestAttemptLabel", "Latest refresh attempt"),
    value: formatTimestampValue(latestAttemptAt, null, locale, priceState.marketTimeZone, dict),
  });
  if (latestOutcome) rows.push({
    label: holdingLabel(dict, "priceStateLatestRefreshOutcomeLabel", "priceStateLatestOutcomeLabel", "Latest refresh outcome"),
    value: formatReasonFact(latestOutcome, dict),
  });
  return { rows, activityPath };
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

function formatSourceLabel(dict: AppDictionary, priceState: PriceStateDtoLike): string {
  switch (priceState.sourceKind) {
    case "yahoo_chart":
    case "intraday_yahoo_chart":
      return dict.holdings.priceStateSourceYahooChart;
    case "yahoo_chart_close":
      return dict.holdings.priceStateSourceYahooClose;
    case "twse_stock_day_close":
      return dict.holdings.priceStateSourceTwseClose;
    case "primary_daily":
      return dict.holdings.priceStateSourcePrimaryDaily;
    case "missing":
      return dict.holdings.priceStateUnknownValue;
    default:
      return priceState.source ?? dict.holdings.priceStateUnknownValue;
  }
}

function formatDelayLabel(dict: AppDictionary, delaySeconds: number | null): string {
  if (delaySeconds === null || !Number.isFinite(delaySeconds)) return dict.holdings.priceStateUnknownValue;
  if (delaySeconds < 60) return dict.holdings.priceStateDelaySeconds.replace("{count}", String(delaySeconds));
  const minutes = Math.round(delaySeconds / 60);
  return dict.holdings.priceStateDelayMinutes.replace("{count}", String(minutes));
}

function readStringFact(priceState: PriceStateDtoLike, key: string): string | null {
  const value = (priceState as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNestedStringFact(priceState: PriceStateDtoLike, objectKey: string, valueKey: string): string | null {
  const object = (priceState as unknown as Record<string, unknown>)[objectKey];
  if (!object || typeof object !== "object") return null;
  const value = (object as Record<string, unknown>)[valueKey];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumberFact(priceState: PriceStateDtoLike, key: string): number | null {
  const value = (priceState as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function holdingLabel(
  dict: AppDictionary,
  preferredKey: string,
  fallbackKey: string,
  fallback: string,
): string {
  const holdings = dict.holdings as unknown as Record<string, unknown>;
  const preferred = holdings[preferredKey];
  if (typeof preferred === "string" && preferred.length > 0) return preferred;
  const next = holdings[fallbackKey];
  return typeof next === "string" && next.length > 0 ? next : fallback;
}

function formatReasonFact(value: string, dict: AppDictionary): string {
  const holdings = dict.holdings as unknown as Record<string, unknown>;
  const key = `priceStateFact${value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
  const localized = holdings[key];
  if (typeof localized === "string" && localized.length > 0) return localized;
  switch (value) {
    case "calendar_unknown":
      return "Calendar unknown";
    case "market_open":
      return "Market open";
    case "market_closed":
      return "Market closed";
    case "not_trading_day":
      return "Not a trading day";
    case "outside_regular_session":
      return "Outside regular session";
    case "rate_limited":
      return "Rate limited";
    case "no_data":
      return "No data";
    case "success":
      return "Success";
    case "delayed":
      return "Delayed";
    case "error":
      return "Error";
    case "skipped":
      return "Skipped";
    default:
      break;
  }
  return value.replace(/_/g, " ");
}
