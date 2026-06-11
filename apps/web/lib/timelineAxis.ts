import type { LocaleCode } from "@vakwen/shared-types";

export type TimelineMode = "auto" | "day" | "week" | "month" | "year";

type ResolvedTimelineMode = Exclude<TimelineMode, "auto">;

interface TimelineAxisOptions {
  endDate: string;
  locale: LocaleCode;
  mode: TimelineMode;
  pointDates?: string[];
  startDate: string;
}

export function buildTimelineAxis(options: TimelineAxisOptions) {
  const resolvedMode = options.mode === "auto"
    ? resolveAutoTimelineMode(options.startDate, options.endDate)
    : options.mode;
  const startMs = dateToUtcMs(options.startDate);
  const endMs = dateToUtcMs(options.endDate);
  const ticks = buildTicksForMode({ endMs, mode: resolvedMode, startMs });
  return {
    domain: [startMs, endMs] as [number, number],
    resolvedMode,
    tickFormatter: (value: number) => formatTimelineTick(msToIsoDate(value), options.locale, resolvedMode),
    ticks,
  };
}

export function resolveAutoTimelineMode(startDate: string, endDate: string): ResolvedTimelineMode {
  const startMs = dateToUtcMs(startDate);
  const endMs = dateToUtcMs(endDate);
  const days = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
  if (days <= 45) return "day";
  if (days <= 210) return "week";
  if (days <= 1100) return "month";
  return "year";
}

function buildTicksForMode(input: {
  endMs: number;
  mode: Exclude<TimelineMode, "auto">;
  startMs: number;
}) {
  const boundaryTicks = calendarBoundaryTicks(input.startMs, input.endMs, input.mode);
  const unique = [...new Set([input.startMs, ...boundaryTicks, input.endMs])]
    .filter((value) => value >= input.startMs && value <= input.endMs)
    .sort((left, right) => left - right);
  if (unique.length <= 1) return unique.length === 1 ? unique : [input.startMs];
  if (input.mode === "day") return thinTicks(unique, 7);
  if (input.mode === "week") return thinTicks(unique, 8);
  if (input.mode === "month") return thinTicks(unique, 8);
  return thinTicks(unique, 6);
}

function calendarBoundaryTicks(startMs: number, endMs: number, mode: Exclude<TimelineMode, "auto">) {
  if (mode === "day") return steppedUtcTicks(startMs, endMs, (date) => date.setUTCDate(date.getUTCDate() + 1));
  if (mode === "week") {
    const first = new Date(startMs);
    const daysUntilMonday = (8 - first.getUTCDay()) % 7;
    first.setUTCDate(first.getUTCDate() + daysUntilMonday);
    return steppedUtcTicks(first.getTime(), endMs, (date) => date.setUTCDate(date.getUTCDate() + 7));
  }
  if (mode === "month") {
    const first = new Date(startMs);
    if (first.getUTCDate() !== 1) {
      first.setUTCMonth(first.getUTCMonth() + 1, 1);
    }
    return steppedUtcTicks(first.getTime(), endMs, (date) => date.setUTCMonth(date.getUTCMonth() + 1, 1));
  }
  const first = new Date(startMs);
  if (first.getUTCDate() !== 1 || first.getUTCMonth() !== 0) {
    first.setUTCFullYear(first.getUTCFullYear() + 1, 0, 1);
  }
  return steppedUtcTicks(first.getTime(), endMs, (date) => date.setUTCFullYear(date.getUTCFullYear() + 1, 0, 1));
}

function steppedUtcTicks(
  startMs: number,
  endMs: number,
  advance: (date: Date) => void,
) {
  const ticks: number[] = [];
  const cursor = new Date(startMs);
  while (cursor.getTime() <= endMs) {
    ticks.push(cursor.getTime());
    advance(cursor);
  }
  return ticks;
}

function thinTicks(values: number[], maxTicks: number) {
  if (values.length <= maxTicks) return values;
  const step = (values.length - 1) / (maxTicks - 1);
  return Array.from({ length: maxTicks }, (_, index) => values[Math.round(index * step)]!).filter((value, index, arr) => index === 0 || value !== arr[index - 1]);
}

function formatTimelineTick(value: string, locale: LocaleCode, mode: ResolvedTimelineMode) {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (mode === "day" || mode === "week") {
    return new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  }
  if (mode === "month") {
    return new Intl.DateTimeFormat(intlLocale, { month: "short", timeZone: "UTC", year: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(intlLocale, { timeZone: "UTC", year: "numeric" }).format(date);
}

function dateToUtcMs(value: string): number {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).getTime();
}

function msToIsoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;
