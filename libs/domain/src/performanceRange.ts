// KZO-159 (158A): Dashboard performance range parser + bounds resolver.
//
// Pure functions, no side effects, no imports from apps/*. Used by both the
// API (dashboard.ts + route validators + admin settings) and the web
// (admin settings validation + user-facing customization in 158C).
//
// Grammar (case-sensitive):
//   ^YTD$            — year-to-date: Jan 1 of asOf year through asOf
//   ^ALL$            — earliestTradeDate through asOf (or asOf..asOf if no trades)
//   ^([1-9]\d*)M$    — n months (1 ≤ n ≤ 240)
//   ^([1-9]\d*)Y$    — n years  (1 ≤ n ≤ 50)

export type ParsedRange =
  | { kind: "month"; n: number }
  | { kind: "year"; n: number }
  | { kind: "ytd" }
  | { kind: "all" };

export const PERFORMANCE_RANGE_REGEX = /^([1-9]\d*)(M|Y)$|^YTD$|^ALL$/;
export const PERFORMANCE_RANGE_MAX_MONTHS = 240;
export const PERFORMANCE_RANGE_MAX_YEARS = 50;

/**
 * Parses a performance range string. Returns `null` when the input does not
 * match the grammar or exceeds the month/year bounds. Case-sensitive.
 */
export function parsePerformanceRange(str: string): ParsedRange | null {
  if (typeof str !== "string") return null;
  if (str === "YTD") return { kind: "ytd" };
  if (str === "ALL") return { kind: "all" };

  const match = /^([1-9]\d*)(M|Y)$/.exec(str);
  if (!match) return null;

  const n = Number(match[1]);
  const unit = match[2];

  if (unit === "M") {
    if (n > PERFORMANCE_RANGE_MAX_MONTHS) return null;
    return { kind: "month", n };
  }
  // unit === "Y"
  if (n > PERFORMANCE_RANGE_MAX_YEARS) return null;
  return { kind: "year", n };
}

/**
 * Convenience: returns `true` when `str` is a valid range per the grammar and
 * bounds above. Equivalent to `parsePerformanceRange(str) !== null`.
 */
export function isValidPerformanceRange(str: string): boolean {
  return parsePerformanceRange(str) !== null;
}

function toUtcDate(isoDate: string): Date {
  // Normalize to midnight UTC; accept either "YYYY-MM-DD" or full ISO string.
  const slice = isoDate.slice(0, 10);
  return new Date(`${slice}T00:00:00.000Z`);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves a range string to concrete `{ startDate, endDate }` bounds
 * (inclusive on both ends, ISO "YYYY-MM-DD" strings).
 *
 * - `YTD` → startDate = Jan 1 of asOf year
 * - `ALL` → startDate = earliestTradeDate when provided, otherwise asOf
 * - `nM`  → startDate = asOf minus n months (UTC)
 * - `nY`  → startDate = asOf minus n years (UTC)
 *
 * Throws `Error` with a descriptive message when the range is unparseable.
 * Callers (routes, services) validate via zod/parsePerformanceRange first
 * and rely on this function to be total over valid inputs.
 */
export function resolveRangeBounds(
  rangeString: string,
  asOf: string,
  earliestTradeDate?: string,
): { startDate: string; endDate: string } {
  const parsed = parsePerformanceRange(rangeString);
  if (!parsed) {
    throw new Error(`invalid performance range: ${rangeString}`);
  }

  const end = toUtcDate(asOf);
  const endDate = toIsoDate(end);
  const start = new Date(end);

  switch (parsed.kind) {
    case "ytd":
      start.setUTCMonth(0, 1);
      break;
    case "all":
      if (earliestTradeDate) {
        return { startDate: toIsoDate(toUtcDate(earliestTradeDate)), endDate };
      }
      return { startDate: endDate, endDate };
    case "month":
      start.setUTCMonth(start.getUTCMonth() - parsed.n);
      break;
    case "year":
      start.setUTCFullYear(start.getUTCFullYear() - parsed.n);
      break;
  }

  return { startDate: toIsoDate(start), endDate };
}
