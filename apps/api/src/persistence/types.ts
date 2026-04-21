import type { BackfillStatus, InstrumentRef, Lot, VerificationStatus } from "@tw-portfolio/domain";
import type { DividendLedgerAggregates, DividendSourceLine } from "@tw-portfolio/shared-types";
import type { DividendLedgerRecomputeChange } from "../services/dividends.js";
import type {
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  DividendLedgerEntry,
  DividendPostingStatus,
  LotAllocationProjection,
  MarketDataFacts,
  Store,
  InstrumentDef,
} from "../types/store.js";
import type { DailyBar } from "@tw-portfolio/domain";
import type {
  AdminAuditLogResponse,
  AdminInviteListResponse,
  AdminUserListResponse,
  AdminUserStatus,
  InstrumentCatalogItemDto,
  InviteListStatus,
  MonitoredTickerDto,
  NotificationDto,
  ProfileDto,
} from "@tw-portfolio/shared-types";

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

export type UserRole = "admin" | "member" | "viewer";

export interface AuthUserRecord {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  sessionVersion: number;
  isDemo: boolean;
  deactivatedAt: string | null;
  deletedAt: string | null;
}

export interface ResolveOrCreateUserOptions {
  role?: UserRole;
  sessionVersion?: number;
}

export interface ResolveOrCreateUserResult {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export type InviteStatus = "valid" | "invalid" | "expired" | "used" | "revoked";
export type InviteConsumeFailure = InviteStatus | "email_mismatch";

export interface InviteRecord {
  code: string;
  email: string;
  role: UserRole;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  issuedByUserId: string | null;
  shareOwnerUserId: string | null;
  createdAt: string;
}

export interface CreateInviteInput {
  email: string;
  role: UserRole;
  expiresAt: string;
  issuedByUserId: string | null;
}

export interface ConsumeInviteResult {
  status: "consumed" | InviteConsumeFailure;
  invite?: InviteRecord;
}

export type AuditLogAction =
  | "admin_promote_cli"
  | "admin_promote_startup"
  | "admin_promote_first_signin"
  | "admin_role_change"
  | "admin_disable_user"
  | "admin_enable_user"
  | "admin_delete_user"
  | "admin_hard_purge_user"
  | "admin_invite_issued"
  | "admin_invite_revoked"
  | "share_granted"
  | "share_revoked"
  | "share_token_created"
  | "share_token_revoked"
  | "impersonation_start"
  | "impersonation_end"
  | "impersonation_blocked_write"
  | "session_force_logout"
  | "app_config_updated";

export interface ShareGrantRecord {
  id: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  granteeUserId: string;
  granteeEmail: string | null;
  granteeDisplayName: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface PendingShareInviteRecord {
  code: string;
  email: string;
  role: UserRole;
  shareOwnerUserId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
}

export interface CreateShareGrantInput {
  ownerUserId: string;
  granteeUserId: string;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export interface CreateShareCoupledInviteInput {
  ownerUserId: string;
  email: string;
  expiresAt: string;
  issuedByUserId: string | null;
}

export interface ListSharesForOwnerResult {
  active: ShareGrantRecord[];
  pending: PendingShareInviteRecord[];
  expired: PendingShareInviteRecord[];
  revoked: Array<ShareGrantRecord | PendingShareInviteRecord>;
}

export interface ListInboundSharesForGranteeResult {
  active: ShareGrantRecord[];
  revoked: ShareGrantRecord[];
}

export interface MaterializePendingSharesInput {
  userId: string;
  email: string;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export interface AnonymousShareTokenRecord {
  id: string;
  token: string;
  ownerUserId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface CreateAnonymousShareTokenInput {
  ownerUserId: string;
  token: string;
  expiresAt: string;
  ttlDays: number;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export interface RevokeAnonymousShareTokenInput {
  id: string;
  ownerUserId: string;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export type CreateAnonymousShareTokenResult =
  | { status: "ok"; record: AnonymousShareTokenRecord }
  | { status: "cap_exceeded" }
  | { status: "collision" };

export type RevokeAnonymousShareTokenResult =
  | { status: "revoked"; record: AnonymousShareTokenRecord }
  | { status: "noop" }
  | { status: "not_found" };

export interface AuditLogInput {
  actorUserId?: string | null;
  action: AuditLogAction;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
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

export interface UpdatePostedCashDividendInput {
  expectedVersion: number;
  dividendLedgerEntry: DividendLedgerEntry;
  linkedCashEntries: CashLedgerEntry[];
  dividendDeductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
  dividendSourceLines: DividendSourceLine[];
  lots: Lot[];
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

// ── Cash ledger listing (KZO-137) ────────────────────────────────────────────

export type CashLedgerSortColumn = "entryDate" | "entryType" | "amount" | "currency" | "accountId";

export interface CashLedgerListOptions {
  fromEntryDate?: string;
  toEntryDate?: string;
  accountId?: string;
  entryType?: string[];
  page: number;
  limit: number;
  sortBy: CashLedgerSortColumn;
  sortOrder: "asc" | "desc";
}

export interface CashLedgerListResult {
  entries: CashLedgerEntry[];
  total: number;
  summary: { accountId: string; currency: string; amount: number }[];
}

// ── Dividend ledger listing (KZO-135) ─────────────────────────────────────────

export type DividendLedgerSortColumn =
  | "paymentDate"
  | "ticker"
  | "account"
  | "expectedCashAmount"
  | "receivedCashAmount"
  | "reconciliationStatus";

export interface DividendLedgerListOptions {
  accountId?: string;
  fromPaymentDate?: string;
  toPaymentDate?: string;
  reconciliationStatus?: DividendLedgerEntry["reconciliationStatus"];
  postingStatus?: DividendPostingStatus;
  ticker?: string;
  page: number;
  limit: number;
  sortBy: DividendLedgerSortColumn;
  sortOrder: "asc" | "desc";
}

export type DividendLedgerEntryWithDetails = DividendLedgerEntry & {
  deductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
  sourceLines: DividendSourceLine[];
};

export interface DividendLedgerListResult {
  ledgerEntries: DividendLedgerEntryWithDetails[];
  total: number;
  aggregates: DividendLedgerAggregates;
}

export interface CatalogSyncResult {
  upserted: number;
  delisted: number;
}

// ── Holding snapshots (KZO-115) ─────────────────────────────────────────────

export interface HoldingSnapshot {
  id: string;
  userId: string;
  accountId: string;
  ticker: string;
  snapshotDate: string;
  quantity: number;
  closePrice: number | null;
  marketValue: number | null;
  costBasis: number;
  unrealizedPnl: number | null;
  cumulativeRealizedPnl: number;
  cumulativeDividends: number;
  isProvisional: boolean;
  currency: string;
  generatedAt: string;
  generationRunId: string;
}

export interface AggregatedSnapshotPoint {
  date: string;
  totalCostBasis: number;
  totalMarketValue: number | null;
  totalUnrealizedPnl: number | null;
  cumulativeRealizedPnl: number;
  cumulativeDividends: number;
  totalReturnAmount: number | null;
  totalReturnPercent: number | null;
  isProvisional: boolean;
}

/**
 * Flat dividend record for snapshot generation: the walker accumulates these
 * by (accountId, ticker) in payment-date order. Filtering (posted, not
 * reversed, not superseded) is done server-side so the walker stays simple.
 */
export interface SnapshotDividendInput {
  accountId: string;
  ticker: string;
  paymentDate: string;
  amount: number;
}

/**
 * Narrow trade shape for the snapshot walker — only the fields it actually
 * reads. Avoids loading fee policy snapshots, market data, etc., that the
 * walker does not need.
 */
export interface SnapshotTradeInput {
  id: string;
  accountId: string;
  ticker: string;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  tradeDate: string;
  bookingSequence?: number;
  commissionAmount: number;
  taxAmount: number;
}

export interface SnapshotGenerationInputs {
  trades: SnapshotTradeInput[];
  postedDividends: SnapshotDividendInput[];
}

export interface SnapshotGenerationScope {
  accountId: string;
  ticker: string;
}

// ── Admin portal list options (KZO-144) ────────────────────────────────────

export interface AdminUserListOptions {
  page: number;
  limit: number;
  search?: string;
  role?: UserRole;
  status?: AdminUserStatus;
}

export interface AdminInviteListOptions {
  page: number;
  limit: number;
  status?: InviteListStatus;
  email?: string;
}

export interface AdminAuditLogListOptions {
  page: number;
  limit: number;
  actorUserId?: string;
  targetUserId?: string;
  actions?: string[];
  fromDate?: string;
  toDate?: string;
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
  resolveOrCreateUser(
    provider: string,
    providerSubject: string,
    claims: OAuthClaims,
    options?: ResolveOrCreateUserOptions,
  ): Promise<ResolveOrCreateUserResult>;
  /** @internal — used by resolveOrCreateUser and dev_bypass loadStore. Not for direct use from routes. */
  ensureDefaultPortfolioData(userId: string): Promise<void>;
  getAuthUserById(userId: string): Promise<AuthUserRecord | null>;
  getAuthUserByEmail(email: string): Promise<AuthUserRecord | null>;
  ensureDevBypassUser(): Promise<void>;
  promoteUserToAdminByEmail(
    email: string,
    action: AuditLogInput["action"],
    metadata?: Record<string, unknown>,
  ): Promise<AuthUserRecord | null>;
  appendAuditLog(input: AuditLogInput): Promise<void>;
  bumpSessionVersion(userId: string): Promise<number>;
  createInvite(input: CreateInviteInput): Promise<InviteRecord>;
  insertBootstrapInvite(input: CreateInviteInput): Promise<InviteRecord>;
  revokeInvite(code: string): Promise<void>;
  getInviteStatus(code: string): Promise<InviteStatus>;
  getInviteRecord(code: string): Promise<InviteRecord | null>;
  consumeInvite(code: string, email: string): Promise<ConsumeInviteResult>;
  createShareGrant(input: CreateShareGrantInput): Promise<ShareGrantRecord>;
  /**
   * Revoke a share grant owned by `revokedByUserId`. Idempotent — already-revoked
   * shares silently succeed without re-emitting audit or notification. Returns
   * the grantee user id when the revoke flipped the row from active to revoked,
   * or null when the call was a no-op (already revoked). Caller uses the return
   * to decide whether to publish an SSE event.
   */
  revokeShareGrant(shareId: string, revokedByUserId: string, auditInput: Omit<AuditLogInput, "action" | "targetUserId">): Promise<{ granteeUserId: string } | null>;
  createShareCoupledInvite(input: CreateShareCoupledInviteInput): Promise<PendingShareInviteRecord>;
  countActivePendingShareInvites(ownerUserId: string): Promise<number>;
  listSharesForOwner(ownerUserId: string): Promise<ListSharesForOwnerResult>;
  listInboundSharesForGrantee(granteeUserId: string): Promise<ListInboundSharesForGranteeResult>;
  /**
   * Return `true` iff there is an active (non-revoked) share grant from `ownerUserId`
   * to `granteeUserId`. Used by the auth middleware to validate the `x-context-user-id`
   * header before hydrating `contextUserId`. Must be cheap (single indexed lookup).
   */
  validateActiveShare(ownerUserId: string, granteeUserId: string): Promise<boolean>;
  revokePendingShareInvite(
    code: string,
    ownerUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<void>;
  materializePendingSharesForEmail(input: MaterializePendingSharesInput): Promise<ShareGrantRecord[]>;
  /**
   * Atomically create an anonymous share token, enforcing the per-owner active-token
   * cap of {@link ANONYMOUS_SHARE_TOKEN_CAP}. On Postgres, serialised with a
   * transaction-scoped advisory lock keyed by owner; on memory, with a per-owner
   * async mutex. Returns `"cap_exceeded"` when the owner already holds the maximum
   * number of active tokens, or `"collision"` on a UNIQUE violation against the
   * plaintext token (caller retries with a freshly minted token).
   */
  createAnonymousShareToken(input: CreateAnonymousShareTokenInput): Promise<CreateAnonymousShareTokenResult>;
  /**
   * List tokens for the owner with the 30-day retention filter applied — active
   * rows always visible; revoked/expired rows visible for 30 days after
   * termination. Sorted `created_at DESC`.
   */
  listAnonymousShareTokensForOwner(ownerUserId: string): Promise<AnonymousShareTokenRecord[]>;
  /**
   * Resolve a plaintext token to its active record (non-revoked, not expired).
   * Returns null in all other cases — callers must not distinguish between
   * missing, expired, and revoked in their responses.
   */
  findActiveAnonymousShareTokenByToken(token: string): Promise<AnonymousShareTokenRecord | null>;
  /**
   * Revoke a token owned by `ownerUserId`. Flips `revoked_at = NOW()` only when
   * the row is currently active (`revoked_at IS NULL AND expires_at > NOW()`);
   * otherwise returns `"noop"` without writing an audit entry. Wrong-owner
   * returns `"not_found"` (no existence leak).
   */
  revokeAnonymousShareToken(input: RevokeAnonymousShareTokenInput): Promise<RevokeAnonymousShareTokenResult>;
  /** Count active (non-revoked, non-expired) tokens for the owner. */
  countActiveAnonymousShareTokensForOwner(ownerUserId: string): Promise<number>;
  /**
   * Delete terminal (revoked or expired) anonymous_share_tokens whose
   * terminality is older than `olderThanMs`. Returns the number of rows
   * deleted. Memory backend is a no-op (returns 0).
   */
  purgeTerminalAnonymousShareTokens(olderThanMs: number): Promise<number>;
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
  replaceDividendSourceLinesForLedger(userId: string, ledgerEntryId: string, sourceLines: DividendSourceLine[]): Promise<void>;
  findDividendLedgerEntryById(userId: string, dividendLedgerEntryId: string): Promise<DividendLedgerEntry | null>;
  /**
   * Fetch a single dividend ledger entry with its deductions + source lines
   * eagerly attached, keyed by its primary id and scoped to the owning user.
   *
   * Used by the PATCH reconciliation route handler so it can return the
   * nested entry shape without scanning a paginated list — safe regardless
   * of how many historical rows the account has accumulated.
   */
  getDividendLedgerEntryWithDetails(
    userId: string,
    dividendLedgerEntryId: string,
  ): Promise<
    | (DividendLedgerEntry & {
        deductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
        sourceLines: DividendSourceLine[];
      })
    | null
  >;
  updateDividendReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: DividendLedgerEntry["reconciliationStatus"],
    note?: string,
  ): Promise<DividendLedgerEntry>;
  updatePostedCashDividend(userId: string, input: UpdatePostedCashDividendInput): Promise<DividendLedgerEntry>;
  /**
   * Apply a pre-computed set of dividend ledger recompute changes atomically.
   * Caller computes the change plan via planDividendLedgerRecompute; this
   * method persists it under a row lock. Returns the set of entries that
   * were actually updated (input minus rows that drifted due to concurrent
   * writes — currently best-effort, version mismatches are ignored since
   * recompute is idempotent against itself).
   */
  applyDividendLedgerRecompute(
    userId: string,
    changes: DividendLedgerRecomputeChange[],
  ): Promise<DividendLedgerRecomputeChange[]>;
  /**
   * Enumerate the distinct (userId, accountId, ticker) scopes with at least
   * one non-superseded, non-reversed dividend ledger entry. Used by the
   * startup backfill to iterate exactly the scopes that need a recompute.
   */
  listDividendLedgerScopes(): Promise<Array<{ userId: string; accountId: string; ticker: string }>>;
  listDividendEventsByPaymentDate(
    userId: string,
    fromPaymentDate?: string,
    toPaymentDate?: string,
    limit?: number,
  ): Promise<Store["marketData"]["dividendEvents"]>;
  listDividendLedgerEntries(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendLedgerListResult>;
  listDividendLedgerYears(userId: string): Promise<{ years: number[] }>;
  listCashLedgerEntries(userId: string, opts: CashLedgerListOptions): Promise<CashLedgerListResult>;
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

  // App config (KZO-133) — global settings. Returns null when unset (callers
  // fall back to Env defaults via getEffectiveRepairCooldownMinutes()).
  getRepairCooldownMinutes(): Promise<number | null>;

  // App config (KZO-142) — read the raw DB override + updatedAt stamp. Routes
  // combine this with getEffectiveRepairCooldownMinutes() to expose the full
  // AppConfigDto to clients.
  getAppConfig(): Promise<{ repairCooldownMinutes: number | null; updatedAt: string }>;

  // App config (KZO-142) — set (or clear) the repair cooldown override and
  // stamp the `updated_at` column. The route layer wraps this in an audit log.
  setRepairCooldownMinutes(value: number | null): Promise<void>;

  // Monitored tickers
  // KZO-133: persistence returns DTOs without `repairAvailableAt` — route layer
  // decorates using getEffectiveRepairCooldownMinutes() + deriveRepairAvailableAt().
  getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]>;
  getAllMonitoredTickers(): Promise<string[]>;
  getUsersMonitoringTicker(ticker: string): Promise<string[]>;
  getManualSelections(userId: string): Promise<{ ticker: string; addedAt: string }[]>;
  replaceManualSelections(userId: string, tickers: string[]): Promise<{ newTickers: string[] }>;
  listInstrumentsCatalog(
    search?: string,
    type?: string,
    userId?: string,
  ): Promise<Omit<InstrumentCatalogItemDto, "repairAvailableAt">[]>;

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

  // Holding snapshots (KZO-115)
  bulkUpsertHoldingSnapshots(userId: string, snapshots: HoldingSnapshot[]): Promise<void>;
  deleteHoldingSnapshotsForTicker(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number>;
  deleteAllHoldingSnapshots(userId: string): Promise<void>;
  getAggregatedSnapshots(userId: string, startDate: string, endDate: string): Promise<AggregatedSnapshotPoint[]>;
  countHoldingSnapshotsAfterDate(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number>;
  getHoldingSnapshotsForTicker(userId: string, accountId: string, ticker: string, startDate: string, endDate: string): Promise<HoldingSnapshot[]>;
  getDailyBarsForTicker(ticker: string, startDate: string, endDate: string): Promise<DailyBar[]>;
  /**
   * Batched variant of getDailyBarsForTicker: fetches bars for N tickers in a
   * single query. Returned map is keyed by ticker; missing tickers yield an
   * empty array. Used by the full-generation path to avoid N+1 queries.
   */
  getDailyBarsForTickers(tickers: string[], startDate: string, endDate: string): Promise<Map<string, DailyBar[]>>;
  /**
   * Fetch the inputs needed to generate holding snapshots — trade events and
   * posted dividend ledger entries pre-joined with their dividend events.
   * Avoids the broader cost of loadStore (which pulls accounts, lots, fee
   * policies, source lines, etc.).
   *
   * When `scope` is provided, results are filtered to that (accountId, ticker)
   * pair; dividends are filtered by ticker (not accountId) because the ticker
   * lives on the event, not the ledger entry.
   */
  getSnapshotGenerationInputs(userId: string, scope?: SnapshotGenerationScope): Promise<SnapshotGenerationInputs>;

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

  // ── Admin portal methods (KZO-144) ──────────────────────────────────────────

  listUsers(options: AdminUserListOptions): Promise<AdminUserListResponse>;
  changeUserRole(userId: string, newRole: UserRole, auditInput: Omit<AuditLogInput, "action">): Promise<AuthUserRecord>;
  disableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  enableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  softDeleteUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  hardPurgeUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  hasActiveJobs(userId: string): Promise<boolean>;
  countActiveAdmins(): Promise<number>;
  listInvites(options: AdminInviteListOptions): Promise<AdminInviteListResponse>;
  listAuditLog(options: AdminAuditLogListOptions): Promise<AdminAuditLogResponse>;
}
