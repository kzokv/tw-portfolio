import type { Lot } from "@tw-portfolio/domain";
import type { AccountingStore, BookedTradeEvent, CashLedgerEntry, LotAllocationProjection, Store, SymbolDef } from "../types/store.js";
import type { Quote } from "../providers/marketData.js";
import type { ProfileDto } from "@tw-portfolio/shared-types";

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
  symbol: string;
  feePolicySnapshotId: string;
  deletedChildRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
  };
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
  upsertSymbols(userId: string, symbols: SymbolDef[]): Promise<void>;
  loadAccountingStore(userId: string): Promise<AccountingStore>;
  saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void>;
  savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void>;
  savePostedDividend(userId: string, accounting: AccountingStore, dividendLedgerEntryId: string): Promise<void>;
  claimIdempotencyKey(userId: string, key: string): Promise<boolean>;
  releaseIdempotencyKey(userId: string, key: string): Promise<void>;
  getProfile(userId: string): Promise<ProfileDto>;
  updateProfileEmail(userId: string, email: string): Promise<ProfileDto>;
  getCachedQuotes(symbols: string[]): Promise<Record<string, Quote>>;
  cacheQuotes(quotes: Quote[]): Promise<void>;
  readiness(): Promise<ReadinessStatus>;
  markDemoUser(userId: string, ttlSeconds: number): Promise<void>;

  // Transaction mutation methods
  getTradeEvent(userId: string, tradeEventId: string): Promise<BookedTradeEvent | null>;
  deleteTradeEvent(userId: string, tradeEventId: string): Promise<DeleteTradeEventResult>;
  updateTradeEvent(userId: string, tradeEventId: string, patch: TradeEventPatch): Promise<{ accountId: string; symbol: string }>;
  getTradeEventsForAccountSymbol(userId: string, accountId: string, symbol: string): Promise<BookedTradeEvent[]>;
  deleteLotsForAccountSymbol(userId: string, accountId: string, symbol: string): Promise<number>;
  deleteLotAllocationsForAccountSymbol(userId: string, accountId: string, symbol: string): Promise<number>;
  deleteTradeCashEntriesForAccountSymbol(userId: string, accountId: string, symbol: string): Promise<number>;
  bulkUpsertLots(userId: string, lots: Lot[]): Promise<void>;
  bulkInsertLotAllocations(userId: string, allocations: LotAllocationProjection[]): Promise<void>;
  bulkInsertCashLedgerEntries(userId: string, entries: CashLedgerEntry[]): Promise<void>;
  compactBookingSequence(userId: string, accountId: string, tradeDate: string): Promise<void>;
}
