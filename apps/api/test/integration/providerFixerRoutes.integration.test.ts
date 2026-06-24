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

  it("executes market-data provider actions with durable operation ids", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const bossSend = vi.fn()
      .mockResolvedValueOnce("catalog-sync-tw")
      .mockResolvedValueOnce("provider-op-kr")
      .mockResolvedValueOnce("fx-refresh-job");
    app.boss = { send: bossSend } as never;

    const catalog = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/actions/execute",
      headers,
      payload: {
        action: "sync_catalog",
        providerId: "finmind-tw",
        acknowledged: true,
      },
    });

    expect(catalog.statusCode).toBe(200);
    const catalogBody = catalog.json() as {
      operationId: string;
      marketCode: string;
      providerId: string;
      action: string;
      status: string;
      jobId: string | null;
    };
    expect(catalogBody).toMatchObject({
      marketCode: "TW",
      providerId: "finmind-tw",
      action: "sync_catalog",
      status: "queued",
      jobId: "catalog-sync-tw",
    });
    expect(bossSend).toHaveBeenCalledWith(
      "catalog-sync",
      { pendingMarkets: ["TW"], providerOperationId: catalogBody.operationId },
      expect.objectContaining({ singletonKey: "catalog-sync:TW", priority: 5 }),
    );
    await expect(app.persistence.getProviderOperation(catalogBody.operationId)).resolves.toMatchObject({
      providerId: "finmind-tw",
      marketCode: "TW",
      operationType: "sync_catalog",
      phase: "queued",
    });

    const repair = await app.inject({
      method: "POST",
      url: "/admin/market-data/KR/actions/execute",
      headers,
      payload: {
        action: "repair_mapping",
        providerId: "yahoo-finance-kr",
        acknowledged: true,
        resolverMode: "quote_first",
      },
    });

    expect(repair.statusCode).toBe(200);
    const repairBody = repair.json() as {
      operationId: string;
      marketCode: string;
      providerId: string;
      action: string;
      status: string;
      jobId: string | null;
    };
    expect(repairBody).toMatchObject({
      marketCode: "KR",
      providerId: "yahoo-finance-kr",
      action: "repair_mapping",
      status: "queued",
      jobId: "provider-op-kr",
    });
    expect(bossSend).toHaveBeenCalledWith(
      "provider-operation-execution",
      { operationId: repairBody.operationId, actorUserId: admin.userId, ipAddress: expect.any(String) },
      expect.objectContaining({ singletonKey: `provider-operation-execution:${repairBody.operationId}`, priority: 10 }),
    );
    await expect(app.persistence.getProviderOperation(repairBody.operationId)).resolves.toMatchObject({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "queued",
      metadata: expect.objectContaining({ marketDataBff: true, mappingOnly: true }),
    });

    const fxRefresh = await app.inject({
      method: "POST",
      url: "/admin/market-data/FX/actions/execute",
      headers,
      payload: {
        action: "refresh_fx_rates",
        providerId: "frankfurter",
        acknowledged: true,
      },
    });

    expect(fxRefresh.statusCode).toBe(200);
    const fxRefreshBody = fxRefresh.json() as {
      operationId: string;
      marketCode: string;
      providerId: string;
      action: string;
      status: string;
      jobId: string | null;
    };
    expect(fxRefreshBody).toMatchObject({
      marketCode: "FX",
      providerId: "frankfurter",
      action: "refresh_fx_rates",
      status: "queued",
      jobId: "fx-refresh-job",
    });
    expect(bossSend).toHaveBeenCalledWith(
      "fx-refresh",
      expect.objectContaining({ trigger: "manual", providerOperationId: fxRefreshBody.operationId }),
      expect.objectContaining({ singletonKey: "fx-refresh", priority: 5 }),
    );
    await expect(app.persistence.getProviderOperation(fxRefreshBody.operationId)).resolves.toMatchObject({
      providerId: "frankfurter",
      marketCode: "FX",
      operationType: "refresh_fx_rates",
      phase: "queued",
      metadata: expect.objectContaining({ marketDataBff: true }),
    });
    expect(bossSend).not.toHaveBeenCalledWith(
      "finmind-backfill",
      expect.anything(),
      expect.anything(),
    );
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
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        scope: {
          type: "selected_items",
          items: [
            {
              providerId: "yahoo-finance-kr",
              marketCode: "KR",
              errorCode: "yahoo_finance_kr_symbol_unresolved",
              sourceSymbol: "005930",
            },
          ],
        },
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
          frozenScope: unknown;
          evidenceSample: Array<{ candidateSymbol: string | null; verificationStatus: string }>;
        };
      };
    };
    expect(previewBody.operation.matchCount).toBe(1);
    expect(previewBody.operation.preview.frozenScope).toMatchObject({
      type: "selected_items",
      matchCount: 1,
      selectedItems: [
        expect.objectContaining({
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          sourceSymbol: "005930",
        }),
      ],
    });
    expect(previewBody.operation.preview.evidenceSample[0]?.candidateSymbol).toBe("005930.KS");
    expect(previewBody.operation.preview.evidenceSample[0]?.verificationStatus).toBe("pending");

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
      expect(operation?.metadata).toMatchObject({
        mappingOnly: true,
        enqueuedBackfillCount: 0,
        skippedExistingBackfillCount: 0,
      });
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
    expect(bossSend).not.toHaveBeenCalled();
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
    expect(execute.json()).toMatchObject({ error: "provider_fixer_snapshot_drift" });
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
    expect(execute.json()).toMatchObject({ error: "provider_fixer_snapshot_drift" });
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

  it("searches provider mappings by source and resolved symbol", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "OP-MAPPING-1" },
      verifiedByUserId: admin.userId,
    });
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "000660",
      resolvedSymbol: "000660.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "OP-MAPPING-2" },
      verifiedByUserId: admin.userId,
    });

    const bySource = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/mappings?search=005930&page=1&limit=10",
      headers,
    });
    expect(bySource.statusCode).toBe(200);
    expect(bySource.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", resolvedSymbol: "005930.KS" })],
    });

    const byResolved = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/mappings?search=000660.KS&page=1&limit=10",
      headers,
    });
    expect(byResolved.statusCode).toBe(200);
    expect(byResolved.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "000660", resolvedSymbol: "000660.KS" })],
    });
  });

  it("filters and paginates operation outcomes by state", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const operation = await app.persistence.createProviderOperation({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "completed",
    });

    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      providerSymbol: "005930",
      action: "repair_mapping",
      state: "succeeded",
      message: "resolved",
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "000660",
      providerSymbol: "000660",
      action: "repair_mapping",
      state: "failed",
      errorCode: "provider_symbol_unresolved",
      message: "failed",
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "035720",
      providerSymbol: "035720",
      action: "repair_mapping",
      state: "succeeded",
      message: "resolved again",
    });

    const response = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${operation.id}/outcomes?state=succeeded&page=1&limit=1`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 2,
      page: 1,
      limit: 1,
      summary: { total: 3, succeeded: 2, failed: 1, processed: 3 },
      items: [expect.objectContaining({ state: "succeeded" })],
    });
    expect((response.json() as { items: Array<{ sourceSymbol: string }> }).items).toHaveLength(1);
  });

  it("filters FX market operations before pagination", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-03T01:00:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-fx",
      providerId: "frankfurter",
      marketCode: "FX",
      operationType: "refresh_rates",
      phase: "completed",
      matchCount: 1,
    });
    vi.setSystemTime(new Date("2026-06-03T02:00:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-kr-newer",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "completed",
      matchCount: 1,
    });
    vi.useRealTimers();

    const response = await app.inject({
      method: "GET",
      url: "/admin/market-data/FX/operations?page=1&limit=1",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      marketCode: "FX",
      total: 1,
      items: [expect.objectContaining({ id: "provider-op-fx", providerId: "frankfurter" })],
    });
  });

  it("returns typed market operation details for catalog sync, FX refresh, and ASX GICS", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.createProviderOperation({
      id: "provider-op-catalog-sync",
      providerId: "twelve-data-au",
      marketCode: "AU",
      operationType: "sync_catalog",
      phase: "completed",
      matchCount: 2,
      metadata: {
        scope: "AU catalog",
        source: "twelve-data",
        importedRows: 2,
      },
    });
    await app.persistence.createProviderOperation({
      id: "provider-op-asx-gics",
      providerId: "asx-gics-csv",
      marketCode: "AU",
      operationType: "sync_asx_gics",
      phase: "completed",
      matchCount: 3,
      metadata: {
        scope: "ASX GICS enrichment",
        source: "asx-csv",
        importedRows: 3,
      },
    });
    await app.persistence.createProviderOperation({
      id: "provider-op-running-au-backfill",
      providerId: "yahoo-finance-au",
      marketCode: "AU",
      operationType: "backfill_catalog_rows",
      phase: "running",
      matchCount: 5,
      metadata: {
        scope: "AU selected unresolved retry",
        progressPercent: 25,
      },
    });
    await app.persistence.createProviderOperation({
      id: "provider-op-fx-refresh",
      providerId: "frankfurter",
      marketCode: "FX",
      operationType: "refresh_rates",
      phase: "completed",
      matchCount: 4,
      metadata: {
        scope: "FX rates",
        source: "frankfurter",
        baseCurrency: "USD",
      },
    });
    await app.persistence.createProviderOperation({
      id: "provider-op-fx-refresh-action",
      providerId: "frankfurter",
      marketCode: "FX",
      operationType: "refresh_fx_rates",
      phase: "completed",
      matchCount: 4,
      metadata: {
        scope: "FX rates",
        source: "frankfurter",
        baseCurrency: "USD",
      },
    });

    const auResponse = await app.inject({
      method: "GET",
      url: "/admin/market-data/AU/operations?page=1&limit=10",
      headers,
    });
    const fxResponse = await app.inject({
      method: "GET",
      url: "/admin/market-data/FX/operations?page=1&limit=10",
      headers,
    });

    expect(auResponse.statusCode).toBe(200);
    expect(fxResponse.statusCode).toBe(200);
    expect(auResponse.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "provider-op-catalog-sync",
          details: expect.objectContaining({ kind: "sync_catalog" }),
        }),
        expect.objectContaining({
          id: "provider-op-asx-gics",
          details: expect.objectContaining({ kind: "sync_asx_gics" }),
        }),
        expect.objectContaining({
          id: "provider-op-running-au-backfill",
          canPause: false,
          canResume: false,
          canCancel: true,
          details: expect.objectContaining({ kind: "backfill_catalog_rows" }),
        }),
      ]),
    });
    expect(fxResponse.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "provider-op-fx-refresh",
          details: expect.objectContaining({ kind: "refresh_rates" }),
        }),
        expect.objectContaining({
          id: "provider-op-fx-refresh-action",
          details: expect.objectContaining({ kind: "refresh_rates" }),
        }),
      ]),
    });
  });

  it("returns normalized operation controls and treats date-only end filters as inclusive days", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-03T18:30:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-running-late-day",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "running",
      matchCount: 3,
    });
    vi.setSystemTime(new Date("2026-06-04T00:05:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-next-day",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "completed",
      matchCount: 1,
    });
    vi.useRealTimers();

    const response = await app.inject({
      method: "GET",
      url: "/admin/market-data/KR/operations?from=2026-06-03&to=2026-06-03&page=1&limit=10&includeOperationId=provider-op-running-late-day",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      selectedOperation: expect.objectContaining({
        id: "provider-op-running-late-day",
        canPause: true,
        canResume: false,
        canCancel: true,
      }),
      selectedOperationIsOffPage: false,
      total: 1,
      items: [
        expect.objectContaining({
          id: "provider-op-running-late-day",
          canPause: true,
          canResume: false,
          canCancel: true,
        }),
      ],
    });
  });

  it("derives market operation filter choices beyond the first 500 matching operations", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-older-renew-evidence",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "renew_evidence",
      phase: "failed",
      matchCount: 1,
    });
    for (let i = 0; i < 501; i += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 5, 2, 0, i, 0)));
      await app.persistence.createProviderOperation({
        id: `provider-op-newer-repair-${i}`,
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        operationType: "repair_mapping",
        phase: "completed",
        matchCount: 1,
      });
    }
    vi.useRealTimers();

    const response = await app.inject({
      method: "GET",
      url: "/admin/market-data/KR/operations?page=1&limit=25",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 502,
      availableFilters: {
        operationTypes: expect.arrayContaining(["renew_evidence", "repair_mapping"]),
        phases: expect.arrayContaining(["failed", "completed"]),
      },
    });
  });

  it("returns an included selected operation off-page and filters outcomes by action", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-03T01:00:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-page-2",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "renew_evidence",
      phase: "completed",
      matchCount: 1,
      scopeQuery: "page-2",
    });
    vi.setSystemTime(new Date("2026-06-03T02:00:00.000Z"));
    await app.persistence.createProviderOperation({
      id: "provider-op-selected",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "completed",
      matchCount: 2,
      scopeQuery: "selected",
    });
    vi.useRealTimers();
    await app.persistence.upsertProviderOperationOutcome({
      operationId: "provider-op-selected",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      providerSymbol: "005930.KS",
      action: "repair_mapping",
      state: "succeeded",
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: "provider-op-selected",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "000660",
      providerSymbol: "000660.KS",
      action: "renew_evidence",
      state: "failed",
    });

    const operations = await app.inject({
      method: "GET",
      url: "/admin/market-data/KR/operations?page=2&limit=1&includeOperationId=provider-op-selected",
      headers,
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toMatchObject({
      selectedOperationIsOffPage: true,
      selectedOperation: { id: "provider-op-selected", providerId: "yahoo-finance-kr" },
      items: [expect.objectContaining({ id: "provider-op-page-2" })],
      filters: {
        providerId: null,
        operationType: null,
        phase: null,
      },
      total: 2,
      page: 2,
      limit: 1,
    });

    const outcomes = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/operations/provider-op-selected/outcomes?state=all&action=renew_evidence&page=1&limit=10",
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 2, failed: 1, succeeded: 1 },
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "000660", action: "renew_evidence", state: "failed" })],
    });

    await app.persistence.createProviderOperationLog({
      operationId: "provider-op-selected",
      phase: "completed",
      level: "info",
      message: "selected_operation_completed",
      detail: "provider-op-selected completed",
      context: {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        sourceSymbol: "005930",
        resolvedSymbol: "005930.KS",
        ignoredKey: "redacted",
      },
    });
    const logs = await app.inject({
      method: "GET",
      url: "/admin/market-data/KR/operations/provider-op-selected/logs?page=1&limit=10",
      headers,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json()).toMatchObject({
      marketCode: "KR",
      operationId: "provider-op-selected",
      total: 1,
      items: [
        expect.objectContaining({
          level: "info",
          message: "selected_operation_completed",
          detail: "provider-op-selected completed",
          context: {
            providerId: "yahoo-finance-kr",
            marketCode: "KR",
            sourceSymbol: "005930",
            resolvedSymbol: "005930.KS",
          },
        }),
      ],
    });
	    expect((logs.json() as { items: Array<{ context: Record<string, unknown> | null }> }).items[0]?.context).not.toHaveProperty("ignoredKey");

	    const selectedExcludedBySearch = await app.inject({
	      method: "GET",
	      url: "/admin/market-data/KR/operations?page=1&limit=10&search=page-2&includeOperationId=provider-op-selected",
	      headers,
	    });
	    expect(selectedExcludedBySearch.statusCode).toBe(200);
	    expect(selectedExcludedBySearch.json()).toMatchObject({
	      selectedOperation: null,
	      selectedOperationIsOffPage: false,
	      total: 1,
	      items: [expect.objectContaining({ id: "provider-op-page-2" })],
	    });

	    const invalidDate = await app.inject({
	      method: "GET",
	      url: "/admin/market-data/KR/operations?from=not-a-date",
	      headers,
	    });
	    expect(invalidDate.statusCode).toBe(400);

	    const invertedDates = await app.inject({
	      method: "GET",
	      url: "/admin/market-data/KR/operations?from=2026-06-04&to=2026-06-03",
	      headers,
	    });
	    expect(invertedDates.statusCode).toBe(400);

	    const mismatchedWorkspaceLogs = await app.inject({
	      method: "GET",
	      url: "/admin/market-data/FX/operations/provider-op-selected/logs?page=1&limit=10",
	      headers,
	    });
	    expect(mismatchedWorkspaceLogs.statusCode).toBe(404);
	  });

  it("returns preparing_preview for dangerous filter previews and promotes them to preview asynchronously", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const unsubscribe = app.eventBus.subscribe(admin.userId, (event) => {
      events.push({ type: event.type, data: event.data as Record<string, unknown> });
    });

    const settings = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers,
      payload: {
        providerFixerDangerousMatchThreshold: 1,
      },
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
    expect(preview.statusCode).toBe(202);
    const previewBody = preview.json() as {
      operation: { id: string; phase: string; preview: { scopeType: string } };
      result: { status: string };
    };
    expect(previewBody).toMatchObject({
      operation: { phase: "preparing_preview", preview: { scopeType: "filter" } },
      result: { status: "preparing_preview" },
    });

    await vi.waitFor(async () => {
      const prepared = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(prepared?.phase).toBe("preview");
      expect(Array.isArray(prepared?.sample)).toBe(true);
      expect(prepared?.sample?.length).toBeGreaterThan(0);
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "provider_operation_progress",
          data: expect.objectContaining({
            operationId: previewBody.operation.id,
            providerId: "yahoo-finance-kr",
            total: 1,
            processed: 1,
            progressPercent: 100,
          }),
        }),
        expect.objectContaining({
          type: "provider_operation_phase_changed",
          data: expect.objectContaining({
            operationId: previewBody.operation.id,
            providerId: "yahoo-finance-kr",
            phase: "preparing_preview",
          }),
        }),
        expect.objectContaining({
          type: "provider_operation_phase_changed",
          data: expect.objectContaining({
            operationId: previewBody.operation.id,
            providerId: "yahoo-finance-kr",
            phase: "preview",
          }),
        }),
      ]),
    );
    unsubscribe();
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

  it("supports unresolved state=all and mappings search by linked operation id", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.updateProviderUnresolvedItemState({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      sourceSymbol: "005930",
      state: "ignored",
      actorUserId: admin.userId,
      reason: "reviewed",
    });
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "mapping-op-123" },
      verifiedByUserId: admin.userId,
    });

    const active = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=active&page=1&limit=10",
      headers,
    });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({ total: 0, items: [] });

    const all = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=all&page=1&limit=10",
      headers,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "ignored" })],
    });

    const mappings = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/mappings?search=mapping-op-123&page=1&limit=10",
      headers,
    });
    expect(mappings.statusCode).toBe(200);
    expect(mappings.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", resolvedSymbol: "005930.KS" })],
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

  it("uses date-range scoped singleton keys for bounded admin market-data backfills", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const bossSend = vi.fn().mockResolvedValue("job-admin-us-range");
    app.boss = { send: bossSend } as never;
    (app.persistence as unknown as {
      _seedInstrument(instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK";
        marketCode: "US";
        barsBackfillStatus: "pending";
        typeRaw?: string;
        catalogExchangeRaw?: string;
        catalogMicCode?: string;
      }): void;
    })._seedInstrument({
      ticker: "USRANGE1",
      name: "US range fixture",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "pending",
      typeRaw: "Common Stock",
      catalogExchangeRaw: "NASDAQ",
      catalogMicCode: "XNAS",
    });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/market-data/US/backfill/preview",
      headers,
      payload: {
        scope: "selected_catalog_rows",
        providerId: "finmind-us",
        selectedCatalogRows: [{ ticker: "USRANGE1", marketCode: "US" }],
        startDate: "2026-06-12",
        endDate: "2026-06-15",
      },
    });

    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { operationId: string; previewToken: string };
    const execute = await app.inject({
      method: "POST",
      url: "/admin/market-data/US/backfill/execute",
      headers,
      payload: {
        operationId: previewBody.operationId,
        previewToken: previewBody.previewToken,
        acknowledged: true,
      },
    });

    expect(execute.statusCode).toBe(200);
    expect(bossSend).toHaveBeenCalledWith(
      "finmind-backfill",
      expect.objectContaining({
        ticker: "USRANGE1",
        marketCode: "US",
        trigger: "admin_rerun",
        startDate: "2026-06-12",
        endDate: "2026-06-15",
      }),
      expect.objectContaining({
        singletonKey: "USRANGE1:US:2026-06-12:2026-06-15",
        priority: 10,
      }),
    );
  });

  it("lists market-scoped unresolved rows with summary counts and instrument context", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    (app.persistence as unknown as {
      _seedInstrument(instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK";
        marketCode: "TW";
        barsBackfillStatus: "pending";
        typeRaw?: string;
        catalogExchangeRaw?: string;
        catalogMicCode?: string;
      }): void;
    })._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "pending",
      typeRaw: "Common Stock",
      catalogExchangeRaw: "TWSE",
      catalogMicCode: "XTAI",
    });
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });

    const unresolved = await app.inject({
      method: "GET",
      url: "/admin/market-data/TW/unresolved?state=all&page=1&limit=10",
      headers,
    });
    expect(unresolved.statusCode).toBe(200);
    expect(unresolved.json()).toMatchObject({
      marketCode: "TW",
      summary: {
        activeRowCount: 1,
        affectedInstrumentCount: 1,
        byProvider: [expect.objectContaining({ key: "finmind-tw", count: 1, activeCount: 1 })],
        byErrorCode: [expect.objectContaining({ key: "provider_symbol_unresolved", count: 1, activeCount: 1 })],
      },
      items: [
        expect.objectContaining({
          providerId: "finmind-tw",
          marketCode: "TW",
          sourceSymbol: "2330",
          instrumentName: "TSMC",
          supportState: "supported",
          backfillStatus: "pending",
          recommendedAction: "retry_via_backfill",
        }),
      ],
    });

    const overview = await app.inject({
      method: "GET",
      url: "/admin/market-data/TW/overview",
      headers,
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      marketCode: "TW",
      unresolvedCount: 1,
      affectedInstrumentCount: 1,
    });
  });

  it("enforces typed confirmation for filter-scoped market unresolved bulk changes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/unresolved/state/bulk",
      headers,
      payload: {
        scope: {
          type: "filter",
          filter: { providerId: "finmind-tw", state: "active", errorCode: "provider_symbol_unresolved" },
        },
        state: "ignored",
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "provider_fixer_typed_confirmation_required" });

    const accepted = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/unresolved/state/bulk",
      headers,
      payload: {
        scope: {
          type: "filter",
          filter: { providerId: "finmind-tw", state: "active", errorCode: "provider_symbol_unresolved" },
        },
        state: "ignored",
        typedConfirmation: "IGNORED 1",
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ updatedCount: 1, succeeded: 1, failed: 0 });

    const unresolved = await app.inject({
      method: "GET",
      url: "/admin/market-data/TW/unresolved?state=ignored&page=1&limit=10",
      headers,
    });
    expect(unresolved.statusCode).toBe(200);
    expect(unresolved.json()).toMatchObject({
      items: [expect.objectContaining({ providerId: "finmind-tw", sourceSymbol: "2330", state: "ignored" })],
    });
  });

  it("keeps market bulk unresolved operation outcomes distinct for duplicate source symbols", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_history_missing",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });

    const accepted = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/unresolved/state/bulk",
      headers,
      payload: {
        scope: {
          type: "selected_items",
          items: [
            { providerId: "finmind-tw", marketCode: "TW", errorCode: "provider_symbol_unresolved", sourceSymbol: "2330" },
            { providerId: "finmind-tw", marketCode: "TW", errorCode: "provider_history_missing", sourceSymbol: "2330" },
          ],
        },
        state: "ignored",
        acknowledged: true,
        reason: "admin reviewed duplicate ticker rows",
      },
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedBody = accepted.json() as { operationId: string; succeeded: number; failed: number };
    expect(acceptedBody).toMatchObject({ succeeded: 2, failed: 0 });

    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/finmind-tw/operations/${acceptedBody.operationId}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    const outcomesBody = outcomes.json() as {
      summary: { total: number; processed: number; succeeded: number };
      items: Array<{
        sourceSymbol: string;
        action: string;
        state: string;
        evidence: { unresolvedIdentity?: { errorCode?: string; sourceSymbol?: string } };
      }>;
    };
    expect(outcomesBody.summary).toMatchObject({ total: 2, processed: 2, succeeded: 2 });
    expect(new Set(outcomesBody.items.map((item) => item.sourceSymbol)).size).toBe(2);
    expect(outcomesBody.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceSymbol: "2330::FINMIND-TW::PROVIDER_SYMBOL_UNRESOLVED",
        action: "ignore_unresolved",
        state: "succeeded",
        evidence: expect.objectContaining({
          unresolvedIdentity: expect.objectContaining({ errorCode: "provider_symbol_unresolved", sourceSymbol: "2330" }),
        }),
      }),
      expect.objectContaining({
        sourceSymbol: "2330::FINMIND-TW::PROVIDER_HISTORY_MISSING",
        action: "ignore_unresolved",
        state: "succeeded",
        evidence: expect.objectContaining({
          unresolvedIdentity: expect.objectContaining({ errorCode: "provider_history_missing", sourceSymbol: "2330" }),
        }),
      }),
    ]));
  });

  it("marks market unresolved single-row operations failed when the target row is stale", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const response = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/unresolved/state",
      headers,
      payload: {
        providerId: "finmind-tw",
        errorCode: "provider_symbol_unresolved",
        sourceSymbol: "MISSING",
        state: "ignored",
        reason: "stale row",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "provider_unresolved_item_not_found" });
    const operations = await app.persistence.listProviderOperations({
      providerId: "finmind-tw",
      marketCode: "TW",
      page: 1,
      limit: 10,
    });
    const failedOperation = operations.items.find((operation) => operation.operationType === "ignore_unresolved");
    expect(failedOperation).toMatchObject({
      phase: "failed",
      matchCount: 1,
      metadata: expect.objectContaining({
        sourceSymbol: "MISSING",
        targetState: "ignored",
        failureReason: "provider unresolved item not found",
      }),
    });
    expect(await app.persistence.hasActiveProviderExecution("finmind-tw", "TW")).toBe(false);
    const outcomes = await app.persistence.listProviderOperationOutcomes({
      operationId: failedOperation!.id,
      page: 1,
      limit: 10,
    });
    expect(outcomes).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          sourceSymbol: "MISSING",
          state: "failed",
          errorCode: "provider_unresolved_state_update_failed",
        }),
      ],
    });
  });

  it("dedupes selected unresolved rows into backfill targets for market retry previews and execution", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const bossSend = vi.fn().mockResolvedValue("job-unresolved-tw-2330");
    app.boss = { send: bossSend } as never;
    (app.persistence as unknown as {
      _seedInstrument(instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK";
        marketCode: "TW";
        barsBackfillStatus: "pending";
        typeRaw?: string;
        catalogExchangeRaw?: string;
        catalogMicCode?: string;
      }): void;
    })._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "pending",
      typeRaw: "Common Stock",
      catalogExchangeRaw: "TWSE",
      catalogMicCode: "XTAI",
    });
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_history_missing",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/backfill/preview",
      headers,
      payload: {
        scope: "selected_unresolved_rows",
        providerId: "finmind-tw",
        selectedUnresolvedRows: [
          { providerId: "finmind-tw", marketCode: "TW", errorCode: "provider_symbol_unresolved", sourceSymbol: "2330" },
          { providerId: "finmind-tw", marketCode: "TW", errorCode: "provider_history_missing", sourceSymbol: "2330" },
        ],
      },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      operationId: string;
      previewToken: string;
      matchCount: number;
      unresolvedSelection: {
        selectedRowCount: number;
        dedupedTargetCount: number;
        dedupedAwayRowCount: number;
        skippedRowCount: number;
      };
    };
    expect(previewBody).toMatchObject({
      matchCount: 1,
      unresolvedSelection: {
        selectedRowCount: 2,
        dedupedTargetCount: 1,
        dedupedAwayRowCount: 1,
        skippedRowCount: 0,
      },
    });

    const execute = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/backfill/execute",
      headers,
      payload: {
        operationId: previewBody.operationId,
        previewToken: previewBody.previewToken,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(200);
    expect(execute.json()).toMatchObject({
      marketCode: "TW",
      matchCount: 1,
      unresolvedSelection: previewBody.unresolvedSelection,
    });
    expect(bossSend).toHaveBeenCalledTimes(1);
    expect(bossSend).toHaveBeenCalledWith(
      "finmind-backfill",
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        trigger: "admin_rerun",
        providerOperationId: previewBody.operationId,
      }),
      expect.any(Object),
    );
  });

  it("rejects catalog-provider unresolved rows for market retry previews", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "asx-gics-csv",
      marketCode: "AU",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "BHP.AX",
      providerSymbol: "BHP.AX",
    });

    const retryThroughBackfillProvider = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/backfill/preview",
      headers,
      payload: {
        scope: "selected_unresolved_rows",
        providerId: "yahoo-finance-au",
        selectedUnresolvedRows: [
          { providerId: "asx-gics-csv", marketCode: "AU", errorCode: "provider_symbol_unresolved", sourceSymbol: "BHP.AX" },
        ],
      },
    });
    expect(retryThroughBackfillProvider.statusCode).toBe(400);
    expect(retryThroughBackfillProvider.json()).toMatchObject({
      error: "market_unresolved_retry_provider_not_supported",
    });

    const retryThroughCatalogProvider = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/backfill/preview",
      headers,
      payload: {
        scope: "selected_unresolved_rows",
        providerId: "asx-gics-csv",
        selectedUnresolvedRows: [
          { providerId: "asx-gics-csv", marketCode: "AU", errorCode: "provider_symbol_unresolved", sourceSymbol: "BHP.AX" },
        ],
      },
    });
    expect(retryThroughCatalogProvider.statusCode).toBe(400);
    expect(retryThroughCatalogProvider.json()).toMatchObject({
      error: "market_unresolved_retry_provider_not_supported",
    });
  });

  it("returns blocking operation details on market unresolved retry conflicts", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    (app.persistence as unknown as {
      _seedInstrument(instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK";
        marketCode: "TW";
        barsBackfillStatus: "pending";
        typeRaw?: string;
        catalogExchangeRaw?: string;
        catalogMicCode?: string;
      }): void;
    })._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "pending",
      typeRaw: "Common Stock",
      catalogExchangeRaw: "TWSE",
      catalogMicCode: "XTAI",
    });
    await app.persistence.upsertProviderUnresolvedItem({
      providerId: "finmind-tw",
      marketCode: "TW",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "2330",
      providerSymbol: "2330",
    });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/backfill/preview",
      headers,
      payload: {
        scope: "selected_unresolved_rows",
        providerId: "finmind-tw",
        selectedUnresolvedRows: [
          { providerId: "finmind-tw", marketCode: "TW", errorCode: "provider_symbol_unresolved", sourceSymbol: "2330" },
        ],
      },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { operationId: string; previewToken: string };
    await app.persistence.createProviderOperation({
      id: "active-tw-blocker",
      providerId: "finmind-tw",
      marketCode: "TW",
      operationType: "sync_catalog",
      phase: "running",
      startedAt: new Date().toISOString(),
    });

    const execute = await app.inject({
      method: "POST",
      url: "/admin/market-data/TW/backfill/execute",
      headers,
      payload: {
        operationId: previewBody.operationId,
        previewToken: previewBody.previewToken,
        acknowledged: true,
      },
    });
    expect(execute.statusCode).toBe(409);
    expect(execute.json()).toMatchObject({
      error: "provider_fixer_active_execution_exists",
      metadata: {
        blockingOperation: expect.objectContaining({
          operationId: "active-tw-blocker",
          providerId: "finmind-tw",
          marketCode: "TW",
          operationType: "sync_catalog",
          phase: "running",
        }),
      },
    });
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
    await app.persistence.createProviderOperation({
      id: "expired-preview-beside-queued-rerun",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "resolver_repair",
      phase: "preview",
      previewExpiresAt: "2026-06-03T00:00:00.000Z",
      matchCount: 1,
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

  it("bulk-updates selected unresolved items with acknowledgement and operation outcomes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };

    const ignored = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/unresolved/state/bulk",
      headers,
      payload: {
        scope: {
          type: "selected_items",
          items: [
            {
              providerId: "yahoo-finance-kr",
              marketCode: "KR",
              errorCode: "yahoo_finance_kr_symbol_unresolved",
              sourceSymbol: "005930",
            },
          ],
        },
        state: "ignored",
        acknowledged: true,
        reason: "admin reviewed selected unresolved row",
      },
    });

    expect(ignored.statusCode).toBe(202);
    const body = ignored.json() as {
      operation: { id: string; phase: string; matchCount: number };
      result: { status: string; succeeded: number; failed: number };
    };
    expect(body).toMatchObject({
      operation: { phase: "completed", matchCount: 1 },
      result: { status: "completed", succeeded: 1, failed: 0 },
    });

    const ignoredRows = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=ignored&page=1&limit=10",
      headers,
    });
    expect(ignoredRows.statusCode).toBe(200);
    const ignoredRowsBody = ignoredRows.json() as {
      total: number;
      items: Array<{
        sourceSymbol: string;
        state: string;
        evidence: { stateChange?: { actorUserId?: string; reason?: string; state?: string } };
      }>;
    };
    expect(ignoredRowsBody.total).toBe(1);
    expect(ignoredRowsBody.items[0]).toMatchObject({ sourceSymbol: "005930", state: "ignored" });
    expect(ignoredRowsBody.items[0]?.evidence.stateChange).toMatchObject({
      actorUserId: admin.userId,
      reason: "admin reviewed selected unresolved row",
      state: "ignored",
    });

    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${body.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 1 },
      items: [expect.objectContaining({ sourceSymbol: "005930", action: "ignore_unresolved", state: "succeeded" })],
    });
  });

  it("requires typed confirmation for all-matching unresolved bulk unsupported changes", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const scope = {
      type: "filter",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      state: "active",
    };

    const blocked = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/unresolved/state/bulk",
      headers,
      payload: {
        scope,
        state: "unsupported",
        typedConfirmation: "MARK 1 UNSUPPORTED",
      },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: "provider_fixer_typed_confirmation_required" });

    const unsupported = await app.inject({
      method: "POST",
      url: "/admin/providers/yahoo-finance-kr/unresolved/state/bulk",
      headers,
      payload: {
        scope,
        state: "unsupported",
        typedConfirmation: "MARK 1 MATCHING UNSUPPORTED",
      },
    });
    expect(unsupported.statusCode).toBe(202);
    const body = unsupported.json() as {
      operation: {
        id: string;
        phase: string;
        matchCount: number;
        preview: { frozenScope: { type: string; matchCount: number; filter: { errorCode: string } } | null };
      };
      result: { status: string; succeeded: number; failed: number };
    };
    expect(body).toMatchObject({
      operation: {
        phase: "completed",
        matchCount: 1,
        preview: {
          frozenScope: {
            type: "filter",
            matchCount: 1,
            filter: { errorCode: "yahoo_finance_kr_symbol_unresolved" },
          },
        },
      },
      result: { status: "completed", succeeded: 1, failed: 0 },
    });

    const unsupportedRows = await app.inject({
      method: "GET",
      url: "/admin/providers/yahoo-finance-kr/unresolved?state=unsupported&page=1&limit=10",
      headers,
    });
    expect(unsupportedRows.statusCode).toBe(200);
    expect(unsupportedRows.json()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "unsupported" })],
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
    expect(summary.json()).toMatchObject({ summary: { effectiveRateCapPerMinute: 0.75 } });

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
    expect(preview.json()).toMatchObject({ operation: { effectiveRateCapPerMinute: 0.75 } });
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
        operationBudgetWindowMs: 80_000,
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
	        finmindProviderMinRequestIntervalMs: 0,
	        twelveDataProviderMinRequestIntervalMs: 250,
	        yahooAuProviderMinRequestIntervalMs: 500,
	        yahooKrProviderMinRequestIntervalMs: 1_500,
	        frankfurterProviderMinRequestIntervalMs: 750,
	        asxGicsProviderMinRequestIntervalMs: 2_000,
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
	      finmindProviderMinRequestIntervalMs: 0,
	      effectiveFinmindProviderMinRequestIntervalMs: 0,
	      twelveDataProviderMinRequestIntervalMs: 250,
	      effectiveTwelveDataProviderMinRequestIntervalMs: 250,
	      yahooAuProviderMinRequestIntervalMs: 500,
	      effectiveYahooAuProviderMinRequestIntervalMs: 500,
	      yahooKrProviderMinRequestIntervalMs: 1_500,
	      effectiveYahooKrProviderMinRequestIntervalMs: 1_500,
	      frankfurterProviderMinRequestIntervalMs: 750,
	      effectiveFrankfurterProviderMinRequestIntervalMs: 750,
	      asxGicsProviderMinRequestIntervalMs: 2_000,
	      effectiveAsxGicsProviderMinRequestIntervalMs: 2_000,
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
	      payload: { providerHealthCriticalUnresolvedThreshold: null, yahooKrProviderMinRequestIntervalMs: null },
	    });
	    expect(clearedCritical.statusCode).toBe(200);
	    expect(clearedCritical.json()).toMatchObject({
	      providerHealthCriticalUnresolvedThreshold: null,
	      effectiveProviderHealthCriticalUnresolvedThreshold: 10_000,
	      yahooKrProviderMinRequestIntervalMs: null,
	      effectiveYahooKrProviderMinRequestIntervalMs: 1_000,
	    });
  });

  it("does not persist KR bindings when Yahoo verification rejects the candidate", async () => {
    verifyResolvedSymbol.mockImplementation((_ticker: string, candidateSymbol: string) => Promise.resolve({
      verified: false,
      checkedSymbol: candidateSymbol,
      resolverMode: "quote_first",
      reason: "quote_not_korean_exchange",
    }));
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
    expect(previewBody.operation.preview.evidenceSample[0]?.verificationStatus).toBe("pending");
    expect(verifyResolvedSymbol).not.toHaveBeenCalled();

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
    const outcomesBody = outcomes.json();
    expect(outcomesBody).toMatchObject({
      summary: { total: 1, processed: 1, succeeded: 0, skipped: 1, result: "none_applied" },
      items: [expect.objectContaining({
        sourceSymbol: "005930",
        state: "skipped",
        errorCode: "candidate_rejected",
        evidence: expect.objectContaining({
          verificationStatus: "rejected",
          verificationReason: "quote_not_korean_exchange",
          attemptedCandidates: [
            { symbol: "005930.KS", status: "rejected", reason: "quote_not_korean_exchange" },
            { symbol: "005930.KQ", status: "rejected", reason: "quote_not_korean_exchange" },
          ],
        }),
      })],
    });
    expect(verifyResolvedSymbol).toHaveBeenCalledTimes(2);
    expect(verifyResolvedSymbol).toHaveBeenNthCalledWith(1, "005930", "005930.KS", { resolverMode: "quote_first" });
    expect(verifyResolvedSymbol).toHaveBeenNthCalledWith(2, "005930", "005930.KQ", { resolverMode: "quote_first" });
    await expect(
      app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930"),
    ).resolves.toBeNull();
  });

  it("tries the alternate KR Yahoo suffix when the catalog-derived candidate is rejected", async () => {
    verifyResolvedSymbol.mockImplementation((_ticker: string, candidateSymbol: string) => Promise.resolve({
      verified: candidateSymbol.endsWith(".KQ"),
      checkedSymbol: candidateSymbol,
      resolverMode: "quote_first",
      reason: candidateSymbol.endsWith(".KQ") ? undefined : "quote_not_korean_exchange",
    }));
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
      payload: { previewToken: previewBody.operation.preview.token, acknowledged: true },
    });
    expect(execute.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("completed");
    });

    expect(verifyResolvedSymbol).toHaveBeenNthCalledWith(1, "005930", "005930.KS", { resolverMode: "quote_first" });
    expect(verifyResolvedSymbol).toHaveBeenNthCalledWith(2, "005930", "005930.KQ", { resolverMode: "quote_first" });
    await expect(app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930")).resolves.toMatchObject({
      resolvedSymbol: "005930.KQ",
    });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.json()).toMatchObject({
      summary: { succeeded: 1, result: "all_succeeded" },
      items: [expect.objectContaining({
        state: "succeeded",
        evidence: expect.objectContaining({
          attemptedCandidates: [
            { symbol: "005930.KS", status: "rejected", reason: "quote_not_korean_exchange" },
            { symbol: "005930.KQ", status: "verified", reason: null },
          ],
        }),
      })],
    });
  });

  it("resolves an active KR unresolved row when a durable mapping already exists", async () => {
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    await app.persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { seeded: true },
      verifiedByUserId: admin.userId,
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
    const previewBody = preview.json() as {
      operation: { id: string; preview: { token: string } };
    };
    const execute = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/execute`,
      headers,
      payload: { previewToken: previewBody.operation.preview.token, acknowledged: true },
    });
    expect(execute.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("completed");
    });

    expect(verifyResolvedSymbol).not.toHaveBeenCalled();
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.json()).toMatchObject({
      summary: { succeeded: 1, result: "all_succeeded" },
      items: [expect.objectContaining({
        state: "succeeded",
        errorCode: "mapping_already_exists",
        evidence: expect.objectContaining({
          verificationStatus: "verified",
          verificationReason: "mapping_already_exists",
          attemptedCandidates: [
            { symbol: "005930.KS", status: "verified", reason: "mapping_already_exists" },
          ],
        }),
      })],
    });
    const unresolved = await app.persistence.listProviderUnresolvedItems({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      state: "resolved",
      page: 1,
      limit: 10,
    });
    expect(unresolved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSymbol: "005930", state: "resolved", resolvedByOperationId: previewBody.operation.id }),
    ]));
  });

  it("pauses KR repair when the alternate suffix attempt hits the rate limit", async () => {
    verifyResolvedSymbol
      .mockImplementationOnce((_ticker: string, candidateSymbol: string) => Promise.resolve({
        verified: false,
        checkedSymbol: candidateSymbol,
        resolverMode: "quote_first",
        reason: "quote_not_korean_exchange",
      }))
      .mockRejectedValueOnce(new RateLimitedError({ msUntilAvailable: 60_000 }));
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
      payload: { previewToken: previewBody.operation.preview.token, acknowledged: true },
    });
    expect(execute.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const operation = await app.persistence.getProviderOperation(previewBody.operation.id);
      expect(operation?.phase).toBe("paused");
    });

    expect(verifyResolvedSymbol).toHaveBeenNthCalledWith(1, "005930", "005930.KS", { resolverMode: "quote_first" });
    expect(verifyResolvedSymbol).toHaveBeenNthCalledWith(2, "005930", "005930.KQ", { resolverMode: "quote_first" });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.json()).toMatchObject({
      summary: { rateLimited: 1, result: "rate_limited" },
      items: [expect.objectContaining({
        state: "rate_limited",
        errorCode: "provider_rate_limited",
        evidence: expect.objectContaining({
          verificationStatus: "rejected",
          verificationReason: "quote_not_korean_exchange",
          attemptedCandidates: [
            { symbol: "005930.KS", status: "rejected", reason: "quote_not_korean_exchange" },
          ],
        }),
      })],
    });
    await expect(app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "005930")).resolves.toBeNull();
  });

  it("marks provider fixer execution failed when Yahoo verification throws a non-rate error", async () => {
    verifyResolvedSymbol.mockRejectedValueOnce(new Error("Yahoo verifier exploded"));
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
    verifyResolvedSymbol.mockRejectedValueOnce(new RateLimitedError({ msUntilAvailable: 30_000 }));
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

  it("resumes provider fixer execution from pending unresolved rows without reprocessing terminal outcomes", async () => {
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
    verifyResolvedSymbol.mockResolvedValueOnce({
      verified: true,
      checkedSymbol: "035720.KS",
      resolverMode: "quote_first",
    });
    const admin = await createAdmin(app);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${admin.cookie}` };
    const operation = await app.persistence.createProviderOperation({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "paused",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      resolverMode: "quote_first",
      matchCount: 2,
      metadata: {
        effectiveRateCapPerMinute: 250,
        frozenScope: {
          type: "selected_items",
          filterFingerprint: "resume-pending-scope",
          matchCount: 2,
          selectedItems: [
            {
              providerId: "yahoo-finance-kr",
              marketCode: "KR",
              errorCode: "yahoo_finance_kr_symbol_unresolved",
              sourceSymbol: "005930",
            },
            {
              providerId: "yahoo-finance-kr",
              marketCode: "KR",
              errorCode: "yahoo_finance_kr_symbol_unresolved",
              sourceSymbol: "035720",
            },
          ],
          filter: null,
        },
      },
      actorUserId: admin.userId,
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      providerSymbol: "005930",
      action: "repair_mapping",
      state: "succeeded",
      message: "Resolved 005930 to 005930.KS before pause.",
      evidence: { candidateSymbol: "005930.KS" },
    });

    const resume = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${operation.id}/resume`,
      headers,
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ operation: { phase: "running" } });
    await vi.waitFor(async () => {
      const current = await app.persistence.getProviderOperation(operation.id);
      expect(current?.phase).toBe("completed");
    });

    expect(verifyResolvedSymbol).toHaveBeenCalledTimes(1);
    expect(verifyResolvedSymbol).toHaveBeenCalledWith("035720", "035720.KS", { resolverMode: "quote_first" });
    const outcomes = await app.inject({
      method: "GET",
      url: `/admin/providers/yahoo-finance-kr/operations/${operation.id}/outcomes?page=1&limit=10`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json()).toMatchObject({
      summary: { total: 2, processed: 2, succeeded: 2 },
      items: expect.arrayContaining([
        expect.objectContaining({ sourceSymbol: "005930", state: "succeeded" }),
        expect.objectContaining({ sourceSymbol: "035720", state: "succeeded" }),
      ]),
    });
    await expect(app.persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "035720")).resolves.toMatchObject({
      resolvedSymbol: "035720.KS",
      verifiedByUserId: admin.userId,
    });
  });

  it("keeps cancelled provider fixer execution terminal when background repair finishes", async () => {
    let resolveVerification: (value: {
      verified: boolean;
      checkedSymbol: string;
      resolverMode: "quote_first";
    }) => void = () => undefined;
    const verificationStarted = vi.fn();
    verifyResolvedSymbol.mockImplementationOnce(() => {
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

  it("keeps paused provider fixer execution paused when background repair observes the pause", async () => {
    let resolveVerification: (value: {
      verified: boolean;
      checkedSymbol: string;
      resolverMode: "quote_first";
    }) => void = () => undefined;
    const verificationStarted = vi.fn();
    verifyResolvedSymbol.mockImplementationOnce(() => {
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

    const pause = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${previewBody.operation.id}/pause`,
      headers,
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json()).toMatchObject({ operation: { phase: "paused" } });

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
      phase: "paused",
      completedAt: null,
    });
    const logs = await app.persistence.listProviderOperationLogs({
      operationId: previewBody.operation.id,
      page: 1,
      limit: 20,
    });
    expect(logs.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "paused", message: expect.stringContaining("execute_stopped") }),
      ]),
    );
  });

  it("rejects expired preview tokens but lets admins create a fresh preview unless another provider-market operation is active", async () => {
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
      expect.objectContaining({ id: expired.id, canExecute: false, canRetry: false }),
    );

    const expiredResponse = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${expired.id}/execute`,
      headers,
      payload: { acknowledged: true },
    });
    expect(expiredResponse.statusCode).toBe(400);
    expect(expiredResponse.json()).toMatchObject({ error: "provider_fixer_preview_token_expired" });

    const freshPreview = await app.inject({
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
    expect(freshPreview.statusCode).toBe(201);
    expect(freshPreview.json()).toMatchObject({
      operation: {
        providerId: "yahoo-finance-kr",
        phase: "preview",
      },
    });
    await app.persistence.updateProviderOperation({
      id: freshPreview.json().operation.id,
      phase: "cancelled",
      cancelledAt: new Date().toISOString(),
    });

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
    expect(candidatePreview.statusCode).toBe(409);
    expect(candidatePreview.json()).toMatchObject({ error: "provider_fixer_active_operation_conflict" });

    const retry = await app.inject({
      method: "POST",
      url: `/admin/providers/yahoo-finance-kr/operations/${expired.id}/retry`,
      headers,
    });
    expect(retry.statusCode).toBe(400);
    expect(retry.json()).toMatchObject({ error: "provider_operation_not_retryable" });
    await expect(app.persistence.getProviderOperation(expired.id)).resolves.toMatchObject({
      id: expired.id,
      phase: "cancelled",
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
