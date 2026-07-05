import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const adminHeaders = { "x-user-id": "admin-user", "x-user-role": "admin" };

function seedAuInstrument(app: BuiltApp): void {
  (app.persistence as unknown as {
    _seedInstrument(instrument: {
      ticker: string;
      name: string;
      instrumentType: "ETF";
      marketCode: "AU";
      barsBackfillStatus: "ready";
      typeRaw?: string;
      catalogExchangeRaw?: string;
      catalogMicCode?: string;
    }): void;
  })._seedInstrument({
    ticker: "ETPMAG",
    name: "Global X Physical Gold",
    instrumentType: "ETF",
    marketCode: "AU",
    barsBackfillStatus: "ready",
    typeRaw: "ETF",
    catalogExchangeRaw: "ASX",
    catalogMicCode: "XASX",
  });
}

describe("admin quote fallback policy routes", () => {
  let app: BuiltApp;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", registerWorkers: false });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("exposes EODHD fallback settings with daily-call bounds and persists the call limit", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/admin/settings",
      headers: adminHeaders,
    });

    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      eodhdDailyCallLimit: null,
      effectiveEodhdDailyCallLimit: 20,
      eodhdApiKeySet: false,
      eodhdFallback: {
        dailyCallLimit: null,
        effectiveDailyCallLimit: 20,
        apiKeySet: false,
        validatedMarkets: ["AU"],
        bounds: {
          dailyCallLimit: { min: 1, max: 1_000 },
        },
      },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: adminHeaders,
      payload: { eodhdDailyCallLimit: 12 },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      eodhdDailyCallLimit: 12,
      effectiveEodhdDailyCallLimit: 12,
      eodhdFallback: {
        dailyCallLimit: 12,
        effectiveDailyCallLimit: 12,
      },
    });
    expect(await app.persistence.getAppConfig()).toMatchObject({
      eodhdDailyCallLimit: 12,
    });
  });

  it("creates, lists, queues refreshes, and deactivates AU quote fallback policies", async () => {
    seedAuInstrument(app);

    const unsupportedMarket = await app.inject({
      method: "POST",
      url: "/admin/market-data/US/quote-fallback-policies/upsert",
      headers: adminHeaders,
      payload: {
        ticker: "AAPL",
        marketCode: "US",
        provider: "eodhd",
        priceType: "eod_close",
        providerSymbol: "AAPL.US",
      },
    });
    expect(unsupportedMarket.statusCode).toBe(400);
    expect(unsupportedMarket.json()).toMatchObject({ error: "quote_fallback_market_not_validated" });

    const created = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/quote-fallback-policies/upsert",
      headers: adminHeaders,
      payload: {
        ticker: "etpmag",
        marketCode: "AU",
        provider: "eodhd",
        priceType: "eod_close",
        providerSymbol: "ETPMAG.AU",
        reason: "Yahoo AU delayed close",
      },
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      policy: {
        ticker: "ETPMAG",
        marketCode: "AU",
        provider: "eodhd",
        priceType: "eod_close",
        providerSymbol: "ETPMAG.AU",
        active: true,
        reason: "Yahoo AU delayed close",
        latestSnapshot: null,
      },
    });

    const instruments = await app.inject({
      method: "GET",
      url: "/admin/market-data/AU/instruments?search=ETPMAG",
      headers: adminHeaders,
    });
    expect(instruments.statusCode).toBe(200);
    expect(instruments.json()).toMatchObject({
      items: [
        {
          ticker: "ETPMAG",
          marketCode: "AU",
          quoteFallbackPolicy: {
            provider: "eodhd",
            providerSymbol: "ETPMAG.AU",
            active: true,
          },
        },
      ],
    });

    const send = vi.fn().mockResolvedValue("quote-fallback-job-1");
    (app as unknown as { boss: { send: typeof send } }).boss = { send };
    const refresh = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/quote-fallback-policies/refresh",
      headers: adminHeaders,
      payload: {
        ticker: "ETPMAG",
        marketCode: "AU",
      },
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({
      refreshed: false,
      remainingCalls: 20,
      message: "Refresh queued.",
      policy: {
        ticker: "ETPMAG",
        provider: "eodhd",
      },
    });
    expect(send).toHaveBeenCalledWith(
      "quote-fallback-refresh",
      expect.objectContaining({
        kind: "policy_refresh",
        ticker: "ETPMAG",
        marketCode: "AU",
        trigger: "manual",
      }),
      expect.objectContaining({
        singletonKey: "quote-fallback-refresh:AU:ETPMAG",
        priority: 5,
      }),
    );

    const deactivated = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/quote-fallback-policies/deactivate",
      headers: adminHeaders,
      payload: {
        ticker: "ETPMAG",
        marketCode: "AU",
      },
    });

    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json()).toMatchObject({
      policy: {
        ticker: "ETPMAG",
        marketCode: "AU",
        active: false,
      },
    });

    const audit = await app.persistence.listAuditLog({ page: 1, limit: 20 });
    expect(audit.items.map((item) => item.action)).toEqual(expect.arrayContaining([
      "quote_fallback_policy_created",
      "quote_fallback_manual_refresh_requested",
      "quote_fallback_policy_deactivated",
    ]));
  });

  it("clears stale snapshots and refresh status when the provider symbol changes", async () => {
    seedAuInstrument(app);

    const created = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/quote-fallback-policies/upsert",
      headers: adminHeaders,
      payload: {
        ticker: "ETPMAG",
        marketCode: "AU",
        provider: "eodhd",
        priceType: "eod_close",
        providerSymbol: "ETPMAG.AU",
      },
    });
    expect(created.statusCode).toBe(200);
    const createdPolicy = created.json().policy as { id: string };

    await app.persistence.upsertQuoteFallbackSnapshot({
      policyId: createdPolicy.id,
      marketCode: "AU",
      ticker: "ETPMAG",
      provider: "eodhd",
      priceType: "eod_close",
      providerSymbol: "ETPMAG.AU",
      marketDate: "2026-07-03",
      close: 82.44,
      previousClose: 81.75,
      currency: "AUD",
      currencySource: "market_default",
      source: "eodhd-eod",
      fetchedAt: "2026-07-05T12:00:00.000Z",
      providerPayloadHash: null,
      providerMetadata: { request: { from: "2026-07-02", to: "2026-07-03" } },
    });
    await app.persistence.updateQuoteFallbackPolicyRefreshStatus({
      policyId: createdPolicy.id,
      status: "success",
      refreshedAt: "2026-07-05T12:00:00.000Z",
      error: null,
      errorCode: null,
    });

    const before = await app.persistence.getQuoteFallbackPolicy("ETPMAG", "AU");
    expect(before).toMatchObject({
      providerSymbol: "ETPMAG.AU",
      lastRefreshStatus: "success",
      latestSnapshot: {
        providerSymbol: "ETPMAG.AU",
        close: 82.44,
      },
    });

    const updated = await app.inject({
      method: "POST",
      url: "/admin/market-data/AU/quote-fallback-policies/upsert",
      headers: adminHeaders,
      payload: {
        ticker: "ETPMAG",
        marketCode: "AU",
        provider: "eodhd",
        priceType: "eod_close",
        providerSymbol: "GOLD.AU",
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      policy: {
        id: createdPolicy.id,
        ticker: "ETPMAG",
        marketCode: "AU",
        providerSymbol: "GOLD.AU",
        lastRefreshStatus: null,
        lastRefreshAt: null,
        lastRefreshError: null,
        lastRefreshErrorCode: null,
        latestSnapshot: null,
      },
    });
    await expect(app.persistence.getLatestQuoteFallbackSnapshot(createdPolicy.id)).resolves.toBeNull();
  });
});
