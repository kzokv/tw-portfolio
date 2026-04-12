import type { CurrencyExpectedReceived } from "@tw-portfolio/shared-types";

// ── Preset date resolution ─────────────────────────────────────────────────

export type DatePreset =
  | "yesterday"
  | "thisWeek"
  | "last7Days"
  | "last30Days"
  | "thisMonth"
  | "lastMonth"
  | "currentQuarter"
  | "lastQuarter"
  | "currentYear"
  | "lastYear"
  | "unspecified"
  | "custom"
  | `year-${number}`;

export interface ResolvedDates {
  from: string | null;
  to: string | null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOfWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
}

function quarterStart(year: number, quarter: number): Date {
  return new Date(Date.UTC(year, (quarter - 1) * 3, 1));
}

function quarterEnd(year: number, quarter: number): Date {
  return new Date(Date.UTC(year, quarter * 3, 0));
}

export function resolvePresetDates(preset: DatePreset, today: Date): ResolvedDates {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();

  switch (preset) {
    case "yesterday": {
      const yesterday = new Date(Date.UTC(y, m, d - 1));
      const s = formatDate(yesterday);
      return { from: s, to: s };
    }
    case "thisWeek": {
      const monday = mondayOfWeek(today);
      return { from: formatDate(monday), to: formatDate(today) };
    }
    case "last7Days": {
      const start = new Date(Date.UTC(y, m, d - 6));
      return { from: formatDate(start), to: formatDate(today) };
    }
    case "last30Days": {
      const start = new Date(Date.UTC(y, m, d - 29));
      return { from: formatDate(start), to: formatDate(today) };
    }
    case "thisMonth": {
      const first = new Date(Date.UTC(y, m, 1));
      const last = new Date(Date.UTC(y, m + 1, 0));
      return { from: formatDate(first), to: formatDate(last) };
    }
    case "lastMonth": {
      const first = new Date(Date.UTC(y, m - 1, 1));
      const last = new Date(Date.UTC(y, m, 0));
      return { from: formatDate(first), to: formatDate(last) };
    }
    case "currentQuarter": {
      const q = Math.floor(m / 3) + 1;
      return { from: formatDate(quarterStart(y, q)), to: formatDate(today) };
    }
    case "lastQuarter": {
      let q = Math.floor(m / 3);
      let qy = y;
      if (q === 0) {
        q = 4;
        qy = y - 1;
      }
      return { from: formatDate(quarterStart(qy, q)), to: formatDate(quarterEnd(qy, q)) };
    }
    case "currentYear":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "lastYear":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "unspecified":
      return { from: null, to: null };
    case "custom":
      return { from: null, to: null };
    default: {
      // year-XXXX
      if (preset.startsWith("year-")) {
        const yr = parseInt(preset.slice(5), 10);
        return { from: `${yr}-01-01`, to: `${yr}-12-31` };
      }
      return { from: null, to: null };
    }
  }
}

// ── Chart utilities ────────────────────────────────────────────────────────

export type Granularity = "month" | "quarter" | "year";

export interface ChartDataPoint {
  label: string;
  expected: number;
  received: number;
}

function monthToQuarter(monthKey: string): string {
  const [year, mm] = monthKey.split("-");
  const quarter = Math.ceil(parseInt(mm, 10) / 3);
  return `${year}-Q${quarter}`;
}

function monthToYear(monthKey: string): string {
  return monthKey.split("-")[0];
}

export function bucketByGranularity(
  byMonth: Record<string, CurrencyExpectedReceived>,
  granularity: Granularity,
): Record<string, CurrencyExpectedReceived> {
  if (granularity === "month") return byMonth;

  const result: Record<string, CurrencyExpectedReceived> = {};
  const keyFn = granularity === "quarter" ? monthToQuarter : monthToYear;

  for (const [monthKey, currencies] of Object.entries(byMonth)) {
    const bucketKey = keyFn(monthKey);
    if (!result[bucketKey]) {
      result[bucketKey] = {};
    }
    for (const [currency, amounts] of Object.entries(currencies)) {
      if (!result[bucketKey][currency]) {
        result[bucketKey][currency] = { expected: 0, received: 0 };
      }
      result[bucketKey][currency].expected += amounts.expected;
      result[bucketKey][currency].received += amounts.received;
    }
  }

  return result;
}

export function computeCumulative(
  bucketed: Record<string, CurrencyExpectedReceived>,
  currency: string,
): ChartDataPoint[] {
  const sortedKeys = Object.keys(bucketed).sort();
  let runningExpected = 0;
  let runningReceived = 0;

  return sortedKeys.map((key) => {
    const amounts = bucketed[key]?.[currency];
    runningExpected += amounts?.expected ?? 0;
    runningReceived += amounts?.received ?? 0;
    return {
      label: key,
      expected: runningExpected,
      received: runningReceived,
    };
  });
}

export function formatYAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export function extractCurrencies(byMonth: Record<string, CurrencyExpectedReceived>): string[] {
  const currencies = new Set<string>();
  for (const amounts of Object.values(byMonth)) {
    for (const currency of Object.keys(amounts)) {
      currencies.add(currency);
    }
  }
  return Array.from(currencies).sort();
}

export function bucketedToChartData(
  bucketed: Record<string, CurrencyExpectedReceived>,
  currency: string,
): ChartDataPoint[] {
  return Object.keys(bucketed)
    .sort()
    .map((key) => ({
      label: key,
      expected: bucketed[key]?.[currency]?.expected ?? 0,
      received: bucketed[key]?.[currency]?.received ?? 0,
    }));
}
