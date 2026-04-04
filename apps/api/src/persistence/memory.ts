import { randomUUID } from "node:crypto";
import type { Lot } from "@tw-portfolio/domain";
import { createStore, setStoreInstruments, syncInstruments } from "../services/store.js";
import { upsertInstrumentDefinitions } from "../services/instrumentRegistry.js";
import type {
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  LotAllocationProjection,
  MarketDataFacts,
  Store,
} from "../types/store.js";
import type { DailyBar } from "@tw-portfolio/domain";
import type { InstrumentCatalogItemDto, MonitoredTickerDto, NotificationDto, ProfileDto } from "@tw-portfolio/shared-types";
import { routeError } from "../lib/routeError.js";
import { rebuildHoldingProjection } from "../services/accountingStore.js";
import type { CatalogInstrument, CatalogSyncResult, DelistingRecord, DeleteTradeEventResult, OAuthClaims, Persistence, ReadinessStatus, TradeEventPatch } from "./types.js";

interface MemoryNotification {
  id: string;
  userId: string;
  severity: "info" | "warning" | "error";
  source: string;
  sourceRef: string | null;
  title: string;
  body: string | null;
  detail: unknown;
  readAt: string | null;
  escalatedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryInstrument {
  ticker: string;
  name: string | null;
  instrumentType: string | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt?: string | null;
  delistedAt?: string;
}

interface MemoryPersistenceOptions {
  seedCatalog?: boolean;
}

const DEFAULT_MEMORY_CATALOG: MemoryInstrument[] = [
  { ticker: "2330", name: "台積電", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "2317", name: "鴻海", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
  { ticker: "0050", name: "元大台灣50", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "00679B", name: "元大美債20年", instrumentType: "BOND_ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "020000", name: "富邦臺灣加權ETN", instrumentType: null, marketCode: "TW", barsBackfillStatus: "pending" },
];

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
  private readonly dailyBars: DailyBar[] = [];
  /** email → MemoryUser (identity resolution index) */
  private readonly usersByEmail = new Map<string, MemoryUser>();
  /** userId → Set<ticker> (manual monitoring selections) */
  private readonly monitoredTickers = new Map<string, Map<string, string>>();
  /** userId → NotificationDto[] (in-memory notification store for E2E) */
  private readonly notifications = new Map<string, MemoryNotification[]>();
  /** ticker → MemoryInstrument (instrument catalog for monitored tickers) */
  private readonly instruments = new Map<string, MemoryInstrument>();
  /** userId → (ticker → MemoryInstrument) test-only catalog overrides */
  private readonly instrumentsByUser = new Map<string, Map<string, MemoryInstrument>>();

  constructor(private readonly options: MemoryPersistenceOptions = {}) {}

  async init(): Promise<void> {
    if (this.options.seedCatalog === true && this.instruments.size === 0) {
      this._replaceInstruments(DEFAULT_MEMORY_CATALOG);
    }
  }

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
    syncInstruments(store);
    this.stores.set(store.userId, store);
  }

  async upsertInstruments(userId: string, instruments: Store["instruments"]): Promise<void> {
    if (instruments.length === 0) return;
    const store = await this.loadStore(userId);
    setStoreInstruments(store, upsertInstrumentDefinitions(store.instruments, instruments));
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
    syncInstruments(store);
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

  async getLatestBars(tickers: string[], limit: number): Promise<DailyBar[]> {
    const tickerSet = new Set(tickers);
    const grouped = new Map<string, DailyBar[]>();
    for (const bar of this.dailyBars) {
      if (!tickerSet.has(bar.ticker)) continue;
      const list = grouped.get(bar.ticker) ?? [];
      list.push(bar);
      grouped.set(bar.ticker, list);
    }
    const result: DailyBar[] = [];
    for (const bars of grouped.values()) {
      bars.sort((a, b) => b.barDate.localeCompare(a.barDate));
      result.push(...bars.slice(0, limit));
    }
    return result;
  }

  _seedDailyBars(bars: DailyBar[]): void { this.dailyBars.push(...bars); }
  _clearDailyBars(): void { this.dailyBars.length = 0; }

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

  // --- Instruments ---

  async getInstrument(ticker: string): Promise<import("./types.js").InstrumentRow | null> {
    const instrument =
      this.instruments.get(ticker)
      ?? [...this.instrumentsByUser.values()]
        .map((catalog) => catalog.get(ticker))
        .find((item): item is MemoryInstrument => Boolean(item));
    if (!instrument) return null;
    const now = new Date().toISOString();
    return {
      ticker: instrument.ticker,
      instrumentType: (instrument.instrumentType as import("@tw-portfolio/domain").InstrumentType) ?? null,
      marketCode: instrument.marketCode,
      name: instrument.name ?? undefined,
      isProvisional: false,
      barsBackfillStatus: instrument.barsBackfillStatus as import("@tw-portfolio/domain").BackfillStatus,
      lastRepairAt: instrument.lastRepairAt ?? undefined,
      verificationStatus: "unverified",
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateBackfillStatus(_ticker: string, _status: import("@tw-portfolio/domain").BackfillStatus): Promise<void> {
    // No-op in memory mode
  }

  async updateLastRepairAt(ticker: string): Promise<void> {
    const now = new Date().toISOString();
    for (const catalog of [this.instruments, ...this.instrumentsByUser.values()]) {
      const current = catalog.get(ticker);
      if (current) {
        catalog.set(ticker, { ...current, lastRepairAt: now });
      }
    }
  }

  // --- Monitored Tickers ---

  async getMonitoredSet(userId: string): Promise<MonitoredTickerDto[]> {
    const manualTickers = this.monitoredTickers.get(userId) ?? new Map<string, string>();
    const store = this.stores.get(userId);
    const catalog = this._catalogForUser(userId);

    // Collect position-derived tickers (lots with open_quantity > 0)
    const positionTickers = new Set<string>();
    if (store) {
      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity > 0) {
          positionTickers.add(lot.ticker);
        }
      }
    }

    // Build union: manual selections take precedence
    const result: MonitoredTickerDto[] = [];
    const seen = new Set<string>();

    for (const ticker of manualTickers.keys()) {
      seen.add(ticker);
      const instrument = catalog.get(ticker);
      result.push({
        ticker,
        source: "manual",
        name: instrument?.name ?? null,
        instrumentType: (instrument?.instrumentType as MonitoredTickerDto["instrumentType"]) ?? null,
        barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        lastRepairAt: instrument?.lastRepairAt ?? null,
      });
    }

    for (const ticker of positionTickers) {
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      const instrument = catalog.get(ticker);
      result.push({
        ticker,
        source: "position",
        name: instrument?.name ?? null,
        instrumentType: (instrument?.instrumentType as MonitoredTickerDto["instrumentType"]) ?? null,
        barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        lastRepairAt: instrument?.lastRepairAt ?? null,
      });
    }

    return result;
  }

  async getAllMonitoredTickers(): Promise<string[]> {
    return [];
  }

  async getUsersMonitoringTicker(_ticker: string): Promise<string[]> {
    return [];
  }

  async getManualSelections(userId: string): Promise<{ ticker: string; addedAt: string }[]> {
    const selections = this.monitoredTickers.get(userId);
    if (!selections) return [];
    return [...selections.entries()].map(([ticker, addedAt]) => ({ ticker, addedAt }));
  }

  async replaceManualSelections(userId: string, tickers: string[]): Promise<{ newTickers: string[] }> {
    // Get current full monitored set before replacing
    const currentSet = await this.getMonitoredSet(userId);
    const currentTickers = new Set(currentSet.map((s) => s.ticker));

    // Replace manual selections
    const now = new Date().toISOString();
    const newSelections = new Map<string, string>();
    for (const ticker of tickers) {
      newSelections.set(ticker, now);
    }
    this.monitoredTickers.set(userId, newSelections);

    // Compute genuinely new tickers (not in current full monitored set)
    const newTickers = tickers.filter((t) => !currentTickers.has(t));
    return { newTickers };
  }

  async listInstrumentsCatalog(search?: string, type?: string, userId?: string): Promise<InstrumentCatalogItemDto[]> {
    let results = [...this._catalogForUser(userId).values()].filter((instrument) => !instrument.delistedAt);

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (i) => i.ticker.toLowerCase().includes(q) || (i.name?.toLowerCase().includes(q) ?? false),
      );
    }

    if (type) {
      results = results.filter((i) => i.instrumentType === type);
    }

    return results.map((i) => ({
      ticker: i.ticker,
      name: i.name,
      instrumentType: i.instrumentType as InstrumentCatalogItemDto["instrumentType"],
      marketCode: i.marketCode,
      barsBackfillStatus: i.barsBackfillStatus,
      lastRepairAt: i.lastRepairAt ?? null,
    }));
  }

  async upsertInstrumentCatalog(_instruments: CatalogInstrument[], _delistings: DelistingRecord[]): Promise<CatalogSyncResult> {
    return { upserted: 0, delisted: 0 };
  }

  // --- Notifications (KZO-132) — functional in-memory impl for E2E ---

  async createNotification(notification: {
    userId: string;
    severity: "info" | "warning" | "error";
    source: string;
    sourceRef?: string;
    title: string;
    body?: string;
    detail?: unknown;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entry: MemoryNotification = {
      id,
      userId: notification.userId,
      severity: notification.severity,
      source: notification.source,
      sourceRef: notification.sourceRef ?? null,
      title: notification.title,
      body: notification.body ?? null,
      detail: notification.detail ?? null,
      readAt: null,
      escalatedAt: null,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const list = this.notifications.get(notification.userId) ?? [];
    list.push(entry);
    this.notifications.set(notification.userId, list);
    return id;
  }

  async getNotificationsForUser(userId: string, opts: { page: number; limit: number }): Promise<{ notifications: NotificationDto[]; total: number }> {
    const all = (this.notifications.get(userId) ?? [])
      .filter((n) => n.dismissedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (opts.page - 1) * opts.limit;
    const page = all.slice(offset, offset + opts.limit);
    return { notifications: page.map(toNotificationDto), total: all.length };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return (this.notifications.get(userId) ?? [])
      .filter((n) => n.readAt === null && n.dismissedAt === null)
      .length;
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const n = list.find((x) => x.id === notificationId && x.dismissedAt === null);
    if (!n) throw routeError(404, "notification_not_found", "Notification not found");
    n.readAt = new Date().toISOString();
    n.updatedAt = n.readAt;
  }

  async markAllRead(userId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const n of this.notifications.get(userId) ?? []) {
      if (n.readAt === null && n.dismissedAt === null) {
        n.readAt = now;
        n.updatedAt = now;
      }
    }
  }

  async dismissNotification(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const n = list.find((x) => x.id === notificationId && x.dismissedAt === null);
    if (!n) throw routeError(404, "notification_not_found", "Notification not found");
    n.dismissedAt = new Date().toISOString();
    n.updatedAt = n.dismissedAt;
  }

  async markNotificationEscalated(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const n = list.find((x) => x.id === notificationId && x.dismissedAt === null);
    if (!n) throw routeError(404, "notification_not_found", "Notification not found");
    n.escalatedAt = new Date().toISOString();
    n.updatedAt = n.escalatedAt;
  }

  // --- Refresh Batches (KZO-132) — no-op stubs ---

  async createRefreshBatch(_userId: string | null, _jobsTotal: number): Promise<string> {
    return "";
  }

  async updateBatchTickerResult(
    _batchId: string,
    _ticker: string,
    _result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ): Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null> {
    return null;
  }

  async getRefreshBatch(_batchId: string): Promise<{
    id: string;
    status: string;
    jobsTotal: number;
    jobsSucceeded: number;
    jobsFailed: number;
    tickerResults: Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>;
  } | null> {
    return null;
  }

  async completeRefreshBatch(_batchId: string, _status: "completed" | "failed"): Promise<void> {}

  // --- Test helpers ---

  /** @internal Test-only: seed an instrument into the in-memory catalog. */
  _seedInstrument(instrument: MemoryInstrument, userId?: string): void {
    this._catalogForWrite(userId).set(instrument.ticker, instrument);
  }

  /** @internal Test-only: replace the in-memory catalog with the provided instruments. */
  _replaceInstruments(instruments: MemoryInstrument[], userId?: string): void {
    const catalog = this._catalogForWrite(userId);
    catalog.clear();
    for (const instrument of instruments) {
      this._seedInstrument(instrument, userId);
    }
  }

  private _catalogForUser(userId?: string): Map<string, MemoryInstrument> {
    return (userId ? this.instrumentsByUser.get(userId) : undefined) ?? this.instruments;
  }

  private _catalogForWrite(userId?: string): Map<string, MemoryInstrument> {
    if (!userId) {
      return this.instruments;
    }

    let catalog = this.instrumentsByUser.get(userId);
    if (!catalog) {
      catalog = new Map<string, MemoryInstrument>();
      this.instrumentsByUser.set(userId, catalog);
    }
    return catalog;
  }
}

function toNotificationDto(n: MemoryNotification): NotificationDto {
  return {
    id: n.id,
    userId: n.userId,
    severity: n.severity,
    source: n.source,
    sourceRef: n.sourceRef,
    title: n.title,
    body: n.body,
    detail: n.detail,
    readAt: n.readAt,
    escalatedAt: n.escalatedAt,
    dismissedAt: n.dismissedAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}
