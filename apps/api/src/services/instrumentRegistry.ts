import type { InstrumentType } from "@tw-portfolio/domain";
import { setStoreInstruments } from "./store.js";
import type { Store, InstrumentDef } from "../types/store.js";

const DEFAULT_MARKET_CODE = "TW";
const DEFAULT_PROVISIONAL_TYPE: InstrumentType = "STOCK";

const DEFAULT_INSTRUMENTS: InstrumentDef[] = [
  { ticker: "2330", type: "STOCK", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
  { ticker: "0050", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
  { ticker: "00919", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
  { ticker: "0056", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
];

export function createDefaultInstruments(): InstrumentDef[] {
  return DEFAULT_INSTRUMENTS.map((instrument) => ({ ...instrument }));
}

export function normalizeTickerInput(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function buildProvisionalInstrument(ticker: string): InstrumentDef {
  return {
    ticker: normalizeTickerInput(ticker),
    type: DEFAULT_PROVISIONAL_TYPE,
    marketCode: DEFAULT_MARKET_CODE,
    isProvisional: true,
    lastSyncedAt: null,
  };
}

export function listTransactionInstruments(current: InstrumentDef[]): InstrumentDef[] {
  const merged = upsertInstrumentDefinitions(current, createDefaultInstruments());
  const mergedByTicker = new Map(merged.map((instrument) => [instrument.ticker, instrument]));
  return DEFAULT_INSTRUMENTS.map((instrument) => mergedByTicker.get(instrument.ticker) ?? { ...instrument });
}

export function ensureInstrumentDefinition(store: Store, rawTicker: string): { instrument: InstrumentDef; created: boolean } {
  setStoreInstruments(store, upsertInstrumentDefinitions(store.instruments, createDefaultInstruments()));
  const ticker = normalizeTickerInput(rawTicker);
  const existing = store.instruments.find((instrument) => instrument.ticker === ticker);

  if (existing) {
    return { instrument: existing, created: false };
  }

  const provisional = buildProvisionalInstrument(ticker);
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
    (left, right) => `${left.marketCode ?? DEFAULT_MARKET_CODE}:${left.ticker}`.localeCompare(
      `${right.marketCode ?? DEFAULT_MARKET_CODE}:${right.ticker}`,
    ),
  );
}
