import type { FeeProfile } from "@tw-portfolio/domain";
import { buildAccountingPolicy } from "./accountingStore.js";
import type { Store } from "../types/store.js";

const defaultFeeProfile: FeeProfile = {
  id: "fp-default",
  name: "Default Broker",
  commissionRateBps: 14,
  commissionDiscountBps: 10000,
  minCommissionNtd: 20,
  commissionRoundingMode: "FLOOR",
  taxRoundingMode: "FLOOR",
  stockSellTaxRateBps: 30,
  stockDayTradeTaxRateBps: 15,
  etfSellTaxRateBps: 10,
  bondEtfSellTaxRateBps: 0,
};

function createDefaultFeeProfile(): FeeProfile {
  return { ...defaultFeeProfile };
}

export function createStore(): Store {
  const seededFeeProfile = createDefaultFeeProfile();

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
        dividendEvents: [],
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
    symbols: [
      { ticker: "2330", type: "STOCK" },
      { ticker: "0050", type: "ETF" },
      { ticker: "00679B", type: "BOND_ETF" },
    ],
    recomputeJobs: [],
    idempotencyKeys: new Set<string>(),
  };
}
