import type { BackfillStatus, CurrencyCode, InstrumentRef, InstrumentType, Lot, VerificationStatus } from "@tw-portfolio/domain";
import type { DividendLedgerAggregates, DividendSourceLine } from "@tw-portfolio/shared-types";
import type { DividendLedgerRecomputeChange } from "../services/dividends.js";
import type { FxRate } from "../services/market-data/types.js";
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
import type { DailyBar, MarketCode } from "@tw-portfolio/domain";
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

/**
 * KZO-198 — names of the plain (non-encrypted) Tier 1/2 columns that can be
 * written via `setAppConfigField`. The set MUST stay in lockstep with the
 * `app_config` schema (migration 047) and `AppConfigCacheEntry`.
 */
export type AppConfigPlainField =
  | "marketDataPriceWindowMs"
  | "marketDataPriceLimit"
  | "marketDataSearchWindowMs"
  | "marketDataSearchLimit"
  | "inviteStatusWindowMs"
  | "inviteStatusLimit"
  | "providerDownNotificationSuppressionMs"
  | "providerErrorTrailRetentionDays"
  | "providerRerunCooldownMs"
  | "backfillRetryLimit"
  | "backfillRetryDelaySeconds"
  | "backfillFinmind402RetryMs"
  | "dailyRefreshLookbackDays"
  | "dailyRefreshPriority"
  | "sseHeartbeatIntervalMs"
  | "sseMaxConnectionsPerUser"
  | "sseBufferDefaultTtlMs"
  // KZO-195 — Tier 2 hybrid env+app_config delisting-detection knobs.
  | "catalogAbsenceThreshold"
  | "catalogAbsenceGuardPercent"
  | "catalogAbsenceGuardFloor";

/**
 * KZO-198 — aggregate patch shape accepted by `setAppConfigPatch`. Each key
 * is optional; absent keys are not touched. Tier 0 secret keys carry the
 * plaintext (the implementation encrypts inline) or `null` to clear.
 */
export type AppConfigPatch = Partial<Record<AppConfigPlainField, number | null>> & {
  finmindApiToken?: string | null;
  twelveDataApiKey?: string | null;
};

/**
 * Mapping from `AppConfigPlainField` to its underlying `app_config` column.
 * Used by Postgres + Memory persistence to translate the camelCase API into
 * snake_case SQL identifiers. Exported so route-layer audit metadata can echo
 * the canonical column names if needed.
 */
export const APP_CONFIG_PLAIN_COLUMNS: Record<AppConfigPlainField, string> = {
  marketDataPriceWindowMs: "market_data_price_window_ms",
  marketDataPriceLimit: "market_data_price_limit",
  marketDataSearchWindowMs: "market_data_search_window_ms",
  marketDataSearchLimit: "market_data_search_limit",
  inviteStatusWindowMs: "invite_status_window_ms",
  inviteStatusLimit: "invite_status_limit",
  providerDownNotificationSuppressionMs: "provider_down_notification_suppression_ms",
  providerErrorTrailRetentionDays: "provider_error_trail_retention_days",
  providerRerunCooldownMs: "provider_rerun_cooldown_ms",
  backfillRetryLimit: "backfill_retry_limit",
  backfillRetryDelaySeconds: "backfill_retry_delay_seconds",
  backfillFinmind402RetryMs: "backfill_finmind_402_retry_ms",
  dailyRefreshLookbackDays: "daily_refresh_lookback_days",
  dailyRefreshPriority: "daily_refresh_priority",
  sseHeartbeatIntervalMs: "sse_heartbeat_interval_ms",
  sseMaxConnectionsPerUser: "sse_max_connections_per_user",
  sseBufferDefaultTtlMs: "sse_buffer_default_ttl_ms",
  // KZO-195 — delisting detection knobs (Tier 2 hybrid).
  catalogAbsenceThreshold: "catalog_absence_threshold",
  catalogAbsenceGuardPercent: "catalog_absence_guard_percent",
  catalogAbsenceGuardFloor: "catalog_absence_guard_floor",
};

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
  | "app_config_updated"
  | "admin_fx_rates_refresh"
  | "fx_transfer_created"
  | "fx_transfer_updated"
  | "fx_transfer_reversed"
  | "provider_health_rerun"
  // KZO-195 — admin overrides for absence-based delisting detection.
  | "instrument_undelete"
  | "instrument_exclusion_toggle"
  // KZO-195 — persistence-side audit rows for absence-based stamps, streak
  // bumps, and guard trips.
  | "instrument_delisted_via_absence"
  | "instrument_absence_streak_bumped"
  | "instrument_absence_guard_tripped";

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
  // KZO-170 S4: per-row market code now required. The persistence layer threads
  // this through `unnest($N::text[])` (postgres.ts) and as the second composite-PK
  // column on `market_data.instruments` (post-KZO-169). Previously every row was
  // hardcoded `'TW'` at the SQL layer (`array_fill('TW'::text, ...)`); the stamp
  // now comes from the catalog source.
  marketCode: import("@tw-portfolio/domain").MarketCode;
}

/**
 * KZO-195 — options bag for `upsertInstrumentCatalog`. Backward-compatible:
 * callers that omit `absenceDetection` (TW provider-feed path) get the legacy
 * upsert + delistings flow. The AU path (and US once flipped on) wires
 * `absenceDetection.categorize` to the pure detector so the persistence layer
 * can fold the diff-based detection into the same transaction.
 */
export interface UpsertInstrumentCatalogOptions {
  absenceDetection?: {
    marketCode: import("@tw-portfolio/domain").MarketCode;
    /**
     * Decide which absent rows should bump streak / cross threshold / trip the
     * guard. See `apps/api/src/services/market-data/detectDelistingsByAbsence.ts`.
     */
    categorize: (
      absent: import("../services/market-data/detectDelistingsByAbsence.js").AbsentRow[],
      prevCatalogSize: number,
    ) => import("../services/market-data/detectDelistingsByAbsence.js").DetectionPlan;
    /** Audit actor for absence-stamped rows. Optional — `null` skips the actor field. */
    actorUserId?: string | null;
  };
}

export interface DelistingRecord {
  ticker: string;
  name: string;
  date: string;
  // KZO-170 S4: optional market code for delisting target isolation. Without this,
  // a TW delisting for ticker X would also flip a US instrument with the same ticker.
  // `runCatalogSync` stamps this from the per-market sync invocation; older callers
  // that omit it preserve the legacy TW-only behavior via the postgres branch.
  marketCode?: import("@tw-portfolio/domain").MarketCode;
  // KZO-195 — provenance discriminator. `provider_feed` (default) is the legacy
  // TW path where the upstream provider explicitly publishes a delisting row.
  // `absence_detected` is the diff-based path used by AU (and US once flipped on)
  // where consecutive absence from the catalog sync triggers the stamp. Optional
  // so callers that omit it default to `provider_feed` semantics.
  source?: "provider_feed" | "absence_detected";
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

/**
 * KZO-195 — row shape returned by the admin instrument override routes.
 * Carries the absence-detection state the admin UI needs to render the
 * undelete/exclude controls.
 */
export interface AdminInstrumentRow {
  ticker: string;
  marketCode: string;
  name: string | null;
  instrumentType: string | null;
  delistedAt: string | null;
  statusReason: string | null;
  lastSeenInCatalogAt: string | null;
  absenceStreak: number;
  delistingDetectionExcluded: boolean;
  updatedAt: string;
}

export interface CatalogSyncResult {
  upserted: number;
  delisted: number;
  // KZO-195 — counters for the diff-based delisting path. Always present in the
  // result shape (zero when the sync ran without `absenceDetection` wired in,
  // i.e. TW provider-feed path). When the mass-delisting guard trips, `delisted`
  // is 0 and `guardTripped` is true; `absent` reports the candidate count and
  // `absentTickers` lists them (truncated for log/notification readability).
  absent: number;
  guardTripped: boolean;
  absentTickers: string[];
}

// ── Provider health (KZO-177) ────────────────────────────────────────────────

export type ProviderHealthStatus = "healthy" | "degraded" | "down";
export type ProviderErrorClass =
  | "rate_limit"
  | "http_4xx"
  | "http_5xx"
  | "network"
  | "parse"
  | "other";

/** Row shape for `market_data.provider_health_status`. */
export interface ProviderHealthRow {
  providerId: string;
  status: ProviderHealthStatus;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  lastErrorMessage: string | null;
  lastDownNotificationAt: string | null;
  lastManualRerunAt: string | null;
  updatedAt: string;
}

/** Row shape for `market_data.provider_error_trail`. */
export interface ProviderErrorTrailRow {
  id: number;
  providerId: string;
  occurredAt: string;
  errorClass: ProviderErrorClass;
  errorMessage: string | null;
  context: Record<string, unknown> | null;
}

export interface ProviderHealthUpsert {
  providerId: string;
  status?: ProviderHealthStatus;
  lastSuccessfulRun?: string | null;
  lastFailedRun?: string | null;
  lastErrorMessage?: string | null;
  lastDownNotificationAt?: string | null;
  lastManualRerunAt?: string | null;
}

export interface ProviderErrorTrailInput {
  providerId: string;
  errorClass: ProviderErrorClass;
  errorMessage?: string | null;
  context?: Record<string, unknown> | null;
}

// ── Holding snapshots (KZO-115, extended in KZO-165) ──────────────────────────

/**
 * Per-(account, ticker, date) holding snapshot row.
 *
 * KZO-165 extensions:
 * - `currency` is now the **native** currency of the holding (no fallback default).
 *   Writers must always supply it; the walker derives it from `trades[0].priceCurrency`
 *   and fails fast on mixed-currency rows for the same (account, ticker).
 * - `valueNative`, `costBasisNative`, `unrealizedPnlNative` carry the same numeric
 *   meaning as `marketValue`, `costBasis`, `unrealizedPnl` but in the native currency.
 *   For TWD-only data they equal the legacy columns by design (dual-write per D6).
 * - `providerSource` denormalizes the `daily_bars.source` of the bar that supplied
 *   `closePrice`. NULL on provisional rows.
 *
 * The legacy `marketValue`/`costBasis`/`unrealizedPnl` columns are retained and
 * dual-written pending KZO-176's dashboard rewrite + drop.
 */
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
  /** KZO-165: market value in native currency (4-decimal precision). NULL when closePrice is null. */
  valueNative: number | null;
  /** KZO-165: cost basis in native currency (2-decimal precision). */
  costBasisNative: number;
  /** KZO-165: unrealized P&L in native currency (2-decimal precision). NULL when valueNative is null. */
  unrealizedPnlNative: number | null;
  /** KZO-165: denormalized `daily_bars.source` for the bar that supplied closePrice. NULL on provisional rows. */
  providerSource: string | null;
  generatedAt: string;
  generationRunId: string;
}

// ── Currency wallet snapshots (KZO-165) ───────────────────────────────────────

/**
 * Per-(account, currency, date) cash balance snapshot row.
 *
 * KZO-165 ships this as a minimal aggregator stub: rows are emitted for every date
 * with cash-ledger activity per (account, currency), with `wacFxToUsd = null`,
 * `realizedFxPnlLifetime = 0`, and `providerSource = null`. The real WAC math +
 * realized FX P&L crystallization is owned by KZO-166; the read-side dashboard
 * rewrite is owned by KZO-176.
 */
export interface CurrencyWalletSnapshot {
  userId: string;
  accountId: string;
  currency: string;
  date: string;
  balanceNative: number;
  wacFxToUsd: number | null;
  realizedFxPnlLifetime: number;
  providerSource: string | null;
  generatedAt: string;
  generationRunId: string;
}

/**
 * Trimmed cash-ledger row used by the wallet aggregator. We project only the four
 * fields the aggregator reads — keeps the persistence boundary narrow and avoids
 * shipping fee-policy snapshots, dividend metadata, etc., that the walker doesn't need.
 */
export interface CashLedgerEntryForBalance {
  accountId: string;
  currency: string;
  entryDate: string;
  amount: number;
}

/**
 * KZO-166: extended cash-ledger projection for the wallet WAC walker.
 * Includes fxRateToUsd and reversal-pair fields needed by the WAC engine.
 * Reversal pairs are filtered out upstream by getCashLedgerEntriesForWalletReplay.
 */
export interface CashLedgerEntryForWalletReplay {
  id: string;
  accountId: string;
  currency: string;
  entryDate: string;
  amount: number;
  fxRateToUsd: number | null;
  fxTransferId?: string | null;
  entryType: import("../types/store.js").CashLedgerEntryType;
  reversalOfCashLedgerEntryId?: string;
  bookedAt?: string;
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
  /**
   * KZO-180: per-snapshot-date FX availability rollup. `true` when every
   * contributing row's source currency either matches the requested reporting
   * currency (self-pair shortcut, fx = 1.0) OR has an FX rate at or before the
   * snapshot date. `false` when at least one contributing row's pair has no
   * forward-fillable FX rate.
   *
   * The legacy `getAggregatedSnapshots(...)` method (no reporting-currency
   * argument) does not perform FX translation and always emits `true`.
   */
  fxAvailable: boolean;
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
  /** KZO-165: native currency of the trade. Walker uses trades[0].priceCurrency
   *  as the holding's native currency and fails fast on mixed values for the
   *  same (account, ticker). */
  priceCurrency: string;
  /** KZO-185: market code that owns this (ticker, market_code) row. Walker
   *  groups (account, ticker) and forwards `marketCode` into the
   *  `tickersNeedingBackfill` payload so downstream `boss.send` calls stamp
   *  the producer-validated `marketCode` directly — no per-ticker fallback. */
  marketCode: string;
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
  /**
   * KZO-168 D8: persist a full accounting snapshot together with one audit-log
   * row in a single DB transaction. Postgres opens BEGIN/COMMIT around both
   * writes; memory backend simply chains the two inserts (no real transaction
   * semantics). Used by the FX-transfer service so the cash-ledger legs and
   * the lifecycle audit row never diverge on partial failure.
   */
  saveAccountingStoreWithAudit(
    userId: string,
    accounting: AccountingStore,
    auditEntry: AuditLogInput,
  ): Promise<void>;
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
  /**
   * KZO-173: distinct `bar_date` values from `market_data.daily_bars` for the
   * given market, on or after `fromDate` inclusive. Ordered ascending.
   */
  getDistinctBarDates(market: MarketCode, fromDate: string): Promise<string[]>;
  /**
   * KZO-177 (P2 Fix 3): batched latest-bar-date lookup keyed by composite
   * `(ticker, marketCode)`. Returns `null` for keys with no bar data. Used by
   * the dashboard freshness classifier — required so cross-listed instruments
   * (e.g. BHP/AU vs BHP/US) get classified against the correct market's data
   * rather than being collapsed under the bare ticker.
   *
   * Returned map keys are `${ticker}:${marketCode}`.
   */
  getLatestBarDatesByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>>;
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
  // KZO-169: `marketCode` becomes part of the lookup key after migration 044.
  // Optional for back-compat in legacy callers (read-only consumers that
  // haven't yet been threaded with market context); when present, the
  // implementation matches against the composite `(ticker, market_code)` PK.
  // When absent, the implementation falls back to ticker-only lookup which is
  // safe for monomarket TW deployments and degrades to the first match
  // otherwise.
  getInstrument(ticker: string, marketCode?: string): Promise<InstrumentRow | null>;
  updateBackfillStatus(ticker: string, status: BackfillStatus): Promise<void>;
  updateLastRepairAt(ticker: string): Promise<void>;

  // App config (KZO-133) — global settings. Returns null when unset (callers
  // fall back to Env defaults via getEffectiveRepairCooldownMinutes()).
  getRepairCooldownMinutes(): Promise<number | null>;

  // App config (KZO-142 / KZO-159 / KZO-189 / KZO-198) — read the raw DB overrides +
  // updatedAt stamp. Routes combine this with getEffectiveRepairCooldownMinutes(),
  // the 3-tier range resolver, and getEffectiveMetadataEnrichmentMode() to
  // expose the full AppConfigDto to clients. KZO-198 added 19 nullable columns
  // covering Tier 0 secrets (encrypted) + Tier 1/2 plain incident levers; the
  // shape mirrors `AppConfigCacheEntry` so the cache can store the row directly.
  getAppConfig(): Promise<{
    repairCooldownMinutes: number | null;
    dashboardPerformanceRanges: string[] | null;
    metadataEnrichmentMode: "unconditional" | "conditional" | null;
    finmindApiTokenEncrypted: string | null;
    twelveDataApiKeyEncrypted: string | null;
    marketDataPriceWindowMs: number | null;
    marketDataPriceLimit: number | null;
    marketDataSearchWindowMs: number | null;
    marketDataSearchLimit: number | null;
    inviteStatusWindowMs: number | null;
    inviteStatusLimit: number | null;
    providerDownNotificationSuppressionMs: number | null;
    providerErrorTrailRetentionDays: number | null;
    providerRerunCooldownMs: number | null;
    backfillRetryLimit: number | null;
    backfillRetryDelaySeconds: number | null;
    backfillFinmind402RetryMs: number | null;
    dailyRefreshLookbackDays: number | null;
    dailyRefreshPriority: number | null;
    sseHeartbeatIntervalMs: number | null;
    sseMaxConnectionsPerUser: number | null;
    sseBufferDefaultTtlMs: number | null;
    // KZO-195 — Tier 2 absence-based delisting detection knobs.
    catalogAbsenceThreshold: number | null;
    catalogAbsenceGuardPercent: number | null;
    catalogAbsenceGuardFloor: number | null;
    // KZO-196 — Tier A AU GICS sync cron schedule override (NULL = use env).
    asxGicsRefreshCron: string | null;
    updatedAt: string;
  }>;

  // App config (KZO-142) — set (or clear) the repair cooldown override and
  // stamp the `updated_at` column. The route layer wraps this in an audit log.
  setRepairCooldownMinutes(value: number | null): Promise<void>;

  // App config (KZO-159 / 158A) — set (or clear, when `null`) the admin
  // override for the user-facing dashboard timeframe picker. The route layer
  // validates the list shape via `dashboardPerformanceRangesSchema` from
  // `@tw-portfolio/shared-types` and wraps this in an `app_config_updated`
  // audit entry (see adminRoutes.ts).
  setDashboardPerformanceRanges(value: string[] | null): Promise<void>;

  // App config (KZO-189) — read the raw DB override for AU metadata enrichment
  // mode. Returns null when unset; callers fall back to Env.METADATA_ENRICHMENT_MODE
  // via getEffectiveMetadataEnrichmentMode().
  getMetadataEnrichmentMode(): Promise<"unconditional" | "conditional" | null>;

  // App config (KZO-189) — set (or clear, when `null`) the admin override for
  // AU metadata enrichment mode. The route layer wraps this in an audit log
  // (action `app_config_updated`).
  setMetadataEnrichmentMode(value: "unconditional" | "conditional" | null): Promise<void>;

  // App config (KZO-198) — generic per-field setter for Tier 1/2 plain
  // overrides. `field` is the camelCase key matching `getAppConfig()`'s
  // return shape; `value` is `null` to clear or the new value to set.
  // Stamps `updated_at`. The route layer wraps this in an `app_config_updated`
  // audit entry. Setters must be atomic (single UPSERT).
  setAppConfigField(
    field: AppConfigPlainField,
    value: number | null,
  ): Promise<void>;

  // App config (KZO-198 Tier 0) — set (or clear, when `null`) an encrypted
  // secret. Implementations call `encryptSecret(plaintext)` from
  // `apps/api/src/services/appConfig/encryption.ts` inline so the plaintext
  // never lives outside the persistence boundary. `null` clears the column.
  // Stamps `updated_at`.
  setAppConfigEncryptedSecret(
    field: "finmindApiToken" | "twelveDataApiKey",
    plaintext: string | null,
  ): Promise<void>;

  // App config (KZO-198) — aggregate patch setter. Applies any subset of the
  // 17 Tier 1/2 plain fields and the 2 Tier 0 secrets in a single atomic
  // write (Postgres: one UPSERT). Tier 0 secrets are passed as plaintext on
  // the `finmindApiToken` / `twelveDataApiKey` keys; the implementation
  // encrypts them inline so plaintext never crosses the persistence boundary.
  // `null` on any key clears the column. Stamps `updated_at`. Route layer
  // wraps the resulting diff in an `app_config_updated` audit entry.
  setAppConfigPatch(patch: AppConfigPatch): Promise<void>;

  // User preferences (KZO-159 / 158A) — per-user JSONB preferences row.
  // `getUserPreferences` returns `{}` when no row exists (lazy — no insert
  // on read). `setUserPreferencePatch` performs a single-UPDATE top-level
  // merge: non-null keys replace existing values, `null` deletes the key.
  // Implementations must be atomic (INSERT ... ON CONFLICT DO UPDATE on
  // Postgres; equivalent guarantee on memory). See design doc D3 for the
  // canonical Postgres SQL shape.
  getUserPreferences(userId: string): Promise<Record<string, unknown>>;
  setUserPreferencePatch(
    userId: string,
    patch: Record<string, unknown | null>,
  ): Promise<Record<string, unknown>>;

  // Test-only helper — used by POST /__e2e/seed-user-preferences to seed a
  // full preferences object for a user. Must never be called from production
  // code paths. Guarded at the route layer by `assertE2ESeedEnabled()`.
  _setUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<void>;

  // Monitored tickers
  // KZO-133: persistence returns DTOs without `repairAvailableAt` — route layer
  // decorates using getEffectiveRepairCooldownMinutes() + deriveRepairAvailableAt().
  getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]>;
  // KZO-185: returns `(ticker, marketCode)` pairs so producers (daily refresh,
  // post-recompute auto-backfill) can stamp `marketCode` on `BackfillJobData`
  // directly. The Zod gatekeeper at the worker entry validates the value; the
  // catalog `i.market_code` join in postgres.ts is the authoritative source.
  getAllMonitoredTickers(): Promise<{ ticker: string; marketCode: string }[]>;
  getUsersMonitoringTicker(ticker: string): Promise<string[]>;
  getManualSelections(userId: string): Promise<{ ticker: string; marketCode: string; addedAt: string }[]>;
  // KZO-169: signature change — entries are now keyed by `(ticker, market_code)`
  // composite to honor migration 044's PK. The newTickers field continues to
  // return the keys that were not previously monitored (manual or position).
  // KZO-188: optional `name` + `instrumentType` carry metadata for live-search
  // picks that are not yet in `market_data.instruments`. When both are
  // provided, the implementation upserts the catalog row (ON CONFLICT DO
  // NOTHING) before the FK insert so an un-catalogued AU pick like CBA can be
  // saved on Postgres without violating `user_monitored_tickers_*_fkey`.
  replaceManualSelections(
    userId: string,
    selections: ReadonlyArray<{
      ticker: string;
      marketCode: string;
      name?: string | null;
      instrumentType?: InstrumentType | null;
    }>,
  ): Promise<{ newTickers: string[] }>;
  listInstrumentsCatalog(
    search?: string,
    type?: string,
    marketCode?: string,
    userId?: string,
  ): Promise<Omit<InstrumentCatalogItemDto, "repairAvailableAt">[]>;

  // Catalog sync
  upsertInstrumentCatalog(
    instruments: CatalogInstrument[],
    delistings: DelistingRecord[],
    options?: UpsertInstrumentCatalogOptions,
  ): Promise<CatalogSyncResult>;

  // KZO-195 — admin overrides for absence-based delisting detection.
  // The route layer (`POST /admin/instruments/:ticker/:marketCode/{undelete,exclude}`)
  // calls these. The persistence layer writes the audit row in the same
  // transaction as the mutation, so the route is a thin pass-through.
  instrumentAdminGet(ticker: string, marketCode: string): Promise<AdminInstrumentRow | null>;
  undeleteInstrument(
    ticker: string,
    marketCode: string,
    actorUserId: string,
  ): Promise<AdminInstrumentRow>;
  setInstrumentDelistingDetectionExcluded(
    ticker: string,
    marketCode: string,
    excluded: boolean,
    actorUserId: string,
  ): Promise<AdminInstrumentRow>;
  // KZO-195 — paginated admin listing for `/admin/instruments`. Filters by
  // marketCode; returns items + total count + page/limit echo. Caller (route
  // layer) layers the `thresholds` block on top of this.
  listAdminInstruments(opts: {
    marketCode: string;
    page: number;
    limit: number;
  }): Promise<{
    items: AdminInstrumentRow[];
    total: number;
    page: number;
    limit: number;
  }>;

  // KZO-164: FX rates (Frankfurter v2 ingestion). All three methods are required because
  // `fxRefreshWorker.ts` and the admin routes consume them through the `Persistence`
  // interface (no direct Postgres pool access — keeps the worker testable on memory).
  /**
   * Bulk upsert FX rates. Postgres uses `ON CONFLICT (date, base_currency, quote_currency)
   * DO UPDATE SET rate, source, ingested_at`. Memory uses `Map<dateKey, FxRate>` keyed
   * by `${date}:${base}:${quote}`. Returns the row count actually upserted.
   *
   * Caller (worker) MUST filter self-pairs (`r.quoteCurrency !== r.baseCurrency`) before
   * calling — schema CHECK rejects them and would crash the entire batch in Postgres.
   */
  upsertFxRates(rates: ReadonlyArray<FxRate>): Promise<number>;
  /** Returns the maximum `date` across all FX rate rows, or `null` for an empty table. */
  getLatestFxRateDate(): Promise<string | null>;
  /**
   * Per-pair freshness summary — one row per `(baseCurrency, quoteCurrency)` with the
   * most recent date for that pair. Ordered by base, then quote, ascending.
   */
  getFxRateFreshness(): Promise<Array<{ baseCurrency: string; quoteCurrency: string; latestDate: string }>>;
  /**
   * KZO-166 read helper. Returns the latest FX rate for the (base → quote) pair
   * with `date <= asOfDate` (forward-fill semantics).
   *
   * Self-pair shortcut: when `base === quote`, returns `1.0` without touching the DB.
   *
   * Returns `null` when no rate exists for the pair at or before `asOfDate`.
   *
   * Backed by `idx_fx_rates_pair_date_desc` for O(log N) lookup.
   *
   * Caller contract:
   *   - Write-path callers (wallet generator) MUST throw
   *     `MissingFxRateError(base, quote, asOfDate)` on `null`.
   *   - Read-path callers (future dashboard JOINs) MAY degrade to native-only.
   */
  getFxRate(base: CurrencyCode, quote: CurrencyCode, asOfDate: string): Promise<number | null>;
  getFxTransferById(
    userId: string,
    fxTransferId: string,
  ): Promise<{ legs: CashLedgerEntry[]; reversed: boolean } | null>;
  getAccountAvailableBalance(userId: string, accountId: string, currency: CurrencyCode): Promise<number>;
  /**
   * KZO-166: deterministic cash-ledger projection for the wallet WAC walker.
   *
   * Returns entries in `(entry_date ASC, booked_at ASC, id ASC)` order. Both
   * the reversed entry and its REVERSAL counterpart are filtered out — they
   * still contribute to `balance_native` via getCashLedgerEntriesForBalances
   * (which sums them and ends at 0), but they are invisible to the WAC and
   * realized-FX state.
   */
  getCashLedgerEntriesForWalletReplay(userId: string): Promise<CashLedgerEntryForWalletReplay[]>;

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
  /**
   * KZO-180: FX-aware variant of `getAggregatedSnapshots`. Translates each
   * contributing row's per-currency native columns (`value_native`,
   * `cost_basis_native`, `unrealized_pnl_native`) plus the legacy
   * `cumulative_realized_pnl` and `cumulative_dividends` columns into
   * `reportingCurrency` using the per-snapshot-date FX rate from
   * `market_data.fx_rates` (forward-fill via `date <= snapshot_date`).
   *
   * Self-pair shortcut: rows whose `currency = reportingCurrency` translate
   * with `fx = 1.0` (no DB JOIN, no NULL propagation). This is the **D8**
   * SQL guard — without it, every TWD-only row produces NULL aggregates and
   * silently degrades the entire production user base.
   *
   * Convention: translate-then-sum. `fxAvailable` per snapshot date is true
   * iff every contributing row's pair resolved (or self-pair). When false,
   * the translated cumulative/total fields are NULL.
   *
   * **v1 deviation from KZO-166 D4 / KZO-180 D4:** `cumulative_realized_pnl`
   * is translated at `snapshot_date` FX, not the original sale-date FX. The
   * denormalized cumulative column doesn't preserve per-trade sale dates;
   * strict adherence requires a JOIN-to-trades aggregation owned by KZO-176.
   * For TWD-only users (today's user base) this is exact. For mixed-currency
   * users it's an approximation until KZO-176.
   */
  getAggregatedSnapshotsInReportingCurrency(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@tw-portfolio/shared-types").AccountDefaultCurrency,
  ): Promise<AggregatedSnapshotPoint[]>;
  countHoldingSnapshotsAfterDate(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number>;
  getHoldingSnapshotsForTicker(userId: string, accountId: string, ticker: string, startDate: string, endDate: string): Promise<HoldingSnapshot[]>;

  // Currency wallet snapshots (KZO-165) — minimal aggregator stub. WAC + FX is KZO-166.
  /**
   * Bulk upsert currency wallet snapshot rows. PK is (account_id, currency, date).
   * Mirrors the unnest-arrays pattern used by `bulkUpsertHoldingSnapshots`.
   */
  bulkUpsertCurrencyWalletSnapshots(userId: string, snapshots: CurrencyWalletSnapshot[]): Promise<void>;
  /** Delete all wallet snapshots for a user. Called before a fresh aggregator run. */
  deleteAllCurrencyWalletSnapshots(userId: string): Promise<void>;
  /**
   * Forward-compatibility scaffolding for KZO-176's dashboard read path. The
   * KZO-165 scope explicitly adds this reader; its current callers are
   * integration tests plus the future dashboard rewrite.
   */
  getCurrencyWalletSnapshotsForAccount(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<CurrencyWalletSnapshot[]>;
  /**
   * Trimmed cash-ledger projection used by the wallet aggregator. Returns rows in
   * (accountId ASC, currency ASC, entryDate ASC) order so the running-balance
   * walker can stream without an extra sort.
   */
  getCashLedgerEntriesForBalances(userId: string): Promise<CashLedgerEntryForBalance[]>;
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

  // ── Provider health (KZO-177) ──────────────────────────────────────────────
  /**
   * Fetch one provider health status row. Returns null if the providerId is
   * unknown (i.e. not seeded by migration 046).
   */
  getProviderHealthStatus(providerId: string): Promise<ProviderHealthRow | null>;
  /** Fetch every provider health status row, ordered by providerId ASC. */
  getAllProviderHealthStatuses(): Promise<ProviderHealthRow[]>;
  /**
   * Update a provider health row in-place. Only the fields explicitly set in
   * `patch` are written; others are preserved. `updated_at` is bumped to NOW().
   */
  upsertProviderHealthStatus(patch: ProviderHealthUpsert): Promise<ProviderHealthRow>;
  /**
   * CAS-clear `last_down_notification_at` IFF the row's previously-recorded
   * value matches `expectedPreviousNotificationAt`. Returns true when the
   * worker won the CAS (and therefore SHOULD fire recovery notifications).
   * Used to ensure only one worker fires recovery notifications across
   * concurrent successes.
   */
  clearProviderDownNotificationCas(
    providerId: string,
    expectedPreviousNotificationAt: string,
  ): Promise<boolean>;
  /**
   * KZO-177 (P2 Fix 5) — atomic claim for the down-notification fan-out slot.
   * Returns true iff this caller wins the slot: only the winner should fire
   * the `provider_down` admin fan-out. Implemented as a conditional UPDATE
   * `WHERE last_down_notification_at IS NULL OR last_down_notification_at <
   * NOW() - <suppressionWindow>` so concurrent workers never double-fire
   * within the suppression window.
   */
  claimProviderDownNotificationSlot(
    providerId: string,
    suppressionWindowMs: number,
  ): Promise<boolean>;
  /** Insert a new error trail row. */
  insertProviderErrorTrailEntry(input: ProviderErrorTrailInput): Promise<ProviderErrorTrailRow>;
  /**
   * Fetch the most recent N error trail rows for the given providerId,
   * ordered occurredAt DESC.
   */
  getRecentProviderErrors(
    providerId: string,
    limit: number,
  ): Promise<ProviderErrorTrailRow[]>;
  /**
   * Count error trail rows for the providerId where `error_class != 'rate_limit'`
   * AND occurredAt within the last 24 hours.
   */
  computeErrorCount24h(providerId: string): Promise<number>;
  /** Count error trail rows where error_class != 'rate_limit' within the last 7 days. */
  computeErrorCount7d(providerId: string): Promise<number>;
  /** Count error trail rows where error_class = 'rate_limit' within the last 24 hours. */
  computeRateLimitCount24h(providerId: string): Promise<number>;
  /**
   * Delete error trail rows older than `olderThanDays` days. Memory backend
   * may behave as a no-op (returns 0). Returns the number of rows deleted.
   */
  pruneOldProviderErrorTrail(olderThanDays: number): Promise<number>;
  /** Return user IDs of all active admins (role='admin', not deactivated/deleted). */
  listAdminUserIds(): Promise<string[]>;
}
