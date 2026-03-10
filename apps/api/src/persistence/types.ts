import type { AccountingStore, Store } from "../types/store.js";
import type { Quote } from "../providers/marketData.js";

export interface ReadinessStatus {
  backend: "postgres" | "memory";
  postgres: boolean;
  redis: boolean;
}

export interface Persistence {
  init(): Promise<void>;
  close(): Promise<void>;
  loadStore(userId: string): Promise<Store>;
  saveStore(store: Store): Promise<void>;
  loadAccountingStore(userId: string): Promise<AccountingStore>;
  saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void>;
  savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void>;
  savePostedDividend(userId: string, accounting: AccountingStore, dividendLedgerEntryId: string): Promise<void>;
  claimIdempotencyKey(userId: string, key: string): Promise<boolean>;
  releaseIdempotencyKey(userId: string, key: string): Promise<void>;
  getCachedQuotes(symbols: string[]): Promise<Record<string, Quote>>;
  cacheQuotes(quotes: Quote[]): Promise<void>;
  readiness(): Promise<ReadinessStatus>;
}
