import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { McpRequestContext, McpToolHandlerContext } from "../../src/mcp/types.js";
import {
  amendDividendReceipt,
  getDividendReview,
  postDividendReceipt,
  previewAmendDividendReceipt,
  previewPostDividendReceipt,
  previewUpdateDividendReconciliation,
  updateDividendReconciliation,
} from "../../src/services/mcpDividends.js";
import type { BookedTradeEvent, DividendEvent, DividendEventType, DividendLedgerEntry } from "../../src/types/store.js";

const USER_ID = "user-1";

let app: AppInstance;

function requestContext(): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: USER_ID,
      connection: null,
      scopes: ["portfolio:mcp_read", "dividend:write"],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: USER_ID,
      portfolioContextUserId: USER_ID,
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "mcp-dividend-service-test",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

function serviceContext(): McpToolHandlerContext {
  return {
    app,
    requestContext: requestContext(),
  };
}

async function seedExpectedDividendRow(options: {
  ticker?: string;
  marketCode?: BookedTradeEvent["marketCode"];
  eventType?: DividendEventType;
  instrumentType?: BookedTradeEvent["instrumentType"];
  cashDividendPerShare?: number;
  cashDividendCurrency?: DividendEvent["cashDividendCurrency"];
  stockDividendPerShare?: number;
  stockParValueAmount?: number;
  paymentDate?: string | null;
  materializeLedgerEntry?: boolean;
} = {}): Promise<string> {
  const store = await app.persistence.loadStore(USER_ID);
  const account = store.accounts[0]!;
  const cashDividendCurrency: typeof account.defaultCurrency = (options.cashDividendCurrency ?? "TWD") as typeof account.defaultCurrency;
  const marketCode = options.marketCode ?? "TW";
  account.defaultCurrency = cashDividendCurrency;
  const ticker = options.ticker ?? "2330";
  const instrumentType = options.instrumentType ?? "STOCK";
  store.instruments = store.instruments.filter((entry) => entry.ticker !== ticker || entry.marketCode !== marketCode);
  store.instruments.push({
    ticker,
    marketCode,
    type: instrumentType,
    name: `${ticker} test instrument`,
  });
  const trade: BookedTradeEvent = {
    id: randomUUID(),
    userId: USER_ID,
    accountId: account.id,
    ticker,
    marketCode,
    instrumentType,
    type: "BUY",
    quantity: 1000,
    unitPrice: 100,
    priceCurrency: cashDividendCurrency,
    tradeDate: "2024-05-20",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: store.feeProfiles[0]!,
  };
  const paymentDate = options.paymentDate === undefined ? "2024-07-10" : options.paymentDate;
  const dividendEvent: DividendEvent = {
    id: randomUUID(),
    ticker,
    marketCode,
    eventType: options.eventType ?? "CASH",
    exDividendDate: "2024-06-01",
    paymentDate,
    cashDividendPerShare: options.cashDividendPerShare ?? 3,
    cashDividendCurrency,
    stockDividendPerShare: options.stockDividendPerShare ?? 0,
    stockDistributionAmountRaw: options.stockDividendPerShare ?? 0,
    stockDistributionRatio: (options.stockDividendPerShare ?? 0) > 0
      ? options.stockDividendPerShare!
      : null,
    stockDistributionRatioState: (options.stockDividendPerShare ?? 0) > 0
      ? "authoritative"
      : "unresolved",
    stockParValueAmount: options.stockParValueAmount ?? null,
    stockParValueCurrency: options.stockParValueAmount === undefined ? null : cashDividendCurrency,
    source: "test_seed",
  };
  store.accounting.facts.tradeEvents.push(trade);
  store.marketData.dividendEvents.push(dividendEvent);

  if (options.materializeLedgerEntry) {
    const ledgerEntry: DividendLedgerEntry = {
      id: randomUUID(),
      accountId: account.id,
      dividendEventId: dividendEvent.id,
      eligibleQuantity: 1000,
      expectedCashAmount: Math.round(1000 * dividendEvent.cashDividendPerShare),
      expectedStockQuantity: Math.floor(1000 * dividendEvent.stockDividendPerShare),
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "unknown_pending_disclosure",
      reconciliationNote: undefined,
      bookedAt: new Date("2024-07-01T00:00:00.000Z").toISOString(),
    };
    store.accounting.facts.dividendLedgerEntries.push(ledgerEntry);
  }

  const review = await app.persistence.listDividendReviewRows(USER_ID, {
    page: 1,
    limit: 50,
    sortBy: "paymentDate",
    sortOrder: "desc",
  });
  const expectedRowId = `expected:${account.id}:${dividendEvent.id}`;
  const row = options.materializeLedgerEntry
    ? review.rows.find((candidate) => candidate.dividendEventId === dividendEvent.id && candidate.postingStatus === "expected")
    : review.rows.find((candidate) => candidate.id === expectedRowId);
  expect(row).toEqual(expect.objectContaining({
    rowKind: options.materializeLedgerEntry ? "ledger" : "expected",
    postingStatus: "expected",
  }));
  return row!.id;
}

async function postSeededReceipt(rowId: string, idempotencyKey = `mcp-dividend-${randomUUID()}`) {
  const preview = await previewPostDividendReceipt(serviceContext(), { rowId });
  return postDividendReceipt(serviceContext(), {
    rowId,
    confirmationSummary: preview.confirmationSummary,
    confirmationDigest: preview.confirmationDigest,
    idempotencyKey,
  });
}

async function seedLaterCashDividendLedger(): Promise<string> {
  const store = await app.persistence.loadStore(USER_ID);
  const account = store.accounts[0]!;
  const dividendEvent: DividendEvent = {
    id: randomUUID(),
    ticker: "2330",
    marketCode: "TW",
    eventType: "CASH",
    exDividendDate: "2024-08-01",
    paymentDate: "2024-08-10",
    cashDividendPerShare: 2,
    cashDividendCurrency: "TWD",
    stockDividendPerShare: 0,
    stockDistributionAmountRaw: 0,
    stockDistributionRatio: null,
    stockDistributionRatioState: "unresolved",
    stockParValueAmount: null,
    stockParValueCurrency: null,
    source: "test_seed",
  };
  const ledgerEntry: DividendLedgerEntry = {
    id: randomUUID(),
    accountId: account.id,
    dividendEventId: dividendEvent.id,
    eligibleQuantity: 1000,
    expectedCashAmount: 2000,
    expectedStockQuantity: 0,
    receivedCashAmount: 0,
    receivedStockQuantity: 0,
    postingStatus: "expected",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus: "unknown_pending_disclosure",
    reconciliationNote: undefined,
    bookedAt: "2024-08-02T00:00:00.000Z",
  };
  store.marketData.dividendEvents.push(dividendEvent);
  store.accounting.facts.dividendLedgerEntries.push(ledgerEntry);
  await app.persistence.saveStore(store);
  return ledgerEntry.id;
}

async function expectLaterRuleBEntitlement(
  ledgerEntryId: string,
  eligibleQuantity: number,
  expectedCashAmount: number,
): Promise<void> {
  const store = await app.persistence.loadStore(USER_ID);
  expect(store.accounting.facts.dividendLedgerEntries).toContainEqual(expect.objectContaining({
    id: ledgerEntryId,
    eligibleQuantity,
    expectedCashAmount,
    postingStatus: "expected",
  }));
}

describe("MCP dividend services", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("posts a previewed receipt when source lines omit caller-provided ids and status", async () => {
    const rowId = await seedExpectedDividendRow();
    const eventSpy = vi.spyOn(app.eventBus, "publishEvent");

    const receiptInput = {
      rowId,
      receivedCashAmount: 3000,
      receivedStockQuantity: 0,
      sourceLines: [{
        sourceBucket: "DIVIDEND_INCOME" as const,
        amount: 3000,
        currencyCode: "TWD" as const,
      }],
    };
    const preview = await previewPostDividendReceipt(serviceContext(), receiptInput);
    expect(preview.receipt.sourceCompositionStatus).toBe("provided");

    const posted = await postDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-receipt-no-source-line-id",
    });

    expect(posted.posted).toBe(true);
    expect(posted.ledgerEntry).toEqual(expect.objectContaining({
      postingStatus: "posted",
      receivedCashAmount: 3000,
      sourceCompositionStatus: "provided",
      sourceLines: [expect.objectContaining({ sourceBucket: "DIVIDEND_INCOME", amount: 3000 })],
    }));
    expect(eventSpy).toHaveBeenCalledWith(USER_ID, "dividend_posted", expect.objectContaining({
      dividendLedgerEntryId: posted.dividendLedgerEntryId,
    }));
  });

  it("mirrors stock cash dividend source auto-fill in receipt previews", async () => {
    const rowId = await seedExpectedDividendRow();

    const preview = await previewPostDividendReceipt(serviceContext(), { rowId });

    expect(preview.receipt.sourceCompositionStatus).toBe("provided");
    expect(preview.receipt.sourceLines).toEqual([
      expect.objectContaining({
        sourceBucket: "DIVIDEND_INCOME",
        amount: 3000,
        currencyCode: "TWD",
        source: "dividend_posting",
      }),
    ]);

    const posted = await postDividendReceipt(serviceContext(), {
      rowId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-receipt-auto-source-line",
    });

    expect(posted.ledgerEntry).toEqual(expect.objectContaining({
      sourceCompositionStatus: "provided",
      sourceLines: [expect.objectContaining({ sourceBucket: "DIVIDEND_INCOME", amount: 3000 })],
    }));
  });

  it("allows stock cash auto-fill when caller explicitly marks source composition unknown", async () => {
    const rowId = await seedExpectedDividendRow();

    const preview = await previewPostDividendReceipt(serviceContext(), {
      rowId,
      sourceCompositionStatus: "unknown_pending_disclosure",
    });

    expect(preview.receipt.sourceCompositionStatus).toBe("provided");
    expect(preview.receipt.sourceLines).toEqual([
      expect.objectContaining({ sourceBucket: "DIVIDEND_INCOME", amount: 3000 }),
    ]);

    await expect(postDividendReceipt(serviceContext(), {
      rowId,
      sourceCompositionStatus: "unknown_pending_disclosure",
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-receipt-explicit-unknown-auto-fill",
    })).resolves.toEqual(expect.objectContaining({ posted: true }));
  });

  it("defaults omitted receipt deduction currency to the dividend row currency", async () => {
    const rowId = await seedExpectedDividendRow({
      ticker: "AAPL",
      marketCode: "US",
      cashDividendCurrency: "USD",
    });
    const receiptInput = {
      rowId,
      receivedCashAmount: 2900,
      deductions: [{
        deductionType: "WITHHOLDING_TAX" as const,
        amount: 100,
      }],
    };

    const preview = await previewPostDividendReceipt(serviceContext(), receiptInput);

    expect(preview.receipt.deductions).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100 }),
    ]);
    await expect(postDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-usd-deduction-default",
    })).resolves.toEqual(expect.objectContaining({ posted: true }));
  });

  it("posts persisted expected ledger rows returned by dividend review", async () => {
    const rowId = await seedExpectedDividendRow({ materializeLedgerEntry: true });
    const review = await getDividendReview(serviceContext(), {
      postingStatus: "expected",
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });

    expect(review.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowId,
        rowKind: "ledger",
        postingStatus: "expected",
        canPostReceipt: true,
        canUpdateReconciliation: false,
      }),
    ]));

    const preview = await previewPostDividendReceipt(serviceContext(), { rowId });
    const posted = await postDividendReceipt(serviceContext(), {
      rowId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-persisted-expected-ledger",
    });

    expect(posted).toEqual(expect.objectContaining({
      posted: true,
      dividendLedgerEntryId: rowId,
    }));
  });

  it("returns globally paginated dividend review rows for merged account and ticker filters", async () => {
    await seedExpectedDividendRow({ ticker: "2330", paymentDate: "2024-07-10" });
    await seedExpectedDividendRow({ ticker: "0050", paymentDate: "2024-08-10" });
    await seedExpectedDividendRow({ ticker: "2317", paymentDate: "2024-09-10" });

    const review = await getDividendReview(serviceContext(), {
      tickerMarkets: [
        { ticker: "2330", marketCode: "TW" },
        { ticker: "0050", marketCode: "TW" },
        { ticker: "2317", marketCode: "TW" },
      ],
      limit: 1,
      offset: 1,
    });

    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toEqual(expect.objectContaining({
      ticker: "0050",
      paymentDate: "2024-08-10",
    }));
    expect(review.hasMore).toBe(true);
  });

  it("rejects conflicting account ID and name filters", async () => {
    const store = await app.persistence.loadStore(USER_ID);
    store.accounts.push({
      id: "acc-2",
      userId: USER_ID,
      name: "Secondary",
      feeProfileId: store.feeProfiles[0]!.id,
      defaultCurrency: "TWD",
      accountType: "broker",
    });

    await expect(getDividendReview(serviceContext(), {
      accountIds: [store.accounts[0]!.id],
      accountNames: ["Secondary"],
    })).rejects.toMatchObject({ code: "mcp_account_filter_conflict", statusCode: 409 });
  });

  it("rejects a receipt confirmation when row facts changed after preview", async () => {
    const rowId = await seedExpectedDividendRow();
    const preview = await previewPostDividendReceipt(serviceContext(), { rowId });
    const store = await app.persistence.loadStore(USER_ID);
    const eventId = rowId.split(":").at(-1);
    const event = store.marketData.dividendEvents.find((candidate) => candidate.id === eventId)!;
    event.cashDividendPerShare = 4;

    await expect(postDividendReceipt(serviceContext(), {
      rowId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-stale-receipt",
    })).rejects.toMatchObject({ code: "mcp_confirmation_stale", statusCode: 409 });
  });

  it("requires the latest confirmation payload before posting a dividend receipt", async () => {
    const rowId = await seedExpectedDividendRow();

    await previewPostDividendReceipt(serviceContext(), { rowId });

    await expect(postDividendReceipt(serviceContext(), {
      rowId,
      idempotencyKey: "mcp-dividend-missing-confirmation",
      confirmationSummary: undefined as unknown as string,
      confirmationDigest: undefined as unknown as string,
    })).rejects.toMatchObject({ code: "mcp_confirmation_required", statusCode: 409 });
  });

  it("rejects a replayed dividend receipt idempotency key", async () => {
    const firstRowId = await seedExpectedDividendRow({ ticker: "2330" });
    const secondRowId = await seedExpectedDividendRow({ ticker: "0050", paymentDate: "2024-08-10" });
    const idempotencyKey = "mcp-dividend-duplicate-key";

    await postSeededReceipt(firstRowId, idempotencyKey);
    const preview = await previewPostDividendReceipt(serviceContext(), { rowId: secondRowId });

    await expect(postDividendReceipt(serviceContext(), {
      rowId: secondRowId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey,
    })).rejects.toMatchObject({ code: "duplicate_idempotency_key", statusCode: 409 });
  });

  it("checks receipt idempotency before resolving a posted expected row retry", async () => {
    const rowId = await seedExpectedDividendRow();
    const idempotencyKey = "mcp-dividend-retry-after-post";
    const preview = await previewPostDividendReceipt(serviceContext(), { rowId });

    await postDividendReceipt(serviceContext(), {
      rowId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey,
    });

    await expect(postDividendReceipt(serviceContext(), {
      rowId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey,
    })).rejects.toMatchObject({ code: "duplicate_idempotency_key", statusCode: 409 });
  });

  it("posts stock-only dividend receipts with stock lot impact details", async () => {
    const rowId = await seedExpectedDividendRow({
      eventType: "STOCK",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockParValueAmount: 10,
    });
    const receiptInput = { rowId, receivedCashAmount: 0, receivedStockQuantity: 100 };
    const preview = await previewPostDividendReceipt(serviceContext(), receiptInput);

    expect(preview.receipt.stockLotImpact).toContain("stock-dividend position action");

    const posted = await postDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-stock-only",
    });

    expect(posted.ledgerEntry).toEqual(expect.objectContaining({
      postingStatus: "posted",
      receivedCashAmount: 0,
      receivedStockQuantity: 100,
    }));

    const store = await app.persistence.loadStore(USER_ID);
    const positionAction = store.accounting.facts.positionActions.find(
      (action) => action.relatedDividendLedgerEntryId === posted.dividendLedgerEntryId,
    );
    expect(positionAction).toEqual(expect.objectContaining({
      actionType: "STOCK_DIVIDEND",
      quantity: 100,
      parValuePerShare: 10,
      premiumBaseAmount: 0,
      nhiPremiumBaseAmount: 1000,
    }));
    expect(positionAction?.cashInLieuAmount).toBeUndefined();
    expect(positionAction?.cashInLieuCurrency).toBeUndefined();
    expect(store.accounting.projections.lots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `lot-pa-${positionAction!.id}`,
        accountId: "acc-1",
        ticker: "2330",
        openQuantity: 100,
        totalCostAmount: 0,
        costCurrency: "TWD",
        openedAt: "2024-07-10",
      }),
    ]));
  });

  it("persists Rule B entitlement changes for a later dividend after posting a stock receipt", async () => {
    const rowId = await seedExpectedDividendRow({
      eventType: "STOCK",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockParValueAmount: 10,
    });
    const laterLedgerEntryId = await seedLaterCashDividendLedger();
    const receiptInput = { rowId, receivedCashAmount: 0, receivedStockQuantity: 100 };
    const preview = await previewPostDividendReceipt(serviceContext(), receiptInput);

    const posted = await postDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-stock-rule-b-post",
    });

    expect(posted.ledgerEntry).toEqual(expect.objectContaining({ receivedStockQuantity: 100 }));
    await expectLaterRuleBEntitlement(laterLedgerEntryId, 1100, 2200);
    await expectLaterRuleBEntitlement(laterLedgerEntryId, 1100, 2200);
  });

  it("amends posted stock dividend receipts through confirmation-gated MCP mutation", async () => {
    const rowId = await seedExpectedDividendRow({
      eventType: "STOCK",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockParValueAmount: 10,
    });
    const posted = await postSeededReceipt(rowId, "mcp-dividend-stock-amend-post");

    const preview = await previewAmendDividendReceipt(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      receivedCashAmount: 0,
      receivedStockQuantity: 120,
      sourceCompositionStatus: "unknown_pending_disclosure",
    });

    expect(preview.receipt.stockLotImpact).toContain("linked stock-dividend position action");

    const amended = await amendDividendReceipt(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      receivedCashAmount: 0,
      receivedStockQuantity: 120,
      sourceCompositionStatus: "unknown_pending_disclosure",
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-stock-amend-confirm",
    });

    expect(amended.ledgerEntry).toEqual(expect.objectContaining({
      receivedStockQuantity: 120,
      version: 2,
    }));
    const store = await app.persistence.loadStore(USER_ID);
    const positionAction = store.accounting.facts.positionActions.find(
      (action) => action.relatedDividendLedgerEntryId === posted.dividendLedgerEntryId,
    );
    expect(positionAction).toEqual(expect.objectContaining({
      actionType: "STOCK_DIVIDEND",
      quantity: 120,
    }));
    expect(store.accounting.projections.lots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `lot-pa-${positionAction!.id}`,
        openQuantity: 120,
        totalCostAmount: 0,
      }),
    ]));

    const zeroPreview = await previewAmendDividendReceipt(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      sourceCompositionStatus: "unknown_pending_disclosure",
    });
    const zeroAmendment = await amendDividendReceipt(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      sourceCompositionStatus: "unknown_pending_disclosure",
      confirmationSummary: zeroPreview.confirmationSummary,
      confirmationDigest: zeroPreview.confirmationDigest,
      idempotencyKey: "mcp-dividend-stock-amend-zero-confirm",
    });

    expect(zeroAmendment.ledgerEntry).toEqual(expect.objectContaining({
      receivedStockQuantity: 0,
      version: 3,
    }));
    const zeroStore = await app.persistence.loadStore(USER_ID);
    expect(zeroStore.accounting.facts.positionActions.some(
      (action) => action.relatedDividendLedgerEntryId === posted.dividendLedgerEntryId
        && !action.supersededAt,
    )).toBe(false);
    expect(zeroStore.accounting.projections.lots.some(
      (lot) => lot.id === `lot-pa-${positionAction!.id}`,
    )).toBe(false);
  });

  it("persists Rule B entitlement changes for a later dividend after amending a stock receipt", async () => {
    const rowId = await seedExpectedDividendRow({
      eventType: "STOCK",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockParValueAmount: 10,
    });
    const laterLedgerEntryId = await seedLaterCashDividendLedger();
    const posted = await postSeededReceipt(rowId, "mcp-dividend-stock-rule-b-amend-post");
    await expectLaterRuleBEntitlement(laterLedgerEntryId, 1100, 2200);
    const receiptInput = {
      rowId: posted.dividendLedgerEntryId,
      receivedCashAmount: 0,
      receivedStockQuantity: 120,
      sourceCompositionStatus: "unknown_pending_disclosure" as const,
    };
    const preview = await previewAmendDividendReceipt(serviceContext(), receiptInput);

    const amended = await amendDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-stock-rule-b-amend",
    });

    expect(amended.ledgerEntry).toEqual(expect.objectContaining({
      receivedStockQuantity: 120,
      version: 2,
    }));
    await expectLaterRuleBEntitlement(laterLedgerEntryId, 1120, 2240);
    await expectLaterRuleBEntitlement(laterLedgerEntryId, 1120, 2240);
  });

  it("posts mixed dividend receipts with deductions and source lines", async () => {
    const rowId = await seedExpectedDividendRow({
      eventType: "CASH_AND_STOCK",
      cashDividendPerShare: 2,
      stockDividendPerShare: 0.1,
      stockParValueAmount: 10,
    });
    const receiptInput = {
      rowId,
      receivedCashAmount: 1900,
      receivedStockQuantity: 100,
      deductions: [{
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM" as const,
        amount: 100,
        currencyCode: "TWD",
        source: "mcp_dividend_posting",
        note: "NHI supplement",
      }],
      sourceLines: [{
        sourceBucket: "DIVIDEND_INCOME" as const,
        amount: 2000,
        currencyCode: "TWD" as const,
        source: "mcp_dividend_posting",
      }],
      sourceCompositionStatus: "provided" as const,
    };
    const preview = await previewPostDividendReceipt(serviceContext(), receiptInput);

    expect(preview.receipt).toEqual(expect.objectContaining({
      deductionTotal: 100,
      actualCashEconomicAmount: 2000,
    }));
    expect(preview.receipt.stockLotImpact).toContain("stock-dividend position action");

    const posted = await postDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-mixed",
    });

    expect(posted.ledgerEntry).toEqual(expect.objectContaining({
      receivedCashAmount: 1900,
      receivedStockQuantity: 100,
      deductions: [expect.objectContaining({ deductionType: "NHI_SUPPLEMENTAL_PREMIUM", amount: 100 })],
      sourceLines: [expect.objectContaining({ sourceBucket: "DIVIDEND_INCOME", amount: 2000 })],
    }));

    const store = await app.persistence.loadStore(USER_ID);
    const positionAction = store.accounting.facts.positionActions.find(
      (action) => action.relatedDividendLedgerEntryId === posted.dividendLedgerEntryId,
    );
    expect(positionAction).toEqual(expect.objectContaining({
      quantity: 100,
      parValuePerShare: 10,
      premiumBaseAmount: 2000,
      nhiPremiumBaseAmount: 3000,
    }));
  });

  it("rejects stock quantities for pure cash dividend receipts", async () => {
    const rowId = await seedExpectedDividendRow({
      eventType: "CASH",
      cashDividendPerShare: 2,
      stockDividendPerShare: 0,
    });

    await expect(previewPostDividendReceipt(serviceContext(), {
      rowId,
      receivedCashAmount: 2000,
      receivedStockQuantity: 100,
    })).rejects.toMatchObject({ code: "cash_dividend_stock_quantity_not_allowed", statusCode: 400 });
  });

  it("rejects source lines when source composition is marked unknown", async () => {
    const rowId = await seedExpectedDividendRow();

    await expect(previewPostDividendReceipt(serviceContext(), {
      rowId,
      sourceLines: [{
        sourceBucket: "DIVIDEND_INCOME",
        amount: 3000,
        currencyCode: "TWD",
      }],
      sourceCompositionStatus: "unknown_pending_disclosure",
    })).rejects.toMatchObject({ code: "mcp_dividend_source_lines_conflict", statusCode: 400 });
  });

  it("rejects mismatched provided source lines before issuing receipt confirmation", async () => {
    const rowId = await seedExpectedDividendRow();

    await expect(previewPostDividendReceipt(serviceContext(), {
      rowId,
      sourceLines: [{
        sourceBucket: "DIVIDEND_INCOME",
        amount: 2000,
        currencyCode: "TWD",
      }],
      sourceCompositionStatus: "provided",
    })).rejects.toMatchObject({ code: "mcp_dividend_source_line_mismatch", statusCode: 400 });
  });

  it("rejects provided source status without source lines when auto-fill does not apply", async () => {
    const rowId = await seedExpectedDividendRow({ instrumentType: "ETF" });

    await expect(previewPostDividendReceipt(serviceContext(), {
      rowId,
      sourceCompositionStatus: "provided",
    })).rejects.toMatchObject({ code: "mcp_dividend_source_line_mismatch", statusCode: 400 });
  });

  it("excludes non-withheld deductions from MCP cash economics", async () => {
    const rowId = await seedExpectedDividendRow();
    const receiptInput = {
      rowId,
      receivedCashAmount: 2950,
      deductions: [{
        deductionType: "BROKER_FEE" as const,
        amount: 50,
        withheldAtSource: false,
      }],
    };
    const preview = await previewPostDividendReceipt(serviceContext(), receiptInput);

    expect(preview.receipt).toEqual(expect.objectContaining({
      deductionTotal: 50,
      actualCashEconomicAmount: 2950,
    }));

    const posted = await postDividendReceipt(serviceContext(), {
      ...receiptInput,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      idempotencyKey: "mcp-dividend-non-withheld-deduction",
    });
    const review = await getDividendReview(serviceContext(), {
      postingStatus: "posted",
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });
    const row = review.rows.find((candidate) => candidate.dividendLedgerEntryId === posted.dividendLedgerEntryId);

    expect(row).toEqual(expect.objectContaining({
      deductionTotal: 50,
      actualCashEconomicAmount: 2950,
      cashVarianceAmount: 50,
    }));
  });

  it("requires a note when previewing explained reconciliation", async () => {
    const rowId = await seedExpectedDividendRow();
    const posted = await postSeededReceipt(rowId);

    await expect(previewUpdateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status: "explained",
    })).rejects.toMatchObject({ code: "mcp_dividend_reconciliation_note_required", statusCode: 400 });
  });

  it("rejects reconciliation previews for persisted expected ledger rows", async () => {
    const rowId = await seedExpectedDividendRow({ materializeLedgerEntry: true });

    await expect(previewUpdateDividendReconciliation(serviceContext(), {
      rowId,
      status: "matched",
    })).rejects.toMatchObject({ code: "mcp_dividend_reconciliation_requires_ledger_row", statusCode: 409 });
  });

  it("rejects a reconciliation confirmation when status changed after preview", async () => {
    const rowId = await seedExpectedDividendRow();
    const posted = await postSeededReceipt(rowId);
    const preview = await previewUpdateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status: "matched",
    });
    await app.persistence.updateDividendReconciliationStatus(USER_ID, posted.dividendLedgerEntryId, "resolved");

    await expect(updateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status: "matched",
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    })).rejects.toMatchObject({ code: "mcp_confirmation_stale", statusCode: 409 });
  });

  it("requires the latest confirmation payload before updating reconciliation", async () => {
    const rowId = await seedExpectedDividendRow();
    const posted = await postSeededReceipt(rowId);

    await previewUpdateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status: "matched",
    });

    await expect(updateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status: "matched",
      confirmationSummary: undefined as unknown as string,
      confirmationDigest: undefined as unknown as string,
    })).rejects.toMatchObject({ code: "mcp_confirmation_required", statusCode: 409 });
  });

  it("rejects reconciliation persistence updates when the expected version is stale", async () => {
    const rowId = await seedExpectedDividendRow();
    const posted = await postSeededReceipt(rowId);
    const before = await app.persistence.findDividendLedgerEntryById(USER_ID, posted.dividendLedgerEntryId);
    expect(before).not.toBeNull();
    const beforeVersion = before!.version;

    await app.persistence.updateDividendReconciliationStatus(USER_ID, posted.dividendLedgerEntryId, "resolved");

    await expect(app.persistence.updateDividendReconciliationStatus(
      USER_ID,
      posted.dividendLedgerEntryId,
      "matched",
      undefined,
      beforeVersion,
    )).rejects.toMatchObject({ code: "dividend_version_conflict", statusCode: 409 });
  });

  it.each([
    ["matched", undefined],
    ["explained", "Broker rounding delta"],
    ["resolved", undefined],
    ["open", undefined],
  ] as const)("confirms reconciliation status %s and publishes an event", async (status, note) => {
    const rowId = await seedExpectedDividendRow();
    const posted = await postSeededReceipt(rowId);
    const eventSpy = vi.spyOn(app.eventBus, "publishEvent");
    const updateSpy = vi.spyOn(app.persistence, "updateDividendReconciliationStatus");
    const current = await app.persistence.findDividendLedgerEntryById(USER_ID, posted.dividendLedgerEntryId);
    const currentVersion = current!.version;
    const preview = await previewUpdateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status,
      note,
    });

    const updated = await updateDividendReconciliation(serviceContext(), {
      rowId: posted.dividendLedgerEntryId,
      status,
      note,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    });

    expect(updated.ledgerEntry).toEqual(expect.objectContaining({ reconciliationStatus: status }));
    expect(updateSpy).toHaveBeenCalledWith(
      USER_ID,
      posted.dividendLedgerEntryId,
      status,
      note,
      currentVersion,
    );
    expect(eventSpy).toHaveBeenCalledWith(USER_ID, "dividend_reconciliation_changed", expect.objectContaining({
      dividendLedgerEntryId: posted.dividendLedgerEntryId,
      reconciliationStatus: status,
    }));
  });
});
