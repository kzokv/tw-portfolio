import { describe, expect, it } from "vitest";
import { createEmptyTickerFundamentals } from "../../src/services/fundamentals/types.js";
import { createDefaultFeeProfile, createStore, setStoreInstruments } from "../../src/services/store.js";
import { buildTickerDetails } from "../../src/services/tickerDetails.js";

describe("buildTickerDetails", () => {
  function createPersistence() {
    return {
      async getDailyBarsForTickerMarket() {
        return [];
      },
      async getLatestBarDatesByTickerMarket() {
        return new Map<string, string>();
      },
      async getInstrument(ticker: string, marketCode?: string) {
        return ticker && marketCode
          ? {
              ticker,
              name: `${ticker} ${marketCode}`,
              instrumentType: "STOCK" as const,
              marketCode,
              isProvisional: false,
              barsBackfillStatus: "ready" as const,
              verificationStatus: "verified" as const,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            }
          : null;
      },
    };
  }

  function buildCrossMarketStore() {
    const store = createStore();
    const usdFeeProfile = createDefaultFeeProfile("acc-us", "USD", "fp-us");
    const audFeeProfile = createDefaultFeeProfile("acc-au", "AUD", "fp-au");

    store.accounts.push(
      {
        id: "acc-us",
        userId: "user-1",
        name: "US Broker",
        feeProfileId: usdFeeProfile.id,
        defaultCurrency: "USD",
        accountType: "broker",
      },
      {
        id: "acc-au",
        userId: "user-1",
        name: "AU Broker",
        feeProfileId: audFeeProfile.id,
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    );
    store.feeProfiles.push(usdFeeProfile, audFeeProfile);
    setStoreInstruments(store, [
      ...store.instruments,
      { ticker: "BHP", type: "STOCK", marketCode: "US", isProvisional: false },
      { ticker: "BHP", type: "STOCK", marketCode: "AU", isProvisional: false },
    ]);
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-us",
        ticker: "BHP",
        quantity: 4,
        costBasisAmount: 200,
        currency: "USD",
      },
      {
        accountId: "acc-au",
        ticker: "BHP",
        quantity: 3,
        costBasisAmount: 120,
        currency: "AUD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "bhp-us-buy",
        userId: "user-1",
        accountId: "acc-us",
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 4,
        unitPrice: 50,
        priceCurrency: "USD",
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
      },
      {
        id: "bhp-au-buy",
        userId: "user-1",
        accountId: "acc-au",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 3,
        unitPrice: 40,
        priceCurrency: "AUD",
        tradeDate: "2026-02-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: audFeeProfile,
      },
    );

    return store;
  }

  it("requires an explicit market for same ticker across multiple held markets", async () => {
    await expect(buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      fundamentalsRecord: null,
    })).rejects.toMatchObject({
      code: "ticker_market_required",
      statusCode: 400,
    });
  });

  it("uses the requested marketCode for same ticker across multiple markets", async () => {
    const { details, marketCode } = await buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      fundamentalsRecord: {
        ticker: "BHP",
        marketCode: "AU",
        providerId: "test-provider",
        fundamentals: createEmptyTickerFundamentals(),
        refreshedAt: "2026-06-01T00:00:00.000Z",
        nextRefreshAt: "2026-06-15T00:00:00.000Z",
        lastAttemptedAt: null,
        lastError: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(marketCode).toBe("AU");
    expect(details.identity).toEqual(expect.objectContaining({
      ticker: "BHP",
      marketCode: "AU",
      priceCurrency: "AUD",
    }));
    expect(details.position).toEqual(expect.objectContaining({
      quantity: 3,
      costBasisAmount: 120,
      currency: "AUD",
      accountIds: ["acc-au"],
    }));
    expect(details.transactions).toEqual([
      expect.objectContaining({
        accountId: "acc-au",
        marketCode: "AU",
        priceCurrency: "AUD",
      }),
    ]);
  });
});
