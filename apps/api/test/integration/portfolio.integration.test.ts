import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { transactionPayload, feeProfilePayload, type TransactionType } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("portfolio (transactions, holdings, recompute)", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("creates transaction and returns holdings", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k1" },
      payload: transactionPayload(),
    });
    expect(createResponse.statusCode).toBe(200);

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    const holdings = holdingsResponse.json();
    expect(Array.isArray(holdings)).toBe(true);
    expect(holdings[0].quantity).toBe(10);

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents).toHaveLength(1);
    expect(store.accounting.facts.tradeEvents[0].type).toBe("BUY");
    expect(store.accounting.facts.tradeEvents[0].bookingSequence).toBe(1);
    expect(store.accounting.facts.cashLedgerEntries).toEqual([
      expect.objectContaining({
        relatedTradeEventId: store.accounting.facts.tradeEvents[0].id,
        entryType: "TRADE_SETTLEMENT_OUT",
        amountNtd: -(10 * 100 + store.accounting.facts.tradeEvents[0].commissionNtd),
      }),
    ]);
    expect(store.accounting.projections.lots).toHaveLength(1);
    expect(store.accounting.projections.lots[0].openedSequence).toBe(1);
    expect(store.accounting.projections.holdings).toEqual([
      expect.objectContaining({
        accountId: "acc-1",
        symbol: "2330",
        quantity: 10,
      }),
    ]);
    expect(store.accounting.policy).toEqual({
      inventoryModel: "LOT_CAPABLE",
      disposalPolicy: "WEIGHTED_AVERAGE",
    });
  });

  it("creates linked cash settlement facts for buys and sells", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-cash-buy" },
      payload: transactionPayload({ quantity: 10, priceNtd: 100, tradeDate: "2026-01-01" }),
    });

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-cash-sell" },
      payload: transactionPayload({
        quantity: 5,
        priceNtd: 130,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    const tradeEvents = store.accounting.facts.tradeEvents;
    const cashEntries = store.accounting.facts.cashLedgerEntries;
    const buyTrade = tradeEvents.find((item) => item.type === "BUY");
    const sellTrade = tradeEvents.find((item) => item.type === "SELL");

    expect(buyTrade).toBeDefined();
    expect(sellTrade).toBeDefined();
    expect(cashEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relatedTradeEventId: buyTrade?.id,
          entryType: "TRADE_SETTLEMENT_OUT",
          amountNtd: -(buyTrade!.quantity * buyTrade!.priceNtd + buyTrade!.commissionNtd + buyTrade!.taxNtd),
        }),
        expect.objectContaining({
          relatedTradeEventId: sellTrade?.id,
          entryType: "TRADE_SETTLEMENT_IN",
          amountNtd: sellTrade!.quantity * sellTrade!.priceNtd - sellTrade!.commissionNtd - sellTrade!.taxNtd,
        }),
      ]),
    );
  });

  it("persists same-day booking sequence and sell-to-lot allocations", async () => {
    const secondBuyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-seq-buy-2" },
      payload: transactionPayload({
        quantity: 10,
        priceNtd: 120,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:02.000Z",
        bookingSequence: 2,
      }),
    });
    expect(secondBuyResponse.statusCode).toBe(200);

    const firstBuyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-seq-buy-1" },
      payload: transactionPayload({
        quantity: 10,
        priceNtd: 100,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:01.000Z",
        bookingSequence: 1,
      }),
    });
    expect(firstBuyResponse.statusCode).toBe(200);

    const sellResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-seq-sell" },
      payload: transactionPayload({
        quantity: 5,
        priceNtd: 130,
        tradeDate: "2026-01-01",
        tradeTimestamp: "2026-01-01T09:00:03.000Z",
        bookingSequence: 3,
        type: "SELL" as TransactionType,
      }),
    });
    expect(sellResponse.statusCode).toBe(200);
    const firstBuy = firstBuyResponse.json();
    const secondBuy = secondBuyResponse.json();
    const sell = sellResponse.json();

    const store = await app.persistence.loadStore("user-1");
    const sameDayTrades = store.accounting.facts.tradeEvents
      .filter((trade) => trade.tradeDate === "2026-01-01")
      .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
    expect(sameDayTrades.map((trade) => trade.bookingSequence)).toEqual([1, 2, 3]);

    const sameDayLots = store.accounting.projections.lots
      .filter((lot) => lot.symbol === "2330")
      .sort((a, b) => (a.openedSequence ?? 0) - (b.openedSequence ?? 0));
    expect(sameDayLots.map((lot) => lot.id)).toEqual([`lot-${firstBuy.id}`, `lot-${secondBuy.id}`]);
    expect(sameDayLots.map((lot) => lot.openedSequence)).toEqual([1, 2]);

    expect(store.accounting.projections.lotAllocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tradeEventId: sell.id,
          lotId: `lot-${firstBuy.id}`,
          lotOpenedSequence: 1,
          allocatedQuantity: 5,
          allocatedCostNtd: 560,
        }),
      ]),
    );
  });

  it("rejects duplicate same-day booking sequence for the same account", async () => {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-seq-dup-1" },
      payload: transactionPayload({
        tradeDate: "2026-01-05",
        tradeTimestamp: "2026-01-05T09:00:01.000Z",
        bookingSequence: 1,
      }),
    });
    expect(firstResponse.statusCode).toBe(200);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-seq-dup-2" },
      payload: transactionPayload({
        tradeDate: "2026-01-05",
        tradeTimestamp: "2026-01-05T09:00:02.000Z",
        bookingSequence: 1,
      }),
    });
    expect(secondResponse.statusCode).toBe(400);
    expect(secondResponse.json()).toMatchObject({
      error: "invalid_request",
      message: "Invalid booking sequence: already exists for the same account and trade date",
    });
  });

  it("previews and confirms recompute", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k2" },
      payload: transactionPayload({ quantity: 10, priceNtd: 200 }),
    });

    const preview = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/preview",
      payload: { profileId: "fp-default" },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();

    const confirm = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/confirm",
      payload: { jobId: previewBody.id },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe("CONFIRMED");
  });

  it("does not consume idempotency key for invalid payload", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-invalid" },
      payload: { accountId: "acc-1" },
    });
    expect(first.statusCode).toBeGreaterThanOrEqual(400);

    const second = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-invalid" },
      payload: transactionPayload({ quantity: 1 }),
    });
    expect(second.statusCode).toBe(200);
  });

  it("does not consume idempotency key for domain validation failure", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-domain-invalid" },
      payload: transactionPayload({ symbol: "UNKNOWN", quantity: 1 }),
    });
    expect(first.statusCode).toBe(400);

    const second = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-domain-invalid" },
      payload: transactionPayload({ quantity: 1 }),
    });
    expect(second.statusCode).toBe(200);
  });

  it("keeps transaction fee snapshots immutable after profile edits", async () => {
    const feeProfilesBefore = await app.inject({ method: "GET", url: "/fee-profiles" });
    const profile = feeProfilesBefore.json()[0];

    const createResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-snapshot-immutable" },
      payload: transactionPayload({ quantity: 1 }),
    });
    expect(createResponse.statusCode).toBe(200);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/fee-profiles/${profile.id}`,
      payload: { ...profile, name: "Updated Broker Name" },
    });
    expect(patchResponse.statusCode).toBe(200);

    const transactions = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(transactions.statusCode).toBe(200);
    expect(transactions.json()[0].feeSnapshot.name).toBe(profile.name);
  });

  it("releases idempotency key when persistence fails", async () => {
    const originalSaveAccountingStore = app.persistence.saveAccountingStore.bind(app.persistence);
    let failOnce = true;
    app.persistence.saveAccountingStore = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("forced save failure");
      }
      return originalSaveAccountingStore(...args);
    };

    const first = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-save-fail" },
      payload: transactionPayload({ quantity: 1 }),
    });
    expect(first.statusCode).toBe(500);

    const second = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-save-fail" },
      payload: transactionPayload({ quantity: 1 }),
    });
    expect(second.statusCode).toBe(200);
  });

  it("recompute updates realized pnl on sell transactions", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-sell-1" },
      payload: transactionPayload(),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-sell-2" },
      payload: transactionPayload({
        quantity: 5,
        priceNtd: 120,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    const createdProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee" }),
    });
    expect(createdProfileResponse.statusCode).toBe(200);
    const createdProfile = createdProfileResponse.json();

    const before = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    const beforeSell = before
      .json()
      .find((tx: { type: string; realizedPnlNtd?: number }) => tx.type === "SELL");
    expect(beforeSell).toBeDefined();

    const storeBefore = await app.persistence.loadStore("user-1");
    const sellTradeBefore = storeBefore.accounting.facts.tradeEvents.find((tx) => tx.type === "SELL");
    const sellCashBefore = storeBefore.accounting.facts.cashLedgerEntries.find(
      (entry) => entry.relatedTradeEventId === sellTradeBefore?.id,
    );
    expect(sellCashBefore).toBeDefined();

    const preview = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/preview",
      payload: { profileId: createdProfile.id },
    });
    const previewBody = preview.json();
    await app.inject({
      method: "POST",
      url: "/portfolio/recompute/confirm",
      payload: { jobId: previewBody.id },
    });

    const after = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    const afterSell = after
      .json()
      .find((tx: { type: string; realizedPnlNtd?: number }) => tx.type === "SELL");
    expect(afterSell).toBeDefined();
    expect(afterSell.realizedPnlNtd).not.toBe(beforeSell.realizedPnlNtd);

    const storeAfter = await app.persistence.loadStore("user-1");
    const sellTradeAfter = storeAfter.accounting.facts.tradeEvents.find((tx) => tx.type === "SELL");
    const sellCashAfter = storeAfter.accounting.facts.cashLedgerEntries.find(
      (entry) => entry.relatedTradeEventId === sellTradeAfter?.id,
    );
    expect(sellCashAfter).toBeDefined();
    expect(sellCashAfter?.amountNtd).not.toBe(sellCashBefore?.amountNtd);
    expect(sellCashAfter?.amountNtd).toBe(
      sellTradeAfter!.quantity * sellTradeAfter!.priceNtd - sellTradeAfter!.commissionNtd - sellTradeAfter!.taxNtd,
    );
  });

  it("uses weighted-average cost basis for partial sells", async () => {
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();
    const zeroFeeProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Weighted Average" }),
    });
    expect(zeroFeeProfileResponse.statusCode).toBe(200);
    const zeroFeeProfile = zeroFeeProfileResponse.json();

    const settings = await app.inject({ method: "GET", url: "/settings" });
    const settingsBody = settings.json();
    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/full",
      payload: {
        settings: {
          locale: settingsBody.locale,
          costBasisMethod: settingsBody.costBasisMethod,
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: [
          ...feeConfigBody.feeProfiles.map((profile: { id: string } & Record<string, unknown>) => ({ ...profile })),
          { id: zeroFeeProfile.id, ...zeroFeeProfile },
        ],
        accounts: feeConfigBody.accounts.map((account: { id: string }) => ({
          id: account.id,
          feeProfileRef: zeroFeeProfile.id,
        })),
        feeProfileBindings: [],
      },
    });
    expect(saveFull.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-buy-1" },
      payload: transactionPayload({ quantity: 10, priceNtd: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-buy-2" },
      payload: transactionPayload({ quantity: 10, priceNtd: 120, tradeDate: "2026-01-02" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-sell" },
      payload: transactionPayload({
        quantity: 5,
        priceNtd: 130,
        tradeDate: "2026-01-03",
        type: "SELL" as TransactionType,
      }),
    });

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        symbol: "2330",
        quantity: 15,
        costNtd: 1_650,
      },
    ]);

    const transactionsResponse = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(transactionsResponse.statusCode).toBe(200);
    const sell = transactionsResponse
      .json()
      .find((tx: { type: string; realizedPnlNtd?: number }) => tx.type === "SELL");
    expect(sell?.realizedPnlNtd).toBe(100);
  });

  it("records a realized loss when sell price is below weighted-average cost", async () => {
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();
    const zeroFeeProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Weighted Average Loss" }),
    });
    expect(zeroFeeProfileResponse.statusCode).toBe(200);
    const zeroFeeProfile = zeroFeeProfileResponse.json();

    const settings = await app.inject({ method: "GET", url: "/settings" });
    const settingsBody = settings.json();
    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/full",
      payload: {
        settings: {
          locale: settingsBody.locale,
          costBasisMethod: settingsBody.costBasisMethod,
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: [
          ...feeConfigBody.feeProfiles.map((profile: { id: string } & Record<string, unknown>) => ({ ...profile })),
          { id: zeroFeeProfile.id, ...zeroFeeProfile },
        ],
        accounts: feeConfigBody.accounts.map((account: { id: string }) => ({
          id: account.id,
          feeProfileRef: zeroFeeProfile.id,
        })),
        feeProfileBindings: [],
      },
    });
    expect(saveFull.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-loss-buy-1" },
      payload: transactionPayload({ quantity: 10, priceNtd: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-loss-buy-2" },
      payload: transactionPayload({ quantity: 10, priceNtd: 120, tradeDate: "2026-01-02" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-loss-sell" },
      payload: transactionPayload({
        quantity: 5,
        priceNtd: 90,
        tradeDate: "2026-01-03",
        type: "SELL" as TransactionType,
      }),
    });

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        symbol: "2330",
        quantity: 15,
        costNtd: 1_650,
      },
    ]);

    const transactionsResponse = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(transactionsResponse.statusCode).toBe(200);
    const sell = transactionsResponse
      .json()
      .find((tx: { type: string; realizedPnlNtd?: number }) => tx.type === "SELL");
    expect(sell?.realizedPnlNtd).toBe(-100);
  });

  it("applies per-symbol fee profile override before account fallback", async () => {
    const settings = await app.inject({ method: "GET", url: "/settings" });
    const settingsBody = settings.json();
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();

    const createdProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Override" }),
    });
    const createdProfile = createdProfileResponse.json();

    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/full",
      payload: {
        settings: {
          locale: settingsBody.locale,
          costBasisMethod: settingsBody.costBasisMethod,
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: [
          ...feeConfigBody.feeProfiles.map((profile: { id: string } & Record<string, unknown>) => ({ ...profile })),
          { id: createdProfile.id, ...createdProfile },
        ],
        accounts: feeConfigBody.accounts.map((account: { id: string; feeProfileId: string }) => ({
          id: account.id,
          feeProfileRef: account.feeProfileId,
        })),
        feeProfileBindings: [
          {
            accountId: feeConfigBody.accounts[0].id,
            symbol: "2330",
            feeProfileRef: createdProfile.id,
          },
        ],
      },
    });
    expect(saveFull.statusCode).toBe(200);

    const createResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-override-fee" },
      payload: transactionPayload({ accountId: feeConfigBody.accounts[0].id, quantity: 1 }),
    });
    expect(createResponse.statusCode).toBe(200);
    const tx = createResponse.json();
    expect(tx.commissionNtd).toBe(0);
    expect(tx.feeSnapshot.id).toBe(createdProfile.id);
  });
});
