import { randomUUID } from "node:crypto";
import type { Lot } from "@tw-portfolio/domain";
import type { DividendLedgerAggregates, DividendSourceLine } from "@tw-portfolio/shared-types";
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
} from "@tw-portfolio/shared-types";
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
  UserRole,
} from "./types.js";
import {
  ANONYMOUS_SHARE_TOKEN_CAP,
  ANONYMOUS_SHARE_TOKEN_RETENTION_MS,
} from "../lib/anonymousShareToken.js";
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
}

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
  /** KZO-142: timestamp of the last app_config write (ISO 8601). Stamped at
   *  construction so a fresh MemoryPersistence always has a non-null value. */
  private _appConfigUpdatedAt: string = new Date().toISOString();
  /** KZO-159 / 158A: per-user preferences keyed by user id. Lazy — absent key
   *  == empty preferences. Top-level merge semantics mirror the Postgres
   *  `||` / `- key[]` update shape (see design D3). */
  private readonly userPreferences = new Map<string, Record<string, unknown>>();

  constructor(private readonly options: MemoryPersistenceOptions = {}) {}

  async init(): Promise<void> {
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
    if (activeCount >= ANONYMOUS_SHARE_TOKEN_CAP) {
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
    const cutoff = now - ANONYMOUS_SHARE_TOKEN_RETENTION_MS;
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
    return {
      userId: memUser.id,
      email: memUser.email,
      displayName: memUser.displayName,
      providerPictureUrl: memUser.providerPictureUrl,
      providerDisplayName: memUser.providerDisplayName,
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
      };
    });
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

  // --- App Config (KZO-133) ---

  async getRepairCooldownMinutes(): Promise<number | null> {
    return this._repairCooldownMinutes;
  }

  async getAppConfig(): Promise<{
    repairCooldownMinutes: number | null;
    dashboardPerformanceRanges: string[] | null;
    updatedAt: string;
  }> {
    return {
      repairCooldownMinutes: this._repairCooldownMinutes,
      dashboardPerformanceRanges: this._dashboardPerformanceRanges
        ? [...this._dashboardPerformanceRanges]
        : null,
      updatedAt: this._appConfigUpdatedAt,
    };
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
    this.userPreferences.set(userId, { ...preferences });
  }

  // --- Monitored Tickers ---

  async getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]> {
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

    // Build union: manual selections take precedence. Persistence returns rows
    // without `repairAvailableAt` (KZO-133 — route layer decorates).
    const result: Omit<MonitoredTickerDto, "repairAvailableAt">[] = [];
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

  async listInstrumentsCatalog(
    search?: string,
    type?: string,
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
