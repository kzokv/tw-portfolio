import type { FeeProfile, InstrumentRef } from "@tw-portfolio/domain";
import { buildAccountingPolicy } from "./accountingStore.js";
import { createDefaultInstruments } from "./instrumentRegistry.js";
import type { Store, InstrumentDef } from "../types/store.js";

const defaultFeeProfile: FeeProfile = {
  id: "fp-default",
  name: "Default Broker",
  boardCommissionRate: 1.425,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 20,
  commissionCurrency: "TWD",
  commissionRoundingMode: "FLOOR",
  taxRoundingMode: "FLOOR",
  stockSellTaxRateBps: 30,
  stockDayTradeTaxRateBps: 15,
  etfSellTaxRateBps: 10,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT",
};

function createDefaultFeeProfile(): FeeProfile {
  return { ...defaultFeeProfile };
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
  const seededFeeProfile = createDefaultFeeProfile();
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
