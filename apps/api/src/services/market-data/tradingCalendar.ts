import type { MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";

export interface SettleOptions {
  /**
   * Hours after market close before a date is considered "settled" by this helper.
   * Default 0 means the regular market close threshold.
   */
  settleGraceHours?: number;
}

type CalendarMarket = MarketCode | "FX";
type SupportedMarketCode = "TW" | "US" | "AU" | "KR" | "JP";

type CalendarLogger = {
  error: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
};

interface TradingCalendarCacheEntry {
  dates: Set<string>;
  loadedAt: number;
  horizonStartDate: string;
  warnedEmpty: boolean;
}

interface TradingCalendarCacheDeps {
  persistence: Pick<Persistence, "getDistinctBarDates" | "getActiveMarketCalendarVersion">;
  log?: CalendarLogger;
}

const SUPPORTED_MARKETS = ["TW", "US", "AU", "KR", "JP"] as const;
const SUPPORTED_MARKET_SET = new Set<string>(SUPPORTED_MARKETS);

export const MARKET_TIMEZONE: Record<SupportedMarketCode, string> = {
  TW: "Asia/Taipei",
  US: "America/New_York",
  AU: "Australia/Sydney",
  KR: "Asia/Seoul",
  JP: "Asia/Tokyo",
};

export const MARKET_CLOSE_LOCAL_TIME: Record<SupportedMarketCode, { hour: number; minute: number }> = {
  TW: { hour: 13, minute: 30 },
  US: { hour: 16, minute: 0 },
  AU: { hour: 16, minute: 0 },
  KR: { hour: 15, minute: 30 },
  JP: { hour: 15, minute: 30 },
};

export const FX_PUBLISH_HOUR_UTC = 16;
export const LOOKBACK_DAYS = 400;
export const TTL_MS = 60 * 60 * 1000;
const RECENT_TRADING_DAY_MAX_AGE_DAYS = 14;

function assertSupportedMarket(market: MarketCode): asserts market is SupportedMarketCode {
  if (!SUPPORTED_MARKET_SET.has(market)) {
    throw new Error(`unsupported_market_for_trading_calendar: ${market}`);
  }
}

function isoDateFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIsoDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return isoDateFromUtc(parsed);
}

function daysBetweenIsoDates(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / 86_400_000);
}

function isWeekdayIsoDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function previousWeekdayOnOrBefore(date: string): string {
  let current = date;
  while (!isWeekdayIsoDate(current)) {
    current = addDaysIsoDate(current, -1);
  }
  return current;
}

// Meeus/Jones/Butcher anonymous-Gregorian Computus. Returns Easter Sunday as
// ISO YYYY-MM-DD. Good Friday = Easter − 2, Easter Monday = Easter + 1.
function computeEasterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// The 6 TARGET2 closing days have been stable since 2002. ECB one-off
// closures (e.g., system migrations) are NOT covered; mint a follow-on
// ticket if such an event lands.
const ECB_HOLIDAY_YEAR_CACHE = new Map<number, ReadonlySet<string>>();

function ecbHolidaysForYear(year: number): ReadonlySet<string> {
  const cached = ECB_HOLIDAY_YEAR_CACHE.get(year);
  if (cached) return cached;
  const easter = computeEasterSunday(year);
  const goodFriday = addDaysIsoDate(easter, -2);
  const easterMonday = addDaysIsoDate(easter, 1);
  const yy = String(year);
  const holidays = new Set<string>([
    `${yy}-01-01`,
    goodFriday,
    easterMonday,
    `${yy}-05-01`,
    `${yy}-12-25`,
    `${yy}-12-26`,
  ]);
  ECB_HOLIDAY_YEAR_CACHE.set(year, holidays);
  return holidays;
}

function isEcbHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  return ecbHolidaysForYear(year).has(date);
}

function isFxTradingDay(date: string): boolean {
  return isWeekdayIsoDate(date) && !isEcbHoliday(date);
}

function previousFxTradingDayOnOrBefore(date: string): string {
  let current = date;
  while (!isFxTradingDay(current)) {
    current = addDaysIsoDate(current, -1);
  }
  return current;
}

function latestTradingDateOnOrBefore(tradingDates: ReadonlySet<string>, date: string): string | null {
  let latest: string | null = null;
  for (const tradingDate of tradingDates) {
    if (tradingDate <= date && (latest === null || tradingDate > latest)) {
      latest = tradingDate;
    }
  }
  return latest;
}

function getMarketLocalParts(market: SupportedMarketCode, now: Date): {
  localDate: string;
  localHour: number;
  localMinute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIMEZONE[market],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localHour: Number(parts.hour),
    localMinute: Number(parts.minute),
  };
}

function resolveMarketSettlementCandidate(
  market: MarketCode,
  now: Date,
  options: SettleOptions = {},
): string {
  assertSupportedMarket(market);
  const { localDate, localHour, localMinute } = getMarketLocalParts(market, now);
  const close = MARKET_CLOSE_LOCAL_TIME[market];
  const effectiveCloseHour = close.hour + (options.settleGraceHours ?? 0);
  const dayOffset = Math.floor(effectiveCloseHour / 24);
  const hourInDay = effectiveCloseHour % 24;
  const closeElapsed =
    localHour > hourInDay ||
    (localHour === hourInDay && localMinute >= close.minute);
  return addDaysIsoDate(localDate, closeElapsed ? -dayOffset : -dayOffset - 1);
}

function resolveFxSettlementCandidate(now: Date): string {
  const utcDate = isoDateFromUtc(now);
  const publishElapsed = now.getUTCHours() >= FX_PUBLISH_HOUR_UTC;
  return publishElapsed ? utcDate : addDaysIsoDate(utcDate, -1);
}

function resolveLatestSettledTradingDay(
  tradingDates: ReadonlySet<string>,
  market: CalendarMarket,
  now: Date,
  options: SettleOptions = {},
): { date: string; usedFallback: boolean } {
  if (market === "FX") {
    return { date: previousFxTradingDayOnOrBefore(resolveFxSettlementCandidate(now)), usedFallback: false };
  }

  const candidateDate = resolveMarketSettlementCandidate(market, now, options);
  const latest = latestTradingDateOnOrBefore(tradingDates, candidateDate);
  if (latest && daysBetweenIsoDates(latest, candidateDate) <= RECENT_TRADING_DAY_MAX_AGE_DAYS) {
    return { date: latest, usedFallback: false };
  }

  return { date: previousWeekdayOnOrBefore(candidateDate), usedFallback: true };
}

export function latestSettledTradingDayPure(
  tradingDates: ReadonlySet<string>,
  market: CalendarMarket,
  now: Date,
  options: SettleOptions = {},
): string {
  return resolveLatestSettledTradingDay(tradingDates, market, now, options).date;
}

export function tradingDaysBetweenPure(
  tradingDates: ReadonlySet<string>,
  d1: string,
  d2: string,
  market: CalendarMarket,
): number {
  if (d1 >= d2) return 0;

  if (market === "FX" || tradingDates.size === 0) {
    let count = 0;
    for (let current = addDaysIsoDate(d1, 1); current <= d2; current = addDaysIsoDate(current, 1)) {
      if (market === "FX" ? isFxTradingDay(current) : isWeekdayIsoDate(current)) count++;
    }
    return count;
  }

  let count = 0;
  for (const date of tradingDates) {
    if (date > d1 && date <= d2) count++;
  }
  return count;
}

export function isTradingDayPure(
  tradingDates: ReadonlySet<string>,
  market: CalendarMarket,
  date: string,
): boolean {
  if (market === "FX") {
    return isFxTradingDay(date);
  }
  if (tradingDates.size === 0) {
    return isWeekdayIsoDate(date);
  }
  return tradingDates.has(date);
}

export class TradingCalendarCache {
  private readonly cache = new Map<MarketCode, TradingCalendarCacheEntry>();
  private readonly inFlight = new Map<MarketCode, Promise<Set<string>>>();
  private readonly log?: CalendarLogger;

  constructor(private readonly deps: TradingCalendarCacheDeps) {
    this.log = deps.log;
  }

  async getTradingDates(market: MarketCode): Promise<Set<string>> {
    assertSupportedMarket(market);
    const cached = this.cache.get(market);
    if (cached && Date.now() - cached.loadedAt < TTL_MS) {
      return cached.dates;
    }

    const active = this.inFlight.get(market);
    if (active) return active;

    const refresh = this.refreshMarket(market).finally(() => {
      this.inFlight.delete(market);
    });
    this.inFlight.set(market, refresh);
    return refresh;
  }

  notifyBarsUpserted(market: MarketCode, dates: ReadonlyArray<string>): void {
    assertSupportedMarket(market);
    const cached = this.cache.get(market);
    if (!cached) return;

    for (const date of dates) {
      if (date >= cached.horizonStartDate) {
        cached.dates.add(date);
      }
    }
  }

  flush(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  async latestSettledTradingDay(
    market: CalendarMarket,
    now: Date,
    options: SettleOptions = {},
  ): Promise<string> {
    if (market === "FX") {
      return latestSettledTradingDayPure(new Set(), market, now, options);
    }

    const tradingDates = await this.getTradingDates(market);
    const result = resolveLatestSettledTradingDay(tradingDates, market, now, options);
    if (result.usedFallback) {
      this.warnBootstrapFallback(market, "latest_settled_trading_day");
    }
    return result.date;
  }

  async tradingDaysBetween(d1: string, d2: string, market: CalendarMarket): Promise<number> {
    if (market === "FX") {
      return tradingDaysBetweenPure(new Set(), d1, d2, market);
    }
    const tradingDates = await this.getTradingDates(market);
    if (tradingDates.size === 0) {
      this.warnBootstrapFallback(market, "trading_days_between");
    }
    return tradingDaysBetweenPure(tradingDates, d1, d2, market);
  }

  async isTradingDay(market: CalendarMarket, date: string): Promise<boolean> {
    if (market === "FX") {
      return isTradingDayPure(new Set(), market, date);
    }
    const tradingDates = await this.getTradingDates(market);
    if (tradingDates.size === 0) {
      this.warnBootstrapFallback(market, "is_trading_day");
    }
    return isTradingDayPure(tradingDates, market, date);
  }

  async getOfficialCalendarDayStatus(
    market: SupportedMarketCode,
    at: Date,
  ): Promise<{
    localDate: string;
    calendarYear: number;
    status: "open" | "closed" | "calendar_unknown";
    reason: "not_trading_day" | "calendar_unknown";
  }> {
    const { localDate } = getMarketLocalParts(market, at);
    const calendarYear = Number(localDate.slice(0, 4));
    const version = await this.deps.persistence.getActiveMarketCalendarVersion(market, calendarYear);
    if (!version) {
      return { localDate, calendarYear, status: "calendar_unknown", reason: "calendar_unknown" };
    }
    const exception = version.exceptions.find((candidate) => candidate.date === localDate);
    const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
    const isWeekday = day >= 1 && day <= 5;
    const isOpen = exception ? exception.status === "open" : isWeekday;
    return {
      localDate,
      calendarYear,
      status: isOpen ? "open" : "closed",
      reason: "not_trading_day",
    };
  }

  private async refreshMarket(market: SupportedMarketCode): Promise<Set<string>> {
    // `bar_date` is market-local while the lookback cutoff is UTC. The 400-day
    // horizon intentionally makes one-day cutoff skew immaterial.
    const horizonStartDate = addDaysIsoDate(isoDateFromUtc(new Date(Date.now())), -LOOKBACK_DAYS);
    const previousWarned = this.cache.get(market)?.warnedEmpty ?? false;
    try {
      const rows = await this.deps.persistence.getDistinctBarDates(market, horizonStartDate);
      const dates = new Set(rows);
      this.cache.set(market, {
        dates,
        loadedAt: Date.now(),
        horizonStartDate,
        warnedEmpty: dates.size === 0 ? previousWarned : false,
      });
      return dates;
    } catch (err) {
      this.log?.error({ err, market }, "trading_calendar_refresh_failed");
      const dates = new Set<string>();
      this.cache.set(market, {
        dates,
        loadedAt: Date.now(),
        horizonStartDate,
        warnedEmpty: previousWarned,
      });
      return dates;
    }
  }

  private warnBootstrapFallback(market: MarketCode, reason: string): void {
    const cached = this.cache.get(market);
    if (!cached || cached.warnedEmpty) return;
    cached.warnedEmpty = true;
    this.log?.warn({ market, reason }, "trading_calendar_bootstrap_fallback");
  }
}
