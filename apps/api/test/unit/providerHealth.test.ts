/**
 * KZO-177 — Unit tests for `recordOutcome` aggregator + freshness helper.
 *
 * NOTE (TDD-red): the modules under test are landed by the Backend Implementer
 * during Phase 1. Until they exist these imports fail to resolve, which is the
 * intended Tier-3 parallel Phase 1+2 contract.
 *
 * Coverage matrix mirrors `qa-plan.md` §1:
 *   U1   first success on null row → healthy, no notification
 *   U2   success after error → healthy, recovery CAS no-op when prev !== down
 *   U3   recovery: down → healthy fires recovery notification once per admin
 *   U4   recovery CAS — only winner fires notification on concurrent success
 *   U5   error transition healthy → down fires admin notifications + sets last_down_notification_at
 *   U6   24h flap suppression: second down within 24h does NOT re-fire
 *   U7   down → degraded → down — notification fires only once across cycle
 *   U8   rate_limit outcome — rate_limit_count_24h++, error_count_24h unchanged, status unchanged
 *   U9   error trail row fields — provider_id, occurred_at, error_class, error_message, context
 *   U10  last_error_message overwrites prior value on each error
 *   U11  frankfurter uses FX-weekday calendar (synthetic market)
 *
 * computeStatus pure helper:
 *   C1-C5  threshold tests
 *   C6     unsupported provider — returns 'current' freshness, null tooltip
 *
 * Freshness DTO classification (separate file or this one):
 *   F1-F6  current/stale_amber/stale_red boundary + manual + per-request cache
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = new Date("2026-05-06T12:00:00Z");

beforeEach(() => {
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Module under test (TDD-red imports — must land in Phase 1) ────────────────

const { MemoryPersistence } = await import("../../src/persistence/memory.js");
const { recordOutcome, computeStatus } = await import(
  "../../src/services/market-data/providerHealth.js"
);

type Persistence = InstanceType<typeof MemoryPersistence>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDERS = [
  "finmind-tw",
  "finmind-us",
  "yahoo-finance-au",
  "twelve-data-au",
  "frankfurter",
] as const;

async function seedHealthRow(
  persistence: Persistence,
  providerId: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  // Backend Implementer exposes a memory-backed seeder helper used by both unit
  // and integration tests. If the helper name differs, update here.
  await persistence._seedProviderHealthStatus({
    providerId,
    status: "down",
    lastSuccessfulRun: null,
    lastFailedRun: null,
    errorCount24h: 0,
    errorCount7d: 0,
    rateLimitCount24h: 0,
    lastErrorMessage: null,
    lastDownNotificationAt: null,
    lastManualRerunAt: null,
    ...patch,
  });
}

async function listAdminNotifications(
  persistence: Persistence,
  category: string,
): Promise<Array<{ category: string; payload: unknown }>> {
  // Wrapper around the in-memory notifications collection. Backend Implementer
  // confirms the exact accessor; placeholder for now.
  return persistence._listAdminNotifications(category);
}

// ── recordOutcome state-machine tests ─────────────────────────────────────────

describe("recordOutcome — state machine", () => {
  let persistence: Persistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    for (const id of PROVIDERS) {
      await seedHealthRow(persistence, id);
    }
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("U1: first-ever success on null row → healthy, no notification", async () => {
    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "success" },
    });

    const row = await (persistence as never as {
      _getProviderHealthStatus(id: string): Promise<{
        status: string;
        lastSuccessfulRun: string | null;
        errorCount24h: number;
      }>;
    })._getProviderHealthStatus("finmind-tw");

    expect(row.status).toBe("healthy");
    expect(row.lastSuccessfulRun).not.toBeNull();
    expect(row.errorCount24h).toBe(0);

    const notifications = await listAdminNotifications(persistence, "provider_recovered");
    expect(notifications).toHaveLength(0);
  });

  it("U2: success after error (was degraded, not down) → healthy; recovery CAS no-op", async () => {
    await seedHealthRow(persistence, "finmind-tw", {
      status: "degraded",
      lastSuccessfulRun: FIXED_NOW.toISOString(),
      errorCount24h: 1,
      lastDownNotificationAt: null, // not previously down
    });

    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "success" },
    });

    const notifications = await listAdminNotifications(persistence, "provider_recovered");
    expect(notifications).toHaveLength(0);
  });

  it("U3: recovery (down → healthy) fires recovery notification once per admin", async () => {
    // Seed two admins
    const admin1 = await persistence.resolveOrCreateUser("google", "admin1-sub", {
      email: "admin1@example.com",
      name: "Admin One",
    });
    await persistence.changeUserRole(admin1.userId, "admin", { actorUserId: "system" });
    const admin2 = await persistence.resolveOrCreateUser("google", "admin2-sub", {
      email: "admin2@example.com",
      name: "Admin Two",
    });
    await persistence.changeUserRole(admin2.userId, "admin", { actorUserId: "system" });

    await seedHealthRow(persistence, "finmind-tw", {
      status: "down",
      lastDownNotificationAt: new Date(FIXED_NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    });

    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "success" },
    });

    const notifications = await listAdminNotifications(persistence, "provider_recovered");
    expect(notifications.length).toBeGreaterThanOrEqual(2); // one per admin
  });

  it("U4: recovery CAS — concurrent success on down row, only one winner fires notification", async () => {
    const admin = await persistence.resolveOrCreateUser("google", "admin-cas-sub", {
      email: "admin-cas@example.com",
      name: "Admin CAS",
    });
    await persistence.changeUserRole(admin.userId, "admin", { actorUserId: "system" });

    await seedHealthRow(persistence, "finmind-tw", {
      status: "down",
      lastDownNotificationAt: new Date(FIXED_NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    });

    await Promise.all([
      recordOutcome(persistence, { providerId: "finmind-tw", outcome: { kind: "success" } }),
      recordOutcome(persistence, { providerId: "finmind-tw", outcome: { kind: "success" } }),
    ]);

    const notifications = await listAdminNotifications(persistence, "provider_recovered");
    // Exactly one notification per admin — CAS guards against double-fire.
    expect(notifications).toHaveLength(1);
  });

  it("U5: error transition healthy → down fires admin notifications + sets last_down_notification_at", async () => {
    const admin = await persistence.resolveOrCreateUser("google", "admin-down-sub", {
      email: "admin-down@example.com",
      name: "Admin Down",
    });
    await persistence.changeUserRole(admin.userId, "admin", { actorUserId: "system" });

    // Seed healthy with last_successful_run far enough in the past that the next
    // failed-run computation produces status='down'.
    await seedHealthRow(persistence, "finmind-tw", {
      status: "healthy",
      lastSuccessfulRun: new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastDownNotificationAt: null,
    });

    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "http_5xx", errorMessage: "boom" },
    });

    const row = await (persistence as never as {
      _getProviderHealthStatus(id: string): Promise<{
        status: string;
        lastDownNotificationAt: string | null;
      }>;
    })._getProviderHealthStatus("finmind-tw");

    expect(row.status).toBe("down");
    expect(row.lastDownNotificationAt).not.toBeNull();
    const notifications = await listAdminNotifications(persistence, "provider_down");
    expect(notifications.length).toBeGreaterThanOrEqual(1);
  });

  it("U6: 24h flap suppression — second down within 24h does NOT re-fire", async () => {
    const admin = await persistence.resolveOrCreateUser("google", "admin-flap-sub", {
      email: "admin-flap@example.com",
      name: "Admin Flap",
    });
    await persistence.changeUserRole(admin.userId, "admin", { actorUserId: "system" });

    const stamp = new Date(FIXED_NOW.getTime() - 23 * 60 * 60 * 1000).toISOString();
    await seedHealthRow(persistence, "finmind-tw", {
      status: "down",
      lastDownNotificationAt: stamp,
    });

    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "http_5xx", errorMessage: "again" },
    });

    const notifications = await listAdminNotifications(persistence, "provider_down");
    expect(notifications).toHaveLength(0);

    const row = await (persistence as never as {
      _getProviderHealthStatus(id: string): Promise<{ lastDownNotificationAt: string | null }>;
    })._getProviderHealthStatus("finmind-tw");
    expect(row.lastDownNotificationAt).toBe(stamp); // unchanged
  });

  it("U8: rate_limit outcome — rate_limit_count_24h++, status unchanged, error_count_24h unchanged", async () => {
    await seedHealthRow(persistence, "finmind-tw", {
      status: "healthy",
      lastSuccessfulRun: FIXED_NOW.toISOString(),
      errorCount24h: 0,
      rateLimitCount24h: 0,
    });

    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: {
        kind: "rate_limit",
        errorClass: "rate_limit",
        errorMessage: "429 budget exhausted",
      },
    });

    const row = await (persistence as never as {
      _getProviderHealthStatus(id: string): Promise<{
        status: string;
        rateLimitCount24h: number;
        errorCount24h: number;
      }>;
    })._getProviderHealthStatus("finmind-tw");

    expect(row.status).toBe("healthy");
    expect(row.rateLimitCount24h).toBe(1);
    expect(row.errorCount24h).toBe(0);
  });

  it("U7: down → degraded → down — notification fires only once across the cycle", async () => {
    const admin = await persistence.resolveOrCreateUser("google", "admin-cycle-sub", {
      email: "admin-cycle@example.com",
      name: "Admin Cycle",
    });
    await persistence.changeUserRole(admin.userId, "admin", { actorUserId: "system" });

    // Start: down with notification fired 1h ago. Suppression window still
    // intact (< 24h).
    const downStamp = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000).toISOString();
    await seedHealthRow(persistence, "finmind-tw", {
      status: "down",
      lastDownNotificationAt: downStamp,
      lastSuccessfulRun: new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Cycle: error (still down) → success (recovers, but lands as degraded if
    // error_count_24h>=1 OR healthy if 0; either way leaves the down state) →
    // error (back to down within the same 24h window).
    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "http_5xx", errorMessage: "first error" },
    });
    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "success" },
    });
    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "http_5xx", errorMessage: "second error" },
    });

    // The cycle's only legitimate `provider_down` notification was the seeded
    // one from 1h ago — which we did NOT count via the in-memory list, since
    // it was injected directly via _seedProviderHealthStatus. The new errors
    // within the 24h suppression window must NOT re-fire `provider_down`.
    const downNotifications = await listAdminNotifications(persistence, "provider_down");
    expect(downNotifications).toHaveLength(0);
  });

  it("U10: last_error_message denormalization — overwrites prior value", async () => {
    await seedHealthRow(persistence, "finmind-tw", {
      status: "healthy",
      lastSuccessfulRun: FIXED_NOW.toISOString(),
      lastErrorMessage: "old",
    });

    await recordOutcome(persistence, {
      providerId: "finmind-tw",
      outcome: { kind: "error", errorClass: "network", errorMessage: "new" },
    });

    const row = await (persistence as never as {
      _getProviderHealthStatus(id: string): Promise<{ lastErrorMessage: string | null }>;
    })._getProviderHealthStatus("finmind-tw");

    expect(row.lastErrorMessage).toBe("new");
  });
});

// ── computeStatus pure helper ─────────────────────────────────────────────────

describe("computeStatus — pure helper", () => {
  // Stub `latestSettledTradingDay` via a fixed argument to keep this pure.
  // computeStatus signature (per scope): ({ lastSuccessfulRun, errorCount24h, latestSettledTradingDay }).
  it("C1: healthy when last_successful_run >= latest and errors = 0", () => {
    expect(
      computeStatus({
        lastSuccessfulRun: "2026-05-06T00:00:00Z",
        errorCount24h: 0,
        latestSettledTradingDay: "2026-05-05",
      }),
    ).toBe("healthy");
  });

  it("C2: degraded when last_successful_run >= latest but errors >= 1", () => {
    expect(
      computeStatus({
        lastSuccessfulRun: "2026-05-06T00:00:00Z",
        errorCount24h: 3,
        latestSettledTradingDay: "2026-05-05",
      }),
    ).toBe("degraded");
  });

  it("C3: down when last_successful_run < latest", () => {
    expect(
      computeStatus({
        lastSuccessfulRun: "2026-05-04T00:00:00Z",
        errorCount24h: 0,
        latestSettledTradingDay: "2026-05-05",
      }),
    ).toBe("down");
  });

  it("C4: down when last_successful_run is null", () => {
    expect(
      computeStatus({
        lastSuccessfulRun: null,
        errorCount24h: 0,
        latestSettledTradingDay: "2026-05-05",
      }),
    ).toBe("down");
  });

  it("C5: boundary inclusive — last_successful_run == latest 00:00 UTC → healthy", () => {
    expect(
      computeStatus({
        lastSuccessfulRun: "2026-05-05T00:00:00Z",
        errorCount24h: 0,
        latestSettledTradingDay: "2026-05-05",
      }),
    ).toBe("healthy");
  });
});
