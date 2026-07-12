import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "dev_bypass" as const },
  };
});

import { buildApp } from "../../src/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;

async function seedDividendReadModelFixture() {
  const store = await app.persistence.loadStore("user-1");
  store.instruments = [
    ...store.instruments.filter((instrument) => !(instrument.ticker === "2330" && instrument.marketCode === "TW")),
    { ticker: "2330", name: "TSMC", type: "STOCK", marketCode: "TW", isProvisional: false },
  ];
  store.accounts.push({
    id: "acc-2",
    userId: "user-1",
    name: "Second",
    feeProfileId: store.feeProfiles[0]!.id,
    defaultCurrency: "TWD",
    accountType: "broker",
  });
  store.accounting.projections.holdings.push(
    { accountId: "acc-1", ticker: "2330", quantity: 10, costBasisAmount: 1000, currency: "TWD" },
    { accountId: "acc-2", ticker: "2330", quantity: 5, costBasisAmount: 500, currency: "TWD" },
  );
  store.accounting.facts.tradeEvents.push(
    {
      id: "trade-1",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    },
  );

  for (let index = 1; index <= 12; index += 1) {
    const day = String(index).padStart(2, "0");
    const eventId = `event-${day}`;
    store.marketData.dividendEvents.push({
      id: eventId,
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: `2026-01-${day}`,
      paymentDate: `2026-02-${day}`,
      cashDividendPerShare: 10,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: `ledger-${day}`,
      accountId: "acc-1",
      dividendEventId: eventId,
      eligibleQuantity: 10,
      expectedCashAmount: 100,
      expectedStockQuantity: 0,
      receivedCashAmount: 100,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: index === 1 ? "open" : "matched",
      version: 1,
      sourceCompositionStatus: "provided",
      bookedAt: `2026-02-${day}T09:00:00.000Z`,
    });
  }
  store.accounting.facts.positionActions.push(
    {
      id: "split-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      actionType: "SPLIT",
      actionDate: "2026-03-15",
      actionTimestamp: "2026-03-15T09:00:00.000Z",
      quantity: 20,
      ratioNumerator: 2,
      ratioDenominator: 1,
      source: "manual",
    },
    {
      id: "stock-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      actionType: "STOCK_DIVIDEND",
      actionDate: "2026-02-20",
      actionTimestamp: "2026-02-20T09:00:00.000Z",
      quantity: 1,
      relatedDividendLedgerEntryId: "ledger-01",
      source: "dividend_posting",
    },
  );
}

describe("dividend read model routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
    await seedDividendReadModelFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it("[ticker read models]: posted/open routes → paginate and separate open reconciliation", async () => {
    const posted = await app.inject({
      method: "GET",
      url: "/tickers/2330/dividends/posted-history?marketCode=TW&page=2&limit=10",
    });
    const open = await app.inject({
      method: "GET",
      url: "/tickers/2330/dividends/open-reconciliation?marketCode=TW&page=1&limit=10",
    });

    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toEqual({
      postedHistory: expect.objectContaining({
        page: 2,
        limit: 10,
        total: 12,
        items: [
          expect.objectContaining({ dividendLedgerEntryId: "ledger-02" }),
          expect.objectContaining({ dividendLedgerEntryId: "ledger-01" }),
        ],
      }),
    });
    expect(open.statusCode).toBe(200);
    expect(open.json()).toEqual({
      openReconciliation: expect.objectContaining({
        page: 1,
        limit: 10,
        total: 1,
        items: [expect.objectContaining({ dividendLedgerEntryId: "ledger-01", reconciliationStatus: "open" })],
      }),
    });
  });

  it("[holding activity]: combined route → returns independent section metadata and scoped position actions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/portfolio/holdings/2330/activity-dividends?marketCode=TW&accountId=acc-1&positionActionsLimit=10&upcomingLimit=10&postedLimit=10",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      positionActions: expect.objectContaining({
        page: 1,
        limit: 10,
        total: 2,
        items: [
          expect.objectContaining({ id: "split-1", actionType: "SPLIT", accountId: "acc-1" }),
          expect.objectContaining({ id: "stock-1", actionType: "STOCK_DIVIDEND", accountId: "acc-1" }),
        ],
      }),
      upcomingDividends: expect.objectContaining({
        page: 1,
        limit: 10,
      }),
      postedDividends: expect.objectContaining({
        page: 1,
        limit: 10,
        total: 12,
      }),
    });
  });
});
