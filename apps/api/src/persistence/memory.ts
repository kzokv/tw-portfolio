import { createStore } from "../services/store.js";
import type { AccountingStore, Store } from "../types/store.js";
import type { Quote } from "../providers/marketData.js";
import type { Persistence, ReadinessStatus } from "./types.js";

export class MemoryPersistence implements Persistence {
  private readonly stores = new Map<string, Store>();
  private readonly idempotencyKeys = new Map<string, Set<string>>();
  private readonly quoteCache = new Map<string, Quote>();

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async loadStore(userId: string) {
    const existing = this.stores.get(userId);
    if (existing) return existing;

    const store = createStore();
    store.userId = userId;
    store.settings.userId = userId;
    store.accounts = store.accounts.map((account) => ({ ...account, userId }));

    this.stores.set(userId, store);
    return store;
  }

  async saveStore(store: Store): Promise<void> {
    this.stores.set(store.userId, store);
  }

  async loadAccountingStore(userId: string): Promise<AccountingStore> {
    const store = await this.loadStore(userId);
    return store.accounting;
  }

  async saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting = accounting;
    this.stores.set(userId, store);
  }

  async savePostedTrade(userId: string, accounting: AccountingStore): Promise<void> {
    await this.saveAccountingStore(userId, accounting);
  }

  async claimIdempotencyKey(userId: string, key: string): Promise<boolean> {
    const existing = this.idempotencyKeys.get(userId) ?? new Set<string>();
    if (existing.has(key)) return false;
    existing.add(key);
    this.idempotencyKeys.set(userId, existing);
    return true;
  }

  async releaseIdempotencyKey(userId: string, key: string): Promise<void> {
    const existing = this.idempotencyKeys.get(userId);
    if (!existing) return;
    existing.delete(key);
    if (existing.size === 0) this.idempotencyKeys.delete(userId);
  }

  async getCachedQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const found: Record<string, Quote> = {};
    for (const symbol of symbols) {
      const quote = this.quoteCache.get(symbol);
      if (quote) found[symbol] = quote;
    }
    return found;
  }

  async cacheQuotes(quotes: Quote[]): Promise<void> {
    for (const quote of quotes) {
      this.quoteCache.set(quote.symbol, quote);
    }
  }

  async readiness(): Promise<ReadinessStatus> {
    return { backend: "memory", postgres: true, redis: true };
  }
}
