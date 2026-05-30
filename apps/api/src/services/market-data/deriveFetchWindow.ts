import type { Persistence } from "../../persistence/types.js";
import type { FxRefreshJobData } from "./types.js";

/**
 * KZO-164: max number of days the cron path will fetch in a single run.
 * After a long outage / first-deploy, the worker self-heals by fetching the most recent
 * 30 days only — older history is filled by KZO-174's trade-events walk.
 *
 * Window semantics: an inclusive (`startDate`, `endDate`) range. When this constant
 * is `30`, the window covers 31 calendar days (`today-30 .. today` inclusive).
 */
export const FX_REFRESH_MAX_LOOKBACK_DAYS = 30;

/** Returns today's date in YYYY-MM-DD UTC. Cron runs at 22:00 UTC by which time CBC/RBA/ECB have published. */
export function today_utc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addUtcDays(yyyymmdd: string, deltaDays: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function diffDaysInclusive(fromDate: string, toDate: string): number {
  // Returns the calendar-day delta between two ISO YYYY-MM-DD strings (UTC midnight).
  // Example: ('2026-04-23', '2026-04-26') → 3.
  const a = new Date(`${fromDate}T00:00:00Z`).getTime();
  const b = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Compute the window the worker should fetch for a given job invocation.
 *
 * - **Manual trigger**: returns `{ jobData.startDate, jobData.endDate }` verbatim. The
 *   admin already specified the window explicitly — no autodetection or capping. Does
 *   NOT call `getLatestFxRateDate()`.
 * - **Cron trigger** + empty table → seeds the most recent N days
 *   (`{ today - FX_REFRESH_MAX_LOOKBACK_DAYS, today }`).
 * - **Cron trigger** + populated, gap > N days → caps at N days backward (long-outage
 *   self-heal — older gaps fill via KZO-174).
 * - **Cron trigger** + populated, gap ≤ N days → fetches `(MAX(date)+1, today)`. When
 *   already up to date (`MAX(date) === today`), returns a sentinel where
 *   `startDate > endDate` so the worker no-ops the upsert batch.
 *
 * Pure function (apart from the persistence read) — exported so the unit tests can
 * exercise the gap-detection logic without spinning up the worker.
 */
export async function deriveFetchWindow(
  jobData: FxRefreshJobData,
  persistence: Pick<Persistence, "getLatestFxRateDate">,
  now: () => string = today_utc,
): Promise<{ startDate: string; endDate: string }> {
  if (jobData.trigger === "manual") {
    return { startDate: jobData.startDate, endDate: jobData.endDate };
  }

  const today = now();
  const latest = await persistence.getLatestFxRateDate();

  if (latest === null) {
    return {
      startDate: addUtcDays(today, -FX_REFRESH_MAX_LOOKBACK_DAYS),
      endDate: today,
    };
  }

  // Already up to date (or "ahead" via clock skew). Return a no-op sentinel where
  // startDate > endDate so the worker fetches nothing.
  if (latest >= today) {
    return { startDate: addUtcDays(today, 1), endDate: today };
  }

  const candidateStart = addUtcDays(latest, 1);
  const gapDays = diffDaysInclusive(latest, today);
  if (gapDays > FX_REFRESH_MAX_LOOKBACK_DAYS) {
    return {
      startDate: addUtcDays(today, -FX_REFRESH_MAX_LOOKBACK_DAYS),
      endDate: today,
    };
  }

  return { startDate: candidateStart, endDate: today };
}
