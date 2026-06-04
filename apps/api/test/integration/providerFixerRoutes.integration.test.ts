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
  const { userId } = await app.persistence.resolveOrCreateUser("google", "provider-console-admin", {
    email: "provider-console-admin@example.com",
    name: "Provider Console Admin",
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
    vi.useRealTimers();
    if (app) await app.close();
  });

  it("previews unresolved KR errors and executes confirmed durable mapping writes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
    const incidentsBeforeExecute = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/incidents?status=open&page=1&limit=10",
      headers,
    });
    expect(incidentsBeforeExecute.statusCode).toBe(200);
    expect(incidentsBeforeExecute.json()).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          status: "open",
          severity: "critical",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          occurrenceCount: 1,
        }),
      ],
    });
    const incidentId = (incidentsBeforeExecute.json() as { items: Array<{ id: string }> }).items[0]!.id;
    const acknowledgeIncident = await app.inject({
      method: "PATCH",
      url: `/admin/providers/yahoo-finance-kr/incidents/${encodeURIComponent(incidentId)}`,
      headers,
      payload: { status: "acknowledged" },
    });
    expect(acknowledgeIncident.statusCode).toBe(200);
    expect(acknowledgeIncident.json()).toMatchObject({
      incident: {
        id: incidentId,
        providerId: "yahoo-finance-kr",
        status: "acknowledged",
        acknowledgedByUserId: admin.userId,
      },
    });
    const acknowledgedIncidents = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/incidents?status=acknowledged&page=1&limit=10",
      headers,
    });
    expect(acknowledgedIncidents.statusCode).toBe(200);
    expect(acknowledgedIncidents.json()).toMatchObject({ total: 1 });
    const bossSend = vi.fn().mockResolvedValue("job-005930-quote-first");
    app.boss = { send: bossSend } as never;

    const blocked = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: false,
      },
    });
    expect(blocked.statusCode).toBe(400);

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(202);
    expect(execute.json()).toMatchObject({ result: { status: "started" }, operation: { phase: "running" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("completed");
    });
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
    const mappings = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/mappings?page=1&limit=10",
      headers,
    });
    expect(mappings.statusCode).toBe(200);
    expect(mappings.json()).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          sourceSymbol: "005930",
          resolvedSymbol: "005930.KS",
          resolverMode: "quote_first",
        }),
      ],
    });
    const activity = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/activity?page=1&limit=10",
      headers,
    });
    expect(activity.statusCode).toBe(200);
    expect(activity.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          providerId: "yahoo-finance-kr",
          kind: "mapping",
          title: "Mapping verified",
          detail: "005930 -> 005930.KS",
        }),
      ]),
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
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      url: `/admin/providers/yahoo-finance-kr/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({ total: 3 });
  });

  it("rejects execute when the previewed provider fixer scope changes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      operation: { id: string; matchCount: number; preview: { token: string } };
    };
    expect(previewBody.operation.matchCount).toBe(1);

    await app.persistence.insertProviderErrorTrailEntry({
      providerId: "yahoo-finance-kr",
      errorClass: "other",
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 035720",
      context: { ticker: "035720", marketCode: "KR" },
    });
    verifyResolvedSymbol.mockClear();

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(409);
    expect(execute.json()).toMatchObject({ error: "snapshot_changed" });
    await expect(app.persistence.getProviderOperation(previewBody.operation.id)).resolves.toMatchObject({
      phase: "preview",
      matchCount: 1,
    });
    expect(verifyResolvedSymbol).not.toHaveBeenCalled();
  });

  it("rejects execute when the previewed scope has the same count but different rows", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      operation: { id: string; matchCount: number; preview: { token: string } };
    };
    expect(previewBody.operation.matchCount).toBe(1);

    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { source: "same-count-snapshot-test" },
      verifiedByUserId: admin.userId,
    });
    await app.persistence.insertProviderErrorTrailEntry({
      providerId: "yahoo-finance-kr",
      errorClass: "other",
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 035720",
      context: { ticker: "035720", marketCode: "KR" },
    });
    verifyResolvedSymbol.mockClear();

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(409);
    expect(execute.json()).toMatchObject({ error: "snapshot_changed" });
    await expect(app.persistence.getProviderOperation(previewBody.operation.id)).resolves.toMatchObject({
      phase: "preview",
      matchCount: 1,
    });
    expect(verifyResolvedSymbol).not.toHaveBeenCalled();
  });

  it("serves provider-scoped operation adapters and rejects cross-provider operation control", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderHealthStatus({
      providerId: "twelve-data-kr",
      status: "degraded",
      lastFailedRun: new Date().toISOString(),
    });

    const providers = await app.inject({
      method: "GET",
      url: "/admin/providers",
      headers,
    });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ providerId: "yahoo-finance-kr" }),
        expect.objectContaining({ providerId: "twelve-data-kr" }),
      ]),
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          providerId: "yahoo-finance-kr",
          supportsMappings: true,
          supportsRepair: true,
          supportsRerun: true,
          actions: expect.arrayContaining([
            expect.objectContaining({ action: "repair_mapping", supported: true, guardrail: "typed_preview" }),
          ]),
        }),
        expect.objectContaining({
          providerId: "twelve-data-kr",
          supportsMappings: false,
          supportsRepair: false,
          supportsRerun: false,
          actions: expect.arrayContaining([
            expect.objectContaining({
              action: "rerun_backfill",
              supported: false,
              reason: "Twelve Data free-plan KR bars are plan-limited, so rerun is not available through this provider.",
            }),
          ]),
        }),
      ]),
    });

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

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(202);
    expect(execute.json()).toMatchObject({
      result: { status: "started" },
      operation: {
        id: previewBody.operation.id,
        providerId: "yahoo-finance-kr",
        phase: "running",
      },
    });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
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

  it("sorts provider unresolved rows through provider-scoped query state", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.insertProviderErrorTrailEntry({
      providerId: "yahoo-finance-kr",
      errorClass: "other",
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 000660",
      context: { ticker: "000660", marketCode: "KR" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=active&sort=source_symbol_asc&page=1&limit=10",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 2,
      items: [
        expect.objectContaining({ sourceSymbol: "000660" }),
        expect.objectContaining({ sourceSymbol: "005930" }),
      ],
    });
  });

  it("renews provider evidence through background operation outcomes without writing mappings", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const response = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/renew",
      headers,
      payload: {
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { operation: { id: string; phase: string }; result: { status: string } };
    expect(body).toMatchObject({ operation: { phase: "running" }, result: { status: "started" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(body.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    expect(verifyResolvedSymbol).toHaveBeenCalledWith("005930", "005930.KS", { resolverMode: "quote_first" });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [
        expect.objectContaining({
          sourceSymbol: "005930",
          action: "renew_evidence",
          state: "succeeded",
        }),
      ],
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toBeNull();
  });

  it("reverifies durable provider mappings through provider operation outcomes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "original-op" },
      verifiedByUserId: admin.userId,
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/mappings/reverify",
      headers,
      payload: {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { operation: { id: string; phase: string } };
    expect(body.operation).toMatchObject({ phase: "running" });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(body.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    expect(verifyResolvedSymbol).toHaveBeenCalledWith("005930", "005930.KS", { resolverMode: "quote_first" });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [
        expect.objectContaining({
          sourceSymbol: "005930",
          action: "reverify_mapping",
          state: "succeeded",
        }),
      ],
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toMatchObject({
      evidence: expect.objectContaining({
        operationId: "original-op",
        reverifiedByOperationId: body.operation.id,
        checkedSymbol: "005930.KS",
      }),
    });
  });

  it("resumes rate-limited provider mapping reverify operations through the reverify runner", async () => {
    verifyResolvedSymbol
      .mockRejectedValueOnce(new RateLimitedError({ msUntilAvailable: 30_000 }))
      .mockResolvedValueOnce({
        verified: true,
        checkedSymbol: "005930.KS",
        resolverMode: "quote_first",
      });
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "original-op" },
      verifiedByUserId: admin.userId,
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/mappings/reverify",
      headers,
      payload: {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { operation: { id: string; phase: string } };
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(body.operation.id);
      expect(operation?.phase).toBe("paused");
    });
    await expect(app.persistence.getProviderOperation(body.operation.id)).resolves.toMatchObject({
      operationType: "reverify_mapping",
      phase: "paused",
      metadata: expect.objectContaining({
        pauseReason: "paused_rate_limit",
        mappingSourceSymbol: "005930",
        mappingResolvedSymbol: "005930.KS",
      }),
    });

    const resume = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/resume`,
      headers,
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ operation: { phase: "running" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(body.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    expect(verifyResolvedSymbol).toHaveBeenCalledTimes(2);
    expect(verifyResolvedSymbol).toHaveBeenLastCalledWith("005930", "005930.KS", { resolverMode: "quote_first" });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", action: "reverify_mapping", state: "succeeded" })],
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toMatchObject({
      evidence: expect.objectContaining({
        operationId: "original-op",
        reverifiedByOperationId: body.operation.id,
        checkedSymbol: "005930.KS",
      }),
    });
  });

  it("reverts durable provider mappings through typed provider operations", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "original-op" },
      verifiedByUserId: admin.userId,
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/mappings/revert",
      headers,
      payload: {
        marketCode: "KR",
        sourceSymbol: "005930",
        typedConfirmation: "REVERT 000000",
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "provider_mapping_revert_confirmation_required" });

    const response = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/mappings/revert",
      headers,
      payload: {
        marketCode: "KR",
        sourceSymbol: "005930",
        typedConfirmation: "REVERT 005930",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { operation: { id: string; phase: string } };
    expect(body.operation).toMatchObject({ phase: "running" });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(body.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toBeNull();
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [
        expect.objectContaining({
          sourceSymbol: "005930",
          providerSymbol: "005930.KS",
          action: "revert_mapping",
          state: "succeeded",
        }),
      ],
    });
    const logs = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/logs?operationId=${encodeURIComponent(body.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ phase: "running", message: expect.stringContaining("revert_started") }),
        expect.objectContaining({ phase: "completed", message: expect.stringContaining("revert_completed") }),
      ]),
    });
  });

  it("reruns mapped provider backfills through provider operation outcomes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const bossSend = vi.fn().mockResolvedValue("job-rerun-005930");
    app.boss = { send: bossSend } as never;
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "original-op" },
      verifiedByUserId: admin.userId,
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/mappings/rerun",
      headers,
      payload: {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
        acknowledged: true,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { operation: { id: string; phase: string }; result: { status: string } };
    expect(body).toMatchObject({ operation: { phase: "running" }, result: { status: "started" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(body.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    expect(bossSend).toHaveBeenCalledWith(
      "finmind-backfill",
      expect.objectContaining({
        ticker: "005930",
        marketCode: "KR",
        trigger: "admin_rerun",
        resolverMode: "quote_first",
        providerOperationId: body.operation.id,
      }),
      expect.objectContaining({ singletonKey: "005930:KR:quote_first", priority: 10 }),
    );
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [
        expect.objectContaining({
          sourceSymbol: "005930",
          providerSymbol: "005930.KS",
          action: "rerun_backfill",
          state: "succeeded",
        }),
      ],
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toMatchObject({ resolvedSymbol: "005930.KS" });
  });

  it("queues mapped provider rerun while another provider operation is active", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const bossSend = vi.fn().mockResolvedValue("job-rerun-005930");
    app.boss = { send: bossSend } as never;
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "original-op" },
      verifiedByUserId: admin.userId,
    });
    await app.persistence.createProviderOperation({
      id: "active-provider-lock",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "renew_evidence",
      phase: "running",
      scopeQuery: "yahoo-finance-kr:KR:symbol_unresolved",
      snapshotHash: "active-lock",
      matchCount: 1,
      metadata: { progressPercent: 0 },
      actorUserId: admin.userId,
      startedAt: new Date().toISOString(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/mappings/rerun",
      headers,
      payload: {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
        acknowledged: true,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json() as { operation: { id: string; phase: string }; result: { status: string } };
    expect(body).toMatchObject({
      operation: { phase: "queued" },
      result: { status: "queued" },
    });
    expect(bossSend).not.toHaveBeenCalled();

    const queuedBeforeCancel = await app.persistence.getProviderOperation(body.operation.id);
    expect(queuedBeforeCancel).toMatchObject({
      phase: "queued",
      metadata: expect.objectContaining({ queuedBehindOperationId: "active-provider-lock" }),
    });

    const cancel = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/active-provider-lock/cancel",
      headers,
    });
    expect(cancel.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const queuedAfterCancel = await app.persistence.getProviderOperation(body.operation.id);
      expect(queuedAfterCancel?.phase).toBe("completed");
    });
    expect(bossSend).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        ticker: "005930",
        marketCode: "KR",
        trigger: "admin_rerun",
        providerOperationId: body.operation.id,
      }),
      expect.any(Object),
    );
  });

  it("updates unresolved item lifecycle state with provider-scoped audit metadata", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const ignore = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/unresolved/state",
      headers,
      payload: {
        marketCode: "KR",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        sourceSymbol: "005930",
        state: "ignored",
        reason: "admin reviewed duplicate raw errors",
      },
    });
    expect(ignore.statusCode).toBe(200);
    expect(ignore.json()).toMatchObject({
      item: {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        sourceSymbol: "005930",
        state: "ignored",
        evidence: {
          stateChange: {
            state: "ignored",
            reason: "admin reviewed duplicate raw errors",
            actorUserId: admin.userId,
          },
        },
      },
    });
    const lifecycleOperations = await app.persistence.listProviderOperations({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      page: 1,
      limit: 10,
    });
    const ignoredOperation = lifecycleOperations.items.find((operation) => operation.operationType === "ignore_unresolved");
    expect(ignoredOperation).toMatchObject({
      phase: "completed",
      matchCount: 1,
      metadata: expect.objectContaining({
        sourceSymbol: "005930",
        targetState: "ignored",
        completedState: "ignored",
      }),
    });
    const lifecycleOutcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${ignoredOperation!.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(lifecycleOutcomes.statusCode).toBe(200);
    expect(lifecycleOutcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", action: "ignore_unresolved", state: "succeeded" })],
    });

    const ignored = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=ignored&page=1&limit=10",
      headers,
    });
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "ignored" })],
    });

    const reopen = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/unresolved/state",
      headers,
      payload: {
        marketCode: "KR",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        sourceSymbol: "005930",
        state: "active",
      },
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json()).toMatchObject({
      item: {
        sourceSymbol: "005930",
        state: "active",
        resolvedAt: null,
        resolvedByOperationId: null,
      },
    });
  });

  it("enforces provider operation rate caps against configured upstream budgets", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const settings = await app.inject({ method: "GET", url: "/admin/settings", headers });
    expect(settings.statusCode).toBe(200);
    const body = settings.json() as {
      bounds: {
        yahooKrProviderRateLimitPerMinute: { max: number };
        frankfurterProviderRateLimitPerMinute: { max: number };
        asxGicsProviderRateLimitPerHour: { max: number };
      };
      effectiveYahooKrProviderRateLimitPerMinute: number;
      effectiveFrankfurterProviderRateLimitPerMinute: number;
      effectiveAsxGicsProviderRateLimitPerHour: number;
    };
    expect(body.bounds.yahooKrProviderRateLimitPerMinute.max).toBeLessThan(body.effectiveYahooKrProviderRateLimitPerMinute);
    expect(body.bounds.frankfurterProviderRateLimitPerMinute.max).toBeLessThan(body.effectiveFrankfurterProviderRateLimitPerMinute);
    expect(body.bounds.asxGicsProviderRateLimitPerHour.max).toBeLessThan(body.effectiveAsxGicsProviderRateLimitPerHour);

    const rejected = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: { yahooKrProviderRateLimitPerMinute: body.bounds.yahooKrProviderRateLimitPerMinute.max + 1 },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "provider_rate_budget_exceeded" });

    const rejectedAsx = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: { asxGicsProviderRateLimitPerHour: body.bounds.asxGicsProviderRateLimitPerHour.max + 1 },
    });
    expect(rejectedAsx.statusCode).toBe(400);
    expect(rejectedAsx.json()).toMatchObject({ error: "provider_rate_budget_exceeded" });

    const accepted = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: { yahooKrProviderRateLimitPerMinute: 1, frankfurterProviderRateLimitPerMinute: 1 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      yahooKrProviderRateLimitPerMinute: 1,
      effectiveYahooKrProviderRateLimitPerMinute: 1,
      frankfurterProviderRateLimitPerMinute: 1,
      effectiveFrankfurterProviderRateLimitPerMinute: 1,
    });

    const summary = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/operations/summary",
      headers,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ summary: { effectiveRateCapPerMinute: 1 } });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
      headers,
      payload: {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json()).toMatchObject({ operation: { effectiveRateCapPerMinute: 1 } });
  });

  it("pauses provider repair when the admin operation budget is exhausted", async () => {
    verifyResolvedSymbol.mockImplementation((_sourceSymbol: string, candidateSymbol: string, options: { resolverMode: "quote_first" }) =>
      Promise.resolve({
        verified: true,
        checkedSymbol: candidateSymbol,
        resolverMode: options.resolverMode,
      }),
    );
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
      ticker: "035720",
      name: "Kakao",
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
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 035720",
      context: { ticker: "035720", marketCode: "KR" },
    });

    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const settings = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: { yahooKrProviderRateLimitPerMinute: 1 },
    });
    expect(settings.statusCode).toBe(200);

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      operation: { id: string; preview: { token: string; confirmationText: string | null } };
    };

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
        ...(previewBody.operation.preview.confirmationText
          ? { typedConfirmation: previewBody.operation.preview.confirmationText }
          : {}),
      },
    });
    expect(execute.statusCode).toBe(202);

    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("paused");
    });
    await expect(app.persistence.getProviderOperation(previewBody.operation.id)).resolves.toMatchObject({
      phase: "paused",
      metadata: expect.objectContaining({
        pauseReason: "paused_rate_limit",
        failureName: "RateLimitedError",
        operationBudgetConsumed: 1,
        operationBudgetCapPerWindow: 1,
        operationBudgetWindowMs: 60_000,
      }),
    });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    const outcomesBody = outcomes.json() as {
      summary: { total: number; processed: number; succeeded: number; rateLimited: number };
      items: Array<{ sourceSymbol: string; state: string; errorCode: string | null }>;
    };
    expect(outcomesBody).toMatchObject({
      summary: { total: 2, processed: 2, succeeded: 1, rateLimited: 1 },
    });
    expect(outcomesBody.items.map((item) => item.sourceSymbol).sort()).toEqual(["005930", "035720"]);
    expect(outcomesBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "succeeded", errorCode: null }),
        expect.objectContaining({ state: "rate_limited", errorCode: "provider_rate_limited" }),
      ]),
    );
  });

  it("persists provider operation settings and rejects inverted health thresholds", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const accepted = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: {
        providerOperationAutoRenewIntervalMinutes: 45,
        providerIncidentRecurrenceWindowMinutes: 20,
        providerHealthWarningUnresolvedThreshold: 500,
        providerHealthCriticalUnresolvedThreshold: 5_000,
        providerOperationStaleHeartbeatMinutes: 10,
        providerOperationSummaryRetentionDays: 120,
        providerOperationLogRetentionDays: 45,
        providerIncidentRetentionDays: 240,
        providerResolvedItemRetentionDays: 60,
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      providerOperationAutoRenewIntervalMinutes: 45,
      effectiveProviderOperationAutoRenewIntervalMinutes: 45,
      providerIncidentRecurrenceWindowMinutes: 20,
      effectiveProviderIncidentRecurrenceWindowMinutes: 20,
      providerHealthWarningUnresolvedThreshold: 500,
      effectiveProviderHealthWarningUnresolvedThreshold: 500,
      providerHealthCriticalUnresolvedThreshold: 5_000,
      effectiveProviderHealthCriticalUnresolvedThreshold: 5_000,
      providerOperationStaleHeartbeatMinutes: 10,
      effectiveProviderOperationStaleHeartbeatMinutes: 10,
      providerOperationSummaryRetentionDays: 120,
      effectiveProviderOperationSummaryRetentionDays: 120,
      providerOperationLogRetentionDays: 45,
      effectiveProviderOperationLogRetentionDays: 45,
      providerIncidentRetentionDays: 240,
      effectiveProviderIncidentRetentionDays: 240,
      providerResolvedItemRetentionDays: 60,
      effectiveProviderResolvedItemRetentionDays: 60,
    });

    const rejected = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: { providerHealthWarningUnresolvedThreshold: 6_000 },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "provider_health_threshold_order_invalid" });

    const clearedCritical = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: { providerHealthCriticalUnresolvedThreshold: null },
    });
    expect(clearedCritical.statusCode).toBe(200);
    expect(clearedCritical.json()).toMatchObject({
      providerHealthCriticalUnresolvedThreshold: null,
      effectiveProviderHealthCriticalUnresolvedThreshold: 10_000,
    });
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
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(202);
    expect(execute.json()).toMatchObject({ result: { status: "started" }, operation: { phase: "running" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("completed");
    });
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

  it("marks provider fixer execution failed when Yahoo verification throws a non-rate error", async () => {
    verifyResolvedSymbol
      .mockResolvedValueOnce({
        verified: true,
        checkedSymbol: "005930.KS",
        resolverMode: "quote_first",
      })
      .mockRejectedValueOnce(new Error("Yahoo verifier exploded"));
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const unsubscribe = app.eventBus.subscribe(admin.userId, (event) => {
      events.push({ type: event.type, data: event.data as Record<string, unknown> });
    });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      operation: { id: string; preview: { token: string } };
    };

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });

    expect(execute.statusCode).toBe(202);
    expect(execute.json()).toMatchObject({ result: { status: "started" }, operation: { phase: "running" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("failed");
    });
    await expect(app.persistence.getProviderOperation(previewBody.operation.id)).resolves.toMatchObject({
      phase: "failed",
      metadata: expect.objectContaining({
        failureReason: "Yahoo verifier exploded",
        failureName: "Error",
      }),
    });

    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, failed: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "failed", errorCode: "provider_verification_failed" })],
    });

    const logs = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          phase: "failed",
          message: expect.stringContaining("execute_failed"),
        }),
      ]),
    });
    const audit = await app.persistence.listAuditLog({
      actions: ["provider_fixer_operation"],
      page: 1,
      limit: 20,
    });
    expect(audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: admin.userId,
          metadata: expect.objectContaining({
            operationId: previewBody.operation.id,
            action: "execute_failed",
            providerId: "yahoo-finance-kr",
            marketCode: "KR",
            errorName: "Error",
            errorMessage: "Yahoo verifier exploded",
          }),
        }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "provider_operation_phase_changed",
          data: expect.objectContaining({
            operationId: previewBody.operation.id,
            providerId: "yahoo-finance-kr",
            phase: "failed",
          }),
        }),
      ]),
    );
    unsubscribe();
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
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });

    expect(execute.statusCode).toBe(202);
    expect(execute.json()).toMatchObject({ result: { status: "started" }, operation: { phase: "running" } });
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("paused");
    });
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
        pauseReason: "paused_rate_limit",
        failureName: "RateLimitedError",
        msUntilAvailable: 30_000,
      }),
    });

    const logs = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
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

  it("resumes paused provider fixer execution and completes background work", async () => {
    verifyResolvedSymbol
      .mockResolvedValueOnce({
        verified: true,
        checkedSymbol: "005930.KS",
        resolverMode: "quote_first",
      })
      .mockRejectedValueOnce(new RateLimitedError({ msUntilAvailable: 30_000 }))
      .mockResolvedValueOnce({
        verified: true,
        checkedSymbol: "005930.KS",
        resolverMode: "quote_first",
      });
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("paused");
    });

    const resume = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/resume`,
      headers,
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ operation: { phase: "running" } });

    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("completed");
    });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toMatchObject({
      resolvedSymbol: "005930.KS",
      verifiedByUserId: admin.userId,
    });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "succeeded" })],
    });
    const logs = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/logs?operationId=${encodeURIComponent(previewBody.operation.id)}`,
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ phase: "running", message: expect.stringContaining("resumed provider=yahoo-finance-kr") }),
        expect.objectContaining({ phase: "completed", message: expect.stringContaining("execute_completed") }),
      ]),
    });
  });

  it("keeps cancelled provider fixer execution terminal when background repair finishes", async () => {
    let resolveVerification: (value: {
      verified: boolean;
      checkedSymbol: string;
      resolverMode: "quote_first";
    }) => void = () => undefined;
    const verificationStarted = vi.fn();
    verifyResolvedSymbol
      .mockResolvedValueOnce({
        verified: true,
        checkedSymbol: "005930.KS",
        resolverMode: "quote_first",
      })
      .mockImplementationOnce(() => {
        verificationStarted();
        return new Promise((resolve) => {
          resolveVerification = resolve;
        });
      });
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
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
      operation: { id: string; preview: { token: string } };
    };

    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: {
        previewToken: previewBody.operation.preview.token,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(202);
    await vi.waitFor(() => expect(verificationStarted).toHaveBeenCalled());

    const cancel = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/cancel`,
      headers,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ operation: { phase: "cancelled" } });

    resolveVerification({
      verified: true,
      checkedSymbol: "005930.KS",
      resolverMode: "quote_first",
    });

    await vi.waitFor(async () => {
      await expect(
        app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
      ).resolves.toMatchObject({ resolvedSymbol: "005930.KS" });
    });
    await expect(app.persistence.getProviderOperation(previewBody.operation.id)).resolves.toMatchObject({
      phase: "cancelled",
    });
    const logs = await app.persistence.listProviderOperationLogs({
      operationId: previewBody.operation.id,
      page: 1,
      limit: 20,
    });
    expect(logs.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "cancelled", message: expect.stringContaining("execute_cancelled") }),
      ]),
    );
  });

  it("rejects expired preview tokens and queues concurrent active executions for the same provider market", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const expired = await app.persistence.createProviderOperation({
      id: "expired-provider-console-op",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "resolver_repair",
      phase: "preview",
      previewExpiresAt: "2026-06-03T00:00:00.000Z",
      matchCount: 1,
    });

    const operationsResponse = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/operations?providerId=yahoo-finance-kr&page=1&limit=10",
      headers,
    });
    expect(operationsResponse.statusCode).toBe(200);
    expect(operationsResponse.json().operations).toContainEqual(
      expect.objectContaining({ id: expired.id, canExecute: false }),
    );

    const expiredResponse = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${expired.id}/execute`,
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
      id: "active-provider-console-op",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "resolver_repair",
      phase: "running",
      matchCount: 1,
    });
    const candidatePreview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/operations/preview",
      headers,
      payload: {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    });
    expect(candidatePreview.statusCode).toBe(201);
    const candidate = candidatePreview.json() as { operation: { id: string; preview: { token: string } } };
    const concurrentResponse = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${candidate.operation.id}/execute`,
      headers,
      payload: { previewToken: candidate.operation.preview.token, acknowledged: true },
    });
    expect(concurrentResponse.statusCode).toBe(202);
    expect(concurrentResponse.json()).toMatchObject({
      operation: {
        id: candidate.operation.id,
        phase: "queued",
      },
      result: { status: "queued" },
    });

    const activeRetry = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${candidate.operation.id}/retry`,
      headers,
    });
    expect(activeRetry.statusCode).toBe(400);
    expect(activeRetry.json()).toMatchObject({ error: "provider_operation_not_retryable" });

    const retry = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${expired.id}/retry`,
      headers,
    });
    expect(retry.statusCode).toBe(201);
    const retryBody = retry.json() as {
      retryOfOperationId: string;
      operation: { id: string; phase: string; canExecute: boolean; canRetry: boolean; preview: { token: string } };
    };
    expect(retryBody).toMatchObject({
      retryOfOperationId: expired.id,
      operation: {
        phase: "preview",
        canExecute: true,
        canRetry: false,
      },
    });
    expect(retryBody.operation.id).not.toBe(expired.id);
    expect(retryBody.operation.preview.token).toBeTruthy();
    await expect(app.persistence.getProviderOperation(expired.id)).resolves.toMatchObject({
      id: expired.id,
      phase: "cancelled",
    });
    await expect(app.persistence.getProviderOperation(retryBody.operation.id)).resolves.toMatchObject({
      providerId: "yahoo-finance-kr",
      phase: "preview",
      metadata: expect.objectContaining({
        retryOfOperationId: expired.id,
        retryAttempt: 1,
      }),
    });
  });

  it("auto-pauses stale running provider operations before console summaries are returned", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "stale-running-provider-op",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "running",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      resolverMode: "quote_first",
      scopeQuery: "yahoo-finance-kr:yahoo_finance_kr_symbol_unresolved",
      snapshotHash: "stale-snapshot",
      previewTokenHash: "stale-token",
      previewExpiresAt: "2026-06-04T01:00:00.000Z",
      matchCount: 42,
      sample: [],
      metadata: { progressPercent: 25 },
      actorUserId: admin.userId,
      startedAt: "2026-06-04T00:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-06-04T00:16:01.000Z"));
    const summary = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/operations/summary",
      headers,
    });

    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      summary: {
        activeOperationsCount: 1,
        runningOperationsCount: 0,
      },
    });
    await expect(app.persistence.getProviderOperation("stale-running-provider-op")).resolves.toMatchObject({
      phase: "paused",
      metadata: expect.objectContaining({
        progressPercent: 25,
        pauseReason: "stale_operation",
        staleHeartbeatMinutes: 15,
      }),
    });
    const logs = await app.persistence.listProviderOperationLogs({
      operationId: "stale-running-provider-op",
      page: 1,
      limit: 10,
    });
    expect(logs.items[0]).toMatchObject({
      phase: "paused",
      level: "warning",
      message: expect.stringContaining("auto_paused_stale_operation"),
    });
  });

  it("previews and executes provider log purge with typed guardrails", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const operation = await app.persistence.createProviderOperation({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "completed",
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: "info",
      message: "test provider operation log",
    });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/logs/purge/preview",
      headers,
      payload: {},
    });
    expect(preview.statusCode).toBe(201);
    const previewBody = preview.json() as {
      preview: {
        operationId: string;
        previewToken: string;
        confirmationText: string;
        errorTrailCount: number;
        operationLogCount: number;
        matchCount: number;
      };
    };
    expect(previewBody.preview).toMatchObject({
      confirmationText: "PURGE yahoo-finance-kr",
      errorTrailCount: 1,
      operationLogCount: 1,
      matchCount: 2,
    });

    const blocked = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/logs/purge/execute",
      headers,
      payload: {
        operationId: previewBody.preview.operationId,
        previewToken: previewBody.preview.previewToken,
        typedConfirmation: "PURGE WRONG",
      },
    });
    expect(blocked.statusCode).toBe(400);

    const execute = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/logs/purge/execute",
      headers,
      payload: {
        operationId: previewBody.preview.operationId,
        previewToken: previewBody.preview.previewToken,
        typedConfirmation: previewBody.preview.confirmationText,
      },
    });
    expect(execute.statusCode).toBe(200);
    expect(execute.json()).toMatchObject({
      providerId: "yahoo-finance-kr",
      errorTrailDeleted: 1,
      operationLogDeleted: 1,
    });
    const executeBody = execute.json() as { operationId: string };

    await expect(app.persistence.listProviderErrorTrailPage({
      providerId: "yahoo-finance-kr",
      page: 1,
      limit: 10,
    })).resolves.toMatchObject({ total: 0 });
    await expect(app.persistence.listProviderUnresolvedItems({
      providerId: "yahoo-finance-kr",
      state: "active",
      page: 1,
      limit: 10,
    })).resolves.toMatchObject({ total: 1 });
    await expect(app.persistence.listProviderIncidents({
      providerId: "yahoo-finance-kr",
      page: 1,
      limit: 10,
    })).resolves.toMatchObject({ total: 1 });
    await expect(app.persistence.listProviderOperationLogs({
      operationId: operation.id,
      page: 1,
      limit: 10,
    })).resolves.toMatchObject({ total: 0 });
    const purgeOutcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${executeBody.operationId}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(purgeOutcomes.statusCode).toBe(200);
    expect(purgeOutcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [expect.objectContaining({ sourceSymbol: "PROVIDER_LOGS", action: "purge_logs", state: "succeeded" })],
    });
    await expect(app.persistence.listProviderOperationLogs({
      operationId: executeBody.operationId,
      page: 1,
      limit: 10,
    })).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ message: expect.stringContaining("purge_logs_completed") })],
    });
  });
});
