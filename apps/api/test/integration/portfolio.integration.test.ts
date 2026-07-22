import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createDividendEvent } from "../../src/services/dividends.js";
import { confirmRecompute, previewRecompute } from "../../src/services/recompute.js";
import type { DividendLedgerEntry } from "../../src/types/store.js";
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
        ticker: "2330",
        quantity: 10,
      }),
    ]);
    expect(store.accounting.policy).toEqual({
      inventoryModel: "LOT_CAPABLE",
      disposalPolicy: "WEIGHTED_AVERAGE",
    });
  });

  it("accepts decimal booked charges with up to 4 decimal places on create", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-decimal-create" },
      payload: transactionPayload({
        commissionAmount: 1.2345,
        taxAmount: 0.6789,
      }),
    });
    expect(createResponse.statusCode).toBe(200);

    expect(createResponse.json()).toMatchObject({
      commissionAmount: 1.2345,
      taxAmount: 0.6789,
    });

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents[0]).toMatchObject({
      commissionAmount: 1.2345,
      taxAmount: 0.6789,
    });
    expect(store.accounting.facts.cashLedgerEntries[0]).toEqual(
      expect.objectContaining({
        amount: -(10 * 100 + 1.2345 + 0.6789),
      }),
    );
  });

  it("rejects create booked charges with more than 4 decimal places", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-decimal-create-invalid" },
      payload: transactionPayload({
        commissionAmount: 1.23456,
      }),
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json()).toMatchObject({
      error: "validation_error",
    });
    expect(createResponse.body).toContain("at most 4 decimal places");
  });

  it("creates provisional symbols for unknown tickers and filters transaction history newest first", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-provisional-1" },
      payload: transactionPayload({
        ticker: "qa-test",
        quantity: 2,
        tradeDate: "2026-01-01",
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-provisional-2" },
      payload: transactionPayload({
        ticker: "qa-test",
        quantity: 3,
        tradeDate: "2026-01-02",
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-provisional-3" },
      payload: transactionPayload({
        ticker: "2330",
        quantity: 1,
        tradeDate: "2026-01-03",
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    expect(store.instruments).toContainEqual(
      expect.objectContaining({
        ticker: "QA-TEST",
        type: "STOCK",
        marketCode: "TW",
        isProvisional: true,
        lastSyncedAt: null,
      }),
    );

    const historyResponse = await app.inject({
      method: "GET",
      url: "/portfolio/transactions?ticker=qa-test&accountId=acc-1",
    });
    expect(historyResponse.statusCode).toBe(200);
    // KZO-183 D4: the seeded default profile uses randomUUID() — assert
    // against the live store's seeded id instead of a literal.
    const seededStore = await app.persistence.loadStore("user-1");
    const seededProfileId = seededStore.feeProfiles[0]!.id;
    expect(historyResponse.json()).toEqual([
      expect.objectContaining({
        ticker: "QA-TEST",
        tradeDate: "2026-01-02",
        feeProfileId: seededProfileId,
        feeProfileName: "Default Broker",
      }),
      expect.objectContaining({
        ticker: "QA-TEST",
        tradeDate: "2026-01-01",
        feeProfileId: seededProfileId,
        feeProfileName: "Default Broker",
      }),
    ]);
  });

  it("filters ticker transaction history by market code", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "US Brokerage",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const usdAccount = accountResponse.json() as { id: string };

    const twTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-market-filter-tw" },
      payload: transactionPayload({
        ticker: "ABC",
        marketCode: "TW",
        priceCurrency: "TWD",
        tradeDate: "2026-01-01",
      }),
    });
    expect(twTrade.statusCode).toBe(200);

    const usTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-market-filter-us" },
      payload: transactionPayload({
        accountId: usdAccount.id,
        ticker: "ABC",
        marketCode: "US",
        priceCurrency: "USD",
        tradeDate: "2026-01-02",
      }),
    });
    expect(usTrade.statusCode).toBe(200);

    const usHistoryResponse = await app.inject({
      method: "GET",
      url: "/portfolio/transactions?ticker=abc&marketCode=US",
    });
    expect(usHistoryResponse.statusCode).toBe(200);
    expect(usHistoryResponse.json()).toEqual([
      expect.objectContaining({ ticker: "ABC", marketCode: "US", accountId: usdAccount.id }),
    ]);

    const twHistoryResponse = await app.inject({
      method: "GET",
      url: "/portfolio/transactions?ticker=abc&marketCode=TW",
    });
    expect(twHistoryResponse.statusCode).toBe(200);
    expect(twHistoryResponse.json()).toEqual([
      expect.objectContaining({ ticker: "ABC", marketCode: "TW", accountId: "acc-1" }),
    ]);
  });

  it("filters ticker transaction history by multiple account ids", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "Second Brokerage",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const secondAccount = accountResponse.json() as { id: string };

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-account-filter-1" },
      payload: transactionPayload({
        accountId: "acc-1",
        ticker: "MULTI",
        tradeDate: "2026-01-01",
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-account-filter-2" },
      payload: transactionPayload({
        accountId: secondAccount.id,
        ticker: "MULTI",
        tradeDate: "2026-01-02",
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-account-filter-other" },
      payload: transactionPayload({
        accountId: "acc-1",
        ticker: "OTHER",
        tradeDate: "2026-01-03",
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: `/portfolio/transactions?ticker=multi&accountIds=acc-1,${secondAccount.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ ticker: "MULTI", accountId: secondAccount.id }),
      expect.objectContaining({ ticker: "MULTI", accountId: "acc-1" }),
    ]);
  });

  it("supports limiting transaction history without changing newest-first ordering", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-limit-1" },
      payload: transactionPayload({
        tradeDate: "2026-01-01",
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-limit-2" },
      payload: transactionPayload({
        tradeDate: "2026-01-02",
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-limit-3" },
      payload: transactionPayload({
        tradeDate: "2026-01-03",
      }),
    });

    const historyResponse = await app.inject({
      method: "GET",
      url: "/portfolio/transactions?limit=2",
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toEqual([
      expect.objectContaining({ tradeDate: "2026-01-03" }),
      expect.objectContaining({ tradeDate: "2026-01-02" }),
    ]);
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

  it("returns realized pnl breakdown math for sell rows and null for buy rows", async () => {
    const zeroFeeProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Breakdown" }),
    });
    expect(zeroFeeProfileResponse.statusCode).toBe(200);
    const zeroFeeProfile = zeroFeeProfileResponse.json();

    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: "acc-1", feeProfileId: zeroFeeProfile.id }],
        feeProfileBindings: [],
      },
    });
    expect(saveFull.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-buy-1" },
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-buy-2" },
      payload: transactionPayload({ quantity: 10, unitPrice: 120, tradeDate: "2026-01-02" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-sell" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 130,
        tradeDate: "2026-01-03",
        type: "SELL" as TransactionType,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(response.statusCode).toBe(200);

    const transactions = response.json() as Array<{
      type: string;
      realizedPnlBreakdown: Record<string, unknown> | null;
    }>;

    const sell = transactions.find((tx) => tx.type === "SELL");
    expect(sell?.realizedPnlBreakdown).toEqual({
      status: "available",
      currency: "TWD",
      preSaleOpenQuantity: 20,
      preSaleOpenCostAmount: 2200,
      exactAverageCostPerShare: 110,
      roundedAverageCostPerShare: 110,
      allocatedCostAmount: 550,
      grossProceedsAmount: 650,
      commissionAmount: 0,
      taxAmount: 0,
      netProceedsAmount: 650,
      realizedPnlAmount: 100,
    });

    const buy = transactions.find((tx) => tx.type === "BUY");
    expect(buy?.realizedPnlBreakdown).toBeNull();
  });

  it("marks realized pnl breakdown unavailable when replay finds insufficient quantity", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-insufficient-buy" },
      payload: transactionPayload({ quantity: 3, unitPrice: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-insufficient-sell" },
      payload: transactionPayload({
        quantity: 2,
        unitPrice: 120,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    const buy = store.accounting.facts.tradeEvents.find((trade) => trade.type === "BUY");
    if (!buy) {
      throw new Error("expected seeded buy trade");
    }
    buy.quantity = 1;
    await app.persistence.saveStore(store);

    const response = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(response.statusCode).toBe(200);

    const sell = (response.json() as Array<{
      type: string;
      realizedPnlBreakdown: Record<string, unknown> | null;
    }>).find((tx) => tx.type === "SELL");

    expect(sell?.realizedPnlBreakdown).toEqual({
      status: "unavailable",
      currency: "TWD",
      reason: "insufficient_quantity",
    });
  });

  it("marks realized pnl breakdown unavailable on trade-currency mismatch", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-currency-buy" },
      payload: transactionPayload({ quantity: 3, unitPrice: 100, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-breakdown-currency-sell" },
      payload: transactionPayload({
        quantity: 2,
        unitPrice: 120,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    const buy = store.accounting.facts.tradeEvents.find((trade) => trade.type === "BUY");
    if (!buy) {
      throw new Error("expected seeded buy trade");
    }
    buy.priceCurrency = "USD";
    await app.persistence.saveStore(store);

    const response = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(response.statusCode).toBe(200);

    const sell = (response.json() as Array<{
      type: string;
      realizedPnlBreakdown: Record<string, unknown> | null;
    }>).find((tx) => tx.type === "SELL");

    expect(sell?.realizedPnlBreakdown).toEqual({
      status: "unavailable",
      currency: "TWD",
      reason: "currency_mismatch",
    });
  });

  it("returns authoritative sell availability including same-day sells, stock dividends, and splits before the proposed booking", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-sell-availability-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-02",
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push({
      id: "same-day-earlier-sell",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 4,
      unitPrice: 120,
      priceCurrency: "TWD",
      tradeDate: "2026-01-05",
      tradeTimestamp: "2026-01-05T09:00:00.000Z",
      bookingSequence: 1,
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    store.accounting.facts.positionActions.push(
      {
        id: "same-day-split",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-01-05",
        actionTimestamp: "2026-01-05T08:00:00.000Z",
        quantity: 0,
        ratioNumerator: 2,
        ratioDenominator: 1,
        source: "test",
      },
      {
        id: "same-day-stock-dividend",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        actionType: "STOCK_DIVIDEND",
        actionDate: "2026-01-05",
        actionTimestamp: "2026-01-05T09:30:00.000Z",
        quantity: 3,
        source: "test",
      },
    );
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=acc-1&ticker=2330&marketCode=TW&tradeDate=2026-01-05&tradeTimestamp=2026-01-05T10:00:00.000Z",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      tradeDate: "2026-01-05",
      availableQuantity: 19,
    });
  });

  it("uses the committed midnight timestamp when sell availability omits a timestamp", async () => {
    const buy = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-sell-availability-midnight-buy" },
      payload: transactionPayload({
        ticker: "MIDNIGHT",
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-05",
        tradeTimestamp: "2026-01-05T10:00:00.000Z",
      }),
    });
    expect(buy.statusCode).toBe(200);

    const availability = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=acc-1&ticker=MIDNIGHT&marketCode=TW&tradeDate=2026-01-05",
    });
    expect(availability.statusCode).toBe(200);
    expect(availability.json()).toMatchObject({
      status: "ready",
      tradeTimestamp: "2026-01-05T00:00:00.000Z",
      availableQuantity: 0,
    });

    const sell = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-sell-availability-midnight-sell" },
      payload: transactionPayload({
        ticker: "MIDNIGHT",
        quantity: 1,
        unitPrice: 110,
        tradeDate: "2026-01-05",
        type: "SELL" as TransactionType,
      }),
    });
    expect(sell.statusCode).toBe(409);
    expect(sell.json()).toMatchObject({
      error: "insufficient_quantity",
      metadata: {
        requestedQuantity: 1,
        availableQuantity: 0,
      },
    });
  });

  it("returns account_not_found when sell availability targets an unknown account", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=missing-account&ticker=2330&marketCode=TW&tradeDate=2026-01-05",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "account_not_found",
      message: "Account not found",
    });
  });

  it("rejects stale oversells with stable requested and available quantities", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stale-oversell-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-01",
      }),
    });

    const preview = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=acc-1&ticker=2330&marketCode=TW&tradeDate=2026-01-02",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ status: "ready", availableQuantity: 10 });

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stale-oversell-existing-sell" },
      payload: transactionPayload({
        quantity: 7,
        unitPrice: 110,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stale-oversell-submit" },
      payload: transactionPayload({
        quantity: 8,
        unitPrice: 111,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "insufficient_quantity",
      metadata: {
        requestedQuantity: 8,
        availableQuantity: 3,
      },
    });
  });

  it("serializes concurrent same-position sells at the persistence boundary", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-concurrent-sell-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-01",
      }),
    });

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "k-concurrent-sell-a" },
        payload: transactionPayload({
          quantity: 6,
          unitPrice: 110,
          tradeDate: "2026-01-02",
          type: "SELL" as TransactionType,
        }),
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "k-concurrent-sell-b" },
        payload: transactionPayload({
          quantity: 6,
          unitPrice: 111,
          tradeDate: "2026-01-02",
          type: "SELL" as TransactionType,
        }),
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort((left, right) => left - right)).toEqual([200, 409]);
    const rejected = [first, second].find((response) => response.statusCode === 409);
    expect(rejected?.json()).toMatchObject({
      error: "insufficient_quantity",
      metadata: {
        requestedQuantity: 6,
        availableQuantity: 4,
      },
    });

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents.filter((trade) => trade.type === "SELL")).toHaveLength(1);
  });

  it("preserves concurrent transaction writes for different position tuples", async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "k-concurrent-different-tuple-2330" },
        payload: transactionPayload({ ticker: "2330", quantity: 2 }),
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "k-concurrent-different-tuple-0050" },
        payload: transactionPayload({ ticker: "0050", quantity: 3 }),
      }),
    ]);

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const transactionIds = [first.json().id as string, second.json().id as string];
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents.filter((trade) => transactionIds.includes(trade.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: transactionIds[0], ticker: "2330", quantity: 2 }),
        expect.objectContaining({ id: transactionIds[1], ticker: "0050", quantity: 3 }),
      ]),
    );
  });

  it("preserves concurrent transaction writes for different accounts", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "Second Brokerage",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const secondAccountId = accountResponse.json().id as string;

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "k-concurrent-different-account-primary" },
        payload: transactionPayload({ accountId: "acc-1", quantity: 2 }),
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "k-concurrent-different-account-secondary" },
        payload: transactionPayload({ accountId: secondAccountId, quantity: 3 }),
      }),
    ]);

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const transactionIds = [first.json().id as string, second.json().id as string];
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents.filter((trade) => transactionIds.includes(trade.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: transactionIds[0], accountId: "acc-1", quantity: 2 }),
        expect.objectContaining({ id: transactionIds[1], accountId: secondAccountId, quantity: 3 }),
      ]),
    );
  });

  it("fails closed when a backdated sell would invalidate a later booked sell", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-backdated-invalidates-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-01",
      }),
    });

    const existingSell = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-backdated-invalidates-existing-sell" },
      payload: transactionPayload({
        quantity: 8,
        unitPrice: 120,
        tradeDate: "2026-01-05",
        type: "SELL" as TransactionType,
      }),
    });
    expect(existingSell.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-backdated-invalidates-submit" },
      payload: transactionPayload({
        quantity: 3,
        unitPrice: 115,
        tradeDate: "2026-01-02",
        type: "SELL" as TransactionType,
      }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "sell_availability_unavailable",
      metadata: {
        reason: "unreplayable_history",
      },
    });

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.tradeEvents.filter((trade) => trade.type === "SELL")).toHaveLength(1);
  });

  it("fails closed when sell availability cannot replay the authoritative history", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-unreplayable-history-buy" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 100,
        tradeDate: "2026-01-01",
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.positionActions.push({
      id: "invalid-fractional-split",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      actionType: "SPLIT",
      actionDate: "2026-01-02",
      quantity: 0,
      ratioNumerator: 3,
      ratioDenominator: 2,
      cashInLieuAmount: 0,
      source: "test",
    });
    await app.persistence.saveStore(store);

    const availability = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=acc-1&ticker=2330&marketCode=TW&tradeDate=2026-01-03",
    });
    expect(availability.statusCode).toBe(200);
    expect(availability.json()).toMatchObject({
      status: "unavailable",
      reason: "unreplayable_history",
    });

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-unreplayable-history-sell" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 120,
        tradeDate: "2026-01-03",
        type: "SELL" as TransactionType,
      }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "sell_availability_unavailable",
      metadata: {
        reason: "unreplayable_history",
      },
    });
  });

  it("returns a stable conflict when a BUY cannot replay existing position history", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push({
      id: "existing-oversell-before-buy",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-01",
      tradeTimestamp: "2026-01-01T00:00:00.000Z",
      bookingSequence: 1,
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-unreplayable-buy-submit" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 110,
        tradeDate: "2026-01-03",
      }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "position_history_unreplayable",
      metadata: {
        reason: "unreplayable_history",
      },
    });
    const persisted = await app.persistence.loadStore("user-1");
    expect(persisted.accounting.facts.tradeEvents).toHaveLength(1);
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
    // KZO-183 D4: seeded profile id is a UUID. Assert via the live store.
    const seededIdForBuy = (await app.persistence.loadStore("user-1")).feeProfiles[0]!.id;
    expect(buy.feeSnapshot.id).toBe(seededIdForBuy);

    const buyHoldingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(buyHoldingsResponse.statusCode).toBe(200);
    expect(buyHoldingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        ticker: "2330",
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
        ticker: "2330",
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
      .filter((lot) => lot.ticker === "2330")
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

  it("[transactions]: selling after closing an earlier lot → preserves historical lot allocation references", async () => {
    const firstBuyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-closed-lot-buy-1" },
      payload: transactionPayload({
        quantity: 35,
        unitPrice: 575,
        tradeDate: "2026-06-01",
        tradeTimestamp: "2026-06-01T09:00:01.000Z",
        bookingSequence: 1,
      }),
    });
    expect(firstBuyResponse.statusCode).toBe(200);

    const secondBuyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-closed-lot-buy-2" },
      payload: transactionPayload({
        quantity: 50,
        unitPrice: 582,
        tradeDate: "2026-06-02",
        tradeTimestamp: "2026-06-02T09:00:01.000Z",
        bookingSequence: 1,
      }),
    });
    expect(secondBuyResponse.statusCode).toBe(200);

    const firstSellResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-closed-lot-sell-1" },
      payload: transactionPayload({
        quantity: 45,
        unitPrice: 590,
        tradeDate: "2026-06-11",
        tradeTimestamp: "2026-06-11T09:00:01.000Z",
        bookingSequence: 1,
        type: "SELL" as TransactionType,
      }),
    });
    expect(firstSellResponse.statusCode).toBe(200);

    const secondSellResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-closed-lot-sell-2" },
      payload: transactionPayload({
        quantity: 30,
        unitPrice: 610,
        tradeDate: "2026-07-02",
        tradeTimestamp: "2026-07-02T09:00:01.000Z",
        bookingSequence: 1,
        type: "SELL" as TransactionType,
      }),
    });
    expect(secondSellResponse.statusCode).toBe(200);

    const firstBuy = firstBuyResponse.json();
    const secondBuy = secondBuyResponse.json();
    const firstSell = firstSellResponse.json();
    const secondSell = secondSellResponse.json();
    const store = await app.persistence.loadStore("user-1");
    const lots = store.accounting.projections.lots
      .filter((lot) => lot.ticker === "2330")
      .sort((a, b) => (a.openedSequence ?? 0) - (b.openedSequence ?? 0));

    expect(lots).toEqual([
      expect.objectContaining({ id: `lot-${firstBuy.id}`, openQuantity: 0 }),
      expect.objectContaining({ id: `lot-${secondBuy.id}`, openQuantity: 10 }),
    ]);
    expect(store.accounting.projections.lotAllocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tradeEventId: firstSell.id,
          lotId: `lot-${firstBuy.id}`,
          allocatedQuantity: 35,
        }),
        expect.objectContaining({
          tradeEventId: secondSell.id,
          lotId: `lot-${secondBuy.id}`,
          allocatedQuantity: 30,
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
    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json()).toMatchObject({
      error: "duplicate_booking_sequence",
      message: "Booking sequence already exists for the same account and trade date",
    });
  });

  it("previews and confirms recompute", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k2" },
      payload: transactionPayload({ quantity: 10, unitPrice: 200 }),
    });

    // KZO-183 D4: seeded default profile id is a UUID; resolve from store.
    const seededRecomputeProfile = (await app.persistence.loadStore("user-1")).feeProfiles[0]!.id;
    const preview = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/preview",
      payload: { profileId: seededRecomputeProfile },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();
    expect(previewBody).toMatchObject({
      mode: "KEEP_RECORDED",
      counts: { total: 1, calculated: 1, preserved: 1, changed: 0 },
    });

    const confirm = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/confirm",
      payload: { jobId: previewBody.id, fingerprint: previewBody.fingerprint },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe("CONFIRMED");
  });

  it("allows only one concurrent confirmation and keeps the durable job confirmed", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "recompute-race-trade" },
      payload: transactionPayload(),
    });
    const preview = await app.inject({ method: "POST", url: "/portfolio/recompute/preview", payload: {} });
    const reviewed = preview.json();

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/portfolio/recompute/confirm",
        payload: { jobId: reviewed.jobId, fingerprint: reviewed.fingerprint },
      }),
      app.inject({
        method: "POST",
        url: "/portfolio/recompute/confirm",
        payload: { jobId: reviewed.jobId, fingerprint: reviewed.fingerprint },
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const rejected = responses.find((response) => response.statusCode === 409)!;
    expect(rejected.json()).toMatchObject({ error: "recompute_preview_consumed" });
    const persisted = await app.persistence.loadStore("user-1");
    expect(persisted.recomputeJobs.find((job) => job.id === reviewed.jobId)?.status).toBe("CONFIRMED");
  });

  it("recompute confirm materializes missing expected dividends and retires stale expected rows nondestructively", async () => {
    const buyResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "recompute-dividend-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 200,
        tradeDate: "2026-01-05",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(buyResponse.statusCode).toBe(200);

    const sellResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "recompute-dividend-sell" },
      payload: transactionPayload({
        type: "SELL",
        quantity: 10,
        unitPrice: 220,
        tradeDate: "2026-02-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(sellResponse.statusCode).toBe(200);

    const store = await app.persistence.loadStore("user-1");
    const earlyEvent = createDividendEvent(store, {
      id: "recompute-expected-create",
      ticker: "2330",
      marketCode: "TW",
      eventType: "STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 0,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0.085,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: 5,
      stockParValueCurrency: "TWD",
      source: "test",
    });
    const lateEvent = createDividendEvent(store, {
      id: "recompute-expected-retire",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-01",
      paymentDate: "2026-03-20",
      cashDividendPerShare: 3,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    });
    const staleExpected: DividendLedgerEntry = {
      id: "stale-recompute-expected",
      accountId: "acc-1",
      dividendEventId: lateEvent.id,
      eligibleQuantity: 10,
      expectedCashAmount: 30,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "unknown_pending_disclosure",
      bookedAt: "2026-02-20T00:00:00.000Z",
    };
    store.accounting.facts.dividendLedgerEntries.push(staleExpected);
    await app.persistence.saveStore(store);

    const seededRecomputeProfile = store.feeProfiles[0]!.id;
    const preview = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/preview",
      payload: { profileId: seededRecomputeProfile },
    });
    expect(preview.statusCode).toBe(200);

    const confirm = await app.inject({
      method: "POST",
      url: "/portfolio/recompute/confirm",
      payload: { jobId: preview.json().id, fingerprint: preview.json().fingerprint },
    });
    expect(confirm.statusCode).toBe(200);

    const updatedStore = await app.persistence.loadStore("user-1");
    const createdExpected = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.dividendEventId === earlyEvent.id && !entry.supersededAt,
    );
    const retiredExpected = updatedStore.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === staleExpected.id,
    );

    expect(createdExpected).toMatchObject({
      accountId: "acc-1",
      postingStatus: "expected",
      eligibleQuantity: 10,
      expectedCashAmount: 0,
      expectedStockQuantity: 0,
      expectedStockCalcState: "needs_action",
      expectedStockDistributionRatio: null,
      expectedStockParValueAmount: 5,
      reconciliationStatus: "open",
    });
    expect(retiredExpected?.supersededAt).toEqual(expect.any(String));
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
      payload: transactionPayload({ accountId: "missing-account", quantity: 1 }),
    });
    expect(first.statusCode).toBe(404);

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
    expect(transactions.json()[0].feeProfileName).toBe(profile.name);
  });

  it("releases idempotency key when persistence fails", async () => {
    const originalWriteLock = app.persistence.withTransactionWriteLock.bind(app.persistence);
    let failOnce = true;
    app.persistence.withTransactionWriteLock = (async (ownerUserId, execute) => originalWriteLock(
      ownerUserId,
      async (writer) => execute({
        ...writer,
        saveReplayedPositionScope: async (...args) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("forced save failure");
          }
          return writer.saveReplayedPositionScope(...args);
        },
      }),
    )) as typeof app.persistence.withTransactionWriteLock;

    try {
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
    } finally {
      app.persistence.withTransactionWriteLock = originalWriteLock;
    }
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
      payload: { profileId: createdProfile.id, mode: "RECALCULATE_CALCULATED" },
    });
    const previewBody = preview.json();
    await app.inject({
      method: "POST",
      url: "/portfolio/recompute/confirm",
      payload: { jobId: previewBody.id, fingerprint: previewBody.fingerprint },
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
      // KZO-183: profile owned by the memory-seeded "acc-1" account.
      accountId: "acc-1",
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
      mode: "RECALCULATE_CALCULATED",
    });
    await confirmRecompute(persisted, "user-1", job.id, job.fingerprint);

    const recomputedSell = persisted.accounting.facts.tradeEvents.find((tx) => tx.type === "SELL");
    expect(recomputedSell?.commissionAmount).toBe(0);
    expect(recomputedSell?.taxAmount).toBe(0);
    expect(recomputedSell?.realizedPnlAmount).toBe(100);
  });

  it("uses weighted-average cost basis for partial sells", async () => {
    // ui-reshape Phase 3d S8 — `PUT /settings/full` retired. Replaced by
    // POST /fee-profiles (which creates the profile scoped to acc-1) plus
    // PUT /settings/fee-config to swap acc-1's fee_profile_id onto it.
    const zeroFeeProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Weighted Average" }),
    });
    expect(zeroFeeProfileResponse.statusCode).toBe(200);
    const zeroFeeProfile = zeroFeeProfileResponse.json();

    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: "acc-1", feeProfileId: zeroFeeProfile.id }],
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
        ticker: "2330",
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
    // ui-reshape Phase 3d S8 — `PUT /settings/full` retired; see note above.
    const zeroFeeProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Weighted Average Loss" }),
    });
    expect(zeroFeeProfileResponse.statusCode).toBe(200);
    const zeroFeeProfile = zeroFeeProfileResponse.json();

    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: "acc-1", feeProfileId: zeroFeeProfile.id }],
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
        ticker: "2330",
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
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();

    const createdProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Override" }),
    });
    const createdProfile = createdProfileResponse.json();

    // ui-reshape Phase 3d S8 — `PUT /settings/full` retired. Per-symbol
    // override is now set through PUT /settings/fee-config; account-level
    // assignments are preserved verbatim.
    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: feeConfigBody.accounts.map((account: { id: string; feeProfileId: string }) => ({
          id: account.id,
          feeProfileId: account.feeProfileId,
        })),
        feeProfileBindings: [
          {
            accountId: feeConfigBody.accounts[0].id,
            ticker: "2330",
            feeProfileId: createdProfile.id,
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

  it("accepts decimal unit prices for ETF trades and computes correct cost basis", async () => {
    // ui-reshape Phase 3d S8 — `PUT /settings/full` retired; see note above.
    const zeroFeeProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Zero Fee Decimal" }),
    });
    const zeroFeeProfile = zeroFeeProfileResponse.json();

    await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: "acc-1", feeProfileId: zeroFeeProfile.id }],
        feeProfileBindings: [],
      },
    });

    const buy1 = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-decimal-buy-1" },
      payload: transactionPayload({ ticker: "0050", quantity: 3, unitPrice: 152.35, tradeDate: "2026-01-01" }),
    });
    expect(buy1.statusCode).toBe(200);
    expect(buy1.json().unitPrice).toBe(152.35);

    const buy2 = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-decimal-buy-2" },
      payload: transactionPayload({ ticker: "0050", quantity: 2, unitPrice: 153.80, tradeDate: "2026-01-02" }),
    });
    expect(buy2.statusCode).toBe(200);

    const holdings = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdings.statusCode).toBe(200);
    // Cost = 3 * 152.35 + 2 * 153.80 = 457.05 + 307.60 = 764.65
    expect(holdings.json()).toEqual([
      expect.objectContaining({
        ticker: "0050",
        quantity: 5,
        costBasisAmount: 764.65,
      }),
    ]);

    const sell = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-decimal-sell" },
      payload: transactionPayload({
        ticker: "0050",
        quantity: 2,
        unitPrice: 155.50,
        tradeDate: "2026-01-03",
        type: "SELL" as TransactionType,
      }),
    });
    expect(sell.statusCode).toBe(200);
    expect(sell.json().unitPrice).toBe(155.50);
    expect(sell.json().realizedPnlAmount).toBeDefined();
  });

  it("rejects unit prices with more than 2 decimal places", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-too-precise" },
      payload: transactionPayload({ unitPrice: 152.355 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "validation_error",
    });
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
          message: "Commission must be a non-negative finite number with at most 4 decimal places",
        },
      ],
    });
  });
});
