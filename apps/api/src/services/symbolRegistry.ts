import type { InstrumentType } from "@tw-portfolio/domain";
import type { Store, SymbolDef } from "../types/store.js";

const DEFAULT_MARKET_CODE = "TW";
const DEFAULT_PROVISIONAL_TYPE: InstrumentType = "STOCK";

const DEFAULT_SYMBOLS: SymbolDef[] = [
  { ticker: "2330", type: "STOCK", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
  { ticker: "0050", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
  { ticker: "00919", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
  { ticker: "0056", type: "ETF", marketCode: DEFAULT_MARKET_CODE, isProvisional: false, lastSyncedAt: null },
];

export function createDefaultSymbols(): SymbolDef[] {
  return DEFAULT_SYMBOLS.map((symbol) => ({ ...symbol }));
}

export function normalizeSymbolInput(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function buildProvisionalSymbol(ticker: string): SymbolDef {
  return {
    ticker: normalizeSymbolInput(ticker),
    type: DEFAULT_PROVISIONAL_TYPE,
    marketCode: DEFAULT_MARKET_CODE,
    isProvisional: true,
    lastSyncedAt: null,
  };
}

export function listTransactionSymbols(current: SymbolDef[]): SymbolDef[] {
  const merged = upsertSymbolDefinitions(current, createDefaultSymbols());
  const mergedByTicker = new Map(merged.map((symbol) => [symbol.ticker, symbol]));
  return DEFAULT_SYMBOLS.map((symbol) => mergedByTicker.get(symbol.ticker) ?? { ...symbol });
}

export function ensureSymbolDefinition(store: Store, rawTicker: string): { symbol: SymbolDef; created: boolean } {
  store.symbols = upsertSymbolDefinitions(store.symbols, createDefaultSymbols());
  const ticker = normalizeSymbolInput(rawTicker);
  const existing = store.symbols.find((symbol) => symbol.ticker === ticker);

  if (existing) {
    return { symbol: existing, created: false };
  }

  const nextSymbol = buildProvisionalSymbol(ticker);
  store.symbols = upsertSymbolDefinitions(store.symbols, [nextSymbol]);
  return { symbol: nextSymbol, created: true };
}

export function isSymbolQuoteable(symbol: SymbolDef | undefined): boolean {
  return Boolean(symbol) && symbol?.isProvisional !== true;
}

export function upsertSymbolDefinitions(current: SymbolDef[], incoming: SymbolDef[]): SymbolDef[] {
  const merged = new Map<string, SymbolDef>();

  for (const symbol of current) {
    merged.set(symbol.ticker, { ...symbol });
  }

  for (const symbol of incoming) {
    const previous = merged.get(symbol.ticker);
    if (!previous) {
      merged.set(symbol.ticker, { ...symbol });
      continue;
    }

    const incomingIsProvisional = symbol.isProvisional === true;
    const previousIsProvisional = previous.isProvisional === true;
    if (incomingIsProvisional && !previousIsProvisional) {
      continue;
    }

    merged.set(symbol.ticker, {
      ...previous,
      ...symbol,
      isProvisional: incomingIsProvisional ? previous.isProvisional ?? true : false,
      lastSyncedAt: symbol.lastSyncedAt ?? previous.lastSyncedAt ?? null,
    });
  }

  return [...merged.values()].sort(
    (left, right) => `${left.marketCode ?? DEFAULT_MARKET_CODE}:${left.ticker}`.localeCompare(
      `${right.marketCode ?? DEFAULT_MARKET_CODE}:${right.ticker}`,
    ),
  );
}
