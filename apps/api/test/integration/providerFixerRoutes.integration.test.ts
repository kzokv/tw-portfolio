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
const { RateLimitedError } = await import("../../src/services/market-data/types.js");

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

    const activeBeforeExecute = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=active&page=1&limit=10",
      headers,
    });
    expect(activeBeforeExecute.statusCode).toBe(200);
    expect(activeBeforeExecute.json()).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          sourceSymbol: "005930",
          state: "active",
          occurrenceCount: 1,
        }),
      ],
    });
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
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1, skipped: 0 },
      items: [
        expect.objectContaining({
          sourceSymbol: "005930",
          action: "repair_mapping",
          state: "succeeded",
        }),
      ],
    });
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
    const activeAfterExecute = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=active&page=1&limit=10",
      headers,
    });
    expect(activeAfterExecute.statusCode).toBe(200);
    expect(activeAfterExecute.json()).toMatchObject({ total: 0, items: [] });

    const resolvedAfterExecute = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=resolved&page=1&limit=10",
      headers,
    });
    expect(resolvedAfterExecute.statusCode).toBe(200);
    expect(resolvedAfterExecute.json()).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          sourceSymbol: "005930",
          state: "resolved",
          resolvedByOperationId: previewBody.operation.id,
        }),
      ],
    });

    const refreshedPreview = await app.inject({
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
    expect(refreshedPreview.statusCode).toBe(201);
    expect(refreshedPreview.json()).toMatchObject({ operation: { matchCount: 0 } });

    const logs = await app.inject({
      method: "GET",
      url: `/admin/provider-fixer/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({ total: 3 });
  });

  it("serves provider-scoped operation adapters and rejects cross-provider operation control", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const summary = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/operations/summary",
      headers,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ summary: { guardrailsEnabled: true } });

    const diagnostics = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/diagnostics?resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved",
      headers,
    });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      diagnostics: {
        providerId: "yahoo-finance-kr",
        rows: expect.arrayContaining([
          expect.objectContaining({ providerId: "yahoo-finance-kr", unresolvedCount: 1 }),
        ]),
      },
    });

    const unresolved = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=active&search=005930&page=1&limit=10",
      headers,
    });
    expect(unresolved.statusCode).toBe(200);
    expect(unresolved.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "active" })],
    });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
      headers,
      payload: {
        marketCode: "KR",
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    });
    expect(preview.statusCode).toBe(201);
    const previewBody = preview.json() as {
      operation: { id: string; matchCount: number; preview: { token: string } };
    };
    expect(previewBody.operation.matchCount).toBe(1);

    const operations = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/operations?page=1&limit=10",
      headers,
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toMatchObject({
      stagedOperation: { id: previewBody.operation.id, providerId: "yahoo-finance-kr" },
      operations: [expect.objectContaining({ id: previewBody.operation.id })],
    });

    const logs = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/logs?page=1&limit=10",
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({
      items: [expect.objectContaining({ operationId: previewBody.operation.id })],
    });

    const mismatchedExecute = await app.inject({
      method: "POST",
      url: `/admin/providers/finmind-tw/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(mismatchedExecute.statusCode).toBe(404);
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
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 0, skipped: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "skipped", errorCode: "candidate_rejected" })],
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toBeNull();
  });

  it("auto-pauses provider fixer execution when Yahoo verification is rate limited", async () => {
    verifyResolvedSymbol
      .mockResolvedValueOnce({
        verified: true,
        checkedSymbol: "005930.KS",
        resolverMode: "quote_first",
      })
      .mockRejectedValueOnce(new RateLimitedError({ msUntilAvailable: 30_000 }));
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
      operation: { id: string; preview: { token: string } };
    };

    const execute = await app.inject({
      method: "POST",
      url: `/admin/provider-fixer/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });

    expect(execute.statusCode).toBe(503);
    expect(execute.json()).toMatchObject({ error: "provider_rate_limited" });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, rateLimited: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "rate_limited" })],
    });
    await expect(app.persistence.getProviderOperation(previewBody.operation.id)).resolves.toMatchObject({
      phase: "paused",
      metadata: expect.objectContaining({
        autoPauseFailureCount: 1,
        failureName: "RateLimitedError",
        msUntilAvailable: 30_000,
      }),
    });

    const logs = await app.inject({
      method: "GET",
      url: `/admin/provider-fixer/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    const logsBody = logs.json() as { total: number; items: Array<{ phase: string; message: string }> };
    expect(logsBody.total).toBe(3);
    expect(logsBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "paused",
          message: expect.stringContaining("execute_auto_paused_rate_limited"),
        }),
      ]),
    );
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
      previewExpiresAt: new Date(Date.now() + 60_000).toISOString(),
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
