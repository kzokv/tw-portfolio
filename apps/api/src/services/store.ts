import type { FeeProfile, InstrumentRef } from "@tw-portfolio/domain";
import { buildAccountingPolicy } from "./accountingStore.js";
import { createDefaultSymbols } from "./symbolRegistry.js";
import type { Store, SymbolDef } from "../types/store.js";

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

export function symbolDefToInstrumentRef(symbol: SymbolDef): InstrumentRef {
  return {
    ticker: symbol.ticker,
    instrumentType: symbol.type,
    marketCode: symbol.marketCode ?? "TW",
    isProvisional: symbol.isProvisional ?? false,
    lastSyncedAt: symbol.lastSyncedAt ?? null,
  };
}

export function instrumentRefToSymbolDef(instrument: InstrumentRef): SymbolDef {
  return {
    ticker: instrument.ticker,
    type: instrument.instrumentType,
    marketCode: instrument.marketCode,
    isProvisional: instrument.isProvisional,
    lastSyncedAt: instrument.lastSyncedAt ?? null,
  };
}

export function setStoreSymbols(store: Pick<Store, "marketData" | "symbols">, symbols: SymbolDef[]): void {
  store.symbols = symbols;
  store.marketData.instruments = symbols.map(symbolDefToInstrumentRef);
}

export function syncLegacySymbols(store: Pick<Store, "marketData" | "symbols">): void {
  store.symbols = store.marketData.instruments.map(instrumentRefToSymbolDef);
}

export function createStore(): Store {
  const seededFeeProfile = createDefaultFeeProfile();
  const seededSymbols = createDefaultSymbols();

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
      instruments: seededSymbols.map(symbolDefToInstrumentRef),
    },
    symbols: seededSymbols,
    recomputeJobs: [],
    idempotencyKeys: new Set<string>(),
  };
}
