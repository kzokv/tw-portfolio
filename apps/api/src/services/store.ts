import { randomUUID } from "node:crypto";
import type { FeeProfile, InstrumentRef } from "@tw-portfolio/domain";
import { buildAccountingPolicy } from "./accountingStore.js";
import { createDefaultInstruments } from "./instrumentRegistry.js";
import type { Store, InstrumentDef } from "../types/store.js";

// KZO-183: fee profiles are now account-scoped. `accountId` is required at
// creation time. The factory returns a fresh object per call so callers can
// mutate without touching shared state.
export function createDefaultFeeProfile(
  accountId: string,
  commissionCurrency: FeeProfile["commissionCurrency"] = "TWD",
  id: string = randomUUID(),
): FeeProfile {
  return {
    id,
    accountId,
    name: "Default Broker",
    boardCommissionRate: 1.425,
    commissionDiscountPercent: 0,
    minimumCommissionAmount: 20,
    commissionCurrency,
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 0,
    commissionChargeMode: "CHARGED_UPFRONT",
  };
}

export function instrumentDefToRef(def: InstrumentDef): InstrumentRef {
  return {
    ticker: def.ticker,
    instrumentType: def.type,
    marketCode: def.marketCode ?? "TW",
    isProvisional: def.isProvisional ?? false,
    lastSyncedAt: def.lastSyncedAt ?? null,
  };
}

export function instrumentRefToDef(instrument: InstrumentRef): InstrumentDef {
  return {
    ticker: instrument.ticker,
    type: instrument.instrumentType,
    marketCode: instrument.marketCode,
    isProvisional: instrument.isProvisional,
    lastSyncedAt: instrument.lastSyncedAt ?? null,
  };
}

export function setStoreInstruments(store: Pick<Store, "marketData" | "instruments">, instruments: InstrumentDef[]): void {
  store.instruments = instruments;
  store.marketData.instruments = instruments.map(instrumentDefToRef);
}

export function syncInstruments(store: Pick<Store, "marketData" | "instruments">): void {
  store.instruments = store.marketData.instruments.map(instrumentRefToDef);
}

export function createStore(): Store {
  // KZO-183: the seeded fee profile is owned by the seeded "acc-1" account.
  // Both rows are created together so the composite-FK ownership invariant
  // (account.feeProfileId references a profile with profile.accountId === account.id)
  // holds at bootstrap time.
  const seededFeeProfile = createDefaultFeeProfile("acc-1");
  const seededInstruments = createDefaultInstruments();

  return {
    userId: "user-1",
    settings: {
      userId: "user-1",
      locale: "en",
      costBasisMethod: "WEIGHTED_AVERAGE",
      quotePollIntervalSeconds: 10,
    },
    accounts: [
      {
        id: "acc-1",
        name: "Main",
        userId: "user-1",
        feeProfileId: seededFeeProfile.id,
        // KZO-167 D10 — auto-seed defaults. Mirrors the
        // ensureDefaultPortfolioData literal in apps/api/src/persistence/postgres.ts:430
        // so MemoryPersistence and PostgresPersistence agree on bootstrap shape.
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    ],
    feeProfiles: [seededFeeProfile],
    feeProfileBindings: [],
    accounting: {
      facts: {
        tradeEvents: [],
        cashLedgerEntries: [],
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
      policy: buildAccountingPolicy(),
    },
    marketData: {
      dividendEvents: [],
      instruments: seededInstruments.map(instrumentDefToRef),
    },
    instruments: seededInstruments,
    recomputeJobs: [],
    idempotencyKeys: new Set<string>(),
  };
}
