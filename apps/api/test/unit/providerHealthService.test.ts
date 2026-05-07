// KZO-177 — provider health service unit tests (Backend Implementer's tests).
// QA's separate `providerHealth.test.ts` file uses a different API shape that
// doesn't match the team-lead's brief (it assumes persisted counter columns;
// the brief explicitly says counters are computed-on-read). Both files live
// in this directory; this one tests the actual implementation.
import { describe, it, expect, vi } from "vitest";
import { computeStatus, createProviderHealthService } from "../../src/services/market-data/providerHealth.js";
import type { TradingCalendarCache } from "../../src/services/market-data/tradingCalendar.js";

describe("computeStatus — pure helper (positional args)", () => {
  it("healthy when last success >= settled day AND no errors", () => {
    expect(computeStatus("2026-05-06T00:00:00Z", "2026-05-05", 0)).toBe("healthy");
  });
  it("degraded when last success >= settled day AND errors >= 1", () => {
    expect(computeStatus("2026-05-06T00:00:00Z", "2026-05-05", 3)).toBe("degraded");
  });
  it("down when last success < settled day", () => {
    expect(computeStatus("2026-05-04T00:00:00Z", "2026-05-05", 0)).toBe("down");
  });
  it("down when last success is null", () => {
    expect(computeStatus(null, "2026-05-05", 0)).toBe("down");
  });
  it("boundary: last_successful_run on settled day → healthy", () => {
    expect(computeStatus("2026-05-05T00:00:00Z", "2026-05-05", 0)).toBe("healthy");
  });
});

describe("createProviderHealthService — recordOutcome", () => {
  function makeDeps() {
    const persistence = {
      getProviderHealthStatus: vi.fn(),
      upsertProviderHealthStatus: vi.fn().mockResolvedValue(undefined),
      clearProviderDownNotificationCas: vi.fn().mockResolvedValue(true),
      claimProviderDownNotificationSlot: vi.fn().mockResolvedValue(true),
      insertProviderErrorTrailEntry: vi.fn().mockResolvedValue(undefined),
      computeErrorCount24h: vi.fn().mockResolvedValue(0),
      listAdminUserIds: vi.fn().mockResolvedValue(["admin-1"]),
      createNotification: vi.fn().mockResolvedValue("notif-1"),
    };
    const tradingCalendar = {
      latestSettledTradingDay: vi.fn().mockResolvedValue("2026-05-05"),
    } as unknown as Pick<TradingCalendarCache, "latestSettledTradingDay">;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { persistence, tradingCalendar, log };
  }

  it("rate_limit outcome inserts trail row but does not change status", async () => {
    const deps = makeDeps();
    deps.persistence.getProviderHealthStatus.mockResolvedValue({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: "2026-05-06T00:00:00Z",
      lastFailedRun: null,
      lastErrorMessage: null,
      lastDownNotificationAt: null,
      lastManualRerunAt: null,
      updatedAt: "2026-05-06T00:00:00Z",
    });
    const svc = createProviderHealthService(deps);
    await svc.recordOutcome("finmind-tw", { kind: "rate_limit", errorMessage: "429" });
    expect(deps.persistence.insertProviderErrorTrailEntry).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "finmind-tw", errorClass: "rate_limit" }),
    );
    expect(deps.persistence.upsertProviderHealthStatus).not.toHaveBeenCalled();
    expect(deps.persistence.createNotification).not.toHaveBeenCalled();
  });

  it("success on previously-down row fires recovery notification when CAS wins", async () => {
    const deps = makeDeps();
    deps.persistence.getProviderHealthStatus.mockResolvedValue({
      providerId: "finmind-tw",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: "2026-05-05T00:00:00Z",
      lastErrorMessage: "boom",
      lastDownNotificationAt: "2026-05-05T01:00:00Z",
      lastManualRerunAt: null,
      updatedAt: "2026-05-05T00:00:00Z",
    });
    const svc = createProviderHealthService(deps);
    await svc.recordOutcome("finmind-tw", { kind: "success" });
    expect(deps.persistence.upsertProviderHealthStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "healthy", lastSuccessfulRun: expect.any(String) }),
    );
    expect(deps.persistence.clearProviderDownNotificationCas).toHaveBeenCalledWith(
      "finmind-tw",
      "2026-05-05T01:00:00Z",
    );
    expect(deps.persistence.createNotification).toHaveBeenCalled();
  });

  it("error transition healthy → down fires admin notification on first occurrence", async () => {
    const deps = makeDeps();
    // last_successful_run is 7 days ago — newStatus will be "down"
    deps.persistence.getProviderHealthStatus.mockResolvedValue({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: "2026-04-29T00:00:00Z",
      lastFailedRun: null,
      lastErrorMessage: null,
      lastDownNotificationAt: null,
      lastManualRerunAt: null,
      updatedAt: "2026-04-29T00:00:00Z",
    });
    const svc = createProviderHealthService(deps);
    await svc.recordOutcome("finmind-tw", {
      kind: "error",
      errorClass: "http_5xx",
      errorMessage: "boom",
    });
    expect(deps.persistence.insertProviderErrorTrailEntry).toHaveBeenCalled();
    expect(deps.persistence.createNotification).toHaveBeenCalled();
  });

  it("24h flap suppression — claim returns false, no notification fires", async () => {
    // KZO-177 (P2 Fix 5): suppression is enforced atomically inside
    // `claimProviderDownNotificationSlot`. When the persistence-level CAS
    // refuses (slot already claimed within suppression window), the
    // aggregator skips the fan-out.
    const deps = makeDeps();
    deps.persistence.claimProviderDownNotificationSlot.mockResolvedValueOnce(false);
    const recentNotif = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    deps.persistence.getProviderHealthStatus.mockResolvedValue({
      providerId: "finmind-tw",
      status: "down",
      lastSuccessfulRun: "2026-04-29T00:00:00Z",
      lastFailedRun: "2026-05-05T01:00:00Z",
      lastErrorMessage: "earlier",
      lastDownNotificationAt: recentNotif,
      lastManualRerunAt: null,
      updatedAt: "2026-05-05T01:00:00Z",
    });
    const svc = createProviderHealthService(deps);
    await svc.recordOutcome("finmind-tw", {
      kind: "error",
      errorClass: "http_5xx",
      errorMessage: "again",
    });
    expect(deps.persistence.claimProviderDownNotificationSlot).toHaveBeenCalled();
    expect(deps.persistence.createNotification).not.toHaveBeenCalled();
  });
});
