/**
 * Unit tests for apps/api/src/services/cashLedgerService.ts (KZO-167).
 *
 * TDD-red until the Implementer lands cashLedgerService.ts (Phase 4),
 * collapses Account→AccountDto in Store (Phase 2), and wires the emission
 * paths (portfolio.ts, recompute.ts, dividends.ts).
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { CashLedgerEntry, Store, Transaction } from "../../src/types/store.js";
import type { AccountDto } from "@tw-portfolio/shared-types";
import {
  assertCashEntryCurrencyMatchesAccount,
  bookCashLedgerEntry,
  bookTradeSettlementRecompute,
  buildTradeSettlementCashEntry,
} from "../../src/services/cashLedgerService.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: "acc-1",
    name: "Main",
    userId: "user-1",
    feeProfileId: "fp-default",
    defaultCurrency: "TWD",
    accountType: "broker",
    ...overrides,
  };
}

function makeCashEntry(overrides: Partial<CashLedgerEntry> = {}): CashLedgerEntry {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    entryDate: "2026-01-15",
    entryType: "TRADE_SETTLEMENT_OUT",
    amount: -10000,
    currency: "TWD",
    source: "trade_settlement",
    ...overrides,
  };
}

const defaultFeeSnapshot = {
  id: "fp-default",
  name: "Default Broker",
  boardCommissionRate: 1.425,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 20,
  commissionCurrency: "TWD" as const,
  commissionRoundingMode: "FLOOR" as const,
  taxRoundingMode: "FLOOR" as const,
  stockSellTaxRateBps: 30,
  stockDayTradeTaxRateBps: 15,
  etfSellTaxRateBps: 10,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT" as const,
};

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 1000,
    priceCurrency: "TWD",
    tradeDate: "2026-01-15",
    commissionAmount: 20,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: defaultFeeSnapshot,
    ...overrides,
  };
}

/**
 * Minimal store for unit tests.
 * accounts is cast because store.accounts transitions from Account[] → AccountDto[]
 * in Phase 2 (Implementer). The cast is safe — service functions only read
 * account.id and account.defaultCurrency.
 */
function makeStore(
  overrides: {
    accounts?: AccountDto[];
    cashEntries?: CashLedgerEntry[];
    tradeEvents?: Transaction[];
  } = {},
): Store {
  const accounts = overrides.accounts ?? [makeAccount()];
  const cashEntries = overrides.cashEntries ?? [];
  const tradeEvents = (overrides.tradeEvents ?? []) as Store["accounting"]["facts"]["tradeEvents"];

  return {
    userId: "user-1",
    settings: {
      userId: "user-1",
      locale: "en" as const,
      costBasisMethod: "WEIGHTED_AVERAGE" as const,
      quotePollIntervalSeconds: 60,
    },
    accounts: accounts as unknown as Store["accounts"],
    feeProfileBindings: [],
    feeProfiles: [],
    accounting: {
      facts: {
        tradeEvents,
        cashLedgerEntries: cashEntries,
        dividendLedgerEntries: [],
        dividendDeductionEntries: [],
        dividendSourceLines: [],
        corporateActions: [],
      },
      projections: {
        lots: [],
        lotAllocations: [],
        holdings: [],
        dailyPortfolioSnapshots: [],
      },
      policy: { inventoryModel: "LOT_CAPABLE", disposalPolicy: "WEIGHTED_AVERAGE" },
    },
    marketData: { dividendEvents: [], instruments: [] },
    instruments: [],
    recomputeJobs: [],
    idempotencyKeys: new Set(),
  } as unknown as Store;
}

// ─── assertCashEntryCurrencyMatchesAccount ───────────────────────────────────

describe("assertCashEntryCurrencyMatchesAccount", () => {
  it("does not throw when entry currency matches account defaultCurrency (TWD)", () => {
    const account = makeAccount({ defaultCurrency: "TWD" });
    const entry = makeCashEntry({ currency: "TWD" });
    expect(() => assertCashEntryCurrencyMatchesAccount(entry, account)).not.toThrow();
  });

  it("does not throw for USD → USD match", () => {
    const account = makeAccount({ defaultCurrency: "USD" });
    const entry = makeCashEntry({ currency: "USD" });
    expect(() => assertCashEntryCurrencyMatchesAccount(entry, account)).not.toThrow();
  });

  it("does not throw for AUD → AUD match", () => {
    const account = makeAccount({ defaultCurrency: "AUD" });
    const entry = makeCashEntry({ currency: "AUD" });
    expect(() => assertCashEntryCurrencyMatchesAccount(entry, account)).not.toThrow();
  });

  it("throws routeError 400 currency_mismatch when entry is USD and account is TWD", () => {
    const account = makeAccount({ defaultCurrency: "TWD" });
    const entry = makeCashEntry({ currency: "USD" });
    expect(() => assertCashEntryCurrencyMatchesAccount(entry, account)).toThrow(
      expect.objectContaining({ statusCode: 400, code: "currency_mismatch" }),
    );
  });

  it("throws routeError 400 currency_mismatch when entry is AUD and account is TWD", () => {
    const account = makeAccount({ defaultCurrency: "TWD" });
    const entry = makeCashEntry({ currency: "AUD" });
    expect(() => assertCashEntryCurrencyMatchesAccount(entry, account)).toThrow(
      expect.objectContaining({ statusCode: 400, code: "currency_mismatch" }),
    );
  });

  it("throws routeError 400 currency_mismatch when entry is TWD and account is USD", () => {
    const account = makeAccount({ defaultCurrency: "USD" });
    const entry = makeCashEntry({ currency: "TWD" });
    expect(() => assertCashEntryCurrencyMatchesAccount(entry, account)).toThrow(
      expect.objectContaining({ statusCode: 400, code: "currency_mismatch" }),
    );
  });
});

// ─── bookCashLedgerEntry ─────────────────────────────────────────────────────

describe("bookCashLedgerEntry", () => {
  it("happy path: appends the entry to store.accounting.facts.cashLedgerEntries", () => {
    const account = makeAccount({ id: "acc-1", defaultCurrency: "TWD" });
    const entry = makeCashEntry({ accountId: "acc-1", currency: "TWD" });
    const store = makeStore({ accounts: [account] });

    expect(() => bookCashLedgerEntry(store, entry)).not.toThrow();
    expect(store.accounting.facts.cashLedgerEntries).toContain(entry);
  });

  it("happy path: works for a USD entry on a USD account", () => {
    const account = makeAccount({ id: "acc-usd", defaultCurrency: "USD" });
    const entry = makeCashEntry({ accountId: "acc-usd", currency: "USD" });
    const store = makeStore({ accounts: [account] });

    expect(() => bookCashLedgerEntry(store, entry)).not.toThrow();
    expect(store.accounting.facts.cashLedgerEntries).toContain(entry);
  });

  it("throws routeError 404 account_not_found when the account is absent from store", () => {
    const store = makeStore({ accounts: [] });
    const entry = makeCashEntry({ accountId: "acc-missing" });

    expect(() => bookCashLedgerEntry(store, entry)).toThrow(
      expect.objectContaining({ statusCode: 404, code: "account_not_found" }),
    );
  });

  it("throws routeError 404 account_not_found when entry.accountId does not match any account", () => {
    const account = makeAccount({ id: "acc-real" });
    const entry = makeCashEntry({ accountId: "acc-other" }); // different ID
    const store = makeStore({ accounts: [account] });

    expect(() => bookCashLedgerEntry(store, entry)).toThrow(
      expect.objectContaining({ statusCode: 404, code: "account_not_found" }),
    );
  });

  it("throws routeError 400 currency_mismatch when entry currency differs from account defaultCurrency", () => {
    const account = makeAccount({ id: "acc-1", defaultCurrency: "TWD" });
    const entry = makeCashEntry({ accountId: "acc-1", currency: "USD" }); // mismatch
    const store = makeStore({ accounts: [account] });

    expect(() => bookCashLedgerEntry(store, entry)).toThrow(
      expect.objectContaining({ statusCode: 400, code: "currency_mismatch" }),
    );
  });

  it("does NOT append the entry to the store when currency mismatches", () => {
    const account = makeAccount({ id: "acc-1", defaultCurrency: "TWD" });
    const entry = makeCashEntry({ accountId: "acc-1", currency: "USD" });
    const store = makeStore({ accounts: [account] });

    try {
      bookCashLedgerEntry(store, entry);
    } catch {
      // expected
    }
    expect(store.accounting.facts.cashLedgerEntries).not.toContain(entry);
  });
});

// ─── bookTradeSettlementRecompute ────────────────────────────────────────────

describe("bookTradeSettlementRecompute", () => {
  it("happy path: replaces the prior cash entry for the same trade", () => {
    const tx = makeTransaction({ id: "trade-r1", accountId: "acc-1", priceCurrency: "TWD" });
    const priorEntry = makeCashEntry({
      id: "prior-entry-r1",
      accountId: "acc-1",
      currency: "TWD",
      relatedTradeEventId: "trade-r1",
    });
    const store = makeStore({
      accounts: [makeAccount({ id: "acc-1", defaultCurrency: "TWD" })],
      cashEntries: [priorEntry],
    });

    expect(() => bookTradeSettlementRecompute(store, tx)).not.toThrow();

    const entries = store.accounting.facts.cashLedgerEntries;
    // Prior entry is gone; replaced by the recomputed entry
    expect(entries.find((e) => e.id === "prior-entry-r1")).toBeUndefined();
    expect(entries.some((e) => e.relatedTradeEventId === "trade-r1")).toBe(true);
  });

  it("does not disturb unrelated cash entries during the replacement", () => {
    const tx = makeTransaction({ id: "trade-r2", accountId: "acc-1", priceCurrency: "TWD" });
    const priorEntry = makeCashEntry({ id: "entry-r2", relatedTradeEventId: "trade-r2", currency: "TWD" });
    const unrelatedEntry = makeCashEntry({ id: "entry-other", relatedTradeEventId: "trade-other", currency: "TWD" });
    const store = makeStore({
      accounts: [makeAccount({ id: "acc-1", defaultCurrency: "TWD" })],
      cashEntries: [priorEntry, unrelatedEntry],
    });

    bookTradeSettlementRecompute(store, tx);

    expect(store.accounting.facts.cashLedgerEntries.find((e) => e.id === "entry-other")).toBeDefined();
  });

  it("throws routeError 404 account_not_found when account is missing from store", () => {
    const tx = makeTransaction({ id: "trade-r3", accountId: "acc-missing" });
    const store = makeStore({ accounts: [] });

    expect(() => bookTradeSettlementRecompute(store, tx)).toThrow(
      expect.objectContaining({ statusCode: 404, code: "account_not_found" }),
    );
  });

  it("throws routeError 400 currency_mismatch when tx.priceCurrency differs from account defaultCurrency", () => {
    const tx = makeTransaction({
      id: "trade-r4",
      accountId: "acc-1",
      priceCurrency: "USD",
      feeSnapshot: { ...defaultFeeSnapshot, commissionCurrency: "USD" },
    });
    const store = makeStore({
      accounts: [makeAccount({ id: "acc-1", defaultCurrency: "TWD" })],
    });

    expect(() => bookTradeSettlementRecompute(store, tx)).toThrow(
      expect.objectContaining({ statusCode: 400, code: "currency_mismatch" }),
    );
  });
});

// ─── buildTradeSettlementCashEntry ───────────────────────────────────────────

describe("buildTradeSettlementCashEntry", () => {
  it("uses tx.priceCurrency as the entry currency", () => {
    const tx = makeTransaction({ priceCurrency: "TWD" });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.currency).toBe("TWD");
  });

  it("uses USD priceCurrency when present", () => {
    const tx = makeTransaction({ priceCurrency: "USD" });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.currency).toBe("USD");
  });

  it("falls back to feeSnapshot.commissionCurrency when priceCurrency is absent", () => {
    // Casting to test the defensive fallback path in the implementation
    const tx = makeTransaction({
      priceCurrency: undefined as unknown as "TWD",
      feeSnapshot: { ...defaultFeeSnapshot, commissionCurrency: "USD" },
    });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.currency).toBe("USD");
  });

  it("falls back to 'TWD' when both priceCurrency and commissionCurrency are absent", () => {
    const tx = makeTransaction({
      priceCurrency: undefined as unknown as "TWD",
      feeSnapshot: { ...defaultFeeSnapshot, commissionCurrency: undefined as unknown as "TWD" },
    });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.currency).toBe("TWD");
  });

  it("links the entry to the trade event via relatedTradeEventId", () => {
    const tx = makeTransaction({ id: "trade-build-1" });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.relatedTradeEventId).toBe("trade-build-1");
  });

  it("carries the correct accountId and userId from the transaction", () => {
    const tx = makeTransaction({ accountId: "acc-xyz", userId: "user-xyz" });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.accountId).toBe("acc-xyz");
    expect(entry.userId).toBe("user-xyz");
  });

  it("produces a TRADE_SETTLEMENT_OUT entry for a BUY (net cash outflow)", () => {
    const tx = makeTransaction({ type: "BUY" });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.entryType).toBe("TRADE_SETTLEMENT_OUT");
    expect(entry.amount).toBeLessThan(0);
  });

  it("produces a TRADE_SETTLEMENT_IN entry for a SELL (net cash inflow)", () => {
    const tx = makeTransaction({ type: "SELL" });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.entryType).toBe("TRADE_SETTLEMENT_IN");
    expect(entry.amount).toBeGreaterThan(0);
  });

  it("BUY amount equals -(quantity × unitPrice + commissionAmount + taxAmount)", () => {
    const tx = makeTransaction({
      type: "BUY",
      quantity: 10,
      unitPrice: 1000,
      commissionAmount: 20,
      taxAmount: 5,
    });
    const entry = buildTradeSettlementCashEntry(tx);
    // Expected: -(10 * 1000 + 20 + 5) = -10025
    expect(entry.amount).toBe(-(10 * 1000 + 20 + 5));
  });

  it("SELL amount equals +(quantity × unitPrice - commissionAmount - taxAmount)", () => {
    const tx = makeTransaction({
      type: "SELL",
      quantity: 10,
      unitPrice: 1000,
      commissionAmount: 20,
      taxAmount: 30,
    });
    const entry = buildTradeSettlementCashEntry(tx);
    // Expected: +(10 * 1000 - 20 - 30) = +9950
    expect(entry.amount).toBe(10 * 1000 - 20 - 30);
  });

  it("produces a deterministic entry id keyed off the transaction id", () => {
    // D11: id is `cash-${tx.id}` — deterministic so replaceCashLedgerEntryForTrade
    // can locate the entry on re-emission without a DB lookup.
    const tx = makeTransaction();
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.id).toBe(`cash-${tx.id}`);
  });

  it("output is identical to the consolidated function from both portfolio.ts and recompute.ts call sites (parity check)", () => {
    // Verifies that consolidation didn't silently break either path.
    // Both portfolio.ts and recompute.ts used equivalent builders; the
    // consolidated version must produce the same observable fields.
    const tx = makeTransaction({
      type: "BUY",
      quantity: 5,
      unitPrice: 500,
      commissionAmount: 10,
      taxAmount: 2,
      priceCurrency: "TWD",
    });
    const entry = buildTradeSettlementCashEntry(tx);
    expect(entry.entryType).toBe("TRADE_SETTLEMENT_OUT");
    expect(entry.currency).toBe("TWD");
    expect(entry.amount).toBe(-(5 * 500 + 10 + 2));
    expect(entry.relatedTradeEventId).toBe(tx.id);
    expect(entry.accountId).toBe(tx.accountId);
    expect(entry.userId).toBe(tx.userId);
  });
});
