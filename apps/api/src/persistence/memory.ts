import { randomUUID } from "node:crypto";
import type { Lot } from "@vakwen/domain";
import { marketCodeFor } from "@vakwen/shared-types";
import type { DividendLedgerAggregates, DividendSourceLine } from "@vakwen/shared-types";
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
import type { DailyBar, InstrumentType, MarketCode } from "@vakwen/domain";
import type { FxRate } from "../services/market-data/types.js";
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
} from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import {
  buildShareAuditMetadata,
  buildShareGrantedNotification,
  buildShareRevokedNotification,
} from "./shareHelpers.js";
import { rebuildHoldingProjection } from "../services/accountingStore.js";
import type {
  AdminAuditLogListOptions,
  AdminInviteListOptions,
  AdminUserListOptions,
  AnonymousShareTokenRecord,
  AuditLogInput,
  AuthUserRecord,
  CreateAnonymousShareTokenInput,
  CreateAnonymousShareTokenResult,
  CreateShareCoupledInviteInput,
  CreateShareGrantInput,
  ConsumeInviteResult,
  CreateInviteInput,
  CashLedgerListOptions,
  CashLedgerListResult,
  CatalogInstrument,
  CatalogSyncResult,
  DelistingRecord,
  DeleteTradeEventResult,
  DividendLedgerListOptions,
  DividendLedgerListResult,
  DividendReviewListResult,
  DividendReviewRowWithDetails,
  InviteRecord,
  InviteStatus,
  OAuthClaims,
  Persistence,
  ReadinessStatus,
  ResolveOrCreateUserOptions,
  ResolveOrCreateUserResult,
  TradeEventPatch,
  UpdatePostedCashDividendInput,
  HoldingSnapshot,
  CurrencyWalletSnapshot,
  CashLedgerEntryForBalance,
  ListInboundSharesForGranteeResult,
  ListSharesForOwnerResult,
  MaterializePendingSharesInput,
  PendingShareInviteRecord,
  RevokeAnonymousShareTokenInput,
  RevokeAnonymousShareTokenResult,
  ShareGrantRecord,
  AggregatedSnapshotPoint,
  ProviderErrorTrailInput,
  ProviderErrorTrailRow,
  ProviderHealthRow,
  ProviderHealthUpsert,
  UserRole,
} from "./types.js";
// KZO-199: anonymous-share token cap and retention are now resolver-backed
// (DB override → env-fallback). Read at method invocation time so admin
// PATCHes take effect on the next call without restart.
import {
  getEffectiveAnonymousShareTokenCap,
  getEffectiveAnonymousShareTokenRetentionMs,
} from "../services/appConfig/sharing.js";
import type { DividendLedgerRecomputeChange } from "../services/dividends.js";

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
  /** KZO-196 — GICS industry-group label (AU only); null on non-AU and pre-sync rows. */
  gicsIndustryGroup?: string | null;
}

type MemoryDailyBar = DailyBar & { marketCode: MarketCode };
type SeedDailyBar = DailyBar & { marketCode?: MarketCode };

interface MemoryPersistenceOptions {
  seedCatalog?: boolean;
  seedDevBypassUser?: boolean;
}

interface MemoryInvite {
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

interface MemoryShare {
  id: string;
  ownerUserId: string;
  granteeUserId: string;
  revokedByUserId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface MemoryAnonymousShareToken {
  id: string;
  token: string;
  ownerUserId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

interface MemoryAuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: AuditLogInput["action"];
  targetUserId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const INVITE_CODE_LENGTH = 8;
const PENDING_SHARE_INVITE_LIMIT = 10;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
    code += INVITE_CODE_ALPHABET[index]!;
  }
  return code;
}

function mapMemoryUser(user: MemoryUser): AuthUserRecord {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    sessionVersion: user.sessionVersion,
    isDemo: user.isDemo ?? false,
    deactivatedAt: user.deactivatedAt ?? null,
    deletedAt: user.deletedAt ?? null,
  };
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
  role: UserRole;
  sessionVersion: number;
  createdAt: string;
  deactivatedAt?: string | null;
  deletedAt?: string | null;
  isDemo?: boolean;
  demoExpiresAt?: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** KZO-169: composite key for the memory instrument catalog (mirrors the
 *  Postgres PK shape on `market_data.instruments`). */
function instrumentCatalogKey(ticker: string, marketCode: string): string {
  return `${ticker}|${marketCode}`;
}

export class MemoryPersistence implements Persistence {
  private readonly stores = new Map<string, Store>();
  private readonly idempotencyKeys = new Map<string, Set<string>>();
  private readonly dailyBars: MemoryDailyBar[] = [];
  /** email → MemoryUser (identity resolution index) */
  private readonly usersByEmail = new Map<string, MemoryUser>();
  /**
   * KZO-169: per-user manual monitoring selections keyed by composite
   * `${ticker}|${marketCode}` (mirrors `user_monitored_tickers` PK shape after
   * migration 044). Inner value carries the structured tuple so callers don't
   * have to re-parse the key.
   */
  private readonly monitoredTickers = new Map<
    string,
    Map<string, { ticker: string; marketCode: string; addedAt: string }>
  >();
  /** userId → NotificationDto[] (in-memory notification store for E2E) */
  private readonly notifications = new Map<string, MemoryNotification[]>();
  /**
   * `${ticker}|${marketCode}` → MemoryInstrument. KZO-169 widened the key to
   * the composite (ticker, market_code) tuple to mirror migration 044's PK
   * shape — the memory backend now supports two BHP rows on different markets,
   * which is required by the E2E disambiguation spec for KZO-169.
   */
  private readonly instruments = new Map<string, MemoryInstrument>();
  /** userId → composite catalog map (mirrors `instruments` per user). */
  private readonly instrumentsByUser = new Map<string, Map<string, MemoryInstrument>>();
  /** Holding snapshots (KZO-115) */
  private readonly holdingSnapshots: HoldingSnapshot[] = [];
  /** KZO-165: currency wallet snapshots (cash balance per account+currency+date). */
  private readonly currencyWalletSnapshots: CurrencyWalletSnapshot[] = [];
  /** KZO-164: in-memory FX rates keyed by `${date}:${baseCurrency}:${quoteCurrency}`. */
  private readonly fxRates = new Map<string, FxRate>();
  private readonly invites = new Map<string, MemoryInvite>();
  private readonly portfolioShares: MemoryShare[] = [];
  private readonly anonymousShareTokens: MemoryAnonymousShareToken[] = [];
  /** Per-owner async mutex — ensures cap-check + insert is atomic for concurrent callers. */
  private readonly anonymousShareTokenLocks = new Map<string, Promise<unknown>>();
  private readonly auditLog: MemoryAuditLogEntry[] = [];
  /** App config: repair cooldown override (KZO-133). null = unset, fall back to Env. */
  private _repairCooldownMinutes: number | null = null;
  /** App config: admin override for dashboard performance ranges (KZO-159 / 158A).
   *  null = unset, callers fall back to the hardcoded DEFAULT list. */
  private _dashboardPerformanceRanges: string[] | null = null;
  /** App config: AU metadata enrichment mode override (KZO-189).
   *  null = unset, callers fall back to Env.METADATA_ENRICHMENT_MODE. */
  private _metadataEnrichmentMode: "unconditional" | "conditional" | null = null;
  /** KZO-198: Tier 0 encrypted secrets — stored as `nonce_b64:ct+tag_b64`.
   *  null = unset, callers (resolvers) fall back to env. */
  private _finmindApiTokenEncrypted: string | null = null;
  private _twelveDataApiKeyEncrypted: string | null = null;
  /** KZO-198: Tier 1/2 plain overrides — keyed by AppConfigPlainField. */
  private _appConfigPlain: Partial<Record<import("./types.js").AppConfigPlainField, number | null>> = {};
  /** KZO-196: AU GICS sync cron override. null = use Env.ASX_GICS_REFRESH_CRON. */
  private _asxGicsRefreshCron: string | null = null;
  /** KZO-199: Tier 2 SQL-only override for anonymous-share retention window.
   *  null = use Env.ANONYMOUS_SHARE_TOKEN_RETENTION_MS. Memory backend exposes
   *  no public setter; tests can mutate via `_anonymousShareTokenRetentionMs`
   *  directly if needed. */
  _anonymousShareTokenRetentionMs: number | null = null;
  /** KZO-199: Tier 2 SQL-only override for PATCH /user-preferences body cap.
   *  null = use Env.USER_PREFERENCES_MAX_BYTES. */
  _userPreferencesMaxBytes: number | null = null;
  /** KZO-142: timestamp of the last app_config write (ISO 8601). Stamped at
   *  construction so a fresh MemoryPersistence always has a non-null value. */
  private _appConfigUpdatedAt: string = new Date().toISOString();
  /** KZO-159 / 158A: per-user preferences keyed by user id. Lazy — absent key
   *  == empty preferences. Top-level merge semantics mirror the Postgres
   *  `||` / `- key[]` update shape (see design D3). */
  private readonly userPreferences = new Map<string, Record<string, unknown>>();
  /** KZO-177: provider health rows keyed by providerId. Pre-seeded in `init()`. */
  private readonly providerHealth = new Map<string, ProviderHealthRow>();
  /** KZO-177: provider error trail rows; auto-incrementing id stamped at insert. */
  private readonly providerErrorTrail: ProviderErrorTrailRow[] = [];
  private _providerErrorTrailNextId = 1;
  /**
   * KZO-177 (M2): per-provider promise-chain mutex for the recovery CAS.
   * MemoryPersistence is single-threaded but JS microtasks interleave; without
   * this, two concurrent `recordOutcome({kind:"success"})` calls on a `down`
   * row could both observe `lastDownNotificationAt !== null` and both win the
   * CAS. The Postgres backend gets atomicity from the conditional UPDATE row
   * count; this mutex matches that semantics in memory.
   */
  private readonly _providerCasLocks = new Map<string, Promise<void>>();
  /**
   * ui-enhancement — soft-deleted account shadow store, keyed by
   * `${userId}:${accountId}`. The active `store.accounts` array (in `stores`)
   * filters these out; the shadow stores the original AccountDto + `deletedAt`
   * ISO so restore can roundtrip the row back into the active set.
   */
  private readonly softDeletedAccounts = new Map<
    string,
    import("@vakwen/shared-types").AccountDto & { deletedAt: string }
  >();

  constructor(private readonly options: MemoryPersistenceOptions = {}) {}

  async init(): Promise<void> {
    // KZO-177: pre-seed the canonical providers, mirroring migration 046's
    // seed insert. The aggregator assumes every providerId exists when the
    // workers start logging outcomes.
    // KZO-200: `twelve-data-au` added (migration 048) — separate from
    // `yahoo-finance-au` because it owns the AU catalog path (KZO-194) on a
    // distinct cadence + budget.
    if (this.providerHealth.size === 0) {
      const now = new Date().toISOString();
      for (const providerId of [
        "finmind-tw",
        "finmind-us",
        "yahoo-finance-au",
        "twelve-data-au",
        "frankfurter",
        // KZO-196 — ASX GICS catalog provider seed row.
        "asx-gics-csv",
      ]) {
        this.providerHealth.set(providerId, {
          providerId,
          status: "down",
          lastSuccessfulRun: null,
          lastFailedRun: null,
          lastErrorMessage: null,
          lastDownNotificationAt: null,
          lastManualRerunAt: null,
          updatedAt: now,
        });
      }
    }
    if (this.options.seedCatalog === true && this.instruments.size === 0) {
      this._replaceInstruments(DEFAULT_MEMORY_CATALOG);
    }
    if (this.options.seedDevBypassUser === true && this.usersByEmail.size === 0) {
      this.usersByEmail.set("user-1@placeholder.local", {
        id: "user-1",
        email: "user-1@placeholder.local",
        displayName: "Dev User",
        providerSubject: "dev-bypass",
        providerDisplayName: "Dev User",
        providerPictureUrl: null,
        role: "admin",
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
      });
    }
  }

  async close(): Promise<void> {}

  async resolveOrCreateUser(
    provider: string,
    providerSubject: string,
    claims: OAuthClaims,
    options: ResolveOrCreateUserOptions = {},
  ): Promise<ResolveOrCreateUserResult> {
    const normalizedEmail = normalizeEmail(claims.email);
    const existing = this.usersByEmail.get(normalizedEmail);
    const targetRole = options.role;
    const targetSessionVersion = options.sessionVersion;

    if (existing) {
      // Subsequent login: update mutable fields, never touch email
      existing.displayName = claims.name ?? existing.displayName;
      existing.providerSubject = providerSubject;
      existing.providerDisplayName = claims.name ?? existing.providerDisplayName;
      existing.providerPictureUrl = claims.picture ?? existing.providerPictureUrl;
      if (targetRole) {
        existing.role = targetRole;
      }
      if (targetSessionVersion) {
        existing.sessionVersion = targetSessionVersion;
      }
      // Sync displayName to already-cached store settings so callers see the updated name.
      if (claims.name) {
        const cachedStore = this.stores.get(existing.id);
        if (cachedStore) cachedStore.settings.displayName = claims.name;
      }
      return {
        userId: existing.id,
        role: existing.role,
        sessionVersion: existing.sessionVersion,
      };
    }

    // New user: generate UUID, seed all fields
    const userId = randomUUID();
    this.usersByEmail.set(normalizedEmail, {
      id: userId,
      email: normalizedEmail,
      displayName: claims.name ?? null,
      providerSubject,
      providerDisplayName: claims.name ?? null,
      providerPictureUrl: claims.picture ?? null,
      role: targetRole ?? "member",
      sessionVersion: targetSessionVersion ?? 1,
      createdAt: new Date().toISOString(),
    });

    // Ensure default portfolio data for the new user
    await this.ensureDefaultPortfolioData(userId);

    return {
      userId,
      role: targetRole ?? "member",
      sessionVersion: targetSessionVersion ?? 1,
    };
  }

  async ensureDefaultPortfolioData(userId: string): Promise<void> {
    // Ensure user identity exists (matches postgres behavior: INSERT ... ON CONFLICT DO NOTHING)
    const existingUser = this.getUserById(userId);
    if (!existingUser) {
      const email = normalizeEmail(`${userId}@placeholder.local`);
      if (!this.usersByEmail.has(email)) {
        this.usersByEmail.set(email, {
          id: userId,
          email,
          displayName: null,
          providerSubject: userId,
          providerDisplayName: null,
          providerPictureUrl: null,
          role: "member",
          sessionVersion: 1,
          createdAt: new Date().toISOString(),
        });
      }
    }
    // In memory persistence, loadStore already creates default data (fee profile, account, etc.)
    await this.loadStore(userId);
  }

  async getAuthUserById(userId: string): Promise<AuthUserRecord | null> {
    const user = this.getUserById(userId);
    return user ? mapMemoryUser(user) : null;
  }

  async getAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const user = this.usersByEmail.get(normalizeEmail(email));
    return user ? mapMemoryUser(user) : null;
  }

  async ensureDevBypassUser(): Promise<void> {
    const existing = this.getUserById("user-1");
    if (existing?.deactivatedAt || existing?.deletedAt || existing) {
      return;
    }

    this.usersByEmail.set("user-1@placeholder.local", {
      id: "user-1",
      email: "user-1@placeholder.local",
      displayName: "Dev User",
      providerSubject: "dev-bypass",
      providerDisplayName: "Dev User",
      providerPictureUrl: null,
      role: "admin",
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
    });
    await this.ensureDefaultPortfolioData("user-1");
  }

  async promoteUserToAdminByEmail(
    email: string,
    action: AuditLogInput["action"],
    metadata: Record<string, unknown> = {},
  ): Promise<AuthUserRecord | null> {
    const user = this.usersByEmail.get(normalizeEmail(email));
    if (!user || user.deactivatedAt || user.deletedAt) {
      return null;
    }
    user.role = "admin";
    await this.appendAuditLog({
      action,
      targetUserId: user.id,
      metadata: { email: user.email, targetEmail: user.email, ...metadata },
    });
    return mapMemoryUser(user);
  }

  async appendAuditLog(input: AuditLogInput): Promise<void> {
    this.auditLog.push({
      id: randomUUID(),
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  async bumpSessionVersion(userId: string): Promise<number> {
    const user = this.getUserById(userId);
    if (!user) {
      throw routeError(404, "not_found", "User not found");
    }
    user.sessionVersion += 1;
    return user.sessionVersion;
  }

  async createInvite(input: CreateInviteInput): Promise<InviteRecord> {
    return this.insertInvite(input);
  }

  async insertBootstrapInvite(input: CreateInviteInput): Promise<InviteRecord> {
    return this.insertInvite(input);
  }

  async revokeInvite(code: string): Promise<void> {
    const invite = this.invites.get(code);
    if (!invite || invite.revokedAt) return;
    invite.revokedAt = new Date().toISOString();
  }

  async getInviteStatus(code: string): Promise<InviteStatus> {
    const invite = this.invites.get(code);
    if (!invite) return "invalid";
    if (invite.revokedAt) return "revoked";
    if (invite.usedAt) return "used";
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return "expired";
    return "valid";
  }

  async getInviteRecord(code: string): Promise<InviteRecord | null> {
    const invite = this.invites.get(code);
    return invite ? { ...invite } : null;
  }

  async consumeInvite(code: string, email: string): Promise<ConsumeInviteResult> {
    const invite = this.invites.get(code);
    const normalizedEmail = normalizeEmail(email);
    if (!invite) return { status: "invalid" };
    if (invite.revokedAt) return { status: "revoked" };
    if (invite.usedAt) return { status: "used" };
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return { status: "expired" };
    if (invite.email !== normalizedEmail) return { status: "email_mismatch" };
    invite.usedAt = new Date().toISOString();
    return { status: "consumed", invite: { ...invite } };
  }

  async createShareGrant(input: CreateShareGrantInput): Promise<ShareGrantRecord> {
    const owner = this.getUserById(input.ownerUserId);
    const grantee = this.getUserById(input.granteeUserId);
    if (!owner || !grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const existing = this.portfolioShares.find(
      (share) =>
        share.ownerUserId === input.ownerUserId &&
        share.granteeUserId === input.granteeUserId &&
        share.revokedAt === null,
    );

    if (existing) {
      return toShareGrantRecord(existing, owner, grantee);
    }

    const share: MemoryShare = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      granteeUserId: input.granteeUserId,
      revokedByUserId: null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.portfolioShares.push(share);

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_granted",
      targetUserId: input.granteeUserId,
      metadata: buildShareAuditMetadata(share.id, owner, grantee),
    });
    const granteeLocale = this.stores.get(grantee.id)?.settings.locale ?? "en";
    await this.createNotification(
      buildShareGrantedNotification(share.id, owner, grantee.id, granteeLocale),
    );

    return toShareGrantRecord(share, owner, grantee);
  }

  async revokeShareGrant(
    shareId: string,
    revokedByUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<{ granteeUserId: string } | null> {
    const share = this.portfolioShares.find((candidate) => candidate.id === shareId);
    if (!share || share.ownerUserId !== revokedByUserId) {
      throw routeError(404, "share_not_found", "Share not found");
    }
    if (share.revokedAt !== null) {
      return null;
    }

    const owner = this.getUserById(share.ownerUserId);
    const grantee = this.getUserById(share.granteeUserId);
    if (!owner || !grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    share.revokedAt = new Date().toISOString();
    share.revokedByUserId = revokedByUserId;

    await this.appendAuditLog({
      ...auditInput,
      action: "share_revoked",
      targetUserId: share.granteeUserId,
      metadata: buildShareAuditMetadata(share.id, owner, grantee),
    });
    const granteeLocale = this.stores.get(share.granteeUserId)?.settings.locale ?? "en";
    await this.createNotification(
      buildShareRevokedNotification(share.id, owner, grantee.id, granteeLocale),
    );
    return { granteeUserId: share.granteeUserId };
  }

  async createShareCoupledInvite(input: CreateShareCoupledInviteInput): Promise<PendingShareInviteRecord> {
    const normalizedEmail = normalizeEmail(input.email);
    const owner = this.getUserById(input.ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const existing = [...this.invites.values()]
      .filter(
        (invite) =>
          invite.email === normalizedEmail &&
          invite.usedAt === null &&
          invite.revokedAt === null &&
          new Date(invite.expiresAt).getTime() > Date.now() &&
          (invite.shareOwnerUserId === null || invite.shareOwnerUserId === input.ownerUserId),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    if (existing) {
      existing.shareOwnerUserId = input.ownerUserId;
      return toPendingShareInviteRecord(existing, owner);
    }

    // Rate limit only applies when a new invite row is about to be inserted —
    // dedup updates existing rows in place and does not contribute to growth.
    const activePending = await this.countActivePendingShareInvites(input.ownerUserId);
    if (activePending >= PENDING_SHARE_INVITE_LIMIT) {
      throw routeError(429, "share_invite_rate_limited", "share invite rate limited");
    }

    const invite = await this.insertInvite({
      email: normalizedEmail,
      role: "viewer",
      expiresAt: input.expiresAt,
      issuedByUserId: input.issuedByUserId,
    });
    const stored = this.invites.get(invite.code);
    if (!stored) {
      throw new Error("Expected invite to exist after insert");
    }
    stored.shareOwnerUserId = input.ownerUserId;
    return toPendingShareInviteRecord(stored, owner);
  }

  async countActivePendingShareInvites(ownerUserId: string): Promise<number> {
    return [...this.invites.values()].filter(
      (invite) =>
        invite.shareOwnerUserId === ownerUserId &&
        invite.usedAt === null &&
        invite.revokedAt === null &&
        new Date(invite.expiresAt).getTime() > Date.now(),
    ).length;
  }

  async listSharesForOwner(ownerUserId: string): Promise<ListSharesForOwnerResult> {
    const owner = this.getUserById(ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const active: ShareGrantRecord[] = [];
    const revokedShares: ShareGrantRecord[] = [];
    for (const share of this.portfolioShares.filter((candidate) => candidate.ownerUserId === ownerUserId)) {
      const grantee = this.getUserById(share.granteeUserId);
      if (!grantee) {
        continue;
      }
      const record = toShareGrantRecord(share, owner, grantee);
      if (share.revokedAt) {
        revokedShares.push(record);
      } else {
        active.push(record);
      }
    }

    const pending: PendingShareInviteRecord[] = [];
    const expired: PendingShareInviteRecord[] = [];
    const revokedInvites: PendingShareInviteRecord[] = [];
    for (const invite of [...this.invites.values()].filter((candidate) => candidate.shareOwnerUserId === ownerUserId)) {
      const record = toPendingShareInviteRecord(invite, owner);
      if (invite.revokedAt) {
        revokedInvites.push(record);
      } else if (invite.usedAt) {
        continue;
      } else if (new Date(invite.expiresAt).getTime() <= Date.now()) {
        expired.push(record);
      } else {
        pending.push(record);
      }
    }

    return {
      active: active.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      pending: pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      expired: expired.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revoked: [...revokedShares, ...revokedInvites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async listInboundSharesForGrantee(granteeUserId: string): Promise<ListInboundSharesForGranteeResult> {
    const grantee = this.getUserById(granteeUserId);
    if (!grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const active: ShareGrantRecord[] = [];
    const revoked: ShareGrantRecord[] = [];
    for (const share of this.portfolioShares.filter((candidate) => candidate.granteeUserId === granteeUserId)) {
      const owner = this.getUserById(share.ownerUserId);
      if (!owner) {
        continue;
      }
      const record = toShareGrantRecord(share, owner, grantee);
      if (share.revokedAt) {
        revoked.push(record);
      } else {
        active.push(record);
      }
    }

    return {
      active: active.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revoked: revoked.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async validateActiveShare(ownerUserId: string, granteeUserId: string): Promise<boolean> {
    return this.portfolioShares.some(
      (candidate) =>
        candidate.ownerUserId === ownerUserId &&
        candidate.granteeUserId === granteeUserId &&
        candidate.revokedAt === null,
    );
  }

  async revokePendingShareInvite(
    code: string,
    ownerUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<void> {
    const invite = this.invites.get(code);
    if (!invite || invite.shareOwnerUserId !== ownerUserId) {
      throw routeError(404, "share_pending_not_found", "Pending share invite not found");
    }
    if (invite.usedAt !== null) {
      throw routeError(409, "share_pending_already_used", "Pending share invite already used");
    }
    if (invite.revokedAt !== null) {
      return;
    }

    const owner = this.getUserById(ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    invite.revokedAt = new Date().toISOString();

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_invite_revoked",
      metadata: {
        inviteCode: code,
        targetEmail: invite.email,
        shareCoupled: true,
        shareOwnerEmail: owner.email,
        shareOwnerDisplayName: owner.displayName,
      },
    });
  }

  async materializePendingSharesForEmail(input: MaterializePendingSharesInput): Promise<ShareGrantRecord[]> {
    const normalizedEmail = normalizeEmail(input.email);
    const grantee = this.getUserById(input.userId);
    if (!grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const matches = [...this.invites.values()].filter(
      (invite) =>
        invite.email === normalizedEmail &&
        invite.shareOwnerUserId !== null &&
        invite.usedAt === null &&
        invite.revokedAt === null &&
        new Date(invite.expiresAt).getTime() > Date.now(),
    );

    const materialized: ShareGrantRecord[] = [];
    for (const invite of matches) {
      invite.usedAt = new Date().toISOString();
      // Owner was hard-purged (FK set to NULL). Invite is marked used above so
      // subsequent logins don't retry materialization for this orphan record.
      if (!invite.shareOwnerUserId) {
        continue;
      }
      const owner = this.getUserById(invite.shareOwnerUserId);
      if (!owner) {
        continue;
      }
      const existing = this.portfolioShares.find(
        (share) =>
          share.ownerUserId === owner.id &&
          share.granteeUserId === input.userId &&
          share.revokedAt === null,
      );
      if (existing) {
        continue;
      }

      const share: MemoryShare = {
        id: randomUUID(),
        ownerUserId: owner.id,
        granteeUserId: input.userId,
        revokedByUserId: null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
      this.portfolioShares.push(share);

      await this.appendAuditLog({
        ...input.auditInput,
        action: "share_granted",
        targetUserId: input.userId,
        metadata: buildShareAuditMetadata(share.id, owner, grantee),
      });
      const granteeLocale = this.stores.get(input.userId)?.settings.locale ?? "en";
      await this.createNotification(
        buildShareGrantedNotification(share.id, owner, input.userId, granteeLocale),
      );

      materialized.push(toShareGrantRecord(share, owner, grantee));
    }

    return materialized;
  }

  async createAnonymousShareToken(
    input: CreateAnonymousShareTokenInput,
  ): Promise<CreateAnonymousShareTokenResult> {
    // Per-owner mutex keeps cap-check + insert atomic across concurrent callers.
    const previous = this.anonymousShareTokenLocks.get(input.ownerUserId) ?? Promise.resolve();
    const next = previous.then(() => this._createAnonymousShareTokenLocked(input));
    this.anonymousShareTokenLocks.set(
      input.ownerUserId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async _createAnonymousShareTokenLocked(
    input: CreateAnonymousShareTokenInput,
  ): Promise<CreateAnonymousShareTokenResult> {
    const owner = this.getUserById(input.ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    if (this.anonymousShareTokens.some((row) => row.token === input.token)) {
      return { status: "collision" };
    }

    const activeCount = this._countActiveAnonymousShareTokens(input.ownerUserId);
    if (activeCount >= getEffectiveAnonymousShareTokenCap()) {
      return { status: "cap_exceeded" };
    }

    const record: MemoryAnonymousShareToken = {
      id: randomUUID(),
      token: input.token,
      ownerUserId: input.ownerUserId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedByUserId: null,
    };
    this.anonymousShareTokens.push(record);

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_token_created",
      targetUserId: null,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        tokenId: record.id,
        expiresAt: record.expiresAt,
        ttlDays: input.ttlDays,
      },
    });

    return { status: "ok", record: toAnonymousShareTokenRecord(record) };
  }

  async listAnonymousShareTokensForOwner(ownerUserId: string): Promise<AnonymousShareTokenRecord[]> {
    const now = Date.now();
    const cutoff = now - getEffectiveAnonymousShareTokenRetentionMs();
    return this.anonymousShareTokens
      .filter((row) => row.ownerUserId === ownerUserId)
      .filter((row) => {
        if (row.revokedAt === null) {
          const expiresAtMs = new Date(row.expiresAt).getTime();
          if (expiresAtMs > now) return true;
          return expiresAtMs >= cutoff;
        }
        return new Date(row.revokedAt).getTime() >= cutoff;
      })
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toAnonymousShareTokenRecord);
  }

  async findActiveAnonymousShareTokenByToken(token: string): Promise<AnonymousShareTokenRecord | null> {
    const row = this.anonymousShareTokens.find((candidate) => candidate.token === token);
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
    return toAnonymousShareTokenRecord(row);
  }

  async revokeAnonymousShareToken(
    input: RevokeAnonymousShareTokenInput,
  ): Promise<RevokeAnonymousShareTokenResult> {
    const row = this.anonymousShareTokens.find((candidate) => candidate.id === input.id);
    if (!row || row.ownerUserId !== input.ownerUserId) {
      return { status: "not_found" };
    }
    const isActive =
      row.revokedAt === null && new Date(row.expiresAt).getTime() > Date.now();
    if (!isActive) {
      return { status: "noop" };
    }
    row.revokedAt = new Date().toISOString();
    row.revokedByUserId = input.ownerUserId;

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_token_revoked",
      targetUserId: null,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        tokenId: row.id,
      },
    });

    return { status: "revoked", record: toAnonymousShareTokenRecord(row) };
  }

  async countActiveAnonymousShareTokensForOwner(ownerUserId: string): Promise<number> {
    return this._countActiveAnonymousShareTokens(ownerUserId);
  }

  async purgeTerminalAnonymousShareTokens(_olderThanMs: number): Promise<number> {
    return 0;
  }

  private _countActiveAnonymousShareTokens(ownerUserId: string): number {
    const now = Date.now();
    return this.anonymousShareTokens.filter(
      (row) =>
        row.ownerUserId === ownerUserId &&
        row.revokedAt === null &&
        new Date(row.expiresAt).getTime() > now,
    ).length;
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
    // KZO-183: enforce the composite-FK ownership invariant in application
    // code. Postgres enforces it via the (id, account_id) composite FKs from
    // accounts and account_fee_profile_overrides; the memory backend cannot
    // express that declaratively, so this mirror runs on every saveStore so
    // memory-backed unit tests catch the same class of cross-account
    // ownership violation that integration tests catch via Postgres.
    validateMemoryStoreOwnership(store);
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

  async saveAccountingStoreWithAudit(
    userId: string,
    accounting: AccountingStore,
    auditEntry: AuditLogInput,
  ): Promise<void> {
    await this.saveAccountingStore(userId, accounting);
    await this.appendAuditLog(auditEntry);
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
      throw routeError(409, "dividend_conflict", "Dividend posting requires an active expected entry");
    }

    store.accounting = accounting;
    store.marketData = marketData;
    syncInstruments(store);
    this.stores.set(userId, store);
  }

  async replaceDividendSourceLinesForLedger(userId: string, ledgerEntryId: string, sourceLines: DividendSourceLine[]): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting.facts.dividendSourceLines = [
      ...store.accounting.facts.dividendSourceLines.filter((entry) => entry.dividendLedgerEntryId !== ledgerEntryId),
      ...sourceLines,
    ];
  }

  async findDividendLedgerEntryById(userId: string, dividendLedgerEntryId: string) {
    const store = await this.loadStore(userId);
    const accountIds = new Set(store.accounts.filter((account) => account.userId === userId).map((account) => account.id));
    return store.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === dividendLedgerEntryId && accountIds.has(entry.accountId),
    ) ?? null;
  }

  async getDividendLedgerEntryWithDetails(userId: string, dividendLedgerEntryId: string) {
    const store = await this.loadStore(userId);
    const accountIds = new Set(store.accounts.filter((account) => account.userId === userId).map((account) => account.id));
    const entry = store.accounting.facts.dividendLedgerEntries.find(
      (candidate) => candidate.id === dividendLedgerEntryId && accountIds.has(candidate.accountId),
    );
    if (!entry) return null;
    return {
      ...entry,
      deductions: store.accounting.facts.dividendDeductionEntries.filter(
        (deduction) => deduction.dividendLedgerEntryId === entry.id,
      ),
      sourceLines: store.accounting.facts.dividendSourceLines.filter(
        (line) => line.dividendLedgerEntryId === entry.id,
      ),
    };
  }

  async updateDividendReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: Store["accounting"]["facts"]["dividendLedgerEntries"][number]["reconciliationStatus"],
    note?: string,
  ) {
    const entry = await this.findDividendLedgerEntryById(userId, dividendLedgerEntryId);
    if (!entry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }

    if (!["posted", "adjusted"].includes(entry.postingStatus)) {
      throw routeError(409, "reconciliation_requires_posted_status", "Dividend must be posted before reconciliation changes");
    }

    const normalizedNote = note?.trim();
    if (status === "explained" && !normalizedNote) {
      throw routeError(400, "reconciliation_note_required", "A note is required when reconciliation stays explained");
    }

    entry.reconciliationStatus = status;
    entry.version += 1;
    entry.reconciliationNote = normalizedNote || entry.reconciliationNote;

    return entry;
  }

  async updatePostedCashDividend(userId: string, input: UpdatePostedCashDividendInput) {
    const store = await this.loadStore(userId);
    const entryIndex = store.accounting.facts.dividendLedgerEntries.findIndex((entry) => entry.id === input.dividendLedgerEntry.id);
    if (entryIndex === -1) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    const currentEntry = store.accounting.facts.dividendLedgerEntries[entryIndex]!;
    if (currentEntry.version !== input.expectedVersion) {
      throw routeError(409, "dividend_version_conflict", "Dividend has been updated by another request");
    }
    if (currentEntry.postingStatus !== "posted") {
      throw routeError(409, "dividend_update_requires_posted_status", "Only posted dividends can be edited in place");
    }

    const dividendEvent = store.marketData.dividendEvents.find((event) => event.id === currentEntry.dividendEventId);
    if (!dividendEvent) {
      throw routeError(404, "dividend_event_not_found", "Dividend event not found");
    }
    if (dividendEvent.eventType !== "CASH") {
      throw routeError(422, "stock_dividend_in_place_edit_unsupported", "Only pure cash dividends can be edited in place");
    }

    const nextEntry = {
      ...input.dividendLedgerEntry,
      version: input.expectedVersion + 1,
      reconciliationStatus: "open" as const,
      reconciliationNote: undefined,
    };

    store.accounting.facts.dividendLedgerEntries[entryIndex] = nextEntry;
    store.accounting.facts.dividendDeductionEntries = [
      ...store.accounting.facts.dividendDeductionEntries.filter((entry) => entry.dividendLedgerEntryId !== input.dividendLedgerEntry.id),
      ...input.dividendDeductions,
    ];
    store.accounting.facts.dividendSourceLines = [
      ...store.accounting.facts.dividendSourceLines.filter((entry) => entry.dividendLedgerEntryId !== input.dividendLedgerEntry.id),
      ...input.dividendSourceLines,
    ];
    store.accounting.facts.cashLedgerEntries = [
      ...store.accounting.facts.cashLedgerEntries.filter((entry) => entry.relatedDividendLedgerEntryId !== input.dividendLedgerEntry.id),
      ...input.linkedCashEntries,
    ];
    if (dividendEvent) {
      store.accounting.projections.lots = [
        ...store.accounting.projections.lots.filter(
          (lot) => lot.accountId !== input.dividendLedgerEntry.accountId || lot.ticker !== dividendEvent.ticker,
        ),
        ...input.lots,
      ];
      rebuildHoldingProjection(store);
    }
    return nextEntry;
  }

  async listDividendLedgerScopes(): Promise<Array<{ userId: string; accountId: string; ticker: string }>> {
    const out: Array<{ userId: string; accountId: string; ticker: string }> = [];
    const seen = new Set<string>();
    for (const [userId, store] of this.stores.entries()) {
      const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event.ticker]));
      const supersededIds = new Set(
        store.accounting.facts.dividendLedgerEntries
          .map((entry) => entry.reversalOfDividendLedgerEntryId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const entry of store.accounting.facts.dividendLedgerEntries) {
        if (entry.reversalOfDividendLedgerEntryId) continue;
        if (entry.supersededAt) continue;
        if (supersededIds.has(entry.id)) continue;
        const ticker = eventById.get(entry.dividendEventId);
        if (!ticker) continue;
        const key = `${userId}:${entry.accountId}:${ticker}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ userId, accountId: entry.accountId, ticker });
      }
    }
    return out;
  }

  async applyDividendLedgerRecompute(
    userId: string,
    changes: DividendLedgerRecomputeChange[],
  ): Promise<DividendLedgerRecomputeChange[]> {
    if (changes.length === 0) return [];
    const store = await this.loadStore(userId);
    const applied: DividendLedgerRecomputeChange[] = [];

    for (const change of changes) {
      const entry = store.accounting.facts.dividendLedgerEntries.find(
        (candidate) => candidate.id === change.ledgerEntryId && candidate.accountId === change.accountId,
      );
      if (!entry) continue;
      // Idempotency guard: if a concurrent write already moved the entry
      // forward past our previousVersion, skip — the next replay will
      // resynchronize.
      if (entry.version !== change.previousVersion) continue;

      entry.eligibleQuantity = change.nextEligibleQuantity;
      entry.expectedCashAmount = change.nextExpectedCashAmount;
      entry.expectedStockQuantity = change.nextExpectedStockQuantity;
      entry.version = change.nextVersion;
      entry.reconciliationStatus = change.nextReconciliationStatus;
      // Preserve the existing note (1a) — plan already carried it forward.
      applied.push(change);
    }

    return applied;
  }

  async listDividendEventsByPaymentDate(
    userId: string,
    fromPaymentDate?: string,
    toPaymentDate?: string,
    limit: number = 500,
  ) {
    const store = await this.loadStore(userId);
    void userId;
    return store.marketData.dividendEvents
      .filter((event) => matchesNullableDateRange(event.paymentDate, fromPaymentDate, toPaymentDate))
      .sort(compareNullablePaymentDates)
      .slice(0, limit);
  }

  async listDividendLedgerEntries(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendLedgerListResult> {
    const store = await this.loadStore(userId);
    const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    const accountById = new Map(store.accounts.map((account) => [account.id, account]));

    // Sum received cash amounts from DIVIDEND_RECEIPT cash ledger entries,
    // keyed by relatedDividendLedgerEntryId. Matches postgres receipts subquery.
    const receivedByLedgerId = new Map<string, number>();
    for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
      if (cashEntry.entryType !== "DIVIDEND_RECEIPT") continue;
      const ledgerId = cashEntry.relatedDividendLedgerEntryId;
      if (!ledgerId) continue;
      receivedByLedgerId.set(ledgerId, (receivedByLedgerId.get(ledgerId) ?? 0) + cashEntry.amount);
    }

    // Entries reversed by a later entry are inactive even if their own
    // supersededAt is still null — matches the NOT EXISTS reversal subquery.
    const reversedIds = new Set(
      store.accounting.facts.dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );

    const filtered = store.accounting.facts.dividendLedgerEntries.filter((entry) => {
      if (entry.reversalOfDividendLedgerEntryId) return false;
      if (entry.supersededAt) return false;
      if (reversedIds.has(entry.id)) return false;
      if (opts.accountId && entry.accountId !== opts.accountId) return false;
      const event = eventById.get(entry.dividendEventId);
      const hasDates = opts.fromPaymentDate != null || opts.toPaymentDate != null;
      if (hasDates) {
        if (!matchesNullableDateRange(event?.paymentDate ?? null, opts.fromPaymentDate, opts.toPaymentDate)) return false;
      } else {
        // No date params: exclude TBD entries (null payment_date)
        if ((event?.paymentDate ?? null) == null) return false;
      }
      if (opts.reconciliationStatus && entry.reconciliationStatus !== opts.reconciliationStatus) return false;
      if (opts.postingStatus && entry.postingStatus !== opts.postingStatus) return false;
      if (opts.ticker && event?.ticker !== opts.ticker) return false;
      return true;
    });

    // Compute aggregates over the full filtered set BEFORE slicing.
    const aggregates: DividendLedgerAggregates = {
      totalExpectedCashAmount: {},
      totalReceivedCashAmount: {},
      openCount: 0,
      byMonth: {},
      byTicker: {},
    };
    for (const entry of filtered) {
      const event = eventById.get(entry.dividendEventId);
      if (!event) continue;
      const currency = event.cashDividendCurrency;
      const expected = entry.expectedCashAmount;
      const received = receivedByLedgerId.get(entry.id) ?? 0;

      aggregates.totalExpectedCashAmount[currency] =
        (aggregates.totalExpectedCashAmount[currency] ?? 0) + expected;
      aggregates.totalReceivedCashAmount[currency] =
        (aggregates.totalReceivedCashAmount[currency] ?? 0) + received;
      if (entry.reconciliationStatus === "open") aggregates.openCount += 1;

      if (event.paymentDate) {
        const monthKey = event.paymentDate.substring(0, 7);
        const monthBucket = (aggregates.byMonth[monthKey] ??= {});
        const monthCurrencyBucket = (monthBucket[currency] ??= { expected: 0, received: 0 });
        monthCurrencyBucket.expected += expected;
        monthCurrencyBucket.received += received;
      }

      const tickerBucket = (aggregates.byTicker[event.ticker] ??= {});
      const tickerCurrencyBucket = (tickerBucket[currency] ??= { expected: 0, received: 0 });
      tickerCurrencyBucket.expected += expected;
      tickerCurrencyBucket.received += received;
    }

    // Sort full filtered set before pagination slice.
    const orderFactor = opts.sortOrder === "asc" ? 1 : -1;
    const sorted = filtered.slice().sort((left, right) => {
      const leftEvent = eventById.get(left.dividendEventId);
      const rightEvent = eventById.get(right.dividendEventId);
      let cmp = 0;
      switch (opts.sortBy) {
        case "paymentDate":
          cmp = compareNullablePaymentDates(leftEvent, rightEvent);
          break;
        case "ticker":
          cmp = (leftEvent?.ticker ?? "").localeCompare(rightEvent?.ticker ?? "");
          break;
        case "account": {
          const leftName = accountById.get(left.accountId)?.name ?? "";
          const rightName = accountById.get(right.accountId)?.name ?? "";
          cmp = leftName.localeCompare(rightName);
          break;
        }
        case "expectedCashAmount":
          cmp = left.expectedCashAmount - right.expectedCashAmount;
          break;
        case "receivedCashAmount": {
          const leftReceived = receivedByLedgerId.get(left.id) ?? 0;
          const rightReceived = receivedByLedgerId.get(right.id) ?? 0;
          cmp = leftReceived - rightReceived;
          break;
        }
        case "reconciliationStatus":
          cmp = left.reconciliationStatus.localeCompare(right.reconciliationStatus);
          break;
      }
      if (cmp !== 0) return cmp * orderFactor;
      // Stable final tiebreaker by id (direction-independent — matches
      // postgres `ORDER BY ..., dle.id ASC` tiebreaker).
      return left.id.localeCompare(right.id);
    });

    const total = sorted.length;
    const startIndex = (opts.page - 1) * opts.limit;
    const pageRows = sorted.slice(startIndex, startIndex + opts.limit);

    const ledgerEntries = pageRows.map((entry) => ({
      ...entry,
      receivedCashAmount: receivedByLedgerId.get(entry.id) ?? 0,
      deductions: store.accounting.facts.dividendDeductionEntries.filter(
        (deduction) => deduction.dividendLedgerEntryId === entry.id,
      ),
      sourceLines: store.accounting.facts.dividendSourceLines.filter(
        (line) => line.dividendLedgerEntryId === entry.id,
      ),
    }));

    return { ledgerEntries, total, aggregates };
  }

  async listDividendReviewRows(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendReviewListResult> {
    const store = await this.loadStore(userId);
    const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    const accountById = new Map(store.accounts.map((account) => [account.id, account]));
    const receivedByLedgerId = new Map<string, number>();

    for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
      if (cashEntry.entryType !== "DIVIDEND_RECEIPT") continue;
      const ledgerId = cashEntry.relatedDividendLedgerEntryId;
      if (!ledgerId) continue;
      receivedByLedgerId.set(ledgerId, (receivedByLedgerId.get(ledgerId) ?? 0) + cashEntry.amount);
    }

    const reversedIds = new Set(
      store.accounting.facts.dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );

    const activeLedgerEntries = store.accounting.facts.dividendLedgerEntries.filter((entry) => {
      if (entry.reversalOfDividendLedgerEntryId) return false;
      if (entry.supersededAt) return false;
      if (reversedIds.has(entry.id)) return false;
      return true;
    });
    const activeLedgerKey = new Set(activeLedgerEntries.map((entry) => `${entry.accountId}:${entry.dividendEventId}`));
    const reversedTradeIds = new Set(
      store.accounting.facts.tradeEvents
        .map((trade) => trade.reversalOfTradeEventId)
        .filter((id): id is string => Boolean(id)),
    );

    const instrumentTypeFor = (ticker: string, cashCurrency: string): InstrumentType => {
      try {
        const marketCode = marketCodeFor(cashCurrency);
        return store.instruments.find(
          (instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode,
        )?.type ?? "STOCK";
      } catch {
        return "STOCK";
      }
    };

    const dateFilterActive = opts.fromPaymentDate != null || opts.toPaymentDate != null;
    const matchesDateFilter = (paymentDate: string | null | undefined): boolean => {
      if (dateFilterActive) return matchesNullableDateRange(paymentDate ?? null, opts.fromPaymentDate, opts.toPaymentDate);
      return paymentDate != null;
    };

    const ledgerRows: DividendReviewRowWithDetails[] = activeLedgerEntries.flatMap((entry) => {
      if (opts.accountId && entry.accountId !== opts.accountId) return [];
      if (opts.reconciliationStatus && entry.reconciliationStatus !== opts.reconciliationStatus) return [];
      if (opts.postingStatus && entry.postingStatus !== opts.postingStatus) return [];
      const event = eventById.get(entry.dividendEventId);
      if (!event) return [];
      if (!matchesDateFilter(event.paymentDate)) return [];
      if (opts.ticker && event.ticker !== opts.ticker) return [];
      return [{
        ...entry,
        rowKind: "ledger",
        ticker: event.ticker,
        instrumentType: instrumentTypeFor(event.ticker, event.cashDividendCurrency),
        eventType: event.eventType,
        exDividendDate: event.exDividendDate,
        paymentDate: event.paymentDate,
        cashCurrency: event.cashDividendCurrency,
        receivedCashAmount: receivedByLedgerId.get(entry.id) ?? 0,
        deductions: store.accounting.facts.dividendDeductionEntries.filter(
          (deduction) => deduction.dividendLedgerEntryId === entry.id,
        ),
        sourceLines: store.accounting.facts.dividendSourceLines.filter(
          (line) => line.dividendLedgerEntryId === entry.id,
        ),
      }];
    });

    const expectedRows: DividendReviewRowWithDetails[] = [];
    for (const account of store.accounts) {
      if (account.userId !== userId) continue;
      if (opts.accountId && account.id !== opts.accountId) continue;

      for (const event of store.marketData.dividendEvents) {
        let eventMarketCode: MarketCode;
        try {
          eventMarketCode = marketCodeFor(event.cashDividendCurrency);
        } catch {
          continue;
        }
        if (account.defaultCurrency !== event.cashDividendCurrency) continue;
        if (!matchesDateFilter(event.paymentDate)) continue;
        if (opts.ticker && event.ticker !== opts.ticker) continue;
        if (opts.reconciliationStatus && opts.reconciliationStatus !== "open") continue;
        if (opts.postingStatus && opts.postingStatus !== "expected") continue;
        if (activeLedgerKey.has(`${account.id}:${event.id}`)) continue;

        const eligibleQuantity = Math.max(
          0,
          store.accounting.facts.tradeEvents
            .filter(
              (trade) =>
                trade.userId === userId &&
                trade.accountId === account.id &&
                trade.ticker === event.ticker &&
                trade.marketCode === eventMarketCode &&
                trade.tradeDate < event.exDividendDate &&
                !trade.reversalOfTradeEventId &&
                !reversedTradeIds.has(trade.id),
            )
            .reduce((sum, trade) => sum + (trade.type === "BUY" ? trade.quantity : -trade.quantity), 0),
        );
        if (eligibleQuantity <= 0) continue;

        expectedRows.push({
          id: `expected:${account.id}:${event.id}`,
          rowKind: "expected",
          accountId: account.id,
          dividendEventId: event.id,
          ticker: event.ticker,
          instrumentType: instrumentTypeFor(event.ticker, event.cashDividendCurrency),
          eventType: event.eventType,
          exDividendDate: event.exDividendDate,
          paymentDate: event.paymentDate,
          cashCurrency: event.cashDividendCurrency,
          eligibleQuantity,
          expectedCashAmount: Math.max(0, Math.round(eligibleQuantity * event.cashDividendPerShare + Number.EPSILON)),
          expectedStockQuantity: Math.floor(eligibleQuantity * event.stockDividendPerShare),
          receivedCashAmount: 0,
          receivedStockQuantity: 0,
          postingStatus: "expected",
          reconciliationStatus: "open",
          version: 0,
          sourceCompositionStatus: "unknown_pending_disclosure",
          deductions: [],
          sourceLines: [],
        });
      }
    }

    const rows = [...ledgerRows, ...expectedRows];
    const aggregates: DividendLedgerAggregates = {
      totalExpectedCashAmount: {},
      totalReceivedCashAmount: {},
      openCount: 0,
      byMonth: {},
      byTicker: {},
    };

    for (const row of rows) {
      const currency = row.cashCurrency;
      aggregates.totalExpectedCashAmount[currency] =
        (aggregates.totalExpectedCashAmount[currency] ?? 0) + row.expectedCashAmount;
      aggregates.totalReceivedCashAmount[currency] =
        (aggregates.totalReceivedCashAmount[currency] ?? 0) + row.receivedCashAmount;
      if (row.reconciliationStatus === "open") aggregates.openCount += 1;

      if (row.paymentDate) {
        const monthKey = row.paymentDate.substring(0, 7);
        const monthBucket = (aggregates.byMonth[monthKey] ??= {});
        const monthCurrencyBucket = (monthBucket[currency] ??= { expected: 0, received: 0 });
        monthCurrencyBucket.expected += row.expectedCashAmount;
        monthCurrencyBucket.received += row.receivedCashAmount;
      }

      const tickerBucket = (aggregates.byTicker[row.ticker] ??= {});
      const tickerCurrencyBucket = (tickerBucket[currency] ??= { expected: 0, received: 0 });
      tickerCurrencyBucket.expected += row.expectedCashAmount;
      tickerCurrencyBucket.received += row.receivedCashAmount;
    }

    const orderFactor = opts.sortOrder === "asc" ? 1 : -1;
    const sorted = rows.slice().sort((left, right) => {
      let cmp = 0;
      switch (opts.sortBy) {
        case "paymentDate":
          cmp = compareNullablePaymentDates(left, right);
          break;
        case "ticker":
          cmp = left.ticker.localeCompare(right.ticker);
          break;
        case "account": {
          const leftName = accountById.get(left.accountId)?.name ?? "";
          const rightName = accountById.get(right.accountId)?.name ?? "";
          cmp = leftName.localeCompare(rightName);
          break;
        }
        case "expectedCashAmount":
          cmp = left.expectedCashAmount - right.expectedCashAmount;
          break;
        case "receivedCashAmount":
          cmp = left.receivedCashAmount - right.receivedCashAmount;
          break;
        case "reconciliationStatus":
          cmp = left.reconciliationStatus.localeCompare(right.reconciliationStatus);
          break;
      }
      if (cmp !== 0) return cmp * orderFactor;
      return left.id.localeCompare(right.id);
    });

    const total = sorted.length;
    const startIndex = (opts.page - 1) * opts.limit;
    return { rows: sorted.slice(startIndex, startIndex + opts.limit), total, aggregates };
  }

  async listCashLedgerEntries(
    userId: string,
    opts: CashLedgerListOptions,
  ): Promise<CashLedgerListResult> {
    const store = await this.loadStore(userId);

    // 1. Filter
    const filtered = store.accounting.facts.cashLedgerEntries.filter((entry) => {
      if (entry.userId !== userId) return false;
      if (opts.fromEntryDate && entry.entryDate < opts.fromEntryDate) return false;
      if (opts.toEntryDate && entry.entryDate > opts.toEntryDate) return false;
      if (opts.accountId && entry.accountId !== opts.accountId) return false;
      if (opts.entryType && !opts.entryType.includes(entry.entryType)) return false;
      return true;
    });

    // 2. Summary over full filtered set (NOT page slice)
    const summaryMap = new Map<string, { accountId: string; currency: string; amount: number }>();
    for (const entry of filtered) {
      const key = `${entry.accountId}:${entry.currency}`;
      const existing = summaryMap.get(key);
      if (existing) {
        existing.amount += entry.amount;
      } else {
        summaryMap.set(key, { accountId: entry.accountId, currency: entry.currency, amount: entry.amount });
      }
    }
    const summary = [...summaryMap.values()];

    // 3. Sort with tiebreaker
    const orderFactor = opts.sortOrder === "asc" ? 1 : -1;
    const sorted = filtered.slice().sort((left, right) => {
      let cmp = 0;
      switch (opts.sortBy) {
        case "entryDate":
          cmp = left.entryDate.localeCompare(right.entryDate);
          break;
        case "entryType":
          cmp = left.entryType.localeCompare(right.entryType);
          break;
        case "amount":
          cmp = left.amount - right.amount;
          break;
        case "currency":
          cmp = left.currency.localeCompare(right.currency);
          break;
        case "accountId":
          cmp = left.accountId.localeCompare(right.accountId);
          break;
      }
      if (cmp !== 0) return cmp * orderFactor;
      // Tiebreaker: bookedAt DESC NULLS LAST
      const leftBookedAt = left.bookedAt ?? "";
      const rightBookedAt = right.bookedAt ?? "";
      if (leftBookedAt || rightBookedAt) {
        if (!leftBookedAt) return 1; // null sorts last
        if (!rightBookedAt) return -1;
        const bookedCmp = rightBookedAt.localeCompare(leftBookedAt); // DESC
        if (bookedCmp !== 0) return bookedCmp;
      }
      // Final tiebreaker: id ASC
      return left.id.localeCompare(right.id);
    });

    // 4. Paginate
    const total = sorted.length;
    const startIndex = (opts.page - 1) * opts.limit;
    const entries = sorted.slice(startIndex, startIndex + opts.limit);

    return { entries, total, summary };
  }

  async listDividendLedgerYears(userId: string): Promise<{ years: number[] }> {
    const store = await this.loadStore(userId);
    const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    const reversedIds = new Set(
      store.accounting.facts.dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );
    const years = new Set<number>();
    for (const entry of store.accounting.facts.dividendLedgerEntries) {
      if (entry.reversalOfDividendLedgerEntryId) continue;
      if (entry.supersededAt) continue;
      if (reversedIds.has(entry.id)) continue;
      const event = eventById.get(entry.dividendEventId);
      if (!event?.paymentDate) continue;
      years.add(parseInt(event.paymentDate.substring(0, 4), 10));
    }
    return { years: Array.from(years).sort((a, b) => b - a) };
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
    // ui-reshape Phase 3d S7 — read user overrides from
    // user_preferences.preferences.userProfile JSONB. Returns null when
    // unset; the route/UI resolver falls back to provider values.
    const prefs = this.userPreferences.get(userId) ?? {};
    const userProfile = isPlainObject(prefs.userProfile) ? prefs.userProfile : {};
    const userDisplayName = typeof userProfile.displayName === "string"
      ? userProfile.displayName
      : null;
    const userPictureUrl = typeof userProfile.pictureUrl === "string"
      ? userProfile.pictureUrl
      : null;
    return {
      userId: memUser.id,
      email: memUser.email,
      displayName: memUser.displayName,
      providerPictureUrl: memUser.providerPictureUrl,
      providerDisplayName: memUser.providerDisplayName,
      userDisplayName,
      userPictureUrl,
      linkedAt: null,
      lastSeenAt: null,
      role: memUser.role,
      impersonation: null,
    };
  }

  async updateProfileEmail(userId: string, email: string): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    const normalizedEmail = normalizeEmail(email);
    // Re-key the map if email changed
    if (memUser.email !== normalizedEmail) {
      const existing = this.usersByEmail.get(normalizedEmail);
      if (existing && existing.id !== userId) {
        throw routeError(409, "email_conflict", "Email is already in use");
      }
      this.usersByEmail.delete(memUser.email);
      memUser.email = normalizedEmail;
      this.usersByEmail.set(normalizedEmail, memUser);
    }
    return this.getProfile(userId);
  }

  /**
   * ui-reshape Phase 3d S7 — store user-overridable profile fields in the
   * user_preferences JSONB blob under `userProfile`. Independent per-field
   * semantics: undefined = leave, null = clear, string = set.
   */
  async updateProfileFields(
    userId: string,
    fields: { displayName?: string | null; pictureUrl?: string | null },
  ): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    const prefs = this.userPreferences.get(userId) ?? {};
    const existingUserProfile = isPlainObject(prefs.userProfile)
      ? { ...prefs.userProfile }
      : {};
    if (fields.displayName !== undefined) {
      if (fields.displayName === null) {
        delete existingUserProfile.displayName;
      } else {
        existingUserProfile.displayName = fields.displayName;
      }
    }
    if (fields.pictureUrl !== undefined) {
      if (fields.pictureUrl === null) {
        delete existingUserProfile.pictureUrl;
      } else {
        existingUserProfile.pictureUrl = fields.pictureUrl;
      }
    }
    const next: Record<string, unknown> = { ...prefs };
    if (Object.keys(existingUserProfile).length === 0) {
      delete next.userProfile;
    } else {
      next.userProfile = existingUserProfile;
    }
    this.userPreferences.set(userId, next);
    return this.getProfile(userId);
  }

  async getLatestBars(tickers: string[], limit: number): Promise<DailyBar[]> {
    const tickerSet = new Set(tickers);
    const grouped = new Map<string, MemoryDailyBar[]>();
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

  async getLatestBarDatesByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    for (const p of pairs) result.set(`${p.ticker}:${p.marketCode}`, null);
    for (const bar of this.dailyBars) {
      const key = `${bar.ticker}:${bar.marketCode}`;
      if (!result.has(key)) continue;
      const current = result.get(key);
      if (!current || bar.barDate > current) {
        result.set(key, bar.barDate);
      }
    }
    return result;
  }

  async getDistinctBarDates(market: MarketCode, fromDate: string): Promise<string[]> {
    const dates = new Set<string>();
    for (const bar of this.dailyBars) {
      if (bar.marketCode !== market) continue;
      if (bar.barDate < fromDate) continue;
      dates.add(bar.barDate);
    }
    return [...dates].sort((a, b) => a.localeCompare(b));
  }

  _seedDailyBars(bars: SeedDailyBar[]): void {
    this.dailyBars.push(...bars.map((bar) => ({ ...bar, marketCode: bar.marketCode ?? "TW" })));
  }
  _clearDailyBars(): void { this.dailyBars.length = 0; }
  _seedHoldingSnapshots(snapshots: HoldingSnapshot[]): void { this.holdingSnapshots.push(...snapshots); }
  _clearHoldingSnapshots(): void { this.holdingSnapshots.length = 0; }
  _seedCurrencyWalletSnapshots(snapshots: CurrencyWalletSnapshot[]): void {
    this.currencyWalletSnapshots.push(...snapshots);
  }
  _clearCurrencyWalletSnapshots(): void { this.currencyWalletSnapshots.length = 0; }
  _getCurrencyWalletSnapshotsForUser(userId: string): CurrencyWalletSnapshot[] {
    return this.currencyWalletSnapshots
      .filter((snapshot) => snapshot.userId === userId)
      .slice()
      .sort((a, b) =>
        a.accountId.localeCompare(b.accountId)
        || a.currency.localeCompare(b.currency)
        || a.date.localeCompare(b.date),
      );
  }

  // KZO-164: FX rates (Frankfurter v2 ingestion). Memory backend is keyed by
  // `${date}:${baseCurrency}:${quoteCurrency}` so subsequent upserts overwrite
  // prior rows (matches Postgres `ON CONFLICT DO UPDATE` semantics).
  async upsertFxRates(rates: ReadonlyArray<FxRate>): Promise<number> {
    let count = 0;
    for (const r of rates) {
      // Mirror schema CHECK: callers must filter self-pairs first; defensive guard
      // keeps the in-memory store from accepting invalid rows that would crash Postgres.
      if (r.baseCurrency === r.quoteCurrency) continue;
      const key = `${r.date}:${r.baseCurrency}:${r.quoteCurrency}`;
      this.fxRates.set(key, { ...r });
      count++;
    }
    return count;
  }

  async getLatestFxRateDate(): Promise<string | null> {
    let latest: string | null = null;
    for (const r of this.fxRates.values()) {
      if (!latest || r.date > latest) latest = r.date;
    }
    return latest;
  }

  async getFxRateFreshness(): Promise<Array<{ baseCurrency: string; quoteCurrency: string; latestDate: string }>> {
    const grouped = new Map<string, { baseCurrency: string; quoteCurrency: string; latestDate: string }>();
    for (const r of this.fxRates.values()) {
      const key = `${r.baseCurrency}:${r.quoteCurrency}`;
      const existing = grouped.get(key);
      if (!existing || r.date > existing.latestDate) {
        grouped.set(key, { baseCurrency: r.baseCurrency, quoteCurrency: r.quoteCurrency, latestDate: r.date });
      }
    }
    return [...grouped.values()].sort((a, b) =>
      a.baseCurrency === b.baseCurrency
        ? a.quoteCurrency.localeCompare(b.quoteCurrency)
        : a.baseCurrency.localeCompare(b.baseCurrency),
    );
  }

  /** KZO-164 test-only — clear all FX rates (`beforeEach` use). */
  _resetFxRates(): void {
    this.fxRates.clear();
  }

  async getFxRate(base: string, quote: string, asOfDate: string): Promise<number | null> {
    if (base === quote) return 1.0;
    let bestDate: string | null = null;
    let bestRate: number | null = null;
    for (const r of this.fxRates.values()) {
      if (r.baseCurrency !== base || r.quoteCurrency !== quote) continue;
      if (r.date > asOfDate) continue;
      if (bestDate === null || r.date > bestDate) {
        bestDate = r.date;
        bestRate = r.rate;
      }
    }
    return bestRate;
  }

  async getFxTransferById(
    userId: string,
    fxTransferId: string,
  ): Promise<{ legs: CashLedgerEntry[]; reversed: boolean } | null> {
    const store = await this.loadStore(userId);
    const legs = store.accounting.facts.cashLedgerEntries
      .filter((entry) => entry.userId === userId && entry.fxTransferId === fxTransferId)
      .sort((left, right) =>
        (left.reversalOfCashLedgerEntryId ?? "").localeCompare(right.reversalOfCashLedgerEntryId ?? "")
        || left.entryType.localeCompare(right.entryType)
        || left.id.localeCompare(right.id),
      );
    if (legs.length === 0) return null;
    return {
      legs,
      reversed: legs.some((leg) => Boolean(leg.reversalOfCashLedgerEntryId)),
    };
  }

  async getAccountAvailableBalance(userId: string, accountId: string, currency: string): Promise<number> {
    const store = await this.loadStore(userId);
    const reversedIds = new Set<string>();
    for (const entry of store.accounting.facts.cashLedgerEntries) {
      if (entry.reversalOfCashLedgerEntryId) {
        reversedIds.add(entry.reversalOfCashLedgerEntryId);
      }
    }
    let total = 0;
    for (const entry of store.accounting.facts.cashLedgerEntries) {
      if (entry.accountId !== accountId) continue;
      if (entry.currency !== currency) continue;
      if (entry.reversalOfCashLedgerEntryId) continue;
      if (reversedIds.has(entry.id)) continue;
      total += entry.amount;
    }
    return total;
  }

  async getCashLedgerEntriesForWalletReplay(
    userId: string,
  ): Promise<import("./types.js").CashLedgerEntryForWalletReplay[]> {
    const store = await this.loadStore(userId);
    const entries = store.accounting.facts.cashLedgerEntries;
    const reversedIds = new Set<string>();
    for (const e of entries) {
      if (e.reversalOfCashLedgerEntryId) reversedIds.add(e.reversalOfCashLedgerEntryId);
    }
    return entries
      .filter((e) => !e.reversalOfCashLedgerEntryId && !reversedIds.has(e.id))
      .map((e) => ({
        id: e.id,
        accountId: e.accountId,
        currency: e.currency,
        entryDate: e.entryDate,
        amount: e.amount,
        fxRateToUsd: e.fxRateToUsd ?? null,
        fxTransferId: e.fxTransferId ?? null,
        entryType: e.entryType,
        reversalOfCashLedgerEntryId: e.reversalOfCashLedgerEntryId,
        bookedAt: e.bookedAt,
      }))
      .sort(
        (a, b) =>
          a.entryDate.localeCompare(b.entryDate)
          || (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "")
          || a.id.localeCompare(b.id),
      );
  }

  async getDailyBarsForTicker(ticker: string, startDate: string, endDate: string): Promise<DailyBar[]> {
    return this.dailyBars
      .filter(b => b.ticker === ticker && b.barDate >= startDate && b.barDate <= endDate)
      .sort((a, b) => a.barDate.localeCompare(b.barDate));
  }

  async getDailyBarsForTickers(tickers: string[], startDate: string, endDate: string): Promise<Map<string, DailyBar[]>> {
    const result = new Map<string, DailyBar[]>();
    for (const t of tickers) result.set(t, []);
    const wanted = new Set(tickers);
    const sorted = [...this.dailyBars]
      .filter(b => wanted.has(b.ticker) && b.barDate >= startDate && b.barDate <= endDate)
      .sort((a, b) => a.barDate.localeCompare(b.barDate));
    for (const bar of sorted) {
      const list = result.get(bar.ticker) ?? [];
      list.push(bar);
      result.set(bar.ticker, list);
    }
    return result;
  }

  async getSnapshotGenerationInputs(
    userId: string,
    scope?: { accountId: string; ticker: string },
  ): Promise<import("./types.js").SnapshotGenerationInputs> {
    const store = await this.loadStore(userId);

    // Trades — apply optional scope filter, then sort by trade_date → booking_sequence → id.
    const trades = store.accounting.facts.tradeEvents
      .filter(t => !scope || (t.accountId === scope.accountId && t.ticker === scope.ticker))
      .slice()
      .sort((a, b) =>
        a.tradeDate.localeCompare(b.tradeDate)
        || (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0)
        || a.id.localeCompare(b.id),
      )
      .map(t => ({
        id: t.id,
        accountId: t.accountId,
        ticker: t.ticker,
        type: t.type as "BUY" | "SELL",
        quantity: t.quantity,
        unitPrice: t.unitPrice,
        tradeDate: t.tradeDate,
        bookingSequence: t.bookingSequence,
        commissionAmount: t.commissionAmount,
        taxAmount: t.taxAmount,
        // KZO-165: project the trade's native currency. BookedTradeEvent always
        // carries a non-null priceCurrency (DB CHECK + TS required field).
        priceCurrency: t.priceCurrency,
        // KZO-185: forward marketCode so the walker can stamp it on
        // `tickersNeedingBackfill` entries. BookedTradeEvent has carried this
        // field since KZO-169 / migration 044.
        marketCode: t.marketCode,
      }));

    // Dividends — filter posted, non-reversed, non-superseded; join with events for paymentDate+ticker.
    const eventById = new Map(store.marketData.dividendEvents.map(e => [e.id, e]));
    const postedDividends = store.accounting.facts.dividendLedgerEntries
      .filter(e => e.postingStatus === "posted" && !e.reversalOfDividendLedgerEntryId && !e.supersededAt)
      .map(entry => {
        const event = eventById.get(entry.dividendEventId);
        if (!event?.paymentDate) return null;
        if (scope && (entry.accountId !== scope.accountId || event.ticker !== scope.ticker)) return null;
        return {
          accountId: entry.accountId,
          ticker: event.ticker,
          paymentDate: event.paymentDate,
          amount: entry.receivedCashAmount,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

    return { trades, postedDividends };
  }

  async bulkUpsertHoldingSnapshots(_userId: string, snapshots: HoldingSnapshot[]): Promise<void> {
    for (const s of snapshots) {
      const idx = this.holdingSnapshots.findIndex(
        e => e.userId === s.userId && e.accountId === s.accountId && e.ticker === s.ticker && e.snapshotDate === s.snapshotDate,
      );
      if (idx >= 0) {
        this.holdingSnapshots[idx] = s;
      } else {
        this.holdingSnapshots.push(s);
      }
    }
  }

  async deleteHoldingSnapshotsForTicker(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number> {
    let deleted = 0;
    for (let i = this.holdingSnapshots.length - 1; i >= 0; i--) {
      const s = this.holdingSnapshots[i];
      if (s.userId === userId && s.accountId === accountId && s.ticker === ticker && s.snapshotDate >= fromDate) {
        this.holdingSnapshots.splice(i, 1);
        deleted++;
      }
    }
    return deleted;
  }

  async deleteAllHoldingSnapshots(userId: string): Promise<void> {
    for (let i = this.holdingSnapshots.length - 1; i >= 0; i--) {
      if (this.holdingSnapshots[i].userId === userId) {
        this.holdingSnapshots.splice(i, 1);
      }
    }
  }

  async getAggregatedSnapshots(userId: string, startDate: string, endDate: string): Promise<AggregatedSnapshotPoint[]> {
    const byDate = new Map<string, HoldingSnapshot[]>();
    for (const s of this.holdingSnapshots) {
      if (s.userId !== userId || s.snapshotDate < startDate || s.snapshotDate > endDate) continue;
      const list = byDate.get(s.snapshotDate) ?? [];
      list.push(s);
      byDate.set(s.snapshotDate, list);
    }
    const dates = [...byDate.keys()].sort();
    return dates.map(date => {
      const rows = byDate.get(date)!;
      const totalCostBasis = rows.reduce((sum, r) => sum + r.costBasis, 0);
      const isProvisional = rows.some(r => r.isProvisional);
      const totalMarketValue = isProvisional ? null : rows.reduce((sum, r) => sum + (r.marketValue ?? 0), 0);
      const totalUnrealizedPnl = isProvisional ? null : rows.reduce((sum, r) => sum + (r.unrealizedPnl ?? 0), 0);
      const cumulativeRealizedPnl = rows.reduce((sum, r) => sum + r.cumulativeRealizedPnl, 0);
      const cumulativeDividends = rows.reduce((sum, r) => sum + r.cumulativeDividends, 0);
      const totalReturnAmount = totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;
      return {
        date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional,
        // Legacy method does no FX translation — every row is trivially "available".
        fxAvailable: true,
      };
    });
  }

  // KZO-180 — FX-aware aggregator (memory mirror of the Postgres method).
  //
  // Mirrors the Postgres SQL semantics: per-row translate-then-sum with the D8
  // self-pair shortcut. Self-pair rows multiply by 1.0; non-self-pair rows
  // call `getFxRate(currency, reportingCurrency, snapshotDate)` (forward-fill
  // is encoded inside `getFxRate`'s memory impl). When ANY contributing row's
  // pair fails, `fxAvailable=false` and the translated SUMs become null.
  async getAggregatedSnapshotsInReportingCurrency(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
  ): Promise<AggregatedSnapshotPoint[]> {
    const byDate = new Map<string, HoldingSnapshot[]>();
    for (const s of this.holdingSnapshots) {
      if (s.userId !== userId || s.snapshotDate < startDate || s.snapshotDate > endDate) continue;
      const list = byDate.get(s.snapshotDate) ?? [];
      list.push(s);
      byDate.set(s.snapshotDate, list);
    }
    const dates = [...byDate.keys()].sort();
    const out: AggregatedSnapshotPoint[] = [];
    for (const date of dates) {
      const rows = byDate.get(date)!;
      const isProvisional = rows.some(r => r.isProvisional);
      let costSum = 0;
      let marketSum = 0;
      let unrealizedSum = 0;
      let cumRealSum = 0;
      let cumDivSum = 0;
      let allFxResolved = true;
      // Cache per-currency FX lookups within this snapshot date to avoid
      // re-querying the in-memory store for the same pair across rows.
      const fxCache = new Map<string, number | null>();

      for (const r of rows) {
        let fxRate: number | null;
        if (r.currency === reportingCurrency) {
          fxRate = 1.0;
        } else {
          if (fxCache.has(r.currency)) {
            fxRate = fxCache.get(r.currency) ?? null;
          } else {
            fxRate = await this.getFxRate(r.currency, reportingCurrency, r.snapshotDate);
            fxCache.set(r.currency, fxRate);
          }
        }
        if (fxRate === null) {
          allFxResolved = false;
          // Don't add to running sums — when fxAvailable=false the translated
          // outputs are nulled regardless. We still enumerate remaining rows
          // to flip allFxResolved on the first miss but skipping the math is fine.
          continue;
        }
        costSum += (r.costBasisNative ?? r.costBasis) * fxRate;
        marketSum += (r.valueNative ?? r.marketValue ?? 0) * fxRate;
        unrealizedSum += (r.unrealizedPnlNative ?? r.unrealizedPnl ?? 0) * fxRate;
        cumRealSum += r.cumulativeRealizedPnl * fxRate;
        cumDivSum += r.cumulativeDividends * fxRate;
      }

      const totalCostBasis = allFxResolved ? costSum : 0;
      const totalMarketValue = !allFxResolved || isProvisional ? null : marketSum;
      const totalUnrealizedPnl = !allFxResolved || isProvisional ? null : unrealizedSum;
      const cumulativeRealizedPnl = allFxResolved ? cumRealSum : 0;
      const cumulativeDividends = allFxResolved ? cumDivSum : 0;
      const totalReturnAmount = allFxResolved && totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;

      out.push({
        date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional,
        fxAvailable: allFxResolved,
      });
    }
    return out;
  }

  async countHoldingSnapshotsAfterDate(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number> {
    return this.holdingSnapshots.filter(
      s => s.userId === userId && s.accountId === accountId && s.ticker === ticker && s.snapshotDate >= fromDate,
    ).length;
  }

  async getHoldingSnapshotsForTicker(
    userId: string, accountId: string, ticker: string, startDate: string, endDate: string,
  ): Promise<HoldingSnapshot[]> {
    return this.holdingSnapshots
      .filter(s => s.userId === userId && s.accountId === accountId && s.ticker === ticker
        && s.snapshotDate >= startDate && s.snapshotDate <= endDate)
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }

  // ── Currency wallet snapshots (KZO-165) ───────────────────────────────────
  // Memory mirror. Note: MemoryPersistence does NOT enforce the composite FK or
  // ISO CHECK that Postgres does — those gaps are documented in
  // `.claude/rules/test-placement-persistence-backend.md` and integration tests
  // assert them with the Postgres backend.

  async bulkUpsertCurrencyWalletSnapshots(
    _userId: string,
    snapshots: CurrencyWalletSnapshot[],
  ): Promise<void> {
    for (const s of snapshots) {
      const idx = this.currencyWalletSnapshots.findIndex(
        (e) => e.accountId === s.accountId && e.currency === s.currency && e.date === s.date,
      );
      if (idx >= 0) {
        this.currencyWalletSnapshots[idx] = s;
      } else {
        this.currencyWalletSnapshots.push(s);
      }
    }
  }

  async deleteAllCurrencyWalletSnapshots(userId: string): Promise<void> {
    for (let i = this.currencyWalletSnapshots.length - 1; i >= 0; i--) {
      if (this.currencyWalletSnapshots[i].userId === userId) {
        this.currencyWalletSnapshots.splice(i, 1);
      }
    }
  }

  async getCurrencyWalletSnapshotsForAccount(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<CurrencyWalletSnapshot[]> {
    return this.currencyWalletSnapshots
      .filter(
        (s) =>
          s.userId === userId
          && s.accountId === accountId
          && s.date >= startDate
          && s.date <= endDate,
      )
      .sort((a, b) =>
        a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency),
      );
  }

  async getCashLedgerEntriesForBalances(userId: string): Promise<CashLedgerEntryForBalance[]> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.cashLedgerEntries
      .map((e) => ({
        accountId: e.accountId,
        currency: e.currency,
        entryDate: e.entryDate,
        amount: e.amount,
      }))
      .sort((a, b) =>
        a.accountId.localeCompare(b.accountId)
        || a.currency.localeCompare(b.currency)
        || a.entryDate.localeCompare(b.entryDate),
      );
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

  // --- Instruments ---

  async getInstrument(ticker: string, marketCode?: string): Promise<import("./types.js").InstrumentRow | null> {
    // KZO-169: composite (ticker, market_code) lookup. When `marketCode` is
    // provided we read directly via the composite key. When omitted (legacy
    // callers), we scan for the first matching ticker — preferring TW for
    // back-compat with monomarket deployments.
    const findInCatalog = (catalog: Map<string, MemoryInstrument>): MemoryInstrument | undefined => {
      if (marketCode) {
        return catalog.get(instrumentCatalogKey(ticker, marketCode));
      }
      let twMatch: MemoryInstrument | undefined;
      let firstMatch: MemoryInstrument | undefined;
      for (const item of catalog.values()) {
        if (item.ticker !== ticker) continue;
        firstMatch ??= item;
        if (item.marketCode === "TW") {
          twMatch = item;
          break;
        }
      }
      return twMatch ?? firstMatch;
    };
    let instrument: MemoryInstrument | undefined = findInCatalog(this.instruments);
    if (!instrument) {
      for (const catalog of this.instrumentsByUser.values()) {
        instrument = findInCatalog(catalog);
        if (instrument) break;
      }
    }
    if (!instrument) return null;
    const now = new Date().toISOString();
    return {
      ticker: instrument.ticker,
      instrumentType: (instrument.instrumentType as import("@vakwen/domain").InstrumentType) ?? null,
      marketCode: instrument.marketCode,
      name: instrument.name ?? undefined,
      isProvisional: false,
      barsBackfillStatus: instrument.barsBackfillStatus as import("@vakwen/domain").BackfillStatus,
      lastRepairAt: instrument.lastRepairAt ?? undefined,
      verificationStatus: "unverified",
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateBackfillStatus(
    _ticker: string,
    _marketCode: import("@vakwen/domain").MarketCode,
    _status: import("@vakwen/domain").BackfillStatus,
  ): Promise<void> {
    // No-op in memory mode (matches pre-KZO-197 behavior). Signature widened
    // for P2-2 to scope by composite (ticker, marketCode) — the Postgres impl
    // is the load-bearing path; memory keeps the no-op shape.
  }

  async updateLastRepairAt(ticker: string): Promise<void> {
    // KZO-169: update every market_code entry that shares this ticker — repair
    // operations trigger cross-market regardless of which row was the trigger
    // (provider-side rate limiter is per-symbol; we record the action against
    // every matching catalog row).
    const now = new Date().toISOString();
    for (const catalog of [this.instruments, ...this.instrumentsByUser.values()]) {
      for (const [key, current] of catalog.entries()) {
        if (current.ticker === ticker) {
          catalog.set(key, { ...current, lastRepairAt: now });
        }
      }
    }
  }

  // --- App Config (KZO-133) ---

  async getRepairCooldownMinutes(): Promise<number | null> {
    return this._repairCooldownMinutes;
  }

  async getAppConfig(): Promise<{
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
    yahooAuRerunCooldownMs: number | null;
    backfillRetryLimit: number | null;
    backfillRetryDelaySeconds: number | null;
    backfillFinmind402RetryMs: number | null;
    dailyRefreshLookbackDays: number | null;
    dailyRefreshPriority: number | null;
    sseHeartbeatIntervalMs: number | null;
    sseMaxConnectionsPerUser: number | null;
    sseBufferDefaultTtlMs: number | null;
    catalogAbsenceThreshold: number | null;
    catalogAbsenceGuardPercent: number | null;
    catalogAbsenceGuardFloor: number | null;
    asxGicsRefreshCron: string | null;
    anonymousShareTokenCap: number | null;
    anonymousShareRateLimitMax: number | null;
    anonymousShareRateLimitWindowMs: number | null;
    anonymousShareTokenRetentionMs: number | null;
    userPreferencesMaxBytes: number | null;
    accountHardPurgeDays: number | null;
    updatedAt: string;
  }> {
    const p = this._appConfigPlain;
    return {
      repairCooldownMinutes: this._repairCooldownMinutes,
      dashboardPerformanceRanges: this._dashboardPerformanceRanges
        ? [...this._dashboardPerformanceRanges]
        : null,
      metadataEnrichmentMode: this._metadataEnrichmentMode,
      finmindApiTokenEncrypted: this._finmindApiTokenEncrypted,
      twelveDataApiKeyEncrypted: this._twelveDataApiKeyEncrypted,
      marketDataPriceWindowMs: p.marketDataPriceWindowMs ?? null,
      marketDataPriceLimit: p.marketDataPriceLimit ?? null,
      marketDataSearchWindowMs: p.marketDataSearchWindowMs ?? null,
      marketDataSearchLimit: p.marketDataSearchLimit ?? null,
      inviteStatusWindowMs: p.inviteStatusWindowMs ?? null,
      inviteStatusLimit: p.inviteStatusLimit ?? null,
      providerDownNotificationSuppressionMs: p.providerDownNotificationSuppressionMs ?? null,
      providerErrorTrailRetentionDays: p.providerErrorTrailRetentionDays ?? null,
      providerRerunCooldownMs: p.providerRerunCooldownMs ?? null,
      // KZO-197 — yahoo-finance-au rerun cooldown override (Tier 1).
      yahooAuRerunCooldownMs: p.yahooAuRerunCooldownMs ?? null,
      backfillRetryLimit: p.backfillRetryLimit ?? null,
      backfillRetryDelaySeconds: p.backfillRetryDelaySeconds ?? null,
      backfillFinmind402RetryMs: p.backfillFinmind402RetryMs ?? null,
      dailyRefreshLookbackDays: p.dailyRefreshLookbackDays ?? null,
      dailyRefreshPriority: p.dailyRefreshPriority ?? null,
      sseHeartbeatIntervalMs: p.sseHeartbeatIntervalMs ?? null,
      sseMaxConnectionsPerUser: p.sseMaxConnectionsPerUser ?? null,
      sseBufferDefaultTtlMs: p.sseBufferDefaultTtlMs ?? null,
      catalogAbsenceThreshold: p.catalogAbsenceThreshold ?? null,
      catalogAbsenceGuardPercent: p.catalogAbsenceGuardPercent ?? null,
      catalogAbsenceGuardFloor: p.catalogAbsenceGuardFloor ?? null,
      // KZO-196 — AU GICS sync cron override (NULL = use env default).
      asxGicsRefreshCron: this._asxGicsRefreshCron ?? null,
      // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
      anonymousShareTokenCap: p.anonymousShareTokenCap ?? null,
      anonymousShareRateLimitMax: p.anonymousShareRateLimitMax ?? null,
      anonymousShareRateLimitWindowMs: p.anonymousShareRateLimitWindowMs ?? null,
      // KZO-199 — Tier 2 (DB+SQL only). Memory persistence doesn't surface a
      // setter for these; they always resolve null and the resolver layer
      // falls back to env. Postgres backend exposes them via direct SQL.
      anonymousShareTokenRetentionMs: this._anonymousShareTokenRetentionMs ?? null,
      userPreferencesMaxBytes: this._userPreferencesMaxBytes ?? null,
      // ui-enhancement — Tier B account-soft-delete grace period (uses the
      // plain-fields map; setAppConfigField/Patch route through it).
      accountHardPurgeDays: p.accountHardPurgeDays ?? null,
      updatedAt: this._appConfigUpdatedAt,
    };
  }

  async setAppConfigField(
    field: import("./types.js").AppConfigPlainField,
    value: number | null,
  ): Promise<void> {
    if (value === null) {
      delete this._appConfigPlain[field];
    } else {
      this._appConfigPlain[field] = value;
    }
    this._bumpAppConfigUpdatedAt();
  }

  async setAppConfigEncryptedSecret(
    field: "finmindApiToken" | "twelveDataApiKey",
    plaintext: string | null,
  ): Promise<void> {
    const { encryptSecret } = await import("../services/appConfig/encryption.js");
    const stored = plaintext === null ? null : encryptSecret(plaintext);
    if (field === "finmindApiToken") {
      this._finmindApiTokenEncrypted = stored;
    } else {
      this._twelveDataApiKeyEncrypted = stored;
    }
    this._bumpAppConfigUpdatedAt();
  }

  async setAppConfigPatch(patch: import("./types.js").AppConfigPatch): Promise<void> {
    const { APP_CONFIG_PLAIN_COLUMNS } = await import("./types.js");
    let touched = false;
    for (const key of Object.keys(APP_CONFIG_PLAIN_COLUMNS) as Array<
      import("./types.js").AppConfigPlainField
    >) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const value = patch[key] ?? null;
        if (value === null) {
          delete this._appConfigPlain[key];
        } else {
          this._appConfigPlain[key] = value;
        }
        touched = true;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, "finmindApiToken") ||
      Object.prototype.hasOwnProperty.call(patch, "twelveDataApiKey")
    ) {
      const { encryptSecret } = await import("../services/appConfig/encryption.js");
      if (Object.prototype.hasOwnProperty.call(patch, "finmindApiToken")) {
        this._finmindApiTokenEncrypted =
          patch.finmindApiToken == null ? null : encryptSecret(patch.finmindApiToken);
        touched = true;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "twelveDataApiKey")) {
        this._twelveDataApiKeyEncrypted =
          patch.twelveDataApiKey == null ? null : encryptSecret(patch.twelveDataApiKey);
        touched = true;
      }
    }

    if (touched) this._bumpAppConfigUpdatedAt();
  }

  async setRepairCooldownMinutes(value: number | null): Promise<void> {
    this._repairCooldownMinutes = value;
    this._bumpAppConfigUpdatedAt();
  }

  async setDashboardPerformanceRanges(value: string[] | null): Promise<void> {
    // KZO-159 (158A) — sibling setter per D6. Route layer validates the
    // list shape via `dashboardPerformanceRangesSchema` before calling.
    this._dashboardPerformanceRanges = value ? [...value] : null;
    this._bumpAppConfigUpdatedAt();
  }

  // KZO-189: AU metadata enrichment mode override.
  async getMetadataEnrichmentMode(): Promise<"unconditional" | "conditional" | null> {
    return this._metadataEnrichmentMode;
  }

  async setMetadataEnrichmentMode(value: "unconditional" | "conditional" | null): Promise<void> {
    this._metadataEnrichmentMode = value;
    this._bumpAppConfigUpdatedAt();
  }

  private _bumpAppConfigUpdatedAt(): void {
    const prevMs = Date.parse(this._appConfigUpdatedAt);
    const nextMs = Math.max(Date.now(), Number.isFinite(prevMs) ? prevMs + 1 : Date.now());
    this._appConfigUpdatedAt = new Date(nextMs).toISOString();
  }

  /** Test-only: override the in-memory repair cooldown (null = use env fallback). */
  _setRepairCooldownMinutes(n: number | null): void {
    this._repairCooldownMinutes = n;
  }

  // --- User preferences (KZO-159 / 158A) ---

  async getUserPreferences(userId: string): Promise<Record<string, unknown>> {
    const row = this.userPreferences.get(userId);
    // Lazy: never insert on read, return an empty object when unset.
    return row ? { ...row } : {};
  }

  async setUserPreferencePatch(
    userId: string,
    patch: Record<string, unknown | null>,
  ): Promise<Record<string, unknown>> {
    // Top-level merge with explicit null-delete semantics — mirrors the
    // canonical Postgres shape in design D3:
    //   (user_preferences.preferences || EXCLUDED.preferences) - $3::text[]
    // Non-null keys replace existing values (arrays/objects assigned whole).
    // Null-valued keys are dropped from the merged object.
    //
    // KZO-162: `cardOrder` is special-cased — it is sub-key-merged so that
    // PATCH `{cardOrder:{transactions:[...]}}` does not wipe `cardOrder.dashboard`.
    // A null sub-key value (e.g. `{cardOrder:{transactions:null}}`) deletes
    // just that sub-key; the empty `cardOrder` object is preserved (caller
    // can still PATCH `{cardOrder:null}` to clear the whole top-level key).
    const current = this.userPreferences.get(userId) ?? {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) {
        delete next[key];
      } else if (
        key === "cardOrder"
        && isPlainObject(value)
      ) {
        const currentCardOrder = isPlainObject(next.cardOrder) ? next.cardOrder : {};
        const merged: Record<string, unknown> = { ...currentCardOrder };
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subValue === null || subValue === undefined) {
            delete merged[subKey];
          } else {
            merged[subKey] = subValue;
          }
        }
        next.cardOrder = merged;
      } else {
        next[key] = value;
      }
    }
    this.userPreferences.set(userId, next);
    return { ...next };
  }

  /** Test-only: full-replace the preferences row for a user (used by the
   *  `/__e2e/seed-user-preferences` endpoint; bypasses merge semantics). */
  async _setUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<void> {
    const existing = this.userPreferences.get(userId) ?? {};
    this.userPreferences.set(userId, { ...existing, ...preferences });
  }

  // --- Monitored Tickers ---

  async getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]> {
    const manualSelections = this.monitoredTickers.get(userId) ?? new Map();
    const store = this.stores.get(userId);
    const catalog = this._catalogForUser(userId);

    // Collect position-derived (ticker, marketCode) pairs from open lots.
    // KZO-169: lots don't store market_code; derive from a representative
    // trade event (per-(account, ticker) market is invariant after KZO-169).
    type PositionKey = { ticker: string; marketCode: string };
    const positions: PositionKey[] = [];
    const positionSeen = new Set<string>();
    if (store) {
      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity <= 0) continue;
        const trade = store.accounting.facts.tradeEvents.find(
          (te) => te.accountId === lot.accountId && te.ticker === lot.ticker,
        );
        if (!trade?.marketCode) {
          throw routeError(
            500,
            "market_code_missing",
            `Open lot ${lot.ticker} is missing a source trade market_code`,
          );
        }
        const marketCode = trade.marketCode;
        const key = instrumentCatalogKey(lot.ticker, marketCode);
        if (positionSeen.has(key)) continue;
        positionSeen.add(key);
        positions.push({ ticker: lot.ticker, marketCode });
      }
    }

    // Manual selections take precedence; persistence omits `repairAvailableAt`
    // (KZO-133 — route layer decorates).
    const result: Omit<MonitoredTickerDto, "repairAvailableAt">[] = [];
    const seen = new Set<string>();

    for (const sel of manualSelections.values()) {
      const key = instrumentCatalogKey(sel.ticker, sel.marketCode);
      seen.add(key);
      const instrument = catalog.get(key);
      result.push({
        ticker: sel.ticker,
        marketCode: sel.marketCode,
        source: "manual",
        name: instrument?.name ?? null,
        instrumentType: (instrument?.instrumentType as MonitoredTickerDto["instrumentType"]) ?? null,
        barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        lastRepairAt: instrument?.lastRepairAt ?? null,
      });
    }

    for (const pos of positions) {
      const key = instrumentCatalogKey(pos.ticker, pos.marketCode);
      if (seen.has(key)) continue;
      seen.add(key);
      const instrument = catalog.get(key);
      result.push({
        ticker: pos.ticker,
        marketCode: pos.marketCode,
        source: "position",
        name: instrument?.name ?? null,
        instrumentType: (instrument?.instrumentType as MonitoredTickerDto["instrumentType"]) ?? null,
        barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        lastRepairAt: instrument?.lastRepairAt ?? null,
      });
    }

    return result;
  }

  async getAllMonitoredTickers(): Promise<{ ticker: string; marketCode: string }[]> {
    // KZO-185: shape change to `{ticker, marketCode}` pairs.
    //
    // KZO-197: enumerate the per-user `monitoredTickers` map so the AU rerun
    // union path can count monitored AU rows on the memory backend. Pre-KZO-197
    // this returned `[]` unconditionally (documented as "memory backend has no
    // users-monitored-tickers state"), which was correct only for the cron /
    // daily-refresh callers (those call paths still no-op on memory because
    // `app.boss === null`). The KZO-197 admin route now reads this directly to
    // populate audit metadata regardless of `app.boss` state, so the empty
    // return silently dropped the monitored-AU count to 0.
    //
    // De-duplicate across users (the persistence interface returns DISTINCT
    // (ticker, marketCode) pairs — same contract as the Postgres impl).
    //
    // KZO-197 P3: mirror the Postgres filter `bars_backfill_status='ready'
    // AND delisted_at IS NULL`. Without it, memory-backed E2E (with
    // `app.boss` set) would enqueue work production excludes — pending /
    // failed / delisted rows that the real refresh cron skips.
    const seen = new Set<string>();
    const out: { ticker: string; marketCode: string }[] = [];
    for (const userMap of this.monitoredTickers.values()) {
      for (const sel of userMap.values()) {
        const key = `${sel.ticker}|${sel.marketCode}`;
        if (seen.has(key)) continue;
        const instrument = this.instruments.get(
          instrumentCatalogKey(sel.ticker, sel.marketCode),
        );
        if (!instrument) continue;
        if (instrument.barsBackfillStatus !== "ready") continue;
        if (instrument.delistedAt) continue;
        seen.add(key);
        out.push({ ticker: sel.ticker, marketCode: sel.marketCode });
      }
    }
    out.sort((a, b) => {
      const t = a.ticker.localeCompare(b.ticker);
      return t !== 0 ? t : a.marketCode.localeCompare(b.marketCode);
    });
    return out;
  }

  async getUsersMonitoringTicker(_ticker: string): Promise<string[]> {
    return [];
  }

  async listAuCatalogBarsBackfillCandidates(): Promise<Array<{ ticker: string; marketCode: "AU" }>> {
    // KZO-197 — fresh-deploy AU warm-up. Read directly from the canonical
    // in-memory catalog map (`this.instruments`), filter to AU instruments
    // whose `barsBackfillStatus` is `pending` or `failed` and that aren't
    // delisted. This is the memory-backend mirror of the Postgres
    // `SELECT ticker FROM market_data.instruments WHERE market_code='AU'
    // AND bars_backfill_status IN ('pending','failed') AND delisted_at IS NULL`.
    //
    // Per `.claude/rules/test-placement-persistence-backend.md` "MemoryPersistence
    // dual-store mirror": the unconditional mirror in `_seedInstrument`
    // (KZO-195 iter 8) keeps the admin store in lockstep, but this method
    // reads from `this.instruments` because it's the source-of-truth that
    // carries the live `barsBackfillStatus` field. The admin-row mirror
    // does not track backfill status.
    const rows: Array<{ ticker: string; marketCode: "AU" }> = [];
    for (const inst of this.instruments.values()) {
      if (inst.marketCode !== "AU") continue;
      if (inst.delistedAt) continue;
      if (inst.barsBackfillStatus !== "pending" && inst.barsBackfillStatus !== "failed") continue;
      rows.push({ ticker: inst.ticker, marketCode: "AU" });
    }
    rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
    return rows;
  }

  async getManualSelections(userId: string): Promise<{ ticker: string; marketCode: string; addedAt: string }[]> {
    const selections = this.monitoredTickers.get(userId);
    if (!selections) return [];
    return [...selections.values()].map(({ ticker, marketCode, addedAt }) => ({
      ticker,
      marketCode,
      addedAt,
    }));
  }

  async replaceManualSelections(
    userId: string,
    selections: ReadonlyArray<{
      ticker: string;
      marketCode: string;
      name?: string | null;
      instrumentType?: InstrumentType | null;
    }>,
  ): Promise<{ newTickers: string[] }> {
    // KZO-169: diff by composite key so a switch from BHP/AU → BHP/US shows up
    // as a "new" entry. The returned `newTickers` is still a flat list of
    // tickers (back-compat with KZO-132 refresh-batch consumers).
    const currentSet = await this.getMonitoredSet(userId);
    const currentKeys = new Set(currentSet.map((s) => instrumentCatalogKey(s.ticker, s.marketCode)));

    // KZO-188: mirror the postgres-side instrument upsert. When the client
    // provides metadata for a live-sourced pick (e.g. CBA/AU) we add the row
    // to the same catalog map the user reads from in `getMonitoredSet` /
    // `listInstrumentsCatalog` so the next reload renders name + type
    // correctly. Write to the existing per-user map when one exists, else the
    // shared catalog — matching `_catalogForUser`'s read precedence — to
    // avoid creating an empty per-user catalog that would shadow the shared
    // default rows.
    const targetCatalog = this.instrumentsByUser.get(userId) ?? this.instruments;
    for (const sel of selections) {
      if (sel.name === undefined || sel.instrumentType === undefined) continue;
      const key = instrumentCatalogKey(sel.ticker, sel.marketCode);
      if (targetCatalog.has(key)) continue;
      targetCatalog.set(key, {
        ticker: sel.ticker,
        name: sel.name ?? null,
        instrumentType: sel.instrumentType ?? null,
        marketCode: sel.marketCode,
        barsBackfillStatus: "pending",
      });
    }

    const now = new Date().toISOString();
    const next = new Map<string, { ticker: string; marketCode: string; addedAt: string }>();
    for (const sel of selections) {
      next.set(instrumentCatalogKey(sel.ticker, sel.marketCode), {
        ticker: sel.ticker,
        marketCode: sel.marketCode,
        addedAt: now,
      });
    }
    this.monitoredTickers.set(userId, next);

    const newTickers = selections
      .filter((sel) => !currentKeys.has(instrumentCatalogKey(sel.ticker, sel.marketCode)))
      .map((sel) => sel.ticker);
    return { newTickers };
  }

  async listInstrumentsCatalog(
    search?: string,
    type?: string,
    marketCode?: string,
    userId?: string,
  ): Promise<Omit<InstrumentCatalogItemDto, "repairAvailableAt">[]> {
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

    // KZO-169: optional market_code filter mirrors the Postgres behavior.
    if (marketCode) {
      results = results.filter((i) => i.marketCode === marketCode);
    }

    // Stable sort: ticker ASC, then marketCode ASC. Mirrors the Postgres
    // `ORDER BY ticker, market_code` so HTTP-layer assertions can compare
    // the two backends without re-sorting.
    results.sort((a, b) =>
      a.ticker === b.ticker ? a.marketCode.localeCompare(b.marketCode) : a.ticker.localeCompare(b.ticker),
    );

    return results.map((i) => ({
      ticker: i.ticker,
      name: i.name,
      instrumentType: i.instrumentType as InstrumentCatalogItemDto["instrumentType"],
      marketCode: i.marketCode,
      barsBackfillStatus: i.barsBackfillStatus,
      lastRepairAt: i.lastRepairAt ?? null,
      // KZO-196 — GICS industry-group projection. Memory catalog mirrors the
      // Postgres SELECT shape so suite-3/4/6 tests see the same DTO.
      gicsIndustryGroup: i.gicsIndustryGroup ?? null,
    }));
  }

  async upsertInstrumentCatalog(
    _instruments: CatalogInstrument[],
    _delistings: DelistingRecord[],
    _options?: import("./types.js").UpsertInstrumentCatalogOptions,
  ): Promise<CatalogSyncResult> {
    // KZO-195 — MemoryPersistence intentionally does not model the instrument
    // catalog table (no integration concerns). Service-layer unit tests assert
    // against the pure detector directly; the Postgres-backed integration
    // suite (`auCatalogDelistingDetector.integration.test.ts`) is authoritative
    // per `.claude/rules/test-placement-persistence-backend.md`.
    return { upserted: 0, delisted: 0, absent: 0, guardTripped: false, absentTickers: [] };
  }

  // KZO-195 — admin instrument overrides. MemoryPersistence does not model
  // the catalog table; HTTP/E2E suites that need real assertions run against
  // Postgres. These no-ops let the route layer compile/run on memory backend
  // (returning a synthetic row for "found", or null for "not found"). Per
  // `.claude/rules/test-placement-persistence-backend.md`, behavioral tests
  // for these methods MUST be Postgres-backed integration tests.
  private _adminInstrumentMemRows: Map<
    string,
    import("./types.js").AdminInstrumentRow
  > = new Map();

  private _adminInstrumentKey(ticker: string, marketCode: string): string {
    return `${ticker}::${marketCode}`;
  }

  async instrumentAdminGet(
    ticker: string,
    marketCode: string,
  ): Promise<import("./types.js").AdminInstrumentRow | null> {
    return this._adminInstrumentMemRows.get(this._adminInstrumentKey(ticker, marketCode)) ?? null;
  }

  async listAdminInstruments(opts: {
    marketCode: string;
    page: number;
    limit: number;
  }): Promise<{
    items: import("./types.js").AdminInstrumentRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Math.floor(opts.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(opts.limit) || 50));
    const all = [...this._adminInstrumentMemRows.values()]
      .filter((row) => row.marketCode === opts.marketCode)
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    const offset = (page - 1) * limit;
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, page, limit };
  }

  async undeleteInstrument(
    ticker: string,
    marketCode: string,
    _actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const key = this._adminInstrumentKey(ticker, marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    const next: import("./types.js").AdminInstrumentRow = existing
      ? {
          ...existing,
          delistedAt: null,
          statusReason: null,
          absenceStreak: 0,
          lastSeenInCatalogAt: now,
          updatedAt: now,
        }
      : {
          ticker,
          marketCode,
          name: null,
          instrumentType: null,
          delistedAt: null,
          statusReason: null,
          lastSeenInCatalogAt: now,
          absenceStreak: 0,
          delistingDetectionExcluded: false,
          updatedAt: now,
        };
    this._adminInstrumentMemRows.set(key, next);
    return next;
  }

  async setInstrumentDelistingDetectionExcluded(
    ticker: string,
    marketCode: string,
    excluded: boolean,
    _actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const key = this._adminInstrumentKey(ticker, marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    const next: import("./types.js").AdminInstrumentRow = existing
      ? { ...existing, delistingDetectionExcluded: excluded, updatedAt: now }
      : {
          ticker,
          marketCode,
          name: null,
          instrumentType: null,
          delistedAt: null,
          statusReason: null,
          lastSeenInCatalogAt: null,
          absenceStreak: 0,
          delistingDetectionExcluded: excluded,
          updatedAt: now,
        };
    this._adminInstrumentMemRows.set(key, next);
    return next;
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
    // KZO-169: store under the composite (ticker|marketCode) key so two BHP
    // rows on different markets can coexist in MemoryPersistence.
    this._catalogForWrite(userId).set(
      instrumentCatalogKey(instrument.ticker, instrument.marketCode),
      instrument,
    );
    // KZO-195 — mirror into the admin-instruments map so `listAdminInstruments`
    // (and the route's GET /admin/instruments) sees rows seeded via test
    // helpers, including the E2E `/__e2e/seed-instruments` endpoint which
    // passes a userId. Catalog instruments are global by design; the admin-row
    // store is independent of the per-user catalog. Iter 8 (KZO-195) removed
    // the iter-4 `if (!userId)` gate that suppressed mirror writes whenever
    // the seeder threaded a userId — it left the admin endpoint blind to
    // E2E-seeded rows. The lockstep clear in `_replaceInstruments` (also
    // unconditional now) preserves the iter-4 invariant that admin overrides
    // (exclusion, undelete) carry across re-seeds for matching keys.
    const key = this._adminInstrumentKey(instrument.ticker, instrument.marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    this._adminInstrumentMemRows.set(key, {
      ticker: instrument.ticker,
      marketCode: instrument.marketCode,
      name: instrument.name,
      instrumentType: instrument.instrumentType,
      delistedAt: instrument.delistedAt ?? existing?.delistedAt ?? null,
      statusReason: existing?.statusReason ?? null,
      // Preserve admin-set absence-detection state across re-seeds
      // (undelete / exclusion / streak) so test scenarios that seed catalog
      // rows AFTER calling `setInstrumentDelistingDetectionExcluded` don't
      // lose the admin override.
      lastSeenInCatalogAt: existing?.lastSeenInCatalogAt ?? now,
      absenceStreak: existing?.absenceStreak ?? 0,
      delistingDetectionExcluded: existing?.delistingDetectionExcluded ?? false,
      updatedAt: now,
    });
  }

  /** @internal Test-only: replace the in-memory catalog with the provided instruments. */
  _replaceInstruments(instruments: MemoryInstrument[], userId?: string): void {
    const catalog = this._catalogForWrite(userId);
    catalog.clear();
    // KZO-195 (iter 8) — snapshot admin overrides BEFORE clearing so the
    // per-row `existing?.*` carry-over inside `_seedInstrument` can still
    // restore exclusion / undelete / streak state for tickers present in
    // the new replacement set. Tickers absent from `instruments` are
    // intentionally dropped to keep the admin map in lockstep with the
    // catalog. Catalog instruments are global by design — userId scope
    // applies to the legacy per-user catalog map only, not the admin store.
    const overrideSnapshot = new Map(this._adminInstrumentMemRows);
    this._adminInstrumentMemRows.clear();
    for (const instrument of instruments) {
      const key = this._adminInstrumentKey(instrument.ticker, instrument.marketCode);
      const carry = overrideSnapshot.get(key);
      if (carry) {
        // Re-stamp the override so `_seedInstrument`'s `existing?.*` lookup
        // sees it. `_seedInstrument` overwrites name / instrumentType /
        // updatedAt but preserves absenceStreak / delistingDetectionExcluded
        // / lastSeenInCatalogAt / statusReason via the same carry pattern.
        this._adminInstrumentMemRows.set(key, carry);
      }
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

  private getUserById(userId: string): MemoryUser | undefined {
    return [...this.usersByEmail.values()].find((user) => user.id === userId);
  }

  private async insertInvite(input: CreateInviteInput): Promise<InviteRecord> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateInviteCode();
      if (this.invites.has(code)) {
        continue;
      }
      const invite: MemoryInvite = {
        code,
        email: normalizeEmail(input.email),
        role: input.role,
        expiresAt: input.expiresAt,
        revokedAt: null,
        usedAt: null,
        issuedByUserId: input.issuedByUserId,
        shareOwnerUserId: null,
        createdAt: new Date().toISOString(),
      };
      this.invites.set(code, invite);
      return { ...invite };
    }
    throw new Error("Failed to generate a unique invite code after 3 attempts");
  }

  // ── Admin portal methods (KZO-144) ──────────────────────────────────────────

  async listUsers(options: AdminUserListOptions): Promise<AdminUserListResponse> {
    const { page, limit, search, role, status } = options;
    let users = [...this.usersByEmail.values()];

    // Filter by status (default: active + disabled)
    if (status) {
      users = users.filter((u) => deriveUserStatus(u) === status);
    }
    // When status is undefined (e.g. "All" tab), no status filter — returns all users

    if (role) {
      users = users.filter((u) => u.role === role);
    }

    if (search) {
      const lower = search.toLowerCase();
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(lower) ||
          (u.displayName && u.displayName.toLowerCase().includes(lower)),
      );
    }

    // Sort by createdAt DESC
    users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = users.length;
    const offset = (page - 1) * limit;
    const pageItems = users.slice(offset, offset + limit);

    return {
      items: pageItems.map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        status: deriveUserStatus(u),
        lastSeenAt: null,
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  async changeUserRole(userId: string, newRole: UserRole, auditInput: Omit<AuditLogInput, "action">): Promise<AuthUserRecord> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    const fromRole = user.role;

    // Atomic last-admin guard when demoting an admin
    if (fromRole === "admin" && newRole !== "admin") {
      this.assertNotLastAdminMem();
    }

    user.role = newRole;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_role_change",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, fromRole, toRole: newRole, targetEmail: user.email },
    });

    return mapMemoryUser(user);
  }

  async disableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    if (user.role === "admin") {
      this.assertNotLastAdminMem();
    }

    user.deactivatedAt = new Date().toISOString();
    user.sessionVersion += 1;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_disable_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email },
    });
    await this.appendAuditLog({
      ...auditInput,
      action: "session_force_logout",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, reason: "admin_disable_user" },
    });
  }

  async enableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    user.deactivatedAt = null;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_enable_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email },
    });
  }

  async softDeleteUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    if (user.role === "admin") {
      this.assertNotLastAdminMem();
    }

    user.deletedAt = new Date().toISOString();
    user.sessionVersion += 1;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_delete_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email },
    });
    await this.appendAuditLog({
      ...auditInput,
      action: "session_force_logout",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, reason: "admin_delete_user" },
    });
  }

  async hardPurgeUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    if (user.role === "admin") {
      this.assertNotLastAdminMem();
    }

    // Emit audit entries BEFORE deletion (FK ON DELETE SET NULL preserves them)
    await this.appendAuditLog({
      ...auditInput,
      action: "admin_hard_purge_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, targetDisplayName: user.displayName },
    });
    await this.appendAuditLog({
      ...auditInput,
      action: "session_force_logout",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, reason: "admin_hard_purge_user" },
    });

    // Cascade delete user data
    this.stores.delete(userId);
    this.idempotencyKeys.delete(userId);
    this.monitoredTickers.delete(userId);
    this.notifications.delete(userId);
    this.instrumentsByUser.delete(userId);
    // ui-enhancement — drop any soft-deleted account shadows owned by this user.
    for (const key of [...this.softDeletedAccounts.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.softDeletedAccounts.delete(key);
      }
    }

    // Remove holding snapshots for user
    const snapshotsToRemove = this.holdingSnapshots.filter((s) => s.userId === userId);
    for (const s of snapshotsToRemove) {
      const idx = this.holdingSnapshots.indexOf(s);
      if (idx >= 0) this.holdingSnapshots.splice(idx, 1);
    }

    // KZO-165: Remove currency wallet snapshots for user (mirrors postgres cascade).
    for (let i = this.currencyWalletSnapshots.length - 1; i >= 0; i -= 1) {
      if (this.currencyWalletSnapshots[i].userId === userId) {
        this.currencyWalletSnapshots.splice(i, 1);
      }
    }

    // Remove owned or grantee share records.
    for (let i = this.portfolioShares.length - 1; i >= 0; i -= 1) {
      const share = this.portfolioShares[i];
      if (share.ownerUserId === userId || share.granteeUserId === userId) {
        this.portfolioShares.splice(i, 1);
        continue;
      }
      if (share.revokedByUserId === userId) {
        share.revokedByUserId = null;
      }
    }

    this.anonymousShareTokenLocks.delete(userId);
    for (let i = this.anonymousShareTokens.length - 1; i >= 0; i -= 1) {
      if (this.anonymousShareTokens[i].ownerUserId === userId) {
        this.anonymousShareTokens.splice(i, 1);
      }
    }

    // SET NULL on invites.issued_by_user_id and invites.share_owner_user_id
    for (const invite of this.invites.values()) {
      if (invite.issuedByUserId === userId) {
        invite.issuedByUserId = null;
      }
      if (invite.shareOwnerUserId === userId) {
        invite.shareOwnerUserId = null;
      }
    }

    // SET NULL on audit_log actor/target
    for (const entry of this.auditLog) {
      if (entry.actorUserId === userId) entry.actorUserId = null;
      if (entry.targetUserId === userId) entry.targetUserId = null;
    }

    // Remove user
    this.usersByEmail.delete(user.email);
  }

  // ── ui-enhancement — Account lifecycle ──────────────────────────────────

  async softDeleteAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<{ deletedAt: string }> {
    const shadowKey = `${userId}:${accountId}`;
    const existingShadow = this.softDeletedAccounts.get(shadowKey);
    if (existingShadow) {
      // Idempotent — already soft-deleted.
      return { deletedAt: existingShadow.deletedAt };
    }
    const store = this.stores.get(userId);
    if (!store) {
      throw routeError(404, "account_not_found", "Account not found.");
    }
    const idx = store.accounts.findIndex((acc) => acc.id === accountId);
    if (idx === -1) {
      throw routeError(404, "account_not_found", "Account not found.");
    }
    const account = store.accounts[idx];
    const deletedAt = new Date().toISOString();
    this.softDeletedAccounts.set(shadowKey, { ...account, deletedAt });
    store.accounts.splice(idx, 1);

    await this.appendAuditLog({
      ...auditInput,
      action: "account_soft_deleted",
      targetUserId: userId,
      metadata: {
        ...auditInput.metadata,
        accountId,
        accountName: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
      },
    });

    return { deletedAt };
  }

  async restoreAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<{ accountId: string; finalName: string }> {
    const shadowKey = `${userId}:${accountId}`;
    const shadow = this.softDeletedAccounts.get(shadowKey);
    if (!shadow) {
      throw routeError(404, "account_not_found", "Account not found or not soft-deleted.");
    }
    const store = this.stores.get(userId);
    if (!store) {
      throw routeError(404, "account_not_found", "Account not found.");
    }

    const priorName = shadow.name;
    const activeNames = new Set(store.accounts.map((acc) => acc.name));
    let finalName = priorName;
    if (activeNames.has(priorName)) {
      finalName = `${priorName} (restored)`;
      let suffix = 2;
      while (activeNames.has(finalName) && suffix <= 20) {
        finalName = `${priorName} (restored ${suffix})`;
        suffix += 1;
      }
      if (activeNames.has(finalName)) {
        throw routeError(
          409,
          "account_restore_name_unresolvable",
          "Could not auto-rename restored account: too many name collisions (>20 candidates tried).",
        );
      }
    }

    // Strip deletedAt and adopt the final (possibly renamed) name.
    const { deletedAt: _deletedAt, ...accountFields } = shadow;
    void _deletedAt;
    store.accounts.push({ ...accountFields, name: finalName });
    this.softDeletedAccounts.delete(shadowKey);

    await this.appendAuditLog({
      ...auditInput,
      action: "account_restored",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, accountId, priorName, finalName },
    });

    return { accountId, finalName };
  }

  async hardPurgeAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
    options: { mustBeSoftDeleted?: boolean } = {},
  ): Promise<void> {
    const mustBeSoftDeleted = options.mustBeSoftDeleted ?? true;
    const shadowKey = `${userId}:${accountId}`;
    const shadow = this.softDeletedAccounts.get(shadowKey);
    const store = this.stores.get(userId);
    const activeIdx = store
      ? store.accounts.findIndex((acc) => acc.id === accountId)
      : -1;

    if (!shadow && activeIdx === -1) {
      throw routeError(404, "account_not_found", "Account not found.");
    }
    if (mustBeSoftDeleted && !shadow) {
      throw routeError(
        404,
        "account_not_soft_deleted",
        "Account must be soft-deleted before cron-driven hard-purge.",
      );
    }

    const account = shadow ?? store!.accounts[activeIdx];

    // Audit BEFORE removal so the entry survives.
    await this.appendAuditLog({
      ...auditInput,
      action: "account_hard_purged",
      targetUserId: userId,
      metadata: {
        ...auditInput.metadata,
        accountId,
        accountName: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        deletedAt: shadow ? shadow.deletedAt : null,
      },
    });

    // Cascade account-scoped data from the in-memory store (mirrors Postgres
    // explicit-DELETE list). fee profiles + overrides cascade with the
    // account row.
    if (store) {
      const facts = store.accounting.facts;
      const projections = store.accounting.projections;
      facts.cashLedgerEntries = facts.cashLedgerEntries.filter((e) => e.accountId !== accountId);
      facts.tradeEvents = facts.tradeEvents.filter((e) => e.accountId !== accountId);
      const removedDividendIds = new Set(
        facts.dividendLedgerEntries.filter((e) => e.accountId === accountId).map((e) => e.id),
      );
      facts.dividendLedgerEntries = facts.dividendLedgerEntries.filter(
        (e) => e.accountId !== accountId,
      );
      facts.dividendDeductionEntries = facts.dividendDeductionEntries.filter(
        (e) => !removedDividendIds.has(e.dividendLedgerEntryId),
      );
      facts.dividendSourceLines = facts.dividendSourceLines.filter(
        (e) => !removedDividendIds.has(e.dividendLedgerEntryId),
      );
      facts.corporateActions = facts.corporateActions.filter((c) => c.accountId !== accountId);
      const removedLotIds = new Set(
        projections.lots.filter((l) => l.accountId === accountId).map((l) => l.id),
      );
      projections.lots = projections.lots.filter((l) => l.accountId !== accountId);
      projections.lotAllocations = projections.lotAllocations.filter(
        (l) => !removedLotIds.has(l.lotId),
      );
      store.feeProfiles = store.feeProfiles.filter((p) => p.accountId !== accountId);
      store.feeProfileBindings = store.feeProfileBindings.filter(
        (b) => b.accountId !== accountId,
      );
      if (activeIdx !== -1) {
        store.accounts.splice(activeIdx, 1);
      }
    }

    // KZO-115 / KZO-165 — top-level snapshot arrays scoped by accountId.
    for (let i = this.holdingSnapshots.length - 1; i >= 0; i -= 1) {
      if (this.holdingSnapshots[i].accountId === accountId) {
        this.holdingSnapshots.splice(i, 1);
      }
    }
    for (let i = this.currencyWalletSnapshots.length - 1; i >= 0; i -= 1) {
      if (this.currencyWalletSnapshots[i].accountId === accountId) {
        this.currencyWalletSnapshots.splice(i, 1);
      }
    }

    this.softDeletedAccounts.delete(shadowKey);
  }

  async listSoftDeletedAccounts(
    userId: string,
  ): Promise<Array<import("@vakwen/shared-types").AccountDto & { deletedAt: string }>> {
    const result: Array<import("@vakwen/shared-types").AccountDto & { deletedAt: string }> = [];
    for (const [key, account] of this.softDeletedAccounts.entries()) {
      if (key.startsWith(`${userId}:`)) {
        result.push({ ...account });
      }
    }
    // Sort by deletedAt DESC (most recent first).
    result.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
    return result;
  }

  async getAccountIncludingDeleted(
    accountId: string,
    userId: string,
  ): Promise<
    | (import("@vakwen/shared-types").AccountDto & { deletedAt: string | null })
    | null
  > {
    const shadow = this.softDeletedAccounts.get(`${userId}:${accountId}`);
    if (shadow) {
      return { ...shadow };
    }
    const store = this.stores.get(userId);
    const active = store?.accounts.find((acc) => acc.id === accountId);
    if (active) {
      return { ...active, deletedAt: null };
    }
    return null;
  }

  async selectAccountsForHardPurge(
    graceDays: number,
  ): Promise<Array<{ accountId: string; userId: string }>> {
    const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;
    const result: Array<{ accountId: string; userId: string; deletedAt: string }> = [];
    for (const [key, account] of this.softDeletedAccounts.entries()) {
      if (new Date(account.deletedAt).getTime() < cutoff) {
        const sepIdx = key.indexOf(":");
        result.push({
          userId: key.slice(0, sepIdx),
          accountId: key.slice(sepIdx + 1),
          deletedAt: account.deletedAt,
        });
      }
    }
    result.sort((a, b) => (a.deletedAt < b.deletedAt ? -1 : a.deletedAt > b.deletedAt ? 1 : 0));
    return result.map(({ accountId, userId }) => ({ accountId, userId }));
  }

  async hasActiveJobs(_userId: string): Promise<boolean> {
    return false;
  }

  async countActiveAdmins(): Promise<number> {
    let count = 0;
    for (const user of this.usersByEmail.values()) {
      if (user.role === "admin" && !user.deactivatedAt && !user.deletedAt) {
        count++;
      }
    }
    return count;
  }

  private resolveActorEmail(actorUserId: string | null, metadata?: Record<string, unknown>): string | null {
    // Try users table first (mirrors Postgres LEFT JOIN fallback)
    if (actorUserId) {
      for (const user of this.usersByEmail.values()) {
        if (user.id === actorUserId) return user.email;
      }
    }
    // Fall back to metadata
    return (metadata?.actorEmail as string) ?? (metadata?.email as string) ?? null;
  }

  private assertNotLastAdminMem(): void {
    let count = 0;
    for (const user of this.usersByEmail.values()) {
      if (user.role === "admin" && !user.deactivatedAt && !user.deletedAt) {
        count++;
      }
    }
    if (count <= 1) {
      throw routeError(409, "last_admin_blocked", "Cannot modify the last remaining admin");
    }
  }

  async listInvites(options: AdminInviteListOptions): Promise<AdminInviteListResponse> {
    const { page, limit, status, email } = options;
    let inviteList = [...this.invites.values()];

    if (status) {
      inviteList = inviteList.filter((inv) => deriveInviteStatus(inv) === status);
    }

    if (email) {
      const lower = email.toLowerCase();
      inviteList = inviteList.filter((inv) => inv.email.toLowerCase().includes(lower));
    }

    // Sort by createdAt DESC
    inviteList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = inviteList.length;
    const offset = (page - 1) * limit;
    const pageItems = inviteList.slice(offset, offset + limit);

    return {
      items: pageItems.map((inv) => {
        const issuer = inv.issuedByUserId ? this.getUserById(inv.issuedByUserId) : null;
        return {
          code: inv.code,
          email: inv.email,
          role: inv.role,
          status: deriveInviteStatus(inv),
          expiresAt: inv.expiresAt,
          usedAt: inv.usedAt,
          revokedAt: inv.revokedAt,
          issuedByEmail: issuer?.email ?? null,
          issuedByDisplayName: issuer?.displayName ?? null,
          createdAt: inv.createdAt,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async listAuditLog(options: AdminAuditLogListOptions): Promise<AdminAuditLogResponse> {
    const { page, limit, actorUserId, targetUserId, actions, fromDate, toDate } = options;
    let entries = [...this.auditLog];

    if (actorUserId) {
      entries = entries.filter((e) => e.actorUserId === actorUserId);
    }
    if (targetUserId) {
      entries = entries.filter((e) => e.targetUserId === targetUserId);
    }
    if (actions && actions.length > 0) {
      const actionSet = new Set(actions);
      entries = entries.filter((e) => actionSet.has(e.action));
    }
    if (fromDate) {
      entries = entries.filter((e) => e.createdAt >= fromDate);
    }
    if (toDate) {
      entries = entries.filter((e) => e.createdAt <= toDate);
    }

    // Sort by createdAt DESC
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = entries.length;
    const offset = (page - 1) * limit;
    const pageItems = entries.slice(offset, offset + limit);

    return {
      items: pageItems.map((e) => ({
        id: e.id,
        actorUserId: e.actorUserId,
        actorEmail: this.resolveActorEmail(e.actorUserId, e.metadata) ?? null,
        action: e.action,
        targetUserId: e.targetUserId,
        targetEmail: (e.metadata?.targetEmail as string) ?? (e.metadata?.email as string) ?? null,
        targetDisplayName: (e.metadata?.targetDisplayName as string) ?? null,
        metadata: e.metadata,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  // ── Provider health (KZO-177) ─────────────────────────────────────────────

  async getProviderHealthStatus(providerId: string): Promise<ProviderHealthRow | null> {
    const row = this.providerHealth.get(providerId);
    return row ? { ...row } : null;
  }

  async getAllProviderHealthStatuses(): Promise<ProviderHealthRow[]> {
    return [...this.providerHealth.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  async upsertProviderHealthStatus(patch: ProviderHealthUpsert): Promise<ProviderHealthRow> {
    const now = new Date().toISOString();
    const existing = this.providerHealth.get(patch.providerId) ?? {
      providerId: patch.providerId,
      status: "down" as const,
      lastSuccessfulRun: null,
      lastFailedRun: null,
      lastErrorMessage: null,
      lastDownNotificationAt: null,
      lastManualRerunAt: null,
      updatedAt: now,
    };
    const merged: ProviderHealthRow = {
      ...existing,
      status: patch.status ?? existing.status,
      lastSuccessfulRun:
        patch.lastSuccessfulRun !== undefined ? patch.lastSuccessfulRun : existing.lastSuccessfulRun,
      lastFailedRun:
        patch.lastFailedRun !== undefined ? patch.lastFailedRun : existing.lastFailedRun,
      lastErrorMessage:
        patch.lastErrorMessage !== undefined ? patch.lastErrorMessage : existing.lastErrorMessage,
      lastDownNotificationAt:
        patch.lastDownNotificationAt !== undefined
          ? patch.lastDownNotificationAt
          : existing.lastDownNotificationAt,
      lastManualRerunAt:
        patch.lastManualRerunAt !== undefined ? patch.lastManualRerunAt : existing.lastManualRerunAt,
      updatedAt: now,
    };
    this.providerHealth.set(patch.providerId, merged);
    return { ...merged };
  }

  async clearProviderDownNotificationCas(
    providerId: string,
    expectedPreviousNotificationAt: string,
  ): Promise<boolean> {
    // KZO-177 (M2): per-provider promise-chain CAS lock — chains the read /
    // check / write through a single in-flight slot so concurrent winners are
    // serialized. Loser sees `lastDownNotificationAt === null` and returns
    // false. Mirrors Postgres's atomic-UPDATE rowcount semantics.
    const prev = this._providerCasLocks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this._providerCasLocks.set(providerId, prev.then(() => next));
    await prev;
    try {
      const row = this.providerHealth.get(providerId);
      if (!row) return false;
      if (row.lastDownNotificationAt !== expectedPreviousNotificationAt) return false;
      this.providerHealth.set(providerId, {
        ...row,
        lastDownNotificationAt: null,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } finally {
      release();
    }
  }

  async claimProviderDownNotificationSlot(
    providerId: string,
    suppressionWindowMs: number,
  ): Promise<boolean> {
    // KZO-177 (P2 Fix 5): chain through the same per-provider mutex used by
    // `clearProviderDownNotificationCas` so concurrent claim attempts are
    // serialized. The Postgres backend gets atomicity from the conditional
    // UPDATE row count; this matches the semantics in memory.
    const prev = this._providerCasLocks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this._providerCasLocks.set(providerId, prev.then(() => next));
    await prev;
    try {
      const row = this.providerHealth.get(providerId);
      if (!row) return false;
      const lastNotifMs = row.lastDownNotificationAt
        ? new Date(row.lastDownNotificationAt).getTime()
        : 0;
      if (Date.now() - lastNotifMs < suppressionWindowMs) {
        return false;
      }
      const nowIso = new Date().toISOString();
      this.providerHealth.set(providerId, {
        ...row,
        lastDownNotificationAt: nowIso,
        updatedAt: nowIso,
      });
      return true;
    } finally {
      release();
    }
  }

  async insertProviderErrorTrailEntry(input: ProviderErrorTrailInput): Promise<ProviderErrorTrailRow> {
    const row: ProviderErrorTrailRow = {
      id: this._providerErrorTrailNextId++,
      providerId: input.providerId,
      occurredAt: new Date().toISOString(),
      errorClass: input.errorClass,
      errorMessage: input.errorMessage ?? null,
      context: input.context ?? null,
    };
    this.providerErrorTrail.push(row);
    return { ...row };
  }

  async getRecentProviderErrors(
    providerId: string,
    limit: number,
  ): Promise<ProviderErrorTrailRow[]> {
    return this.providerErrorTrail
      .filter((row) => row.providerId === providerId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, Math.max(0, limit))
      .map((row) => ({ ...row }));
  }

  async computeErrorCount24h(providerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return this.providerErrorTrail.filter(
      (row) =>
        row.providerId === providerId &&
        row.errorClass !== "rate_limit" &&
        row.occurredAt >= cutoff,
    ).length;
  }

  async computeErrorCount7d(providerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.providerErrorTrail.filter(
      (row) =>
        row.providerId === providerId &&
        row.errorClass !== "rate_limit" &&
        row.occurredAt >= cutoff,
    ).length;
  }

  async computeRateLimitCount24h(providerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return this.providerErrorTrail.filter(
      (row) =>
        row.providerId === providerId &&
        row.errorClass === "rate_limit" &&
        row.occurredAt >= cutoff,
    ).length;
  }

  async pruneOldProviderErrorTrail(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    let removed = 0;
    for (let i = this.providerErrorTrail.length - 1; i >= 0; i--) {
      if (this.providerErrorTrail[i]!.occurredAt < cutoff) {
        this.providerErrorTrail.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  async listAdminUserIds(): Promise<string[]> {
    return [...this.usersByEmail.values()]
      .filter((u) => u.role === "admin" && !u.deactivatedAt && !u.deletedAt)
      .map((u) => u.id);
  }

  // ── Test-only helpers (KZO-177) ─────────────────────────────────────────
  // Used by unit / integration tests to seed and inspect provider-health
  // state without going through `recordOutcome`. NOT part of the production
  // Persistence contract.

  /** @internal */
  async _seedProviderHealthStatus(input: {
    providerId: string;
    status?: "healthy" | "degraded" | "down";
    lastSuccessfulRun?: string | null;
    lastFailedRun?: string | null;
    lastErrorMessage?: string | null;
    lastDownNotificationAt?: string | null;
    lastManualRerunAt?: string | null;
    /** Ignored by memory backend (counters are computed-on-read). */
    errorCount24h?: number;
    /** Ignored by memory backend (counters are computed-on-read). */
    errorCount7d?: number;
    /** Ignored by memory backend (counters are computed-on-read). */
    rateLimitCount24h?: number;
  }): Promise<void> {
    await this.upsertProviderHealthStatus({
      providerId: input.providerId,
      status: input.status,
      lastSuccessfulRun: input.lastSuccessfulRun ?? undefined,
      lastFailedRun: input.lastFailedRun ?? undefined,
      lastErrorMessage: input.lastErrorMessage ?? undefined,
      lastDownNotificationAt: input.lastDownNotificationAt ?? undefined,
      lastManualRerunAt: input.lastManualRerunAt ?? undefined,
    });
  }

  /** @internal — returns the row plus computed counters for test convenience. */
  async _getProviderHealthStatus(providerId: string): Promise<{
    providerId: string;
    status: "healthy" | "degraded" | "down";
    lastSuccessfulRun: string | null;
    lastFailedRun: string | null;
    lastErrorMessage: string | null;
    lastDownNotificationAt: string | null;
    lastManualRerunAt: string | null;
    errorCount24h: number;
    errorCount7d: number;
    rateLimitCount24h: number;
  } | null> {
    const row = await this.getProviderHealthStatus(providerId);
    if (!row) return null;
    const [errorCount24h, errorCount7d, rateLimitCount24h] = await Promise.all([
      this.computeErrorCount24h(providerId),
      this.computeErrorCount7d(providerId),
      this.computeRateLimitCount24h(providerId),
    ]);
    return {
      providerId: row.providerId,
      status: row.status,
      lastSuccessfulRun: row.lastSuccessfulRun,
      lastFailedRun: row.lastFailedRun,
      lastErrorMessage: row.lastErrorMessage,
      lastDownNotificationAt: row.lastDownNotificationAt,
      lastManualRerunAt: row.lastManualRerunAt,
      errorCount24h,
      errorCount7d,
      rateLimitCount24h,
    };
  }

  /** @internal — list admin notifications by source category for tests. */
  async _listAdminNotifications(category: string): Promise<Array<{ category: string; payload: unknown }>> {
    const out: Array<{ category: string; payload: unknown }> = [];
    for (const list of this.notifications.values()) {
      for (const n of list) {
        if (n.source === "provider_health") {
          // Map each in-app notification to a category by inspecting title.
          const inferred = /down/i.test(n.title) ? "provider_down" : "provider_recovered";
          if (inferred === category) {
            out.push({ category: inferred, payload: n.detail });
          }
        }
      }
    }
    return out;
  }
}

function deriveUserStatus(user: { deactivatedAt?: string | null; deletedAt?: string | null }): AdminUserStatus {
  if (user.deletedAt) return "deleted";
  if (user.deactivatedAt) return "disabled";
  return "active";
}

function deriveInviteStatus(invite: { usedAt: string | null; revokedAt: string | null; expiresAt: string }): InviteListStatus {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (new Date(invite.expiresAt) < new Date()) return "expired";
  return "pending";
}

function matchesNullableDateRange(value: string | null | undefined, fromDate?: string, toDate?: string): boolean {
  if (value == null) return true;
  if (fromDate && value < fromDate) return false;
  if (toDate && value > toDate) return false;
  return true;
}

function compareNullablePaymentDates(
  left: { paymentDate?: string | null } | undefined,
  right: { paymentDate?: string | null } | undefined,
): number {
  const leftDate = left?.paymentDate ?? "";
  const rightDate = right?.paymentDate ?? "";
  return leftDate.localeCompare(rightDate);
}

function toShareGrantRecord(share: MemoryShare, owner: MemoryUser, grantee: MemoryUser): ShareGrantRecord {
  return {
    id: share.id,
    ownerUserId: owner.id,
    ownerEmail: owner.email,
    ownerDisplayName: owner.displayName,
    granteeUserId: grantee.id,
    granteeEmail: grantee.email,
    granteeDisplayName: grantee.displayName,
    createdAt: share.createdAt,
    revokedAt: share.revokedAt,
    revokedByUserId: share.revokedByUserId,
  };
}

function toAnonymousShareTokenRecord(row: MemoryAnonymousShareToken): AnonymousShareTokenRecord {
  return {
    id: row.id,
    token: row.token,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
  };
}

function toPendingShareInviteRecord(invite: MemoryInvite, owner: MemoryUser): PendingShareInviteRecord {
  return {
    code: invite.code,
    email: invite.email,
    role: invite.role,
    shareOwnerUserId: invite.shareOwnerUserId,
    ownerEmail: owner.email,
    ownerDisplayName: owner.displayName,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    usedAt: invite.usedAt,
  };
}

// Share audit metadata + notification helpers live in shareHelpers.ts to keep
// memory and postgres backends aligned on shape.

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

// KZO-183 — application-layer mirror of the composite-FK ownership invariant
// that Postgres enforces via FK (fee_profile_id, account_id) → fee_profiles
// (id, account_id). Run inside `MemoryPersistence.saveStore` so memory-backed
// tests catch cross-account ownership violations that would be silently
// allowed by the unscoped FK in `MemoryPersistence` alone.
function validateMemoryStoreOwnership(store: Store): void {
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));
  for (const account of store.accounts) {
    const profile = profilesById.get(account.feeProfileId);
    if (!profile) {
      throw new Error(
        `account ${account.id} references missing fee profile ${account.feeProfileId}`,
      );
    }
    if (profile.accountId !== account.id) {
      throw new Error(
        `account ${account.id} references fee profile ${profile.id} owned by account ${profile.accountId}`,
      );
    }
  }
  for (const binding of store.feeProfileBindings) {
    const profile = profilesById.get(binding.feeProfileId);
    if (!profile) {
      throw new Error(
        `fee profile binding (${binding.accountId},${binding.ticker}) references missing profile ${binding.feeProfileId}`,
      );
    }
    if (profile.accountId !== binding.accountId) {
      throw new Error(
        `fee profile binding (${binding.accountId},${binding.ticker}) references profile ${profile.id} owned by account ${profile.accountId}`,
      );
    }
  }
}
