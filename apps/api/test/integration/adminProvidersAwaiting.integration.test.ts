/**
 * KZO-197 — Integration test for the `awaiting` status derivation and
 * `rerunCooldownMs` field in the `GET /admin/providers` DTO.
 *
 * Coverage:
 *   - Row with `lastSuccessfulRun=null && lastFailedRun=null` reports
 *     `status='awaiting'`. Persistence row shape and DB CHECK constraint
 *     unchanged — `awaiting` is purely a route-derived status.
 *   - Row with at least one of those timestamps non-null reports the
 *     route's `computeStatus()` result (`healthy|degraded|down`) — never
 *     `awaiting`.
 *   - Each row carries a numeric `rerunCooldownMs` field populated from
 *     `getEffectiveProviderRerunCooldownMs(providerId)`:
 *       AU defaults to 1_800_000 (30 min); other providers to 60_000 (60 s).
 *   - DB override on `app_config.yahoo_au_rerun_cooldown_ms` is reflected in
 *     the AU row's `rerunCooldownMs`; other rows unchanged.
 *
 * Memory backend route-integration. Per
 * `.claude/rules/integration-test-persistence-direct.md`: route HTTP tests
 * do NOT require Postgres.
 *
 * RED until Backend Implementer:
 *   • Widens `ProviderHealthStatusDto.status` to include `'awaiting'` and
 *     adds required `rerunCooldownMs: number`.
 *   • Updates `GET /admin/providers` to derive `awaiting` and populate
 *     `rerunCooldownMs` per row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signSessionCookie } = await import("../../src/auth/googleOAuth.js");
const { refresh } = await import("../../src/services/appConfig/cache.js");

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};
const SESSION_COOKIE_NAME = "g_auth_session";

interface ProviderRow {
  providerId: string;
  status: "healthy" | "degraded" | "down" | "awaiting";
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  rerunCooldownMs: number;
}

async function createAdmin(app: BuiltApp): Promise<{ userId: string; cookie: string }> {
  const { userId } = await app.persistence.resolveOrCreateUser("google", "kzo197-await-admin", {
    email: "kzo197-await-admin@example.com",
    name: "KZO-197 Awaiting Admin",
  });
  await app.persistence.changeUserRole(userId, "admin", { actorUserId: "system" });
  const user = await app.persistence.getAuthUserById(userId);
  const cookie = signSessionCookie(userId, testOAuthConfig.sessionSecret, user!.sessionVersion);
  return { userId, cookie };
}

async function listProviders(app: BuiltApp, cookie: string): Promise<ProviderRow[]> {
  const res = await app.inject({
    method: "GET",
    url: "/admin/providers",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { providers: ProviderRow[] };
  return body.providers;
}

describe("KZO-197 — GET /admin/providers awaiting + rerunCooldownMs", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("AU row with both run timestamps null → status='awaiting'", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: null,
    });

    const rows = await listProviders(app, admin.cookie);
    const au = rows.find((r) => r.providerId === "yahoo-finance-au");
    expect(au).toBeDefined();
    expect(au!.status).toBe("awaiting");
  });

  it("Persistence row shape is unchanged — awaiting is a route-derived status", async () => {
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: null,
    });
    const persisted = await app.persistence.getProviderHealthStatus("yahoo-finance-au");
    expect(persisted).toBeDefined();
    // The persistence row carries the raw stored status; not the derived one.
    expect(persisted!.status).toBe("down");
  });

  it("Row with lastSuccessfulRun set never reports 'awaiting'", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastFailedRun: null,
    });

    const rows = await listProviders(app, admin.cookie);
    const au = rows.find((r) => r.providerId === "yahoo-finance-au");
    expect(au).toBeDefined();
    expect(au!.status).not.toBe("awaiting");
  });

  it("Row with lastFailedRun set never reports 'awaiting'", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: new Date().toISOString(),
    });

    const rows = await listProviders(app, admin.cookie);
    const au = rows.find((r) => r.providerId === "yahoo-finance-au");
    expect(au).toBeDefined();
    expect(au!.status).not.toBe("awaiting");
  });

  it("rerunCooldownMs populated per provider — AU=1_800_000, others=60_000", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-us",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    const rows = await listProviders(app, admin.cookie);
    const au = rows.find((r) => r.providerId === "yahoo-finance-au");
    const tw = rows.find((r) => r.providerId === "finmind-tw");
    const us = rows.find((r) => r.providerId === "finmind-us");
    expect(au?.rerunCooldownMs).toBe(30 * 60 * 1000);
    expect(tw?.rerunCooldownMs).toBe(60_000);
    expect(us?.rerunCooldownMs).toBe(60_000);
  });

  it("DB override on yahoo_au_rerun_cooldown_ms reflected in AU row only", async () => {
    const admin = await createAdmin(app);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await app.persistence.setAppConfigPatch({ yahooAuRerunCooldownMs: 5_000 });
    await refresh();

    const rows = await listProviders(app, admin.cookie);
    const au = rows.find((r) => r.providerId === "yahoo-finance-au");
    const tw = rows.find((r) => r.providerId === "finmind-tw");
    expect(au?.rerunCooldownMs).toBe(5_000);
    expect(tw?.rerunCooldownMs).toBe(60_000);
  });
});
