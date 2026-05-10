/**
 * KZO-197 — Integration test for per-provider rerun-cooldown semantics.
 *
 * Coverage:
 *   - AU default cooldown is 30 min; second click within 30 min → 429 + Retry-After.
 *   - TW default cooldown stays at 60 s; second click within 60 s → 429.
 *   - PATCH `app_config.yahoo_au_rerun_cooldown_ms = 5000` → AU honors 5 s,
 *     TW unchanged at 60 s.
 *   - DB AU override does NOT bleed into TW.
 *
 * Memory-backed buildApp + oauth: route logic exercised end-to-end. The cache
 * is refreshed via `refresh()` after the persistence patch lands so the
 * resolver picks up the new value (the route reads from cache directly).
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`: route HTTP
 * tests do NOT require Postgres.
 *
 * RED until Backend Implementer wires the route to call
 * `getEffectiveProviderRerunCooldownMs(providerId)` instead of the generic
 * `getEffectiveRerunCooldownMs()`.
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

async function createAdmin(app: BuiltApp): Promise<{ userId: string; cookie: string }> {
  const { userId } = await app.persistence.resolveOrCreateUser("google", "kzo197-cooldown-admin", {
    email: "kzo197-cooldown-admin@example.com",
    name: "KZO-197 Cooldown Admin",
  });
  await app.persistence.changeUserRole(userId, "admin", { actorUserId: "system" });
  const user = await app.persistence.getAuthUserById(userId);
  const cookie = signSessionCookie(userId, testOAuthConfig.sessionSecret, user!.sessionVersion);
  return { userId, cookie };
}

async function rerun(app: BuiltApp, cookie: string, providerId: string) {
  return app.inject({
    method: "POST",
    url: `/admin/providers/${providerId}/rerun`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    payload: {},
  });
}

describe("KZO-197 — per-provider rerun cooldown", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    // Seed both providers as healthy with no prior rerun.
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("AU default 30-min cooldown: second click within window → 429 + Retry-After", async () => {
    const admin = await createAdmin(app);

    const first = await rerun(app, admin.cookie, "yahoo-finance-au");
    expect(first.statusCode).toBe(202);

    const second = await rerun(app, admin.cookie, "yahoo-finance-au");
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    // Retry-After upper bound: 30 minutes.
    const retryAfter = Number(second.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(60); // > 60s confirms AU is NOT on the generic 60s window
    expect(retryAfter).toBeLessThanOrEqual(30 * 60);
  });

  it("TW default 60-s cooldown: second click within 60s → 429", async () => {
    const admin = await createAdmin(app);

    const first = await rerun(app, admin.cookie, "finmind-tw");
    expect(first.statusCode).toBe(202);

    const second = await rerun(app, admin.cookie, "finmind-tw");
    expect(second.statusCode).toBe(429);
    const retryAfter = Number(second.headers["retry-after"]);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("AU DB override (5s) honored without affecting TW (still 60s)", async () => {
    const admin = await createAdmin(app);

    // Patch app_config.yahoo_au_rerun_cooldown_ms = 5000 and refresh cache.
    await app.persistence.setAppConfigPatch({ yahooAuRerunCooldownMs: 5_000 });
    await refresh();

    // Stamp lastManualRerunAt = 6 s ago for AU; 5 s window has elapsed.
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      lastManualRerunAt: new Date(Date.now() - 6_000).toISOString(),
    });

    const auClick = await rerun(app, admin.cookie, "yahoo-finance-au");
    expect(auClick.statusCode).toBe(202);

    // TW: stamp 30 s ago — still inside the 60-s window — should 429.
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-tw",
      lastManualRerunAt: new Date(Date.now() - 30_000).toISOString(),
    });
    const twClick = await rerun(app, admin.cookie, "finmind-tw");
    expect(twClick.statusCode).toBe(429);
  });

  it("AU DB override does NOT bleed into TW cooldown gating", async () => {
    const admin = await createAdmin(app);

    // Override AU to a HUGE value (24h - 1s); TW must remain on its 60-s default.
    await app.persistence.setAppConfigPatch({ yahooAuRerunCooldownMs: 86_399_000 });
    await refresh();

    // TW: stamp 65 s ago → 60-s window elapsed → should succeed.
    await app.persistence.upsertProviderHealthStatus({
      providerId: "finmind-tw",
      lastManualRerunAt: new Date(Date.now() - 65_000).toISOString(),
    });
    const twClick = await rerun(app, admin.cookie, "finmind-tw");
    expect(twClick.statusCode).toBe(202);

    // AU: stamp 1 hour ago — inside the 24h window — should 429.
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-au",
      lastManualRerunAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const auClick = await rerun(app, admin.cookie, "yahoo-finance-au");
    expect(auClick.statusCode).toBe(429);
  });
});
