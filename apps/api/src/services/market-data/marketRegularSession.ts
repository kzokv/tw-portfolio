import type { MarketCode } from "@vakwen/domain";
import { MARKET_TIMEZONE } from "./tradingCalendar.js";

export type RegularSessionMarketCode = "TW" | "US" | "AU" | "KR";

export interface RegularSessionClock {
  isTradingDay(market: RegularSessionMarketCode, date: string): Promise<boolean>;
  getTradingDates?(market: RegularSessionMarketCode): Promise<ReadonlySet<string>>;
  useWeekdayFallback?: boolean;
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
const CLOSE_REFRESH_LOOKBACK_DAYS = 14;

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

function addDaysIsoDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isWeekdayIsoDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function marketLocalDateTimeToUtc(
  marketCode: RegularSessionMarketCode,
  localDate: string,
  localHour: number,
  localMinute: number,
): Date {
  const guess = new Date(`${localDate}T${String(localHour).padStart(2, "0")}:${String(localMinute).padStart(2, "0")}:00.000Z`);
  const actual = getMarketLocalParts(marketCode, guess);
  const desiredLocalMidnight = new Date(`${localDate}T00:00:00.000Z`).getTime();
  const actualLocalMidnight = new Date(`${actual.localDate}T00:00:00.000Z`).getTime();
  const actualMinutesFromDesiredDate = ((actualLocalMidnight - desiredLocalMidnight) / 60_000) + (actual.localHour * 60) + actual.localMinute;
  const desiredMinutes = (localHour * 60) + localMinute;
  return new Date(guess.getTime() + ((desiredMinutes - actualMinutesFromDesiredDate) * 60_000));
}

function isCloseRefreshDateEligible(
  marketCode: RegularSessionMarketCode,
  localDate: string,
  at: Date,
  graceMinutes: number,
): boolean {
  const close = MARKET_CLOSE_LOCAL_TIME[marketCode];
  const closeAt = marketLocalDateTimeToUtc(marketCode, localDate, close.hour, close.minute);
  return at.getTime() >= closeAt.getTime() + (graceMinutes * 60_000);
}

async function isRegularSessionTradingDay(
  clock: RegularSessionClock,
  marketCode: RegularSessionMarketCode,
  date: string,
): Promise<boolean> {
  const isTradingDay = await clock.isTradingDay(marketCode, date);
  if (isTradingDay) return true;
  if (clock.useWeekdayFallback !== undefined) {
    return clock.useWeekdayFallback && isWeekdayIsoDate(date);
  }
  if (!clock.getTradingDates) return false;

  const tradingDates = await clock.getTradingDates(marketCode);
  if (tradingDates.size === 0) return isWeekdayIsoDate(date);

  let latestKnownDate: string | null = null;
  for (const tradingDate of tradingDates) {
    if (latestKnownDate === null || tradingDate > latestKnownDate) {
      latestKnownDate = tradingDate;
    }
  }
  return latestKnownDate !== null && date > latestKnownDate && isWeekdayIsoDate(date);
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
  const isTradingDay = await isRegularSessionTradingDay(clock, marketCode, localDate);
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
  const { localDate } = getMarketLocalParts(marketCode, at);
  const isTradingDay = await isRegularSessionTradingDay(clock, marketCode, localDate);
  if (isTradingDay && isCloseRefreshDateEligible(marketCode, localDate, at, graceMinutes)) return localDate;

  for (let offset = 1; offset <= CLOSE_REFRESH_LOOKBACK_DAYS; offset += 1) {
    const candidate = addDaysIsoDate(localDate, -offset);
    if (
      await isRegularSessionTradingDay(clock, marketCode, candidate)
      && isCloseRefreshDateEligible(marketCode, candidate, at, graceMinutes)
    ) {
      return candidate;
    }
  }

  return null;
}
