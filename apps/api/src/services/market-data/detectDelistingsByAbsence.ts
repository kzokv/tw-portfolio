/**
 * KZO-195 — Pure detector for absence-based delisting.
 *
 * Given the set of catalog rows that were ABSENT from the most recent sync
 * snapshot for a market, decide:
 *   1. whether the mass-delisting safety guard trips (skip everything),
 *   2. which absent rows should have their `absence_streak` bumped, and
 *   3. which of those rows have crossed the configured threshold and should
 *      be stamped with `delisted_at`.
 *
 * Decision logic lives here as a pure function so service-layer unit tests
 * can exercise every branch without standing up Postgres. The persistence
 * layer invokes this function inside the `upsertInstrumentCatalog`
 * transaction via the `absenceDetection.categorize` callback (R2 / C1-a).
 */

export interface AbsentRow {
  ticker: string;
  /** Pre-this-run streak. Threshold check uses `absenceStreak + 1`. */
  absenceStreak: number;
  /** ISO timestamp of last present sighting; null = never observed. */
  lastSeenInCatalogAt: string | null;
  delistingDetectionExcluded: boolean;
}

export interface DetectionOptions {
  /** Consecutive absences (including this run) at which to stamp delisted. */
  threshold: number;
  /** Mass-delisting guard, percent (0–100) of `prevCatalogSize`. */
  guardPercent: number;
  /** Mass-delisting guard floor; effective ceiling = max(floor, size*pct/100). */
  guardFloor: number;
  /** Catalog size BEFORE this run's upserts (i.e. last known steady-state). */
  prevCatalogSize: number;
}

export interface DetectionPlan {
  /** True when the candidate count exceeds the safety ceiling. */
  guardTripped: boolean;
  /** Tickers whose `absence_streak` should be bumped by 1. Empty when guard trips. */
  toBump: string[];
  /** Tickers that crossed `threshold` this run and should be stamped delisted. Empty when guard trips. */
  toStamp: string[];
  /** All absent candidates regardless of guard outcome (for logs/notifications). */
  absentTickers: string[];
}

/**
 * Decide which absent rows are real delisting candidates and whether the
 * mass-delisting guard trips.
 *
 * Candidate filter:
 *   - `lastSeenInCatalogAt !== null` (legacy LICs / never-observed rows are
 *     not in scope for absence detection).
 *   - `delistingDetectionExcluded === false` (admin opt-out wins).
 *
 * Guard ceiling:
 *   `max(guardFloor, prevCatalogSize * guardPercent / 100)`. The floor protects
 *   small catalogs (e.g. a 10-row test catalog where 1% rounds down to 0).
 *
 * On guard trip: caller MUST commit the upserts (they are not delisting-related)
 * but skip both the streak bump and the stamp. The candidate list is reported
 * back via `absentTickers` for the warning notification.
 */
export function detectDelistingsByAbsence(
  absent: AbsentRow[],
  opts: DetectionOptions,
): DetectionPlan {
  const candidates = absent.filter(
    (row) => row.lastSeenInCatalogAt !== null && row.delistingDetectionExcluded === false,
  );
  const candidateTickers = candidates.map((row) => row.ticker);

  const ceiling = Math.max(
    opts.guardFloor,
    (opts.prevCatalogSize * opts.guardPercent) / 100,
  );
  const guardTripped = candidates.length > ceiling;

  if (guardTripped) {
    return {
      guardTripped: true,
      toBump: [],
      toStamp: [],
      absentTickers: candidateTickers,
    };
  }

  const toBump = candidateTickers;
  const toStamp = candidates
    .filter((row) => row.absenceStreak + 1 >= opts.threshold)
    .map((row) => row.ticker);

  return {
    guardTripped: false,
    toBump,
    toStamp,
    absentTickers: candidateTickers,
  };
}
