import { randomUUID } from "node:crypto";
import type { Lot } from "@tw-portfolio/domain";
import { createStore, setStoreSymbols, syncLegacySymbols } from "../services/store.js";
import { upsertSymbolDefinitions } from "../services/symbolRegistry.js";
import { upsertDividendEvent } from "../services/marketDataStore.js";
import type {
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  LotAllocationProjection,
  MarketDataFacts,
  Store,
  DividendEvent,
} from "../types/store.js";
import type { Quote } from "../providers/marketData.js";
import type { ProfileDto } from "@tw-portfolio/shared-types";
import { routeError } from "../lib/routeError.js";
import { rebuildHoldingProjection } from "../services/accountingStore.js";
import type { DeleteTradeEventResult, OAuthClaims, Persistence, ReadinessStatus, TradeEventPatch } from "./types.js";

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
    syncLegacySymbols(store);
    this.stores.set(store.userId, store);
  }

  async upsertSymbols(userId: string, symbols: Store["symbols"]): Promise<void> {
    if (symbols.length === 0) return;
    const store = await this.loadStore(userId);
    setStoreSymbols(store, upsertSymbolDefinitions(store.symbols, symbols));
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

  async saveDividendEvent(userId: string, dividendEvent: DividendEvent): Promise<void> {
    const store = await this.loadStore(userId);
    upsertDividendEvent(store, dividendEvent);
    this.stores.set(userId, store);
  }

  async savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    marketData: MarketDataFacts,
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

    store.accounting = accounting;
    store.marketData = marketData;
    syncLegacySymbols(store);
    this.stores.set(userId, store);
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
      this.quoteCache.set(quote.ticker, quote);
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

  async getTradeEvent(userId: string, tradeEventId: string): Promise<BookedTradeEvent | null> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.tradeEvents.find((t) => t.id === tradeEventId && t.userId === userId) ?? null;
  }

  async deleteTradeEvent(userId: string, tradeEventId: string): Promise<DeleteTradeEventResult> {
    const store = await this.loadStore(userId);
    const tradeIndex = store.accounting.facts.tradeEvents.findIndex((t) => t.id === tradeEventId && t.userId === userId);
    if (tradeIndex === -1) {
      throw routeError(404, "trade_event_not_found", "Trade event not found");
    }
    const trade = store.accounting.facts.tradeEvents[tradeIndex];

    // Count child rows
    const cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) => e.relatedTradeEventId === tradeEventId,
    ).length;
    const lotAllocations = store.accounting.projections.lotAllocations.filter(
      (a) => a.tradeEventId === tradeEventId,
    ).length;

    // Remove trade
    store.accounting.facts.tradeEvents.splice(tradeIndex, 1);

    // Remove related cash ledger entries (CASCADE equivalent)
    store.accounting.facts.cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) => e.relatedTradeEventId !== tradeEventId,
    );

    // Remove related lot allocations (CASCADE equivalent)
    store.accounting.projections.lotAllocations = store.accounting.projections.lotAllocations.filter(
      (a) => a.tradeEventId !== tradeEventId,
    );

    return {
      accountId: trade.accountId,
      ticker: trade.ticker,
      feePolicySnapshotId: `trade-fee-snapshot:${tradeEventId}`,
      deletedChildRows: { cashLedgerEntries, lotAllocations },
    };
  }

  async updateTradeEvent(userId: string, tradeEventId: string, patch: TradeEventPatch): Promise<{ accountId: string; ticker: string }> {
    const store = await this.loadStore(userId);
    const trade = store.accounting.facts.tradeEvents.find((t) => t.id === tradeEventId && t.userId === userId);
    if (!trade) {
      throw routeError(404, "trade_event_not_found", "Trade event not found");
    }

    const oldTradeDate = trade.tradeDate;

    if (patch.date !== undefined) {
      trade.tradeDate = patch.date;
      trade.tradeTimestamp = new Date(`${patch.date}T00:00:00.000Z`).toISOString();
    }
    if (patch.quantity !== undefined) trade.quantity = patch.quantity;
    if (patch.price !== undefined) trade.unitPrice = patch.price;
    if (patch.side !== undefined) trade.type = patch.side;
    if (patch.commissionAmount !== undefined) trade.commissionAmount = patch.commissionAmount;
    if (patch.taxAmount !== undefined) trade.taxAmount = patch.taxAmount;
    if (patch.feesSource !== undefined) trade.feesSource = patch.feesSource;

    // Handle date change: assign new booking sequence + compact old date
    if (patch.date && patch.date !== oldTradeDate) {
      // Find next available sequence for new date
      const tradesOnNewDate = store.accounting.facts.tradeEvents.filter(
        (t) => t.accountId === trade.accountId && t.tradeDate === patch.date && t.id !== tradeEventId,
      );
      trade.bookingSequence = tradesOnNewDate.length + 1;

      // Compact old date's booking sequence
      const tradesOnOldDate = store.accounting.facts.tradeEvents
        .filter((t) => t.accountId === trade.accountId && t.tradeDate === oldTradeDate)
        .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
      tradesOnOldDate.forEach((t, i) => {
        t.bookingSequence = i + 1;
      });
    }

    return { accountId: trade.accountId, ticker: trade.ticker };
  }

  async getTradeEventsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<BookedTradeEvent[]> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.tradeEvents
      .filter((t) => t.userId === userId && t.accountId === accountId && t.ticker === ticker)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
  }

  async deleteLotsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number> {
    const store = await this.loadStore(userId);
    const before = store.accounting.projections.lots.length;
    store.accounting.projections.lots = store.accounting.projections.lots.filter(
      (l) => !(l.accountId === accountId && l.ticker === ticker),
    );
    rebuildHoldingProjection(store);
    return before - store.accounting.projections.lots.length;
  }

  async deleteLotAllocationsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number> {
    const store = await this.loadStore(userId);
    const before = store.accounting.projections.lotAllocations.length;
    store.accounting.projections.lotAllocations = store.accounting.projections.lotAllocations.filter(
      (a) => !(a.userId === userId && a.accountId === accountId && a.ticker === ticker),
    );
    return before - store.accounting.projections.lotAllocations.length;
  }

  async deleteTradeCashEntriesForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number> {
    const store = await this.loadStore(userId);
    // Collect trade event IDs for the given account+ticker
    const tradeEventIds = new Set(
      store.accounting.facts.tradeEvents
        .filter((t) => t.userId === userId && t.accountId === accountId && t.ticker === ticker)
        .map((t) => t.id),
    );

    const before = store.accounting.facts.cashLedgerEntries.length;
    store.accounting.facts.cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) =>
        !(
          e.userId === userId &&
          e.accountId === accountId &&
          (e.entryType === "TRADE_SETTLEMENT_IN" || e.entryType === "TRADE_SETTLEMENT_OUT") &&
          e.relatedTradeEventId &&
          tradeEventIds.has(e.relatedTradeEventId)
        ),
    );
    return before - store.accounting.facts.cashLedgerEntries.length;
  }

  async bulkUpsertLots(userId: string, lots: Lot[]): Promise<void> {
    if (lots.length === 0) return;
    const store = await this.loadStore(userId);
    for (const lot of lots) {
      const existingIndex = store.accounting.projections.lots.findIndex((l) => l.id === lot.id);
      if (existingIndex >= 0) {
        store.accounting.projections.lots[existingIndex] = lot;
      } else {
        store.accounting.projections.lots.push(lot);
      }
    }
    rebuildHoldingProjection(store);
  }

  async bulkInsertLotAllocations(userId: string, allocations: LotAllocationProjection[]): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting.projections.lotAllocations.push(...allocations);
  }

  async bulkInsertCashLedgerEntries(userId: string, entries: CashLedgerEntry[]): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting.facts.cashLedgerEntries.push(...entries);
  }

  async compactBookingSequence(userId: string, accountId: string, tradeDate: string): Promise<void> {
    const store = await this.loadStore(userId);
    const trades = store.accounting.facts.tradeEvents
      .filter((t) => t.accountId === accountId && t.tradeDate === tradeDate)
      .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
    trades.forEach((t, i) => {
      t.bookingSequence = i + 1;
    });
  }
}
