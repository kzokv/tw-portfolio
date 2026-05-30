/**
 * Unit tests for deriveFetchWindow — pure function, no side effects.
 *
 * Invariant 5: `today` resolves to UTC.
 * All assertions are pinned to a fixed system time to avoid real-clock reliance.
 *
 * Cases:
 *  - manual trigger → returns jobData.{startDate, endDate} verbatim
 *  - cron trigger, empty table → 30-day seed window ending today
 *  - cron trigger, 3-day gap → returns (MAX(date)+1, today)
 *  - cron trigger, 90-day gap → capped at 30 days backward from today
 *  - cron trigger, already up-to-date (MAX = today) → empty / no-op window
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveFetchWindow } from "../../src/services/market-data/deriveFetchWindow.js";
import type { FxRefreshJobData } from "../../src/services/market-data/types.js";

// Pin the clock: 2026-04-26 22:00:00 UTC
// todayUtc = "2026-04-26"
const FIXED_NOW = new Date("2026-04-26T22:00:00Z");
const TODAY_UTC = "2026-04-26";

beforeEach(() => {
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makePersistence(latestDate: string | null): { getLatestFxRateDate: () => Promise<string | null> } {
  return {
    getLatestFxRateDate: vi.fn().mockResolvedValue(latestDate),
  };
}

function makeCronJob(extra?: Partial<FxRefreshJobData>): FxRefreshJobData {
  return {
    trigger: "cron",
    startDate: TODAY_UTC,
    endDate: TODAY_UTC,
    bases: ["TWD", "USD", "AUD", "KRW"],
    ...extra,
  };
}

function makeManualJob(startDate: string, endDate: string, extra?: Partial<FxRefreshJobData>): FxRefreshJobData {
  return {
    trigger: "manual",
    startDate,
    endDate,
    bases: ["TWD", "USD", "AUD", "KRW"],
    ...extra,
  };
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Manual trigger ───────────────────────────────────────────────────────────

describe("deriveFetchWindow — manual trigger", () => {
  it("returns jobData.startDate and jobData.endDate verbatim (no autodetection)", async () => {
    const persistence = makePersistence(null); // DB state irrelevant for manual
    const job = makeManualJob("2026-01-01", "2026-03-31");

    const window = await deriveFetchWindow(job, persistence);

    expect(window.startDate).toBe("2026-01-01");
    expect(window.endDate).toBe("2026-03-31");
  });

  it("does NOT call getLatestFxRateDate for manual trigger", async () => {
    const persistence = makePersistence(null);
    const job = makeManualJob("2026-04-01", "2026-04-25");

    await deriveFetchWindow(job, persistence);

    expect(persistence.getLatestFxRateDate).not.toHaveBeenCalled();
  });

  it("preserves the exact manual window even when table is populated", async () => {
    const persistence = makePersistence("2026-04-20"); // populated table — ignored
    const job = makeManualJob("2026-01-01", "2026-01-31");

    const window = await deriveFetchWindow(job, persistence);

    expect(window.startDate).toBe("2026-01-01");
    expect(window.endDate).toBe("2026-01-31");
  });
});

// ── Cron trigger — empty table ────────────────────────────────────────────────

describe("deriveFetchWindow — cron trigger, empty table", () => {
  it("returns 30-day seed window ending today when DB is empty (null)", async () => {
    const persistence = makePersistence(null);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    expect(window.endDate).toBe(TODAY_UTC);
    expect(window.startDate).toBe(subtractDays(TODAY_UTC, 30));
  });

  it("end date = today_utc (UTC resolution, not local time)", async () => {
    const persistence = makePersistence(null);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    // The pinned clock is 2026-04-26T22:00:00Z.
    // In a UTC-12 timezone, "local" would still be 2026-04-25. UTC must win.
    expect(window.endDate).toBe("2026-04-26");
  });
});

// ── Cron trigger — recent data (small gap) ───────────────────────────────────

describe("deriveFetchWindow — cron trigger, gap < 30 days", () => {
  it("returns (MAX(date)+1, today) for a 3-day gap", async () => {
    const latestDate = subtractDays(TODAY_UTC, 3); // 2026-04-23
    const persistence = makePersistence(latestDate);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    expect(window.startDate).toBe(addDays(latestDate, 1)); // 2026-04-24
    expect(window.endDate).toBe(TODAY_UTC);
  });

  it("returns (today, today) when MAX(date) = yesterday — only fetch today", async () => {
    const yesterday = subtractDays(TODAY_UTC, 1);
    const persistence = makePersistence(yesterday);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    expect(window.startDate).toBe(TODAY_UTC);
    expect(window.endDate).toBe(TODAY_UTC);
  });

  it("returns empty-range or no-op when MAX(date) = today — already up to date", async () => {
    const persistence = makePersistence(TODAY_UTC);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    // startDate >= endDate signals nothing to fetch
    expect(window.startDate > window.endDate).toBe(true);
  });
});

// ── Cron trigger — large gap (cap at 30 days) ────────────────────────────────

describe("deriveFetchWindow — cron trigger, gap > 30 days", () => {
  it("caps at 30 days backward when MAX(date) was 90 days ago", async () => {
    const latestDate = subtractDays(TODAY_UTC, 90);
    const persistence = makePersistence(latestDate);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    expect(window.endDate).toBe(TODAY_UTC);
    expect(window.startDate).toBe(subtractDays(TODAY_UTC, 30));
  });

  it("caps at 30 days backward when MAX(date) was 31 days ago (just over threshold)", async () => {
    const latestDate = subtractDays(TODAY_UTC, 31);
    const persistence = makePersistence(latestDate);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    expect(window.endDate).toBe(TODAY_UTC);
    expect(window.startDate).toBe(subtractDays(TODAY_UTC, 30));
  });

  it("does NOT cap when MAX(date) was exactly 30 days ago", async () => {
    const latestDate = subtractDays(TODAY_UTC, 30);
    const persistence = makePersistence(latestDate);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    // gap = 30 days → startDate = MAX(date)+1 = today-29 (no cap needed)
    expect(window.startDate).toBe(addDays(latestDate, 1));
    expect(window.endDate).toBe(TODAY_UTC);
  });

  it("caps at 30 days when MAX(date) was 365 days ago (first deploy after long outage)", async () => {
    const latestDate = subtractDays(TODAY_UTC, 365);
    const persistence = makePersistence(latestDate);
    const job = makeCronJob();

    const window = await deriveFetchWindow(job, persistence);

    const expectedStart = subtractDays(TODAY_UTC, 30);
    expect(window.startDate).toBe(expectedStart);
    expect(window.endDate).toBe(TODAY_UTC);
  });
});
