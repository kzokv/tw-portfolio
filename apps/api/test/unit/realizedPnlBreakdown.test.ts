import { describe, expect, it } from "vitest";
import { buildRealizedPnlBreakdown } from "../../src/services/realizedPnlBreakdown.js";
import { createDefaultFeeProfile, createStore } from "../../src/services/store.js";

describe("buildRealizedPnlBreakdown", () => {
  it("reports exact and rounded weighted-average cost separately", () => {
    const store = createStore();
    const feeProfile = createDefaultFeeProfile("acc-1", "TWD", "fp-test");
    store.feeProfiles = [feeProfile];

    store.accounting.facts.tradeEvents.push(
      {
        id: "buy-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 3,
        unitPrice: 33.333333,
        priceCurrency: "TWD",
        tradeDate: "2026-01-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
      {
        id: "sell-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 2,
        unitPrice: 40,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
    );

    const breakdown = buildRealizedPnlBreakdown(
      store.accounting,
      store.accounting.facts.tradeEvents[1]!,
    );

    expect(breakdown).toEqual(expect.objectContaining({
      status: "available",
      exactAverageCostPerShare: 100 / 3,
      roundedAverageCostPerShare: 33.33,
      allocatedCostAmount: 66.66,
      realizedPnlAmount: 13.34,
    }));
  });

  it("isolates replay state by account, ticker, and market", () => {
    const store = createStore();
    const twProfile = createDefaultFeeProfile("acc-1", "TWD", "fp-tw");
    const usdProfile = createDefaultFeeProfile("acc-2", "USD", "fp-us");
    store.feeProfiles = [twProfile, usdProfile];

    store.accounting.facts.tradeEvents.push(
      {
        id: "other-account-buy",
        userId: "user-1",
        accountId: "acc-2",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 100,
        unitPrice: 1,
        priceCurrency: "TWD",
        tradeDate: "2026-01-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: twProfile,
      },
      {
        id: "other-market-buy",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 100,
        unitPrice: 1,
        priceCurrency: "USD",
        tradeDate: "2026-01-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdProfile,
      },
      {
        id: "target-buy",
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
        feeSnapshot: twProfile,
      },
      {
        id: "target-sell",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 5,
        unitPrice: 120,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: twProfile,
      },
    );

    expect(buildRealizedPnlBreakdown(
      store.accounting,
      store.accounting.facts.tradeEvents[3]!,
    )).toEqual(expect.objectContaining({
      status: "available",
      preSaleOpenQuantity: 10,
      preSaleOpenCostAmount: 1000,
      allocatedCostAmount: 500,
      realizedPnlAmount: 100,
    }));
  });

  it("returns unsupported_cost_basis_method when the accounting policy is not weighted average", () => {
    const store = createStore();
    const feeProfile = createDefaultFeeProfile("acc-1", "TWD", "fp-test");
    store.feeProfiles = [feeProfile];
    store.accounts[0] = {
      ...store.accounts[0]!,
      feeProfileId: feeProfile.id,
    };

    store.accounting.facts.tradeEvents.push(
      {
        id: "buy-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 3,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
      {
        id: "sell-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 2,
        unitPrice: 120,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
    );

    (store.accounting.policy as { disposalPolicy: string }).disposalPolicy = "FIFO";

    expect(buildRealizedPnlBreakdown(
      store.accounting,
      store.accounting.facts.tradeEvents[1]!,
    )).toEqual({
      status: "unavailable",
      currency: "TWD",
      reason: "unsupported_cost_basis_method",
    });
  });

  it("does not show derived math when a prior split changed the replay basis", () => {
    const store = createStore();
    const feeProfile = createDefaultFeeProfile("acc-1", "TWD", "fp-test");
    store.feeProfiles = [feeProfile];

    store.accounting.facts.tradeEvents.push(
      {
        id: "buy-1",
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
        feeSnapshot: feeProfile,
      },
      {
        id: "sell-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 15,
        unitPrice: 80,
        priceCurrency: "TWD",
        tradeDate: "2026-01-03",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
    );
    store.accounting.facts.corporateActions.push({
      id: "split-1",
      accountId: "acc-1",
      ticker: "2330",
      actionType: "SPLIT",
      numerator: 2,
      denominator: 1,
      actionDate: "2026-01-02",
    });

    expect(buildRealizedPnlBreakdown(
      store.accounting,
      store.accounting.facts.tradeEvents[1]!,
    )).toEqual({
      status: "unavailable",
      currency: "TWD",
      reason: "unknown",
    });
  });

  it("does not show derived math when persisted lot allocations diverge from replayed trade fees", () => {
    const store = createStore();
    const feeProfile = createDefaultFeeProfile("acc-1", "TWD", "fp-test");
    store.feeProfiles = [feeProfile];

    store.accounting.facts.tradeEvents.push(
      {
        id: "buy-1",
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
        feeSnapshot: feeProfile,
      },
      {
        id: "sell-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 5,
        unitPrice: 120,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        realizedPnlAmount: 90,
        feeSnapshot: feeProfile,
      },
    );
    store.accounting.projections.lotAllocations.push({
      id: "alloc-1",
      userId: "user-1",
      accountId: "acc-1",
      tradeEventId: "sell-1",
      ticker: "2330",
      lotId: "lot-1",
      lotOpenedAt: "2026-01-01",
      lotOpenedSequence: 0,
      allocatedQuantity: 5,
      allocatedCostAmount: 510,
      costCurrency: "TWD",
    });

    expect(buildRealizedPnlBreakdown(
      store.accounting,
      store.accounting.facts.tradeEvents[1]!,
    )).toEqual({
      status: "unavailable",
      currency: "TWD",
      reason: "unknown",
    });
  });
});
