import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { confirmRecompute, previewRecompute } from "../../src/services/recompute.js";
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
        amount: -(10 * 100 + store.accounting.facts.tradeEvents[0].commissionAmount),
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
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-01" }),
    });

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-cash-sell" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 130,
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
          amount: -(buyTrade!.quantity * buyTrade!.unitPrice + buyTrade!.commissionAmount + buyTrade!.taxAmount),
        }),
        expect.objectContaining({
          relatedTradeEventId: sellTrade?.id,
          entryType: "TRADE_SETTLEMENT_IN",
          amount: sellTrade!.quantity * sellTrade!.unitPrice - sellTrade!.commissionAmount - sellTrade!.taxAmount,
        }),
      ]),
    );
  });

  it("accepts booked commission and tax overrides and uses them in accounting outputs", async () => {
    const createBuyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-booked-buy-overrides" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 7,
        taxAmount: 3,
      }),
    });
    expect(createBuyResponse.statusCode).toBe(200);
    const buy = createBuyResponse.json();
    expect(buy.commissionAmount).toBe(7);
    expect(buy.taxAmount).toBe(3);
    expect(buy.feeSnapshot.id).toBe("fp-default");

    const buyHoldingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(buyHoldingsResponse.statusCode).toBe(200);
    expect(buyHoldingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        symbol: "2330",
        quantity: 10,
        costBasisAmount: 1_010,
        currency: "TWD",
      },
    ]);

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-booked-sell-overrides" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 130,
        tradeDate: "2026-01-02",
        commissionAmount: 11,
        taxAmount: 13,
        type: "SELL" as TransactionType,
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    const sell = store.accounting.facts.tradeEvents.find((item) => item.type === "SELL");
    expect(sell).toBeDefined();
    expect(sell?.commissionAmount).toBe(11);
    expect(sell?.taxAmount).toBe(13);
    expect(sell?.realizedPnlAmount).toBe(121);
    expect(store.accounting.facts.cashLedgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relatedTradeEventId: buy.id,
          entryType: "TRADE_SETTLEMENT_OUT",
          amount: -1_010,
        }),
        expect.objectContaining({
          relatedTradeEventId: sell?.id,
          entryType: "TRADE_SETTLEMENT_IN",
          amount: 626,
        }),
      ]),
    );
    expect(store.accounting.projections.holdings).toEqual([
      expect.objectContaining({
        accountId: "acc-1",
        symbol: "2330",
        quantity: 5,
        costBasisAmount: 505,
        currency: "TWD",
      }),
    ]);
  });

  it("persists same-day booking sequence and sell-to-lot allocations", async () => {
    const secondBuyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-seq-buy-2" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 120,
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
        unitPrice: 100,
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
        unitPrice: 130,
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
          allocatedCostAmount: 560,
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
      payload: transactionPayload({ quantity: 10, unitPrice: 200 }),
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
    const originalSavePostedTrade = app.persistence.savePostedTrade.bind(app.persistence);
    let failOnce = true;
    app.persistence.savePostedTrade = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("forced save failure");
      }
      return originalSavePostedTrade(...args);
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
        unitPrice: 120,
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
      .find((tx: { type: string; realizedPnlAmount?: number }) => tx.type === "SELL");
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
      .find((tx: { type: string; realizedPnlAmount?: number }) => tx.type === "SELL");
    expect(afterSell).toBeDefined();
    expect(afterSell.realizedPnlAmount).not.toBe(beforeSell.realizedPnlAmount);

    const storeAfter = await app.persistence.loadStore("user-1");
    const sellTradeAfter = storeAfter.accounting.facts.tradeEvents.find((tx) => tx.type === "SELL");
    const sellCashAfter = storeAfter.accounting.facts.cashLedgerEntries.find(
      (entry) => entry.relatedTradeEventId === sellTradeAfter?.id,
    );
    expect(sellCashAfter).toBeDefined();
    expect(sellCashAfter?.amount).not.toBe(sellCashBefore?.amount);
    expect(sellCashAfter?.amount).toBe(
      sellTradeAfter!.quantity * sellTradeAfter!.unitPrice - sellTradeAfter!.commissionAmount - sellTradeAfter!.taxAmount,
    );
  });

  it("recompute derives sell realized pnl from canonical lot allocations instead of stale trade state", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stale-pnl-buy" },
      payload: transactionPayload(),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stale-pnl-sell" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 120,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    const persisted = await app.persistence.loadStore("user-1");
    persisted.feeProfiles.push({
      id: "fp-zero",
      name: "Zero Fee",
      boardCommissionRate: 0,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 0,
      commissionCurrency: "TWD",
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 0,
      stockDayTradeTaxRateBps: 0,
      etfSellTaxRateBps: 0,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    });

    const sellTrade = persisted.accounting.facts.tradeEvents.find((tx) => tx.type === "SELL");
    expect(sellTrade).toBeDefined();
    sellTrade!.realizedPnlAmount = 999_999;

    const job = previewRecompute(persisted, {
      userId: "user-1",
      profileId: "fp-zero",
      useFallbackBindings: true,
    });
    confirmRecompute(persisted, "user-1", job.id);

    expect(sellTrade?.commissionAmount).toBe(0);
    expect(sellTrade?.taxAmount).toBe(0);
    expect(sellTrade?.realizedPnlAmount).toBe(90);
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
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-buy-2" },
      payload: transactionPayload({ quantity: 10, unitPrice: 120, tradeDate: "2026-01-02" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-sell" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 130,
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
        costBasisAmount: 1_650,
        currency: "TWD",
      },
    ]);

    const transactionsResponse = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(transactionsResponse.statusCode).toBe(200);
    const sell = transactionsResponse
      .json()
      .find((tx: { type: string; realizedPnlAmount?: number }) => tx.type === "SELL");
    expect(sell?.realizedPnlAmount).toBe(100);
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
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-loss-buy-2" },
      payload: transactionPayload({ quantity: 10, unitPrice: 120, tradeDate: "2026-01-02" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-wa-loss-sell" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 90,
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
        costBasisAmount: 1_650,
        currency: "TWD",
      },
    ]);

    const transactionsResponse = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(transactionsResponse.statusCode).toBe(200);
    const sell = transactionsResponse
      .json()
      .find((tx: { type: string; realizedPnlAmount?: number }) => tx.type === "SELL");
    expect(sell?.realizedPnlAmount).toBe(-100);
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
    expect(tx.commissionAmount).toBe(0);
    expect(tx.feeSnapshot.id).toBe(createdProfile.id);
  });

  it("rejects negative booked commission or tax overrides", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-invalid-booked-override" },
      payload: transactionPayload({
        commissionAmount: -1,
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "validation_error",
      issues: [
        {
          path: "commissionAmount",
          message: "Number must be greater than or equal to 0",
        },
      ],
    });
  });
});
