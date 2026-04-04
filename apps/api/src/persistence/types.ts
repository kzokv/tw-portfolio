import type { BackfillStatus, InstrumentRef, Lot, VerificationStatus } from "@tw-portfolio/domain";
import type {
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  LotAllocationProjection,
  MarketDataFacts,
  Store,
  InstrumentDef,
} from "../types/store.js";
import type { DailyBar } from "@tw-portfolio/domain";
import type { InstrumentCatalogItemDto, MonitoredTickerDto, NotificationDto, ProfileDto } from "@tw-portfolio/shared-types";

export interface ReadinessStatus {
  backend: "postgres" | "memory";
  postgres: boolean;
  redis: boolean;
}

/** Claims from the OAuth provider's ID token, used for identity resolution. */
export interface OAuthClaims {
  email: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
}

export interface TradeEventPatch {
  date?: string;
  quantity?: number;
  price?: number;
  side?: "BUY" | "SELL";
  commissionAmount?: number;
  taxAmount?: number;
  feesSource?: "CALCULATED" | "MANUAL";
}

export interface DeleteTradeEventResult {
  accountId: string;
  ticker: string;
  feePolicySnapshotId: string;
  deletedChildRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
  };
}

export interface InstrumentRow extends InstrumentRef {
  typeRaw?: string;
  industryCategoryRaw?: string;
  finmindDate?: string;
  delistedAt?: string;
  lastRepairAt?: string;
  statusReason?: string;
  barsBackfillStatus: BackfillStatus;
  verificationStatus: VerificationStatus;
  verificationNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogInstrument {
  ticker: string;
  name: string;
  typeRaw: string;
  industryCategoryRaw: string;
  finmindDate: string;
  instrumentType: import("@tw-portfolio/domain").InstrumentType | null;
}

export interface DelistingRecord {
  ticker: string;
  name: string;
  date: string;
}

export interface CatalogSyncResult {
  upserted: number;
  delisted: number;
}

export interface Persistence {
  init(): Promise<void>;
  close(): Promise<void>;
  /**
   * Resolve an existing user by email or create a new one.
   * Returns the internal UUID for the user.
   *
   * Field sync rules:
   * - First login: seed all fields from claims
   * - Subsequent login: update display_name, provider fields, last_seen_at; never touch email
   */
  resolveOrCreateUser(provider: string, providerSubject: string, claims: OAuthClaims): Promise<string>;
  /** @internal — used by resolveOrCreateUser and dev_bypass loadStore. Not for direct use from routes. */
  ensureDefaultPortfolioData(userId: string): Promise<void>;
  loadStore(userId: string): Promise<Store>;
  saveStore(store: Store): Promise<void>;
  upsertInstruments(userId: string, instruments: InstrumentDef[]): Promise<void>;
  loadAccountingStore(userId: string): Promise<AccountingStore>;
  saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void>;
  savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void>;
  savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    marketData: MarketDataFacts,
    dividendLedgerEntryId: string,
  ): Promise<void>;
  claimIdempotencyKey(userId: string, key: string): Promise<boolean>;
  releaseIdempotencyKey(userId: string, key: string): Promise<void>;
  getProfile(userId: string): Promise<ProfileDto>;
  updateProfileEmail(userId: string, email: string): Promise<ProfileDto>;
  getLatestBars(tickers: string[], limit: number): Promise<DailyBar[]>;
  readiness(): Promise<ReadinessStatus>;
  markDemoUser(userId: string, ttlSeconds: number): Promise<void>;

  // Transaction mutation methods
  getTradeEvent(userId: string, tradeEventId: string): Promise<BookedTradeEvent | null>;
  deleteTradeEvent(userId: string, tradeEventId: string): Promise<DeleteTradeEventResult>;
  updateTradeEvent(userId: string, tradeEventId: string, patch: TradeEventPatch): Promise<{ accountId: string; ticker: string }>;
  getTradeEventsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<BookedTradeEvent[]>;
  deleteLotsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number>;
  deleteLotAllocationsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number>;
  deleteTradeCashEntriesForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number>;
  bulkUpsertLots(userId: string, lots: Lot[]): Promise<void>;
  bulkInsertLotAllocations(userId: string, allocations: LotAllocationProjection[]): Promise<void>;
  bulkInsertCashLedgerEntries(userId: string, entries: CashLedgerEntry[]): Promise<void>;
  compactBookingSequence(userId: string, accountId: string, tradeDate: string): Promise<void>;

  // Instruments
  getInstrument(ticker: string): Promise<InstrumentRow | null>;
  updateBackfillStatus(ticker: string, status: BackfillStatus): Promise<void>;
  updateLastRepairAt(ticker: string): Promise<void>;

  // Monitored tickers
  getMonitoredSet(userId: string): Promise<MonitoredTickerDto[]>;
  getAllMonitoredTickers(): Promise<string[]>;
  getUsersMonitoringTicker(ticker: string): Promise<string[]>;
  getManualSelections(userId: string): Promise<{ ticker: string; addedAt: string }[]>;
  replaceManualSelections(userId: string, tickers: string[]): Promise<{ newTickers: string[] }>;
  listInstrumentsCatalog(search?: string, type?: string, userId?: string): Promise<InstrumentCatalogItemDto[]>;

  // Catalog sync
  upsertInstrumentCatalog(instruments: CatalogInstrument[], delistings: DelistingRecord[]): Promise<CatalogSyncResult>;

  // Notifications (KZO-132)
  createNotification(notification: {
    userId: string;
    severity: "info" | "warning" | "error";
    source: string;
    sourceRef?: string;
    title: string;
    body?: string;
    detail?: unknown;
  }): Promise<string>;
  getNotificationsForUser(userId: string, opts: { page: number; limit: number }): Promise<{ notifications: NotificationDto[]; total: number }>;
  getUnreadCount(userId: string): Promise<number>;
  markNotificationRead(userId: string, notificationId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  dismissNotification(userId: string, notificationId: string): Promise<void>;
  markNotificationEscalated(userId: string, notificationId: string): Promise<void>;

  // Refresh batches (KZO-132)
  createRefreshBatch(userId: string | null, jobsTotal: number): Promise<string>;
  updateBatchTickerResult(
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ): Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null>;
  getRefreshBatch(batchId: string): Promise<{
    id: string;
    status: string;
    jobsTotal: number;
    jobsSucceeded: number;
    jobsFailed: number;
    tickerResults: Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>;
  } | null>;
  completeRefreshBatch(batchId: string, status: "completed" | "failed"): Promise<void>;
}
