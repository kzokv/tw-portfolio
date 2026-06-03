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

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};
const SESSION_COOKIE_NAME = "g_auth_session";

async function createAdmin(app: BuiltApp): Promise<{ userId: string; cookie: string }> {
  const { userId } = await app.persistence.resolveOrCreateUser("google", "provider-fixer-admin", {
    email: "provider-fixer-admin@example.com",
    name: "Provider Fixer Admin",
  });
  await app.persistence.changeUserRole(userId, "admin", { actorUserId: "system" });
  const user = await app.persistence.getAuthUserById(userId);
  const cookie = signSessionCookie(userId, testOAuthConfig.sessionSecret, user!.sessionVersion);
  return { userId, cookie };
}

describe("Provider Fixer admin routes", () => {
  let app: BuiltApp;
  let verifyResolvedSymbol: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    verifyResolvedSymbol = vi.fn().mockResolvedValue({
      verified: true,
      checkedSymbol: "005930.KS",
      resolverMode: "quote_first",
    });
    app.marketDataRegistry.marketData.set("KR", {
      providerId: "yahoo-finance-kr",
      reserveCapacity: vi.fn(),
      fetchBars: vi.fn(),
      fetchDividends: vi.fn(),
      verifyResolvedSymbol,
    } as never);
    await app.persistence.upsertProviderHealthStatus({
      providerId: "yahoo-finance-kr",
      status: "down",
      lastFailedRun: new Date().toISOString(),
    });
    (app.persistence as unknown as {
      _seedInstrument(instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK";
        marketCode: "KR";
        barsBackfillStatus: "pending";
        typeRaw?: string;
        catalogExchangeRaw?: string;
        catalogMicCode?: string;
      }): void;
    })._seedInstrument({
      ticker: "005930",
      name: "Samsung Electronics",
      instrumentType: "STOCK",
      marketCode: "KR",
      barsBackfillStatus: "pending",
      typeRaw: "Common Stock",
      catalogExchangeRaw: "KOSPI",
      catalogMicCode: "XKRX",
    });
    await app.persistence.insertProviderErrorTrailEntry({
      providerId: "yahoo-finance-kr",
      errorClass: "other",
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 005930",
      context: { ticker: "005930", marketCode: "KR" },
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("previews unresolved KR errors and executes confirmed durable mapping writes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/provider-fixer/preview",
      headers,
      payload: {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    });
    expect(preview.statusCode).toBe(201);
    const previewBody = preview.json() as {
      operation: {
        id: string;
        matchCount: number;
        preview: {
          token: string;
          confirmationText: string | null;
          evidenceSample: Array<{ candidateSymbol: string | null; verificationStatus: string }>;
        };
      };
    };
    expect(previewBody.operation.matchCount).toBe(1);
    expect(previewBody.operation.preview.evidenceSample[0]?.candidateSymbol).toBe("005930.KS");
    expect(previewBody.operation.preview.evidenceSample[0]?.verificationStatus).toBe("verified");
    const bossSend = vi.fn().mockResolvedValue("job-005930-quote-first");
    app.boss = { send: bossSend } as never;

    const blocked = await app.inject({
      method: "POST",
      url: `/admin/provider-fixer/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: false,
      },
    });
    expect(blocked.statusCode).toBe(400);

    const execute = await app.inject({
      method: "POST",
      url: `/admin/provider-fixer/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(200);
    expect(execute.json()).toMatchObject({ result: { applied: 1, skipped: 0, scanned: 1 } });
    expect(verifyResolvedSymbol).toHaveBeenCalledWith("005930", "005930.KS", { resolverMode: "quote_first" });
    expect(bossSend).toHaveBeenCalledWith(
      "finmind-backfill",
      expect.objectContaining({
        ticker: "005930",
        marketCode: "KR",
        trigger: "admin_rerun",
        resolverMode: "quote_first",
        providerOperationId: previewBody.operation.id,
      }),
      expect.objectContaining({ singletonKey: "005930:KR:quote_first", priority: 10 }),
    );
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toMatchObject({
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      verifiedByUserId: admin.userId,
    });

    const logs = await app.inject({
      method: "GET",
      url: `/admin/provider-fixer/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({ total: 3 });
  });

  it("does not persist KR bindings when Yahoo verification rejects the candidate", async () => {
    verifyResolvedSymbol.mockResolvedValue({
      verified: false,
      checkedSymbol: "005930.KS",
      resolverMode: "quote_first",
      reason: "quote_not_korean_exchange",
    });
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/provider-fixer/preview",
      headers,
      payload: {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    });
    const previewBody = preview.json() as {
      operation: { id: string; preview: { token: string; evidenceSample: Array<{ verificationStatus: string }> } };
    };
    expect(previewBody.operation.preview.evidenceSample[0]?.verificationStatus).toBe("rejected");

    const execute = await app.inject({
      method: "POST",
      url: `/admin/provider-fixer/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(200);
    expect(execute.json()).toMatchObject({ result: { applied: 0, skipped: 1, scanned: 1 } });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toBeNull();
  });

  it("rejects expired preview tokens and concurrent active executions for the same provider market", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const expired = await app.persistence.createProviderOperation({
      id: "expired-provider-fixer-op",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "resolver_repair",
      phase: "preview",
      previewExpiresAt: "2026-06-03T00:00:00.000Z",
      matchCount: 1,
    });

    const operationsResponse = await app.inject({
      method: "GET",
      url: "/admin/provider-fixer/operations?providerId=yahoo-finance-kr&page=1&limit=10",
      headers,
    });
    expect(operationsResponse.statusCode).toBe(200);
    expect(operationsResponse.json().operations).toContainEqual(
      expect.objectContaining({ id: expired.id, canExecute: false }),
    );

    const expiredResponse = await app.inject({
      method: "POST",
      url: `/admin/provider-fixer/operations/${expired.id}/execute`,
      headers,
      payload: { acknowledged: true },
    });
    expect(expiredResponse.statusCode).toBe(400);
    expect(expiredResponse.json()).toMatchObject({ error: "provider_fixer_preview_token_expired" });

    await app.persistence.updateProviderOperation({
      id: expired.id,
      phase: "cancelled",
      cancelledAt: new Date().toISOString(),
    });
    await app.persistence.createProviderOperation({
      id: "active-provider-fixer-op",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "resolver_repair",
      phase: "running",
      matchCount: 1,
    });
    const candidate = await app.persistence.createProviderOperation({
      id: "candidate-provider-fixer-op",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "resolver_repair",
      phase: "preview",
      previewExpiresAt: "2026-06-03T23:59:00.000Z",
      matchCount: 1,
    });
    const concurrentResponse = await app.inject({
      method: "POST",
      url: `/admin/provider-fixer/operations/${candidate.id}/execute`,
      headers,
      payload: { acknowledged: true },
    });
    expect(concurrentResponse.statusCode).toBe(409);
    expect(concurrentResponse.json()).toMatchObject({ error: "provider_fixer_active_execution_exists" });
  });
});
