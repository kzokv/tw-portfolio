import { describe, expect, it } from "vitest";
import { createDefaultFeeProfile, createStore } from "../../src/services/store.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  createFxTransfer,
  estimateFxTransfer,
  reverseFxTransfer,
  updateFxTransfer,
  validateMidRateTolerance,
} from "../../src/services/fxTransferService.js";
import { generateCurrencyWalletSnapshots } from "../../src/services/currencyWalletSnapshotGeneration.js";
import type { CashLedgerEntry, Store } from "../../src/types/store.js";

function manualCash(overrides: Partial<CashLedgerEntry> = {}): CashLedgerEntry {
  return {
    id: "cash-seed-twd",
    userId: "user-1",
    accountId: "acc-1",
    entryDate: "2026-03-31",
    entryType: "MANUAL_ADJUSTMENT",
    amount: 2000,
    currency: "TWD",
    source: "unit_seed",
    sourceReference: "cash-seed-twd",
    bookedAt: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

async function makePersistence(): Promise<MemoryPersistence> {
  const persistence = new MemoryPersistence();
  const store = createStore();
  store.userId = "user-1";
  store.settings.userId = "user-1";
  store.accounts = store.accounts.map((account) => ({ ...account, userId: "user-1", accountType: "wallet" }));
  store.accounts.push({
    id: "acc-usd",
    userId: "user-1",
    name: "USD Wallet",
    feeProfileId: "fp-usd",
    defaultCurrency: "USD",
    accountType: "wallet",
  });
  store.feeProfiles.push(createDefaultFeeProfile("acc-usd", "USD", "fp-usd"));
  store.accounting.facts.cashLedgerEntries.push(manualCash());
  await persistence.saveStore(store);
  await persistence.upsertFxRates([
    { date: "2026-04-01", baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.032, source: "frankfurter" },
    { date: "2026-04-01", baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.25, source: "frankfurter" },
  ]);
  return persistence;
}

async function loadCashEntries(persistence: MemoryPersistence): Promise<CashLedgerEntry[]> {
  const store: Store = await persistence.loadStore("user-1");
  return store.accounting.facts.cashLedgerEntries;
}

describe("validateMidRateTolerance", () => {
  it("classifies safe, warn, block, and missing-mid-rate states", () => {
    expect(validateMidRateTolerance(1.015, 1).state).toBe("safe");
    expect(validateMidRateTolerance(1.03, 1).state).toBe("warn");
    expect(validateMidRateTolerance(1.12, 1).state).toBe("block");
    expect(validateMidRateTolerance(1, null)).toEqual({ tolerancePct: null, state: "warn" });
  });
});

describe("fxTransferService", () => {
  it("createFxTransfer: writes linked OUT/IN legs with USD WAC invariant and audit metadata", async () => {
    const persistence = await makePersistence();

    const result = await createFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
      notes: "Initial USD funding",
    });

    const entries = await loadCashEntries(persistence);
    const outLeg = entries.find((entry) => entry.id === result.legOutId);
    const inLeg = entries.find((entry) => entry.id === result.legInId);
    expect(outLeg).toMatchObject({
      entryType: "FX_TRANSFER_OUT",
      amount: -1000,
      currency: "TWD",
      fxTransferId: result.fxTransferId,
      fxRateToUsd: 0.032,
    });
    expect(inLeg).toMatchObject({
      entryType: "FX_TRANSFER_IN",
      amount: 32,
      currency: "USD",
      fxTransferId: result.fxTransferId,
      fxRateToUsd: 1,
    });

    const audit = await persistence.listAuditLog({ page: 1, limit: 10, actions: ["fx_transfer_created"] });
    expect(audit.total).toBe(1);
    expect(audit.items[0]?.metadata).toMatchObject({
      fxTransferId: result.fxTransferId,
      fromAmount: 1000,
      toAmount: 32,
      toleranceState: "safe",
    });
  });

  it("estimateFxTransfer: reports insufficient balance without mutating ledger rows", async () => {
    const persistence = await makePersistence();

    const estimate = await estimateFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 3000,
      toAmount: 96,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    expect(estimate.insufficientBalance).toBe(true);
    expect(estimate.fromAccountAvailableBalance).toBe(2000);
    const entries = await loadCashEntries(persistence);
    expect(entries.filter((entry) => entry.entryType === "FX_TRANSFER_OUT")).toHaveLength(0);
  });

  it("estimateFxTransfer: scopes available balance to the source user when account ids collide", async () => {
    const persistence = await makePersistence();
    const otherStore = createStore();
    otherStore.userId = "user-2";
    otherStore.settings.userId = "user-2";
    otherStore.accounts = otherStore.accounts.map((account) => ({ ...account, userId: "user-2" }));
    otherStore.accounting.facts.cashLedgerEntries.push(
      manualCash({
        id: "other-user-negative-cash",
        userId: "user-2",
        amount: -5000,
        sourceReference: "other-user-negative-cash",
      }),
    );
    await persistence.saveStore(otherStore);

    const estimate = await estimateFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    expect(estimate.insufficientBalance).toBe(false);
    expect(estimate.fromAccountAvailableBalance).toBe(2000);
  });

  it("createFxTransfer: rejects same-account, amount-rate mismatch, tolerance block, and insufficient balance (D7)", async () => {
    const persistence = await makePersistence();

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-1",
        fromAmount: 100,
        toAmount: 3.2,
        effectiveRate: 0.032,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_same_account", statusCode: 400 });

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-usd",
        fromAmount: 100,
        toAmount: 4,
        effectiveRate: 0.032,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_amount_rate_mismatch", statusCode: 400 });

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-usd",
        fromAmount: 100,
        toAmount: 4,
        effectiveRate: 0.04,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_rate_out_of_tolerance", statusCode: 400 });

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-usd",
        fromAmount: 3000,
        toAmount: 96,
        effectiveRate: 0.032,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_insufficient_balance", statusCode: 400 });
  });

  it("createFxTransfer: rejects same-currency pair (D7)", async () => {
    const persistence = await makePersistence();
    // Seed a second TWD wallet so both endpoints share TWD as their default currency.
    const store = await persistence.loadStore("user-1");
    store.accounts.push({
      id: "acc-twd-2",
      userId: "user-1",
      name: "TWD Wallet #2",
      feeProfileId: "fp-twd-2",
      defaultCurrency: "TWD",
      accountType: "wallet",
    });
    store.feeProfiles.push(createDefaultFeeProfile("acc-twd-2", "TWD", "fp-twd-2"));
    await persistence.saveStore(store);

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-twd-2",
        fromAmount: 100,
        toAmount: 100,
        effectiveRate: 1,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_same_currency", statusCode: 400 });
  });

  it("createFxTransfer: rejects future-dated entry (D7)", async () => {
    const persistence = await makePersistence();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-usd",
        fromAmount: 1000,
        toAmount: 32,
        effectiveRate: 0.032,
        entryDate: tomorrow,
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_future_date", statusCode: 400 });
  });

  it("createFxTransfer: rejects an account that belongs to another user with 404 (D7 ownership scoping)", async () => {
    const persistence = await makePersistence();
    // user-2 owns its own USD wallet.
    const otherStore = createStore();
    otherStore.userId = "user-2";
    otherStore.settings.userId = "user-2";
    otherStore.accounts = otherStore.accounts.map((account) => ({ ...account, userId: "user-2" }));
    otherStore.accounts.push({
      id: "acc-other-usd",
      userId: "user-2",
      name: "Other USD",
      feeProfileId: "fp-other-usd",
      defaultCurrency: "USD",
      accountType: "wallet",
    });
    otherStore.feeProfiles.push(createDefaultFeeProfile("acc-other-usd", "USD", "fp-other-usd"));
    await persistence.saveStore(otherStore);

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-other-usd", // owned by user-2 — must not leak existence.
        fromAmount: 100,
        toAmount: 3.2,
        effectiveRate: 0.032,
        entryDate: "2026-04-01",
      }),
    ).rejects.toMatchObject({ code: "account_not_found", statusCode: 404 });
  });

  it("createFxTransfer: rejects when the USD-bridge mid-rate is missing (D6 hard-block)", async () => {
    // `getFxRate` does a "best rate as-of" lookup, so any date AFTER the
    // 2026-04-01 seed inherits that rate. To force a missing-bridge state
    // we use a date strictly BEFORE every seeded rate.
    const persistence = await makePersistence();

    await expect(
      createFxTransfer(persistence, "user-1", {
        fromAccountId: "acc-1",
        toAccountId: "acc-usd",
        fromAmount: 1000,
        toAmount: 32,
        effectiveRate: 0.032,
        entryDate: "2026-03-31", // seeded rates start 2026-04-01
      }),
    ).rejects.toMatchObject({ name: "MissingFxRateError" });
  });

  it("AC2: 3-step round-trip realizes FX P&L lifetime against the seeded WAC (KZO-168 D3 + KZO-166 WAC)", async () => {
    // Re-stated AC2 from the scope-todo: TWD→USD #1 seeds the USD wallet and
    // realizes 0 from the TWD side; USD→TWD updates the TWD WAC; TWD→USD #2
    // at a different rate realizes against the weighted TWD WAC.
    const persistence = await makePersistence();

    // Seed extra TWD so step #3 has a margin to spend after step #1's 1000 outflow.
    const store = await persistence.loadStore("user-1");
    store.accounting.facts.cashLedgerEntries.push({
      id: "cash-seed-twd-extra",
      userId: "user-1",
      accountId: "acc-1",
      entryDate: "2026-03-31",
      entryType: "MANUAL_ADJUSTMENT",
      amount: 5000,
      currency: "TWD",
      source: "unit_seed",
      sourceReference: "cash-seed-twd-extra",
      bookedAt: "2026-03-31T00:00:00.000Z",
    });
    await persistence.saveStore(store);
    // Seed the rates each step needs. Direct TWD↔USD pairs (effective rate
    // matches mid → tolerance "safe") for 2026-04-02 and 2026-04-03 in
    // addition to the 2026-04-01 rates already seeded.
    await persistence.upsertFxRates([
      { date: "2026-04-02", baseCurrency: "USD", quoteCurrency: "TWD", rate: 30, source: "frankfurter" },
      { date: "2026-04-02", baseCurrency: "TWD", quoteCurrency: "USD", rate: 1 / 30, source: "frankfurter" },
      { date: "2026-04-03", baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.034, source: "frankfurter" },
      { date: "2026-04-03", baseCurrency: "USD", quoteCurrency: "TWD", rate: 1 / 0.034, source: "frankfurter" },
    ]);

    // Step 1: TWD→USD at 0.032 (1000 TWD → 32 USD). Seeds USD wallet WAC=1.
    // For TWD wallet on this outflow, KZO-168 D3 seeds TWD WAC at 0.032
    // and realizes 0.
    await createFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    // Step 2: USD→TWD at 30 TWD/USD (16 USD → 480 TWD). Stamps the IN leg's
    // fx_rate_to_usd as USD-per-TWD ≈ 1/30 = 0.0333... — this is the *new*
    // basis that gets weighted into the TWD wallet's WAC alongside the
    // remaining TWD balance.
    await createFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-usd",
      toAccountId: "acc-1",
      fromAmount: 16,
      toAmount: 480,
      effectiveRate: 30,
      entryDate: "2026-04-02",
    });

    // Step 3: TWD→USD at 0.034 (300 TWD → 10.2 USD). Realizes against the
    // weighted TWD WAC.
    await createFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 300,
      toAmount: 10.2,
      effectiveRate: 0.034,
      entryDate: "2026-04-03",
    });

    await generateCurrencyWalletSnapshots("user-1", persistence);
    const twdSnaps = await persistence.getCurrencyWalletSnapshotsForAccount(
      "user-1",
      "acc-1",
      "2026-04-01",
      "2026-04-03",
    );
    const finalTwd = twdSnaps[twdSnaps.length - 1];
    // Lifetime realized P&L MUST be strictly positive — step 3's USD-per-TWD
    // rate (0.034) is above the seeded WAC (~0.0322 weighted), so we realize
    // a small profit. The exact value depends on weighting precision, but
    // sign and magnitude are deterministic.
    expect(finalTwd).toBeDefined();
    expect(finalTwd?.realizedFxPnlLifetime).toBeGreaterThan(0);
    // Sanity: balance walks forward correctly. Start 7000 TWD seed, -1000,
    // +480, -300 → 6180.
    expect(finalTwd?.balanceNative).toBeCloseTo(6180, 2);
  });

  it("updateFxTransfer: re-validates USD-bridge availability when entryDate changes (D9)", async () => {
    const persistence = await makePersistence();
    const created = await createFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    // Move the transfer's entryDate BEFORE any seeded FX rate so the
    // "best rate as-of" lookup returns null and the USD-bridge guard fires.
    await expect(
      updateFxTransfer(persistence, "user-1", created.fxTransferId, {
        entryDate: "2026-03-31", // strictly before the 2026-04-01 seed
      }),
    ).rejects.toMatchObject({ name: "MissingFxRateError" });
  });

  it("updateFxTransfer then reverseFxTransfer: updates economic triple, reverses current state, and blocks reverse-then-edit", async () => {
    const persistence = await makePersistence();
    const created = await createFxTransfer(persistence, "user-1", {
      fromAccountId: "acc-1",
      toAccountId: "acc-usd",
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: "2026-04-01",
    });

    await updateFxTransfer(persistence, "user-1", created.fxTransferId, {
      fromAmount: 500,
      toAmount: 16,
      effectiveRate: 0.032,
      notes: "Trimmed",
    });
    const reversed = await reverseFxTransfer(persistence, "user-1", created.fxTransferId, { reason: "test reversal" });

    const entries = await loadCashEntries(persistence);
    expect(entries.find((entry) => entry.id === created.legOutId)?.amount).toBe(-500);
    expect(entries.find((entry) => entry.id === reversed.reversalLegOutId)).toMatchObject({
      entryType: "REVERSAL",
      amount: 500,
      fxTransferId: created.fxTransferId,
      reversalOfCashLedgerEntryId: created.legOutId,
    });

    await expect(
      updateFxTransfer(persistence, "user-1", created.fxTransferId, {
        fromAmount: 400,
        toAmount: 12.8,
        effectiveRate: 0.032,
      }),
    ).rejects.toMatchObject({ code: "fx_transfer_already_reversed", statusCode: 409 });
  });
});
