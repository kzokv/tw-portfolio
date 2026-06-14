import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "oauth" as const },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signSessionCookie } = await import("../../src/auth/googleOAuth.js");
const { SNAPSHOT_REPAIR_QUEUE } = await import("../../src/services/snapshotRepair.js");

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};
const SESSION_COOKIE_NAME = "g_auth_session";

async function createAdmin(app: BuiltApp): Promise<{ cookie: string }> {
  const { userId } = await app.persistence.resolveOrCreateUser("google", "snapshot-repair-admin", {
    email: "snapshot-repair-admin@example.com",
    name: "Snapshot Repair Admin",
  });
  await app.persistence.changeUserRole(userId, "admin", { actorUserId: "system" });
  const user = await app.persistence.getAuthUserById(userId);
  return { cookie: signSessionCookie(userId, testOAuthConfig.sessionSecret, user!.sessionVersion) };
}

function seedInstrument(app: BuiltApp): void {
  (app.persistence as unknown as {
    _seedInstrument: (instrument: {
      ticker: string;
      name: string;
      instrumentType: string;
      marketCode: string;
      barsBackfillStatus: string;
    }) => void;
  })._seedInstrument({
    ticker: "2330",
    name: "TSMC",
    instrumentType: "STOCK",
    marketCode: "TW",
    barsBackfillStatus: "ready",
  });
}

describe("admin market-data snapshot repair", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  it("queues targeted holding snapshot repair jobs without running provider backfill", async () => {
    const admin = await createAdmin(app);
    seedInstrument(app);
    const send = vi.fn().mockResolvedValue("snapshot-repair-job");
    (app as unknown as { boss: { send: typeof send } }).boss = { send };

    const response = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/snapshot-repair/execute",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` },
      payload: { tickers: ["2330"], fromDate: "2026-06-12" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ marketCode: "TW", queued: ["2330"], rejected: [] });
    expect(send).toHaveBeenCalledWith(
      SNAPSHOT_REPAIR_QUEUE,
      {
        ticker: "2330",
        marketCode: "TW",
        fromDate: "2026-06-12",
        trigger: "admin_rerun",
      },
      { singletonKey: "2330:TW:2026-06-12" },
    );
  });
});
