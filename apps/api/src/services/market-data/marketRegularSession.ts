import type { MarketCode } from "@vakwen/domain";
import { MARKET_TIMEZONE } from "./tradingCalendar.js";

export type RegularSessionMarketCode = "TW" | "US" | "AU" | "KR";

export interface RegularSessionClock {
  isTradingDay(market: RegularSessionMarketCode, date: string): Promise<boolean>;
}

export interface RegularSessionState {
  marketCode: RegularSessionMarketCode;
  marketTimeZone: string;
  localDate: string;
  isTradingDay: boolean;
  isOpen: boolean;
  opensAtLocal: string;
  closesAtLocal: string;
}

const REGULAR_SESSION_MARKETS = new Set<RegularSessionMarketCode>(["TW", "US", "AU", "KR"]);

const MARKET_OPEN_LOCAL_TIME: Record<RegularSessionMarketCode, { hour: number; minute: number }> = {
  TW: { hour: 9, minute: 0 },
  US: { hour: 9, minute: 30 },
  AU: { hour: 10, minute: 0 },
  KR: { hour: 9, minute: 0 },
};

const MARKET_CLOSE_LOCAL_TIME: Record<RegularSessionMarketCode, { hour: number; minute: number }> = {
  TW: { hour: 13, minute: 30 },
  US: { hour: 16, minute: 0 },
  AU: { hour: 16, minute: 0 },
  KR: { hour: 15, minute: 30 },
};

export function isRegularSessionMarketCode(marketCode: MarketCode): marketCode is RegularSessionMarketCode {
  return REGULAR_SESSION_MARKETS.has(marketCode as RegularSessionMarketCode);
}

export function getMarketLocalParts(
  marketCode: RegularSessionMarketCode,
  at: Date,
): { localDate: string; localHour: number; localMinute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIMEZONE[marketCode],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localHour: Number(parts.hour),
    localMinute: Number(parts.minute),
  };
}

export function marketLocalDateFromTimestamp(
  marketCode: RegularSessionMarketCode,
  at: Date,
): string {
  return getMarketLocalParts(marketCode, at).localDate;
}

export function isWithinRegularSessionTime(
  marketCode: RegularSessionMarketCode,
  localHour: number,
  localMinute: number,
): boolean {
  const open = MARKET_OPEN_LOCAL_TIME[marketCode];
  const close = MARKET_CLOSE_LOCAL_TIME[marketCode];
  const totalMinutes = localHour * 60 + localMinute;
  const openMinutes = open.hour * 60 + open.minute;
  const closeMinutes = close.hour * 60 + close.minute;
  return totalMinutes >= openMinutes && totalMinutes < closeMinutes;
}

export async function getRegularSessionState(
  marketCode: RegularSessionMarketCode,
  clock: RegularSessionClock,
  at: Date,
): Promise<RegularSessionState> {
  const { localDate, localHour, localMinute } = getMarketLocalParts(marketCode, at);
  const isTradingDay = await clock.isTradingDay(marketCode, localDate);
  const open = MARKET_OPEN_LOCAL_TIME[marketCode];
  const close = MARKET_CLOSE_LOCAL_TIME[marketCode];
  return {
    marketCode,
    marketTimeZone: MARKET_TIMEZONE[marketCode],
    localDate,
    isTradingDay,
    isOpen: isTradingDay && isWithinRegularSessionTime(marketCode, localHour, localMinute),
    opensAtLocal: `${localDate}T${String(open.hour).padStart(2, "0")}:${String(open.minute).padStart(2, "0")}:00`,
    closesAtLocal: `${localDate}T${String(close.hour).padStart(2, "0")}:${String(close.minute).padStart(2, "0")}:00`,
  };
}

export async function getRegularSessionCloseRefreshDate(
  marketCode: RegularSessionMarketCode,
  clock: RegularSessionClock,
  at: Date,
  graceMinutes: number,
): Promise<string | null> {
  const { localDate, localHour, localMinute } = getMarketLocalParts(marketCode, at);
  const isTradingDay = await clock.isTradingDay(marketCode, localDate);
  if (!isTradingDay) return null;
  const close = MARKET_CLOSE_LOCAL_TIME[marketCode];
  const localMinutes = localHour * 60 + localMinute;
  const eligibleMinutes = close.hour * 60 + close.minute + graceMinutes;
  return localMinutes >= eligibleMinutes ? localDate : null;
}
