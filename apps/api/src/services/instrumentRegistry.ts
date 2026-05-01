import type { InstrumentType, MarketCode } from "@tw-portfolio/domain";
import { setStoreInstruments } from "./store.js";
import type { Store, InstrumentDef } from "../types/store.js";

const DEFAULT_MARKET_CODE: MarketCode = "TW";
const DEFAULT_PROVISIONAL_TYPE: InstrumentType = "STOCK";

const DEFAULT_INSTRUMENTS: InstrumentDef[] = [
  { ticker: "2330", type: "STOCK", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null, typeRaw: null, industryCategoryRaw: null, finmindDate: null },
  { ticker: "0050", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null, typeRaw: null, industryCategoryRaw: null, finmindDate: null },
  { ticker: "00919", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null, typeRaw: null, industryCategoryRaw: null, finmindDate: null },
  { ticker: "0056", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null, typeRaw: null, industryCategoryRaw: null, finmindDate: null },
];

export function createDefaultInstruments(): InstrumentDef[] {
  return DEFAULT_INSTRUMENTS.map((instrument) => ({ ...instrument }));
}

export function normalizeTickerInput(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function buildProvisionalInstrument(ticker: string, marketCode: MarketCode = DEFAULT_MARKET_CODE): InstrumentDef {
  return {
    ticker: normalizeTickerInput(ticker),
    type: DEFAULT_PROVISIONAL_TYPE,
    marketCode,
    isProvisional: true,
    lastSyncedAt: null,
    typeRaw: null,
    industryCategoryRaw: null,
    finmindDate: null,
  };
}

export function listTransactionInstruments(current: InstrumentDef[]): InstrumentDef[] {
  const merged = upsertInstrumentDefinitions(current, createDefaultInstruments());
  const mergedByTicker = new Map(merged.map((instrument) => [instrument.ticker, instrument]));
  return DEFAULT_INSTRUMENTS.map((instrument) => mergedByTicker.get(instrument.ticker) ?? { ...instrument });
}

// KZO-169: signature now optionally accepts marketCode. When supplied, the
// store search filters by the composite (ticker, marketCode) tuple — needed
// to disambiguate BHP/AU vs BHP/US once US/AU ingestion lands. When omitted,
// the legacy "first match by ticker" lookup is preserved for callers that
// haven't been threaded with market context (e.g. demoData seeding).
export function ensureInstrumentDefinition(
  store: Store,
  rawTicker: string,
  marketCode?: MarketCode,
): { instrument: InstrumentDef; created: boolean } {
  setStoreInstruments(store, upsertInstrumentDefinitions(store.instruments, createDefaultInstruments()));
  const ticker = normalizeTickerInput(rawTicker);
  const existing = store.instruments.find((instrument) => {
    if (instrument.ticker !== ticker) return false;
    if (marketCode === undefined) return true;
    return instrument.marketCode === marketCode;
  });

  if (existing) {
    return { instrument: existing, created: false };
  }

  const provisional = buildProvisionalInstrument(ticker, marketCode);
  setStoreInstruments(store, upsertInstrumentDefinitions(store.instruments, [provisional]));
  return { instrument: provisional, created: true };
}

export function isInstrumentQuoteable(instrument: InstrumentDef | undefined): boolean {
  return Boolean(instrument) && instrument?.isProvisional !== true;
}

export function upsertInstrumentDefinitions(current: InstrumentDef[], incoming: InstrumentDef[]): InstrumentDef[] {
  const merged = new Map<string, InstrumentDef>();

  for (const instrument of current) {
    merged.set(instrument.ticker, { ...instrument });
  }

  for (const instrument of incoming) {
    const previous = merged.get(instrument.ticker);
    if (!previous) {
      merged.set(instrument.ticker, { ...instrument });
      continue;
    }

    const incomingIsProvisional = instrument.isProvisional === true;
    const previousIsProvisional = previous.isProvisional === true;
    if (incomingIsProvisional && !previousIsProvisional) {
      continue;
    }

    merged.set(instrument.ticker, {
      ...previous,
      ...instrument,
      isProvisional: incomingIsProvisional ? previous.isProvisional ?? true : false,
      lastSyncedAt: instrument.lastSyncedAt ?? previous.lastSyncedAt ?? null,
    });
  }

  return [...merged.values()].sort(
    (left, right) => `${left.marketCode}:${left.ticker}`.localeCompare(`${right.marketCode}:${right.ticker}`),
  );
}
