import { randomUUID } from "node:crypto";
import { createStore } from "../services/store.js";
import { upsertSymbolDefinitions } from "../services/symbolRegistry.js";
import type { AccountingStore, Store } from "../types/store.js";
import type { Quote } from "../providers/marketData.js";
import type { ProfileDto } from "@tw-portfolio/shared-types";
import { routeError } from "../lib/routeError.js";
import type { OAuthClaims, Persistence, ReadinessStatus } from "./types.js";

interface MemoryUser {
  id: string;
  email: string;
  displayName: string | null;
  providerSubject: string;
  providerDisplayName: string | null;
  providerPictureUrl: string | null;
  isDemo?: boolean;
  demoExpiresAt?: Date;
}

export class MemoryPersistence implements Persistence {
  private readonly stores = new Map<string, Store>();
  private readonly idempotencyKeys = new Map<string, Set<string>>();
  private readonly quoteCache = new Map<string, Quote>();
  /** email → MemoryUser (identity resolution index) */
  private readonly usersByEmail = new Map<string, MemoryUser>();

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async resolveOrCreateUser(provider: string, providerSubject: string, claims: OAuthClaims): Promise<string> {
    const existing = this.usersByEmail.get(claims.email);

    if (existing) {
      // Subsequent login: update mutable fields, never touch email
      existing.displayName = claims.name ?? existing.displayName;
      existing.providerSubject = providerSubject;
      existing.providerDisplayName = claims.name ?? existing.providerDisplayName;
      existing.providerPictureUrl = claims.picture ?? existing.providerPictureUrl;
      // Sync displayName to already-cached store settings so callers see the updated name.
      if (claims.name) {
        const cachedStore = this.stores.get(existing.id);
        if (cachedStore) cachedStore.settings.displayName = claims.name;
      }
      return existing.id;
    }

    // New user: generate UUID, seed all fields
    const userId = randomUUID();
    this.usersByEmail.set(claims.email, {
      id: userId,
      email: claims.email,
      displayName: claims.name ?? null,
      providerSubject,
      providerDisplayName: claims.name ?? null,
      providerPictureUrl: claims.picture ?? null,
    });

    // Ensure default portfolio data for the new user
    await this.ensureDefaultPortfolioData(userId);

    return userId;
  }

  async ensureDefaultPortfolioData(userId: string): Promise<void> {
    // In memory persistence, loadStore already creates default data (fee profile, account, etc.)
    // Just ensure the store exists for this user.
    await this.loadStore(userId);
  }

  async loadStore(userId: string) {
    const existing = this.stores.get(userId);
    if (existing) return existing;

    const store = createStore();
    store.userId = userId;
    store.settings.userId = userId;
    store.accounts = store.accounts.map((account) => ({ ...account, userId }));

    // Surface displayName from identity resolution (if user was bootstrapped via resolveOrCreateUser)
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (memUser?.displayName) {
      store.settings.displayName = memUser.displayName;
    }

    this.stores.set(userId, store);
    return store;
  }

  async saveStore(store: Store): Promise<void> {
    this.stores.set(store.userId, store);
  }

  async upsertSymbols(userId: string, symbols: Store["symbols"]): Promise<void> {
    if (symbols.length === 0) return;
    const store = await this.loadStore(userId);
    store.symbols = upsertSymbolDefinitions(store.symbols, symbols);
    this.stores.set(userId, store);
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

  async savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    dividendLedgerEntryId: string,
  ): Promise<void> {
    const store = await this.loadStore(userId);
    const existingDividendLedgerEntry = store.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === dividendLedgerEntryId,
    );
    if (existingDividendLedgerEntry && existingDividendLedgerEntry.postingStatus !== "expected") {
      throw new Error(
        `posted dividend ledger entry ${dividendLedgerEntryId} already exists and cannot be overwritten in place`,
      );
    }

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

  async getProfile(userId: string): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    return {
      userId: memUser.id,
      email: memUser.email,
      displayName: memUser.displayName,
      providerPictureUrl: memUser.providerPictureUrl,
      providerDisplayName: memUser.providerDisplayName,
      linkedAt: null,
      lastSeenAt: null,
    };
  }

  async updateProfileEmail(userId: string, email: string): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    // Re-key the map if email changed
    if (memUser.email !== email) {
      const existing = this.usersByEmail.get(email);
      if (existing && existing.id !== userId) {
        throw routeError(409, "email_conflict", "Email is already in use");
      }
      this.usersByEmail.delete(memUser.email);
      memUser.email = email;
      this.usersByEmail.set(email, memUser);
    }
    return this.getProfile(userId);
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

  async markDemoUser(userId: string, ttlSeconds: number): Promise<void> {
    const user = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (user) {
      user.isDemo = true;
      user.demoExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
    }
  }
}
