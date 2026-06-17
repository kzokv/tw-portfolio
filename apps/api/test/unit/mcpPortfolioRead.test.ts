import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import { getQuoteFreshness } from "../../src/services/mcpPortfolioRead.js";
import type { McpRequestContext } from "../../src/mcp/types.js";
import { transactionPayload } from "../helpers/fixtures.js";

let app: AppInstance;

function createRequestContext(): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: "user-1",
      connection: null,
      scopes: ["portfolio:mcp_read"],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "mcp-portfolio-read-test",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

describe("mcp portfolio read services", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", seedMemoryCatalog: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns factual priceState quote diagnostics without legacy freshness fields", async () => {
    (app.persistence as MemoryPersistence)._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    (app.persistence as MemoryPersistence)._seedDailyBars([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-16",
        open: 1000,
        high: 1010,
        low: 990,
        close: 1005,
        volume: 1_000_000,
        quality: "full_bar",
        source: "test-daily",
        ingestedAt: "2026-06-16T07:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-15",
        open: 990,
        high: 1000,
        low: 980,
        close: 995,
        volume: 1_000_000,
        quality: "full_bar",
        source: "test-daily",
        ingestedAt: "2026-06-15T07:00:00.000Z",
      },
    ]);
    const trade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "mcp-price-state-seed" },
      payload: transactionPayload({
        ticker: "2330",
        marketCode: "TW",
        tradeDate: "2026-06-15",
        quantity: 1,
        unitPrice: 990,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(trade.statusCode).toBe(200);

    const result = await getQuoteFreshness(
      {
        app,
        requestContext: createRequestContext(),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-06-16",
          isTradingDay: async () => false,
        } as never,
      },
      { tickers: ["2330"] },
    );

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0]).toEqual(expect.objectContaining({
      ticker: "2330",
      quoteStatus: "current",
      currentUnitPrice: 1005,
      previousClose: 995,
      priceState: expect.objectContaining({
        basis: "today_close",
        chipState: "closed",
        source: "test-daily",
        quality: "full_bar",
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("freshnessTooltip");
    expect(Object.keys(result.quotes[0]!)).not.toContain("freshness");
  });
});
