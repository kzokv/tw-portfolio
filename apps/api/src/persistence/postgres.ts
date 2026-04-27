import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createClient, type RedisClientType } from "redis";
import {
  calculateAppliedTaxComponents,
  materializeFeeProfileTaxRules,
  projectLegacyFeeProfileTaxFields,
  type FeeProfile,
  type FeeProfileTaxRule,
} from "@tw-portfolio/domain";
import type { DailyBar } from "@tw-portfolio/domain";
import type { FxRate } from "../services/market-data/types.js";
import { loadMigrationManifest } from "./migrationManifest.js";
import {
  buildAccountingPolicy,
  rebuildHoldingProjection,
  syncTradeEventRealizedPnl,
} from "../services/accountingStore.js";
import { instrumentRefToDef } from "../services/store.js";
import { createDefaultInstruments, upsertInstrumentDefinitions } from "../services/instrumentRegistry.js";
import type {
  AccountingStore,
  CashLedgerEntry,
  DividendDeductionEntry,
  DividendEvent,
  DividendLedgerEntry,
  LotAllocationProjection,
  MarketDataFacts,
  RecomputeJob,
  RecomputePreviewItem,
  Store,
  InstrumentDef,
  Transaction,
} from "../types/store.js";
import type {
  DividendLedgerAggregates,
  DividendSourceLine,
  AdminAuditLogResponse,
  AdminInviteListResponse,
  AdminUserListResponse,
  InstrumentCatalogItemDto,
  InviteListStatus,
  LocaleCode,
  MonitoredTickerDto,
  NotificationDto,
  ProfileDto,
} from "@tw-portfolio/shared-types";
import { routeError } from "../lib/routeError.js";
import { roundToDecimal } from "@tw-portfolio/domain";
import type { Lot } from "@tw-portfolio/domain";
import type { BookedTradeEvent } from "../types/store.js";
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
  CashLedgerSortColumn,
  CatalogInstrument,
  CatalogSyncResult,
  DelistingRecord,
  DeleteTradeEventResult,
  DividendLedgerListOptions,
  DividendLedgerListResult,
  InstrumentRow,
  InviteRecord,
  InviteStatus,
  ListInboundSharesForGranteeResult,
  ListSharesForOwnerResult,
  MaterializePendingSharesInput,
  OAuthClaims,
  PendingShareInviteRecord,
  Persistence,
  ReadinessStatus,
  ResolveOrCreateUserOptions,
  ResolveOrCreateUserResult,
  RevokeAnonymousShareTokenInput,
  RevokeAnonymousShareTokenResult,
  ShareGrantRecord,
  TradeEventPatch,
  UpdatePostedCashDividendInput,
  HoldingSnapshot,
  AggregatedSnapshotPoint,
  UserRole,
} from "./types.js";
import {
  ANONYMOUS_SHARE_TOKEN_CAP,
  ANONYMOUS_SHARE_TOKEN_RETENTION_MS,
} from "../lib/anonymousShareToken.js";
import type { DividendLedgerRecomputeChange } from "../services/dividends.js";

export interface PostgresPersistenceOptions {
  databaseUrl: string;
  redisUrl: string;
}

function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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

function mapAuthUserRow(row: {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  session_version: number;
  is_demo: boolean;
  deactivated_at: string | null;
  deleted_at: string | null;
}): AuthUserRecord {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    sessionVersion: Number(row.session_version),
    isDemo: row.is_demo,
    deactivatedAt: row.deactivated_at,
    deletedAt: row.deleted_at,
  };
}

function mapInviteRow(row: {
  code: string;
  email: string;
  role: UserRole;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  issued_by_user_id: string | null;
  share_owner_user_id: string | null;
  created_at: string;
}): InviteRecord {
  return {
    code: row.code,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    usedAt: row.used_at,
    issuedByUserId: row.issued_by_user_id,
    shareOwnerUserId: row.share_owner_user_id,
    createdAt: row.created_at,
  };
}

function mapShareGrantRow(row: {
  id: string;
  owner_user_id: string;
  owner_email: string | null;
  owner_display_name: string | null;
  grantee_user_id: string;
  grantee_email: string | null;
  grantee_display_name: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
}): ShareGrantRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    ownerDisplayName: row.owner_display_name,
    granteeUserId: row.grantee_user_id,
    granteeEmail: row.grantee_email,
    granteeDisplayName: row.grantee_display_name,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
  };
}

function mapAnonymousShareTokenRow(row: {
  id: string;
  token: string;
  owner_user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
}): AnonymousShareTokenRecord {
  return {
    id: row.id,
    token: row.token,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
  };
}

function mapPendingShareInviteRow(row: {
  code: string;
  email: string;
  role: UserRole;
  share_owner_user_id: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
}): PendingShareInviteRecord {
  return {
    code: row.code,
    email: row.email,
    role: row.role,
    shareOwnerUserId: row.share_owner_user_id,
    ownerEmail: row.owner_email,
    ownerDisplayName: row.owner_display_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    usedAt: row.used_at,
  };
}

// Share audit metadata + notification helpers live in shareHelpers.ts.
// Postgres row shapes (`display_name`) are adapted to `displayName` at call sites.
import {
  buildShareAuditMetadata as buildShareAuditMetadataShared,
  buildShareGrantedNotification as buildShareGrantedNotificationShared,
  buildShareRevokedNotification as buildShareRevokedNotificationShared,
} from "./shareHelpers.js";

function buildShareAuditMetadata(
  shareId: string,
  owner: { email: string | null; display_name: string | null },
  grantee: { email: string | null; display_name: string | null },
): Record<string, unknown> {
  return buildShareAuditMetadataShared(
    shareId,
    { email: owner.email, displayName: owner.display_name },
    { email: grantee.email, displayName: grantee.display_name },
  );
}

function buildShareGrantedNotification(
  shareId: string,
  owner: { id: string; email: string | null; display_name: string | null },
  granteeUserId: string,
  granteeLocale: LocaleCode,
) {
  return buildShareGrantedNotificationShared(
    shareId,
    { id: owner.id, email: owner.email, displayName: owner.display_name },
    granteeUserId,
    granteeLocale,
  );
}

function buildShareRevokedNotification(
  shareId: string,
  owner: { id: string; email: string | null; display_name: string | null },
  granteeUserId: string,
  granteeLocale: LocaleCode,
) {
  return buildShareRevokedNotificationShared(
    shareId,
    { id: owner.id, email: owner.email, displayName: owner.display_name },
    granteeUserId,
    granteeLocale,
  );
}

function deriveInviteStatusFromRow(row: { used_at: string | null; revoked_at: string | null; expires_at: string }): InviteListStatus {
  if (row.used_at) return "used";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at) < new Date()) return "expired";
  return "pending";
}

export class PostgresPersistence implements Persistence {
  private readonly pool: Pool;
  private readonly redis: RedisClientType;

  constructor(private readonly options: PostgresPersistenceOptions) {
    this.pool = new Pool({
      connectionString: options.databaseUrl,
      max: 20,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    this.redis = createClient({ url: options.redisUrl });
  }

  async init(): Promise<void> {
    if (!this.redis.isOpen) await this.redis.connect();
    await this.runMigrations();
    await this.seedDefaults();
  }

  async close(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }

  async resolveOrCreateUser(
    provider: string,
    providerSubject: string,
    claims: OAuthClaims,
    options: ResolveOrCreateUserOptions = {},
  ): Promise<ResolveOrCreateUserResult> {
    const normalizedEmail = normalizeEmail(claims.email);
    const insertRole = options.role ?? "member";
    const insertSessionVersion = options.sessionVersion ?? 1;
    const updateRole = options.role ?? null;
    const updateSessionVersion = options.sessionVersion ?? null;
    // Upsert user by email — eliminates TOCTOU race between SELECT and INSERT.
    const userResult = await this.pool.query<{
      id: string;
      role: UserRole;
      session_version: number;
    }>(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role, session_version)
       VALUES ($1, $2, $3, 'en', 'WEIGHTED_AVERAGE', 10, $4, $5)
       ON CONFLICT ((LOWER(email))) WHERE email IS NOT NULL DO UPDATE
         SET display_name = COALESCE($3, users.display_name),
             role = COALESCE($6, users.role),
             session_version = COALESCE($7, users.session_version),
             updated_at = CURRENT_TIMESTAMP
       RETURNING id, role, session_version`,
      [
        randomUUID(),
        normalizedEmail,
        claims.name ?? null,
        insertRole,
        insertSessionVersion,
        updateRole,
        updateSessionVersion,
      ],
    );
    const user = userResult.rows[0]!;
    const userId = user.id;

    // Upsert external identity.
    // First, remove any stale row for (user_id, provider) with a different provider_subject
    // (handles the rare case where a user recreated their Google account and got a new sub).
    await this.pool.query(
      `DELETE FROM user_external_identities
       WHERE user_id = $1 AND provider = $2 AND provider_subject <> $3`,
      [userId, provider, providerSubject],
    );

    await this.pool.query(
      `INSERT INTO user_external_identities (id, user_id, provider, provider_subject, provider_email, provider_display_name, provider_picture_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (provider, provider_subject) DO UPDATE
         SET provider_display_name = $6,
             provider_picture_url = $7,
             last_seen_at = CURRENT_TIMESTAMP`,
      [randomUUID(), userId, provider, providerSubject, normalizedEmail, claims.name ?? null, claims.picture ?? null],
    );

    // Default portfolio data seeded after upsert (idempotent safety net)
    await this.ensureDefaultPortfolioData(userId);

    return {
      userId,
      role: user.role,
      sessionVersion: Number(user.session_version),
    };
  }

  async ensureDefaultPortfolioData(userId: string): Promise<void> {
    const feeProfileId = this.defaultFeeProfileId(userId);
    const accountId = this.defaultAccountId(userId);

    // Quick check: skip all seed work if fee profile already exists (common path)
    const existing = await this.pool.query(`SELECT 1 FROM fee_profiles WHERE id = $1`, [feeProfileId]);
    if (existing.rows.length > 0) return;

    // Lazy user creation for dev_bypass mode: create placeholder user if not exists.
    // In OAuth mode, resolveOrCreateUser creates the user first.
    // Deterministic placeholder email for dev_bypass mode — not used in production.
    await this.pool.query(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role)
       VALUES ($1, $2, NULL, 'en', 'WEIGHTED_AVERAGE', 10, 'member')
       ON CONFLICT (id) DO NOTHING`,
      [userId, normalizeEmail(`${userId}@placeholder.local`)],
    );

    const profileResult = await this.pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
       ) VALUES (
         $1, $2, 'Default Broker', 14, 1.425, 0, 10000,
         20, 'TWD', 'FLOOR', 'FLOOR',
         30, 15,
         10, 0, 'CHARGED_UPFRONT'
       )
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [feeProfileId, userId],
    );

    await this.pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
       VALUES ($1, $2, 'Main', $3)
       ON CONFLICT (id) DO NOTHING`,
      [accountId, userId, feeProfileId],
    );

    // Only seed tax rules when the fee profile was actually created;
    // avoids a destructive DELETE+INSERT race when concurrent requests
    // both call ensureDefaultPortfolioData for the same user.
    if (profileResult.rowCount && profileResult.rowCount > 0) {
      await ensureFeeProfileTaxRules(this.pool, userId, {
        id: feeProfileId,
        name: "Default Broker",
        boardCommissionRate: 1.425,
        commissionDiscountPercent: 0,
        minimumCommissionAmount: 20,
        commissionCurrency: "TWD",
        commissionRoundingMode: "FLOOR",
        taxRoundingMode: "FLOOR",
        stockSellTaxRateBps: 30,
        stockDayTradeTaxRateBps: 15,
        etfSellTaxRateBps: 10,
        bondEtfSellTaxRateBps: 0,
        commissionChargeMode: "CHARGED_UPFRONT",
      });
    }
  }

  async getAuthUserById(userId: string): Promise<AuthUserRecord | null> {
    const result = await this.pool.query<{
      user_id: string;
      email: string | null;
      display_name: string | null;
      role: UserRole;
      session_version: number;
      is_demo: boolean;
      deactivated_at: string | null;
      deleted_at: string | null;
    }>(
      `SELECT id AS user_id,
              email,
              display_name,
              role,
              session_version,
              is_demo,
              deactivated_at::text AS deactivated_at,
              deleted_at::text AS deleted_at
       FROM users
       WHERE id = $1`,
      [userId],
    );
    return result.rows[0] ? mapAuthUserRow(result.rows[0]) : null;
  }

  async getAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const result = await this.pool.query<{
      user_id: string;
      email: string | null;
      display_name: string | null;
      role: UserRole;
      session_version: number;
      is_demo: boolean;
      deactivated_at: string | null;
      deleted_at: string | null;
    }>(
      `SELECT id AS user_id,
              email,
              display_name,
              role,
              session_version,
              is_demo,
              deactivated_at::text AS deactivated_at,
              deleted_at::text AS deleted_at
       FROM users
       WHERE email = $1`,
      [normalizeEmail(email)],
    );
    return result.rows[0] ? mapAuthUserRow(result.rows[0]) : null;
  }

  async ensureDevBypassUser(): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role)
       SELECT $1, $2, $3, 'en', 'WEIGHTED_AVERAGE', 10, 'admin'
       WHERE NOT EXISTS (
         SELECT 1
         FROM users
         WHERE id = $1
           AND (deactivated_at IS NOT NULL OR deleted_at IS NOT NULL)
       )
       ON CONFLICT (id) DO NOTHING`,
      ["user-1", "user-1@placeholder.local", "Dev User"],
    );
    await this.ensureDefaultPortfolioData("user-1");
  }

  async promoteUserToAdminByEmail(
    email: string,
    action: AuditLogInput["action"],
    metadata: Record<string, unknown> = {},
  ): Promise<AuthUserRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        user_id: string;
        email: string | null;
        display_name: string | null;
        role: UserRole;
        session_version: number;
        is_demo: boolean;
        deactivated_at: string | null;
        deleted_at: string | null;
      }>(
        `UPDATE users
         SET role = 'admin',
             updated_at = CURRENT_TIMESTAMP
         WHERE email = $1
           AND deactivated_at IS NULL
           AND deleted_at IS NULL
         RETURNING id AS user_id,
                   email,
                   display_name,
                   role,
                   session_version,
                   is_demo,
                   deactivated_at::text AS deactivated_at,
                   deleted_at::text AS deleted_at`,
        [normalizeEmail(email)],
      );

      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }

      const authUser = mapAuthUserRow(result.rows[0]);
      await this.appendAuditLogTx(client, {
        action,
        targetUserId: authUser.userId,
        metadata: { email: authUser.email, targetEmail: authUser.email, ...metadata },
      });
      await client.query("COMMIT");
      return authUser;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAuditLog(input: AuditLogInput): Promise<void> {
    await this.appendAuditLogTx(this.pool, input);
  }

  async bumpSessionVersion(userId: string): Promise<number> {
    const result = await this.pool.query<{ session_version: number }>(
      `UPDATE users
       SET session_version = session_version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING session_version`,
      [userId],
    );
    if (!result.rows[0]) {
      throw routeError(404, "not_found", "User not found");
    }
    return Number(result.rows[0].session_version);
  }

  async createInvite(input: CreateInviteInput): Promise<InviteRecord> {
    return this.insertInviteWithGeneratedCode(input);
  }

  async insertBootstrapInvite(input: CreateInviteInput): Promise<InviteRecord> {
    return this.insertInviteWithGeneratedCode(input);
  }

  async revokeInvite(code: string): Promise<void> {
    await this.pool.query(
      `UPDATE invites
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE code = $1`,
      [code],
    );
  }

  async getInviteStatus(code: string): Promise<InviteStatus> {
    const result = await this.pool.query<{
      expires_at: string;
      revoked_at: string | null;
      used_at: string | null;
    }>(
      `SELECT expires_at::text AS expires_at,
              revoked_at::text AS revoked_at,
              used_at::text AS used_at
       FROM invites
       WHERE code = $1`,
      [code],
    );
    const row = result.rows[0];
    if (!row) return "invalid";
    if (row.revoked_at) return "revoked";
    if (row.used_at) return "used";
    if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
    return "valid";
  }

  async getInviteRecord(code: string): Promise<InviteRecord | null> {
    const result = await this.pool.query<{
      code: string;
      email: string;
      role: UserRole;
      expires_at: string;
      revoked_at: string | null;
      used_at: string | null;
      issued_by_user_id: string | null;
      share_owner_user_id: string | null;
      created_at: string;
    }>(
      `SELECT code,
              email,
              role,
              expires_at::text AS expires_at,
              revoked_at::text AS revoked_at,
              used_at::text AS used_at,
              issued_by_user_id,
              share_owner_user_id,
              created_at::text AS created_at
       FROM invites
       WHERE code = $1`,
      [code],
    );
    return result.rows[0] ? mapInviteRow(result.rows[0]) : null;
  }

  async consumeInvite(code: string, email: string): Promise<ConsumeInviteResult> {
    const normalizedEmail = normalizeEmail(email);
    const consumed = await this.pool.query<{
      code: string;
      email: string;
      role: UserRole;
      expires_at: string;
      revoked_at: string | null;
      used_at: string | null;
      issued_by_user_id: string | null;
      share_owner_user_id: string | null;
      created_at: string;
    }>(
      `UPDATE invites
       SET used_at = NOW()
       WHERE code = $1
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > NOW()
         AND email = $2
       RETURNING code,
                 email,
                 role,
                 expires_at::text AS expires_at,
                 revoked_at::text AS revoked_at,
                 used_at::text AS used_at,
                 issued_by_user_id,
                 share_owner_user_id,
                 created_at::text AS created_at`,
      [code, normalizedEmail],
    );

    if (consumed.rows[0]) {
      return {
        status: "consumed",
        invite: mapInviteRow(consumed.rows[0]),
      };
    }

    const existing = await this.pool.query<{
      code: string;
      email: string;
      role: UserRole;
      expires_at: string;
      revoked_at: string | null;
      used_at: string | null;
      issued_by_user_id: string | null;
      share_owner_user_id: string | null;
      created_at: string;
    }>(
      `SELECT code,
              email,
              role,
              expires_at::text AS expires_at,
              revoked_at::text AS revoked_at,
              used_at::text AS used_at,
              issued_by_user_id,
              share_owner_user_id,
              created_at::text AS created_at
       FROM invites
       WHERE code = $1`,
      [code],
    );

    const invite = existing.rows[0];
    if (!invite) return { status: "invalid" };
    if (invite.revoked_at) return { status: "revoked" };
    if (invite.used_at) return { status: "used" };
    if (new Date(invite.expires_at).getTime() <= Date.now()) return { status: "expired" };
    if (invite.email !== normalizedEmail) return { status: "email_mismatch" };
    return { status: "invalid" };
  }

  async createShareGrant(input: CreateShareGrantInput): Promise<ShareGrantRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const usersResult = await client.query<{
        id: string;
        email: string | null;
        display_name: string | null;
        locale: LocaleCode;
      }>(
        `SELECT id, email, display_name, locale
         FROM users
         WHERE id = ANY($1::text[])`,
        [[input.ownerUserId, input.granteeUserId]],
      );

      const owner = usersResult.rows.find((row) => row.id === input.ownerUserId);
      const grantee = usersResult.rows.find((row) => row.id === input.granteeUserId);
      if (!owner || !grantee) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const inserted = await client.query<{
        id: string;
        owner_user_id: string;
        owner_email: string | null;
        owner_display_name: string | null;
        grantee_user_id: string;
        grantee_email: string | null;
        grantee_display_name: string | null;
        created_at: string;
        revoked_at: string | null;
        revoked_by_user_id: string | null;
      }>(
        `INSERT INTO portfolio_shares (id, owner_user_id, grantee_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (owner_user_id, grantee_user_id) WHERE revoked_at IS NULL DO NOTHING
         RETURNING id,
                   owner_user_id,
                   $4::text AS owner_email,
                   $5::text AS owner_display_name,
                   grantee_user_id,
                   $6::text AS grantee_email,
                   $7::text AS grantee_display_name,
                   created_at::text AS created_at,
                   revoked_at::text AS revoked_at,
                   revoked_by_user_id`,
        [
          randomUUID(),
          input.ownerUserId,
          input.granteeUserId,
          owner.email,
          owner.display_name,
          grantee.email,
          grantee.display_name,
        ],
      );

      let share = inserted.rows[0];
      if (share) {
        await this.appendAuditLogTx(client, {
          ...input.auditInput,
          action: "share_granted",
          targetUserId: input.granteeUserId,
          metadata: buildShareAuditMetadata(share.id, owner, grantee),
        });
        await this.createNotificationTx(
          client,
          buildShareGrantedNotification(share.id, owner, input.granteeUserId, grantee.locale),
        );
      } else {
        const existing = await client.query<{
          id: string;
          owner_user_id: string;
          owner_email: string | null;
          owner_display_name: string | null;
          grantee_user_id: string;
          grantee_email: string | null;
          grantee_display_name: string | null;
          created_at: string;
          revoked_at: string | null;
          revoked_by_user_id: string | null;
        }>(
          `SELECT ps.id,
                  ps.owner_user_id,
                  owner.email AS owner_email,
                  owner.display_name AS owner_display_name,
                  ps.grantee_user_id,
                  grantee.email AS grantee_email,
                  grantee.display_name AS grantee_display_name,
                  ps.created_at::text AS created_at,
                  ps.revoked_at::text AS revoked_at,
                  ps.revoked_by_user_id
           FROM portfolio_shares ps
           JOIN users owner ON owner.id = ps.owner_user_id
           JOIN users grantee ON grantee.id = ps.grantee_user_id
           WHERE ps.owner_user_id = $1
             AND ps.grantee_user_id = $2
             AND ps.revoked_at IS NULL`,
          [input.ownerUserId, input.granteeUserId],
        );
        share = existing.rows[0];
      }

      await client.query("COMMIT");
      return mapShareGrantRow(share!);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeShareGrant(
    shareId: string,
    revokedByUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<{ granteeUserId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const shareResult = await client.query<{
        id: string;
        owner_user_id: string;
        owner_email: string | null;
        owner_display_name: string | null;
        grantee_user_id: string;
        grantee_email: string | null;
        grantee_display_name: string | null;
        grantee_locale: LocaleCode;
        revoked_at: string | null;
      }>(
        `SELECT ps.id,
                ps.owner_user_id,
                owner.email AS owner_email,
                owner.display_name AS owner_display_name,
                ps.grantee_user_id,
                grantee.email AS grantee_email,
                grantee.display_name AS grantee_display_name,
                grantee.locale AS grantee_locale,
                ps.revoked_at::text AS revoked_at
         FROM portfolio_shares ps
         JOIN users owner ON owner.id = ps.owner_user_id
         JOIN users grantee ON grantee.id = ps.grantee_user_id
         WHERE ps.id = $1
           AND ps.owner_user_id = $2
         FOR UPDATE`,
        [shareId, revokedByUserId],
      );

      const share = shareResult.rows[0];
      if (!share) {
        await client.query("ROLLBACK");
        throw routeError(404, "share_not_found", "Share not found");
      }

      const wasAlreadyRevoked = !!share.revoked_at;
      if (!share.revoked_at) {
        await client.query(
          `UPDATE portfolio_shares
           SET revoked_at = NOW(),
               revoked_by_user_id = $2
           WHERE id = $1`,
          [shareId, revokedByUserId],
        );
        await this.appendAuditLogTx(client, {
          ...auditInput,
          action: "share_revoked",
          targetUserId: share.grantee_user_id,
          metadata: buildShareAuditMetadata(
            share.id,
            {
              email: share.owner_email,
              display_name: share.owner_display_name,
            },
            {
              email: share.grantee_email,
              display_name: share.grantee_display_name,
            },
          ),
        });
        await this.createNotificationTx(
          client,
          buildShareRevokedNotification(
            share.id,
            {
              id: share.owner_user_id,
              email: share.owner_email,
              display_name: share.owner_display_name,
            },
            share.grantee_user_id,
            share.grantee_locale,
          ),
        );
      }

      await client.query("COMMIT");
      return wasAlreadyRevoked ? null : { granteeUserId: share.grantee_user_id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async createShareCoupledInvite(input: CreateShareCoupledInviteInput): Promise<PendingShareInviteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ownerResult = await client.query<{
        id: string;
        email: string | null;
        display_name: string | null;
      }>(
        `SELECT id, email, display_name
         FROM users
         WHERE id = $1`,
        [input.ownerUserId],
      );
      const owner = ownerResult.rows[0];
      if (!owner) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const normalizedEmail = normalizeEmail(input.email);
      const existingResult = await client.query<{
        code: string;
      }>(
        `SELECT code
         FROM invites
         WHERE email = $1
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > NOW()
           AND (share_owner_user_id IS NULL OR share_owner_user_id = $2)
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [normalizedEmail, input.ownerUserId],
      );

      let invite: InviteRecord;
      if (existingResult.rows[0]) {
        const updated = await client.query<{
          code: string;
          email: string;
          role: UserRole;
          expires_at: string;
          revoked_at: string | null;
          used_at: string | null;
          issued_by_user_id: string | null;
          share_owner_user_id: string | null;
          created_at: string;
        }>(
          `UPDATE invites
           SET share_owner_user_id = $2
           WHERE code = $1
           RETURNING code,
                     email,
                     role,
                     expires_at::text AS expires_at,
                     revoked_at::text AS revoked_at,
                     used_at::text AS used_at,
                     issued_by_user_id,
                     share_owner_user_id,
                     created_at::text AS created_at`,
          [existingResult.rows[0].code, input.ownerUserId],
        );
        invite = mapInviteRow(updated.rows[0]!);
      } else {
        // Rate limit only applies when a new invite row is about to be inserted —
        // dedup updates existing rows in place and does not contribute to growth.
        const activeCountResult = await client.query<{ count: string }>(
          `SELECT count(*) AS count
           FROM invites
           WHERE share_owner_user_id = $1
             AND used_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > NOW()`,
          [input.ownerUserId],
        );
        const activePending = parseInt(activeCountResult.rows[0]!.count, 10);
        if (activePending >= PENDING_SHARE_INVITE_LIMIT) {
          await client.query("ROLLBACK");
          throw routeError(429, "share_invite_rate_limited", "share invite rate limited");
        }

        invite = await this.insertInviteWithGeneratedCode(
          {
            email: normalizedEmail,
            role: "viewer",
            expiresAt: input.expiresAt,
            issuedByUserId: input.issuedByUserId,
            shareOwnerUserId: input.ownerUserId,
          },
          client,
        );
      }

      await client.query("COMMIT");
      return {
        code: invite.code,
        email: invite.email,
        role: invite.role,
        shareOwnerUserId: invite.shareOwnerUserId,
        ownerEmail: owner.email,
        ownerDisplayName: owner.display_name,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        revokedAt: invite.revokedAt,
        usedAt: invite.usedAt,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async countActivePendingShareInvites(ownerUserId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count
       FROM invites
       WHERE share_owner_user_id = $1
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [ownerUserId],
    );
    return parseInt(result.rows[0]!.count, 10);
  }

  async listSharesForOwner(ownerUserId: string): Promise<ListSharesForOwnerResult> {
    const [sharesResult, invitesResult] = await Promise.all([
      this.pool.query<{
        id: string;
        owner_user_id: string;
        owner_email: string | null;
        owner_display_name: string | null;
        grantee_user_id: string;
        grantee_email: string | null;
        grantee_display_name: string | null;
        created_at: string;
        revoked_at: string | null;
        revoked_by_user_id: string | null;
      }>(
        `SELECT ps.id,
                ps.owner_user_id,
                owner.email AS owner_email,
                owner.display_name AS owner_display_name,
                ps.grantee_user_id,
                grantee.email AS grantee_email,
                grantee.display_name AS grantee_display_name,
                ps.created_at::text AS created_at,
                ps.revoked_at::text AS revoked_at,
                ps.revoked_by_user_id
         FROM portfolio_shares ps
         JOIN users owner ON owner.id = ps.owner_user_id
         JOIN users grantee ON grantee.id = ps.grantee_user_id
         WHERE ps.owner_user_id = $1
         ORDER BY ps.created_at DESC`,
        [ownerUserId],
      ),
      this.pool.query<{
        code: string;
        email: string;
        role: UserRole;
        share_owner_user_id: string | null;
        owner_email: string | null;
        owner_display_name: string | null;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
        used_at: string | null;
      }>(
        `SELECT i.code,
                i.email,
                i.role,
                i.share_owner_user_id,
                owner.email AS owner_email,
                owner.display_name AS owner_display_name,
                i.created_at::text AS created_at,
                i.expires_at::text AS expires_at,
                i.revoked_at::text AS revoked_at,
                i.used_at::text AS used_at
         FROM invites i
         LEFT JOIN users owner ON owner.id = i.share_owner_user_id
         WHERE i.share_owner_user_id = $1
         ORDER BY i.created_at DESC`,
        [ownerUserId],
      ),
    ]);

    const active = sharesResult.rows
      .filter((row) => row.revoked_at === null)
      .map((row) => mapShareGrantRow(row));
    const revokedShares = sharesResult.rows
      .filter((row) => row.revoked_at !== null)
      .map((row) => mapShareGrantRow(row));

    const pending: PendingShareInviteRecord[] = [];
    const expired: PendingShareInviteRecord[] = [];
    const revokedInvites: PendingShareInviteRecord[] = [];
    for (const row of invitesResult.rows) {
      if (row.used_at) continue;
      const invite = mapPendingShareInviteRow(row);
      if (row.revoked_at) {
        revokedInvites.push(invite);
      } else if (new Date(row.expires_at).getTime() <= Date.now()) {
        expired.push(invite);
      } else {
        pending.push(invite);
      }
    }

    return {
      active,
      pending,
      expired,
      revoked: [...revokedShares, ...revokedInvites].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    };
  }

  async listInboundSharesForGrantee(granteeUserId: string): Promise<ListInboundSharesForGranteeResult> {
    const sharesResult = await this.pool.query<{
      id: string;
      owner_user_id: string;
      owner_email: string | null;
      owner_display_name: string | null;
      grantee_user_id: string;
      grantee_email: string | null;
      grantee_display_name: string | null;
      created_at: string;
      revoked_at: string | null;
      revoked_by_user_id: string | null;
    }>(
      `SELECT ps.id,
              ps.owner_user_id,
              owner.email AS owner_email,
              owner.display_name AS owner_display_name,
              ps.grantee_user_id,
              grantee.email AS grantee_email,
              grantee.display_name AS grantee_display_name,
              ps.created_at::text AS created_at,
              ps.revoked_at::text AS revoked_at,
              ps.revoked_by_user_id
       FROM portfolio_shares ps
       JOIN users owner ON owner.id = ps.owner_user_id
       JOIN users grantee ON grantee.id = ps.grantee_user_id
       WHERE ps.grantee_user_id = $1
       ORDER BY ps.created_at DESC`,
      [granteeUserId],
    );

    return {
      active: sharesResult.rows.filter((row) => row.revoked_at === null).map((row) => mapShareGrantRow(row)),
      revoked: sharesResult.rows.filter((row) => row.revoked_at !== null).map((row) => mapShareGrantRow(row)),
    };
  }

  async validateActiveShare(ownerUserId: string, granteeUserId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM portfolio_shares
         WHERE owner_user_id = $1
           AND grantee_user_id = $2
           AND revoked_at IS NULL
       ) AS exists`,
      [ownerUserId, granteeUserId],
    );
    return result.rows[0]?.exists === true;
  }

  async revokePendingShareInvite(
    code: string,
    ownerUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const inviteResult = await client.query<{
        email: string;
        used_at: string | null;
        revoked_at: string | null;
      }>(
        `SELECT email,
                used_at::text AS used_at,
                revoked_at::text AS revoked_at
         FROM invites
         WHERE code = $1
           AND share_owner_user_id = $2
         FOR UPDATE`,
        [code, ownerUserId],
      );

      const invite = inviteResult.rows[0];
      if (!invite) {
        await client.query("ROLLBACK");
        throw routeError(404, "share_pending_not_found", "Pending share invite not found");
      }
      if (invite.used_at) {
        await client.query("ROLLBACK");
        throw routeError(409, "share_pending_already_used", "Pending share invite already used");
      }

      if (!invite.revoked_at) {
        const ownerResult = await client.query<{ email: string | null; display_name: string | null }>(
          `SELECT email, display_name
           FROM users
           WHERE id = $1`,
          [ownerUserId],
        );
        const owner = ownerResult.rows[0];
        if (!owner) {
          await client.query("ROLLBACK");
          throw routeError(404, "user_not_found", "User not found");
        }

        await client.query(
          `UPDATE invites
           SET revoked_at = NOW()
           WHERE code = $1`,
          [code],
        );
        await this.appendAuditLogTx(client, {
          ...auditInput,
          action: "admin_invite_revoked",
          metadata: {
            inviteCode: code,
            targetEmail: invite.email,
            shareCoupled: true,
            shareOwnerEmail: owner.email,
            shareOwnerDisplayName: owner.display_name,
          },
        });
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async materializePendingSharesForEmail(input: MaterializePendingSharesInput): Promise<ShareGrantRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const granteeResult = await client.query<{
        id: string;
        email: string | null;
        display_name: string | null;
        locale: LocaleCode;
      }>(
        `SELECT id, email, display_name, locale
         FROM users
         WHERE id = $1`,
        [input.userId],
      );
      const grantee = granteeResult.rows[0];
      if (!grantee) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const invitesResult = await client.query<{
        code: string;
        owner_user_id: string;
        owner_email: string | null;
        owner_display_name: string | null;
      }>(
        `SELECT i.code,
                i.share_owner_user_id AS owner_user_id,
                owner.email AS owner_email,
                owner.display_name AS owner_display_name
         FROM invites i
         JOIN users owner ON owner.id = i.share_owner_user_id
         WHERE i.email = $1
           AND i.share_owner_user_id IS NOT NULL
           AND i.used_at IS NULL
           AND i.revoked_at IS NULL
           AND i.expires_at > NOW()
         ORDER BY i.created_at ASC
         FOR UPDATE`,
        [normalizeEmail(input.email)],
      );

      const materialized: ShareGrantRecord[] = [];
      for (const invite of invitesResult.rows) {
        // Always mark the invite used — including the orphan-owner case below —
        // so subsequent logins don't retry materialization against a dangling row.
        await client.query(
          `UPDATE invites
           SET used_at = NOW()
           WHERE code = $1`,
          [invite.code],
        );

        // Owner was hard-purged (FK set to NULL). Share cannot materialize.
        // owner_email being null (legitimate user without email) is NOT a reason to skip.
        if (!invite.owner_user_id) {
          continue;
        }

        const inserted = await client.query<{
          id: string;
          owner_user_id: string;
          owner_email: string | null;
          owner_display_name: string | null;
          grantee_user_id: string;
          grantee_email: string | null;
          grantee_display_name: string | null;
          created_at: string;
          revoked_at: string | null;
          revoked_by_user_id: string | null;
        }>(
          `INSERT INTO portfolio_shares (id, owner_user_id, grantee_user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (owner_user_id, grantee_user_id) WHERE revoked_at IS NULL DO NOTHING
           RETURNING id,
                     owner_user_id,
                     $4::text AS owner_email,
                     $5::text AS owner_display_name,
                     grantee_user_id,
                     $6::text AS grantee_email,
                     $7::text AS grantee_display_name,
                     created_at::text AS created_at,
                     revoked_at::text AS revoked_at,
                     revoked_by_user_id`,
          [
            randomUUID(),
            invite.owner_user_id,
            input.userId,
            invite.owner_email,
            invite.owner_display_name,
            grantee.email,
            grantee.display_name,
          ],
        );

        const share = inserted.rows[0];
        if (!share) {
          continue;
        }

        await this.appendAuditLogTx(client, {
          ...input.auditInput,
          action: "share_granted",
          targetUserId: input.userId,
          metadata: buildShareAuditMetadata(
            share.id,
            {
              email: invite.owner_email,
              display_name: invite.owner_display_name,
            },
            grantee,
          ),
        });
        await this.createNotificationTx(
          client,
          buildShareGrantedNotification(
            share.id,
            {
              id: invite.owner_user_id,
              email: invite.owner_email,
              display_name: invite.owner_display_name,
            },
            input.userId,
            grantee.locale,
          ),
        );
        materialized.push(mapShareGrantRow(share));
      }

      await client.query("COMMIT");
      return materialized;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async createAnonymousShareToken(
    input: CreateAnonymousShareTokenInput,
  ): Promise<CreateAnonymousShareTokenResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Serialise cap-check + insert for this owner — race-safe against concurrent
      // POST /share-tokens calls that arrive simultaneously while at 19 active.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('anon_share:' || $1::text))`,
        [input.ownerUserId],
      );

      const ownerCheck = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`,
        [input.ownerUserId],
      );
      if (!ownerCheck.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM anonymous_share_tokens
         WHERE owner_user_id = $1
           AND revoked_at IS NULL
           AND expires_at > NOW()`,
        [input.ownerUserId],
      );
      const activeCount = Number(countResult.rows[0]?.count ?? "0");
      if (activeCount >= ANONYMOUS_SHARE_TOKEN_CAP) {
        await client.query("ROLLBACK");
        return { status: "cap_exceeded" };
      }

      let inserted: AnonymousShareTokenRecord;
      try {
        const insertResult = await client.query<{
          id: string;
          token: string;
          owner_user_id: string;
          created_at: string;
          expires_at: string;
          revoked_at: string | null;
          revoked_by_user_id: string | null;
        }>(
          `INSERT INTO anonymous_share_tokens (id, token, owner_user_id, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id,
                     token,
                     owner_user_id,
                     created_at::text AS created_at,
                     expires_at::text AS expires_at,
                     revoked_at::text AS revoked_at,
                     revoked_by_user_id`,
          [randomUUID(), input.token, input.ownerUserId, input.expiresAt],
        );
        inserted = mapAnonymousShareTokenRow(insertResult.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error)) {
          await client.query("ROLLBACK");
          return { status: "collision" };
        }
        throw error;
      }

      await this.appendAuditLogTx(client, {
        ...input.auditInput,
        action: "share_token_created",
        targetUserId: null,
        metadata: {
          ...(input.auditInput.metadata ?? {}),
          tokenId: inserted.id,
          expiresAt: inserted.expiresAt,
          ttlDays: input.ttlDays,
        },
      });

      await client.query("COMMIT");
      return { status: "ok", record: inserted };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listAnonymousShareTokensForOwner(ownerUserId: string): Promise<AnonymousShareTokenRecord[]> {
    const retentionCutoff = new Date(Date.now() - ANONYMOUS_SHARE_TOKEN_RETENTION_MS).toISOString();
    const result = await this.pool.query<{
      id: string;
      token: string;
      owner_user_id: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
      revoked_by_user_id: string | null;
    }>(
      `SELECT id,
              token,
              owner_user_id,
              created_at::text AS created_at,
              expires_at::text AS expires_at,
              revoked_at::text AS revoked_at,
              revoked_by_user_id
       FROM anonymous_share_tokens
       WHERE owner_user_id = $1
         AND (
           -- Not revoked + expired no more than 30 days ago (covers active tokens too,
           -- since NOW() > retention_cutoff always).
           (revoked_at IS NULL AND expires_at > $2::timestamptz)
           OR (revoked_at IS NOT NULL AND revoked_at > $2::timestamptz)
         )
       ORDER BY created_at DESC`,
      [ownerUserId, retentionCutoff],
    );
    return result.rows.map(mapAnonymousShareTokenRow);
  }

  async findActiveAnonymousShareTokenByToken(token: string): Promise<AnonymousShareTokenRecord | null> {
    const result = await this.pool.query<{
      id: string;
      token: string;
      owner_user_id: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
      revoked_by_user_id: string | null;
    }>(
      `SELECT id,
              token,
              owner_user_id,
              created_at::text AS created_at,
              expires_at::text AS expires_at,
              revoked_at::text AS revoked_at,
              revoked_by_user_id
       FROM anonymous_share_tokens
       WHERE token = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [token],
    );
    const row = result.rows[0];
    return row ? mapAnonymousShareTokenRow(row) : null;
  }

  async revokeAnonymousShareToken(
    input: RevokeAnonymousShareTokenInput,
  ): Promise<RevokeAnonymousShareTokenResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{
        id: string;
        owner_user_id: string;
        revoked_at: string | null;
        expires_at: string;
      }>(
        `SELECT id,
                owner_user_id,
                revoked_at::text AS revoked_at,
                expires_at::text AS expires_at
         FROM anonymous_share_tokens
         WHERE id = $1
         FOR UPDATE`,
        [input.id],
      );

      const row = existing.rows[0];
      if (!row || row.owner_user_id !== input.ownerUserId) {
        await client.query("ROLLBACK");
        return { status: "not_found" };
      }

      const isActive = row.revoked_at === null && new Date(row.expires_at).getTime() > Date.now();
      if (!isActive) {
        await client.query("ROLLBACK");
        return { status: "noop" };
      }

      const updated = await client.query<{
        id: string;
        token: string;
        owner_user_id: string;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
        revoked_by_user_id: string | null;
      }>(
        `UPDATE anonymous_share_tokens
         SET revoked_at = NOW(),
             revoked_by_user_id = $2
         WHERE id = $1
         RETURNING id,
                   token,
                   owner_user_id,
                   created_at::text AS created_at,
                   expires_at::text AS expires_at,
                   revoked_at::text AS revoked_at,
                   revoked_by_user_id`,
        [input.id, input.ownerUserId],
      );

      await this.appendAuditLogTx(client, {
        ...input.auditInput,
        action: "share_token_revoked",
        targetUserId: null,
        metadata: {
          ...(input.auditInput.metadata ?? {}),
          tokenId: row.id,
        },
      });

      await client.query("COMMIT");
      return { status: "revoked", record: mapAnonymousShareTokenRow(updated.rows[0]!) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async countActiveAnonymousShareTokensForOwner(ownerUserId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM anonymous_share_tokens
       WHERE owner_user_id = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [ownerUserId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async purgeTerminalAnonymousShareTokens(olderThanMs: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM anonymous_share_tokens
       WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 || ' milliseconds')::interval)
          OR (revoked_at IS NULL AND expires_at < NOW() - ($1 || ' milliseconds')::interval)`,
      [olderThanMs],
    );
    return result.rowCount ?? 0;
  }

  async loadStore(userId: string): Promise<Store> {
    await this.ensureDefaultPortfolioData(userId);
    // Batch 1: all queries with no inter-query dependencies
    const [
      userResult,
      accountsResult,
      feeProfilesResult,
      tradeEventsResult,
      lotAllocationsResult,
      dividendEventsResult,
      jobsResult,
      cashLedgerResult,
      symbolsResult,
    ] = await Promise.all([
      this.pool.query(
        `SELECT id, display_name, locale, cost_basis_method, quote_poll_interval_seconds
         FROM users
         WHERE id = $1`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, user_id, name, fee_profile_id
         FROM accounts
         WHERE user_id = $1
         ORDER BY id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps, minimum_commission_amount,
                commission_currency,
                commission_rounding_mode, tax_rounding_mode,
                stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, commission_charge_mode,
                etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps
         FROM fee_profiles
         WHERE user_id = $1
         ORDER BY id`,
        [userId],
      ),
      this.pool.query(
        `SELECT trade_event.id, trade_event.user_id, trade_event.account_id, trade_event.ticker,
                trade_event.market_code, trade_event.instrument_type, trade_event.trade_type, trade_event.quantity,
                trade_event.unit_price, trade_event.price_currency, trade_event.trade_date,
                trade_event.trade_timestamp, trade_event.booking_sequence, trade_event.commission_amount,
                trade_event.tax_amount, trade_event.is_day_trade, trade_event.fee_policy_snapshot_id, trade_event.source,
                trade_event.source_reference, trade_event.booked_at, trade_event.reversal_of_trade_event_id,
                snapshot.profile_id_at_booking, snapshot.profile_name_at_booking, snapshot.board_commission_rate,
                snapshot.commission_discount_percent, snapshot.minimum_commission_amount,
                snapshot.commission_currency, snapshot.commission_rounding_mode, snapshot.tax_rounding_mode,
                snapshot.stock_sell_tax_rate_bps, snapshot.stock_day_trade_tax_rate_bps,
                snapshot.etf_sell_tax_rate_bps, snapshot.bond_etf_sell_tax_rate_bps,
                snapshot.commission_charge_mode
         FROM trade_events AS trade_event
         JOIN trade_fee_policy_snapshots AS snapshot
           ON snapshot.id = trade_event.fee_policy_snapshot_id
         WHERE trade_event.user_id = $1
         ORDER BY trade_event.trade_date, trade_event.booking_sequence, trade_event.trade_timestamp, trade_event.booked_at, trade_event.id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, user_id, account_id, trade_event_id, ticker, lot_id, lot_opened_at,
                lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
         FROM lot_allocations
         WHERE user_id = $1
         ORDER BY trade_event_id, lot_opened_at, lot_opened_sequence, lot_id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, ticker, event_type, ex_dividend_date, payment_date,
                cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
                source, source_reference, ingested_at AS created_at,
                fiscal_year_period, announcement_date, total_distribution_shares
         FROM market_data.dividend_events
         ORDER BY ex_dividend_date, id`,
      ),
      this.pool.query(
        `SELECT id, user_id, account_id, profile_id, status, created_at
         FROM recompute_jobs
         WHERE user_id = $1
         ORDER BY created_at, id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, user_id, account_id, entry_date, entry_type, amount, currency,
                related_trade_event_id, related_dividend_ledger_entry_id, source,
                source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
                fx_rate_to_usd
         FROM cash_ledger_entries
         WHERE user_id = $1
         ORDER BY entry_date, booked_at, id`,
        [userId],
      ),
      this.pool.query(
        `SELECT ticker, instrument_type, market_code, is_provisional, last_synced_at
         FROM market_data.instruments
         ORDER BY market_code, ticker`,
      ),
    ]);

    // Extract IDs needed for Batch 2
    const feeProfileIds = feeProfilesResult.rows.map((row) => String(row.id));
    const feePolicySnapshotIds = tradeEventsResult.rows.map((row) => String(row.fee_policy_snapshot_id));
    const accountIds = accountsResult.rows.map((row) => row.id);
    const jobIds = jobsResult.rows.map((row) => row.id);

    // Batch 2: queries that depend on IDs from Batch 1
    const [
      feeProfileTaxRulesResult,
      snapshotTaxComponentsResult,
      bindingsResult,
      lotsResult,
      actionsResult,
      dividendLedgerEntriesResult,
      jobItemsResult,
    ] = await Promise.all([
      feeProfileIds.length
        ? this.pool.query(
            `SELECT id, fee_profile_id, market_code, trade_side, instrument_type, day_trade_scope,
                    tax_component_code, calculation_method, rate_bps, effective_from, effective_to, sort_order
             FROM fee_profile_tax_rules
             WHERE fee_profile_id = ANY($1)
             ORDER BY fee_profile_id, sort_order, id`,
            [feeProfileIds],
          )
        : Promise.resolve({ rows: [] }),
      feePolicySnapshotIds.length
        ? this.pool.query(
            `SELECT id, snapshot_id, market_code, trade_side, instrument_type, day_trade_scope,
                    tax_component_code, calculation_method, rate_bps, booked_tax_amount, sort_order
             FROM trade_fee_policy_snapshot_tax_components
             WHERE snapshot_id = ANY($1)
             ORDER BY snapshot_id, sort_order, id`,
            [feePolicySnapshotIds],
          )
        : Promise.resolve({ rows: [] }),
      accountIds.length
        ? this.pool.query(
            `SELECT account_id, ticker, market_code, fee_profile_id
             FROM account_fee_profile_overrides
             WHERE account_id = ANY($1)
             ORDER BY account_id, market_code, ticker`,
            [accountIds],
          )
        : Promise.resolve({ rows: [] }),
      accountIds.length
        ? this.pool.query(
            `SELECT id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
             FROM lots
             WHERE account_id = ANY($1)
             ORDER BY opened_at, opened_sequence, id`,
            [accountIds],
          )
        : Promise.resolve({ rows: [] }),
      accountIds.length
        ? this.pool.query(
            `SELECT id, account_id, ticker, action_type, numerator, denominator, action_date
             FROM corporate_actions
             WHERE account_id = ANY($1)
             ORDER BY action_date, id`,
            [accountIds],
          )
        : Promise.resolve({ rows: [] }),
      accountIds.length
        ? this.pool.query(
            `SELECT id, account_id, dividend_event_id, eligible_quantity,
                    expected_cash_amount, expected_stock_quantity,
                    received_stock_quantity,
                    posting_status, reconciliation_status, version,
                    source_composition_status, reconciliation_note, booked_at,
                    reversal_of_dividend_ledger_entry_id, superseded_at
             FROM dividend_ledger_entries
             WHERE account_id = ANY($1)
             ORDER BY booked_at, id`,
            [accountIds],
          )
        : Promise.resolve({ rows: [] }),
      jobIds.length
        ? this.pool.query(
            `SELECT id, job_id, trade_event_id, previous_commission_amount, previous_tax_amount,
                    next_commission_amount, next_tax_amount
             FROM recompute_job_items
             WHERE job_id = ANY($1)
             ORDER BY id`,
            [jobIds],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    // Batch 3: queries that depend on IDs from Batch 2
    const dividendLedgerEntryIds = dividendLedgerEntriesResult.rows.map((row) => row.id);
    const [dividendDeductionsResult, dividendSourceLinesResult] = dividendLedgerEntryIds.length
      ? await Promise.all([
          this.pool.query(
            `SELECT id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
                    withheld_at_source, source, source_reference, note, booked_at
             FROM dividend_deduction_entries
             WHERE dividend_ledger_entry_id = ANY($1)
             ORDER BY dividend_ledger_entry_id, booked_at, id`,
            [dividendLedgerEntryIds],
          ),
          this.pool.query(
            `SELECT id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
                    source, source_reference, note, booked_at
             FROM dividend_source_lines
             WHERE dividend_ledger_entry_id = ANY($1)
             ORDER BY dividend_ledger_entry_id, booked_at, id`,
            [dividendLedgerEntryIds],
          ),
        ])
      : [{ rows: [] }, { rows: [] }];

    const feeProfileTaxRulesByProfileId = groupRowsByKey(feeProfileTaxRulesResult.rows, "fee_profile_id");
    const snapshotTaxComponentsBySnapshotId = groupRowsByKey(snapshotTaxComponentsResult.rows, "snapshot_id");

    const feeProfiles: FeeProfile[] = feeProfilesResult.rows.map((row) =>
      hydrateEditableFeeProfile(row, feeProfileTaxRulesByProfileId.get(String(row.id)) ?? []),
    );

    const lotAllocations: LotAllocationProjection[] = lotAllocationsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      tradeEventId: row.trade_event_id,
      ticker: row.ticker,
      lotId: row.lot_id,
      lotOpenedAt: normalizeDate(row.lot_opened_at),
      lotOpenedSequence: row.lot_opened_sequence,
      allocatedQuantity: row.allocated_quantity,
      allocatedCostAmount: Number(row.allocated_cost_amount),
      costCurrency: row.cost_currency,
      createdAt: normalizeDateTime(row.created_at),
    }));

    const tradeEvents: Transaction[] = tradeEventsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      ticker: row.ticker,
      marketCode: row.market_code,
      instrumentType: row.instrument_type,
      type: row.trade_type,
      quantity: row.quantity,
      unitPrice: Number(row.unit_price),
      priceCurrency: row.price_currency,
      tradeDate: normalizeDate(row.trade_date),
      tradeTimestamp: normalizeDateTime(row.trade_timestamp),
      bookingSequence: row.booking_sequence,
      commissionAmount: row.commission_amount,
      taxAmount: row.tax_amount,
      isDayTrade: row.is_day_trade,
      feeSnapshot: hydrateTradeFeeSnapshot(
        row,
        snapshotTaxComponentsBySnapshotId.get(String(row.fee_policy_snapshot_id)) ?? [],
      ),
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
      realizedPnlCurrency: row.price_currency,
      reversalOfTradeEventId: row.reversal_of_trade_event_id ?? undefined,
    }));

    const cashLedgerEntries: CashLedgerEntry[] = cashLedgerResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      entryDate: normalizeDate(row.entry_date),
      entryType: row.entry_type,
      amount: Number(row.amount),
      currency: row.currency,
      relatedTradeEventId: row.related_trade_event_id ?? undefined,
      relatedDividendLedgerEntryId: row.related_dividend_ledger_entry_id ?? undefined,
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
      fxRateToUsd: row.fx_rate_to_usd != null ? Number(row.fx_rate_to_usd) : null,
    }));

    const dividendEvents: DividendEvent[] = dividendEventsResult.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      eventType: row.event_type,
      exDividendDate: normalizeDate(row.ex_dividend_date),
      paymentDate: normalizeDate(row.payment_date),
      cashDividendPerShare: Number(row.cash_dividend_per_share),
      cashDividendCurrency: row.cash_dividend_currency,
      stockDividendPerShare: Number(row.stock_dividend_per_share),
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      createdAt: normalizeDateTime(row.created_at),
      fiscalYearPeriod: row.fiscal_year_period ?? undefined,
      announcementDate: row.announcement_date ? normalizeDate(row.announcement_date) : undefined,
      totalDistributionShares: row.total_distribution_shares != null ? Number(row.total_distribution_shares) : undefined,
    }));

    const dividendDeductionEntries: DividendDeductionEntry[] = dividendDeductionsResult.rows.map((row) => ({
      id: row.id,
      dividendLedgerEntryId: row.dividend_ledger_entry_id,
      deductionType: row.deduction_type,
      amount: Number(row.amount),
      currencyCode: row.currency_code,
      withheldAtSource: row.withheld_at_source,
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const dividendSourceLines: DividendSourceLine[] = dividendSourceLinesResult.rows.map((row) => ({
      id: row.id,
      dividendLedgerEntryId: row.dividend_ledger_entry_id,
      sourceBucket: row.source_bucket,
      amount: Number(row.amount),
      currencyCode: row.currency_code,
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const receivedCashAmountByDividendLedgerId = new Map<string, number>();
    for (const entry of cashLedgerEntries) {
      if (entry.entryType !== "DIVIDEND_RECEIPT" || !entry.relatedDividendLedgerEntryId) {
        continue;
      }

      receivedCashAmountByDividendLedgerId.set(
        entry.relatedDividendLedgerEntryId,
        (receivedCashAmountByDividendLedgerId.get(entry.relatedDividendLedgerEntryId) ?? 0) + entry.amount,
      );
    }

    const dividendLedgerEntries: DividendLedgerEntry[] = dividendLedgerEntriesResult.rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      dividendEventId: row.dividend_event_id,
      eligibleQuantity: Number(row.eligible_quantity),
      expectedCashAmount: Number(row.expected_cash_amount),
      expectedStockQuantity: Number(row.expected_stock_quantity),
      receivedCashAmount: receivedCashAmountByDividendLedgerId.get(row.id) ?? 0,
      receivedStockQuantity: Number(row.received_stock_quantity),
      postingStatus: row.posting_status,
      reconciliationStatus: row.reconciliation_status,
      version: Number(row.version ?? 1),
      sourceCompositionStatus: row.source_composition_status ?? "unknown_pending_disclosure",
      reconciliationNote: row.reconciliation_note ?? undefined,
      reversalOfDividendLedgerEntryId: row.reversal_of_dividend_ledger_entry_id ?? undefined,
      supersededAt: row.superseded_at ? normalizeDateTime(row.superseded_at) : undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const recomputeItems = new Map<string, RecomputePreviewItem[]>();
    for (const item of jobItemsResult.rows) {
      const list = recomputeItems.get(item.job_id) ?? [];
      list.push({
        tradeEventId: item.trade_event_id,
        previousCommissionAmount: item.previous_commission_amount,
        previousTaxAmount: item.previous_tax_amount,
        nextCommissionAmount: item.next_commission_amount,
        nextTaxAmount: item.next_tax_amount,
      });
      recomputeItems.set(item.job_id, list);
    }

    const recomputeJobs: RecomputeJob[] = jobsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id ?? undefined,
      profileId: row.profile_id,
      status: row.status,
      createdAt: normalizeDateTime(row.created_at),
      items: recomputeItems.get(row.id) ?? [],
    }));
    const instruments = symbolsResult.rows.map((row) => ({
      ticker: row.ticker,
      instrumentType: row.instrument_type,
      marketCode: row.market_code ?? "TW",
      isProvisional: row.is_provisional,
      lastSyncedAt: row.last_synced_at ? normalizeDateTime(row.last_synced_at) : null,
    }));

    const store: Store = {
      userId,
      settings: {
        userId,
        displayName: userResult.rows[0].display_name ?? null,
        locale: userResult.rows[0].locale,
        costBasisMethod: userResult.rows[0].cost_basis_method,
        quotePollIntervalSeconds: userResult.rows[0].quote_poll_interval_seconds,
      },
      accounts: accountsResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        feeProfileId: row.fee_profile_id,
      })),
      feeProfileBindings: bindingsResult.rows.map((row) => ({
        accountId: row.account_id,
        ticker: row.ticker,
        marketCode: row.market_code,
        feeProfileId: row.fee_profile_id,
      })),
      feeProfiles,
      accounting: {
        facts: {
          tradeEvents,
          cashLedgerEntries,
          dividendLedgerEntries,
          dividendDeductionEntries,
          dividendSourceLines,
          corporateActions: actionsResult.rows.map((row) => ({
            id: row.id,
            accountId: row.account_id,
            ticker: row.ticker,
            actionType: row.action_type,
            numerator: row.numerator,
            denominator: row.denominator,
            actionDate: normalizeDate(row.action_date),
          })),
        },
        projections: {
          lots: lotsResult.rows.map((row) => ({
            id: row.id,
            accountId: row.account_id,
            ticker: row.ticker,
            openQuantity: row.open_quantity,
            totalCostAmount: Number(row.total_cost_amount),
            costCurrency: row.cost_currency,
            openedAt: normalizeDate(row.opened_at),
            openedSequence: row.opened_sequence,
          })),
          lotAllocations,
          holdings: [],
          dailyPortfolioSnapshots: [],
        },
        policy: buildAccountingPolicy(),
      },
      marketData: {
        dividendEvents,
        instruments,
      },
      instruments: instruments.map(instrumentRefToDef),
      recomputeJobs,
      idempotencyKeys: new Set<string>(),
    };
    syncTradeEventRealizedPnl(store.accounting);
    rebuildHoldingProjection(store);
    return store;
  }

  async loadAccountingStore(userId: string): Promise<AccountingStore> {
    const store = await this.loadStore(userId);
    return store.accounting;
  }

  async saveStore(store: Store): Promise<void> {
    validateStoreInvariants(store);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE users
         SET locale = $2,
             cost_basis_method = $3,
             quote_poll_interval_seconds = $4
         WHERE id = $1`,
        [
          store.userId,
          store.settings.locale,
          store.settings.costBasisMethod,
          store.settings.quotePollIntervalSeconds,
        ],
      );

      const feeProfileIds = store.feeProfiles.map((item) => item.id);

      for (const profile of store.feeProfiles) {
        const upsertProfile = await client.query(
          `INSERT INTO fee_profiles (
             id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
             minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
             stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps, commission_charge_mode
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11,
             $12, $13, $14,
             $15, $16
           )
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             commission_rate_bps = EXCLUDED.commission_rate_bps,
             board_commission_rate = EXCLUDED.board_commission_rate,
             commission_discount_percent = EXCLUDED.commission_discount_percent,
             commission_discount_bps = EXCLUDED.commission_discount_bps,
             minimum_commission_amount = EXCLUDED.minimum_commission_amount,
             commission_currency = EXCLUDED.commission_currency,
             commission_rounding_mode = EXCLUDED.commission_rounding_mode,
             tax_rounding_mode = EXCLUDED.tax_rounding_mode,
             stock_sell_tax_rate_bps = EXCLUDED.stock_sell_tax_rate_bps,
             stock_day_trade_tax_rate_bps = EXCLUDED.stock_day_trade_tax_rate_bps,
             etf_sell_tax_rate_bps = EXCLUDED.etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps = EXCLUDED.bond_etf_sell_tax_rate_bps,
             commission_charge_mode = EXCLUDED.commission_charge_mode
           WHERE fee_profiles.user_id = EXCLUDED.user_id`,
          [
            profile.id,
            store.userId,
            profile.name,
            legacyCommissionRateBps(profile.boardCommissionRate),
            profile.boardCommissionRate,
            profile.commissionDiscountPercent,
            legacyCommissionDiscountBps(profile.commissionDiscountPercent),
            profile.minimumCommissionAmount,
            profile.commissionCurrency,
            profile.commissionRoundingMode,
            profile.taxRoundingMode,
            profile.stockSellTaxRateBps,
            profile.stockDayTradeTaxRateBps,
            profile.etfSellTaxRateBps,
            profile.bondEtfSellTaxRateBps,
            profile.commissionChargeMode,
          ],
        );

        if (upsertProfile.rowCount !== 1) {
          throw new Error(`Fee profile id conflict for id=${profile.id}`);
        }

        await replaceFeeProfileTaxRules(client, store.userId, profile);
      }

      const accountIds = store.accounts.map((item) => item.id);
      if (accountIds.length) {
        await client.query(
          `DELETE FROM accounts
           WHERE user_id = $1
             AND id <> ALL($2)`,
          [store.userId, accountIds],
        );
      }

      for (const account of store.accounts) {
        const upsertAccount = await client.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             fee_profile_id = EXCLUDED.fee_profile_id
           WHERE accounts.user_id = EXCLUDED.user_id`,
          [account.id, account.userId, account.name, account.feeProfileId],
        );

        if (upsertAccount.rowCount !== 1) {
          throw new Error(`Account id conflict for id=${account.id}`);
        }
      }

      if (accountIds.length) {
        await client.query(`DELETE FROM account_fee_profile_overrides WHERE account_id = ANY($1)`, [accountIds]);
        for (const binding of store.feeProfileBindings) {
          await client.query(
            `INSERT INTO account_fee_profile_overrides (account_id, ticker, market_code, fee_profile_id)
             VALUES ($1, $2, $3, $4)`,
            [binding.accountId, binding.ticker, binding.marketCode ?? "TW", binding.feeProfileId],
          );
        }
      }

      await client.query(
        `DELETE FROM recompute_job_items
         WHERE job_id IN (
           SELECT id FROM recompute_jobs WHERE user_id = $1
         )`,
        [store.userId],
      );
      await client.query(`DELETE FROM recompute_jobs WHERE user_id = $1`, [store.userId]);
      await this.saveMarketDataTx(client, store.marketData);
      await this.saveAccountingStoreTx(client, store.userId, store.accounting, accountIds);

      if (feeProfileIds.length) {
        await client.query(
          `DELETE FROM fee_profiles
           WHERE user_id = $1
             AND id <> ALL($2)`,
          [store.userId, feeProfileIds],
        );
      } else {
        await client.query(`DELETE FROM fee_profiles WHERE user_id = $1`, [store.userId]);
      }

      for (const job of store.recomputeJobs) {
        await client.query(
          `INSERT INTO recompute_jobs (id, user_id, account_id, profile_id, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [job.id, job.userId, job.accountId ?? null, job.profileId, job.status, job.createdAt],
        );

        for (const item of job.items) {
          await client.query(
            `INSERT INTO recompute_job_items (
               id, job_id, trade_event_id, previous_commission_amount, previous_tax_amount,
               next_commission_amount, next_tax_amount
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              `${job.id}:${item.tradeEventId}`,
              job.id,
              item.tradeEventId,
              item.previousCommissionAmount,
              item.previousTaxAmount,
              item.nextCommissionAmount,
              item.nextTaxAmount,
            ],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertInstruments(_userId: string, instruments: InstrumentDef[]): Promise<void> {
    if (instruments.length === 0) return;
    await this.upsertInstrumentDefinitions(instruments);
  }

  async claimIdempotencyKey(userId: string, key: string): Promise<boolean> {
    const redisKey = `idempotency:${userId}:${key}`;
    const result = await this.redis.set(redisKey, "1", { EX: 86_400, NX: true });
    return result === "OK";
  }

  async releaseIdempotencyKey(userId: string, key: string): Promise<void> {
    await this.redis.del(`idempotency:${userId}:${key}`);
  }

  async getLatestBars(tickers: string[], limit: number): Promise<DailyBar[]> {
    if (tickers.length === 0) return [];
    const result = await this.pool.query<{
      ticker: string; bar_date: string; open: string; high: string; low: string;
      close: string; volume: string; source: string; ingested_at: string;
    }>(
      `WITH ranked AS (
         SELECT ticker, bar_date, open, high, low, close, volume, source, ingested_at,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY bar_date DESC) AS rn
         FROM market_data.daily_bars
         WHERE ticker = ANY($1)
       )
       SELECT ticker, bar_date::text, open, high, low, close, volume, source, ingested_at::text
       FROM ranked WHERE rn <= $2
       ORDER BY ticker, bar_date DESC`,
      [tickers, limit],
    );
    return result.rows.map(row => ({
      ticker: row.ticker,
      barDate: row.bar_date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      source: row.source,
      ingestedAt: row.ingested_at,
    }));
  }

  async getDailyBarsForTicker(ticker: string, startDate: string, endDate: string): Promise<DailyBar[]> {
    const result = await this.pool.query<{
      ticker: string; bar_date: string; open: string; high: string; low: string;
      close: string; volume: string; source: string; ingested_at: string;
    }>(
      `SELECT ticker, bar_date::text, open, high, low, close, volume, source, ingested_at::text
       FROM market_data.daily_bars
       WHERE ticker = $1 AND bar_date >= $2::date AND bar_date <= $3::date
       ORDER BY bar_date ASC`,
      [ticker, startDate, endDate],
    );
    return result.rows.map(row => ({
      ticker: row.ticker,
      barDate: row.bar_date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      source: row.source,
      ingestedAt: row.ingested_at,
    }));
  }

  async getDailyBarsForTickers(tickers: string[], startDate: string, endDate: string): Promise<Map<string, DailyBar[]>> {
    const result = new Map<string, DailyBar[]>();
    for (const t of tickers) result.set(t, []);
    if (tickers.length === 0) return result;
    const rows = await this.pool.query<{
      ticker: string; bar_date: string; open: string; high: string; low: string;
      close: string; volume: string; source: string; ingested_at: string;
    }>(
      `SELECT ticker, bar_date::text, open, high, low, close, volume, source, ingested_at::text
       FROM market_data.daily_bars
       WHERE ticker = ANY($1::text[]) AND bar_date >= $2::date AND bar_date <= $3::date
       ORDER BY ticker ASC, bar_date ASC`,
      [tickers, startDate, endDate],
    );
    for (const row of rows.rows) {
      const list = result.get(row.ticker) ?? [];
      list.push({
        ticker: row.ticker,
        barDate: row.bar_date,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        source: row.source,
        ingestedAt: row.ingested_at,
      });
      result.set(row.ticker, list);
    }
    return result;
  }

  // KZO-164: FX rates (Frankfurter v2 ingestion). Mirrors the `unnest`-arrays bulk upsert
  // pattern from `services/market-data/upserts.ts:upsertDailyBars`. The `source` field is
  // column-aligned with NO fallback — provider always stamps `'frankfurter'`. Caller
  // (worker) MUST filter self-pairs before calling: schema CHECK rejects them and would
  // crash the entire batch.
  async upsertFxRates(rates: ReadonlyArray<FxRate>): Promise<number> {
    if (rates.length === 0) return 0;

    const dates: string[] = [];
    const bases: string[] = [];
    const quotes: string[] = [];
    const rateValues: number[] = [];
    const sources: string[] = [];
    for (const r of rates) {
      dates.push(r.date);
      bases.push(r.baseCurrency);
      quotes.push(r.quoteCurrency);
      rateValues.push(r.rate);
      sources.push(r.source);
    }

    const result = await this.pool.query(
      `INSERT INTO market_data.fx_rates (date, base_currency, quote_currency, rate, source, ingested_at)
       SELECT * FROM unnest(
         $1::date[], $2::text[], $3::text[], $4::numeric[], $5::text[],
         array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$6::int])
       )
       ON CONFLICT (date, base_currency, quote_currency) DO UPDATE SET
         rate = EXCLUDED.rate,
         source = EXCLUDED.source,
         ingested_at = EXCLUDED.ingested_at`,
      [dates, bases, quotes, rateValues, sources, rates.length],
    );
    return result.rowCount ?? 0;
  }

  async getLatestFxRateDate(): Promise<string | null> {
    const result = await this.pool.query<{ max: string | null }>(
      `SELECT MAX(date)::text AS max FROM market_data.fx_rates`,
    );
    return result.rows[0]?.max ?? null;
  }

  async getFxRateFreshness(): Promise<Array<{ baseCurrency: string; quoteCurrency: string; latestDate: string }>> {
    const result = await this.pool.query<{ base_currency: string; quote_currency: string; latest_date: string }>(
      `SELECT base_currency, quote_currency, MAX(date)::text AS latest_date
       FROM market_data.fx_rates
       GROUP BY base_currency, quote_currency
       ORDER BY base_currency ASC, quote_currency ASC`,
    );
    return result.rows.map((row) => ({
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      latestDate: row.latest_date,
    }));
  }

  async getFxRate(base: string, quote: string, asOfDate: string): Promise<number | null> {
    if (base === quote) return 1.0;
    const result = await this.pool.query<{ rate: string }>(
      `SELECT rate::text
       FROM market_data.fx_rates
       WHERE base_currency = $1 AND quote_currency = $2 AND date <= $3
       ORDER BY date DESC
       LIMIT 1`,
      [base, quote, asOfDate],
    );
    if (result.rows.length === 0) return null;
    return Number(result.rows[0].rate);
  }

  async getCashLedgerEntriesForWalletReplay(
    userId: string,
  ): Promise<import("./types.js").CashLedgerEntryForWalletReplay[]> {
    const result = await this.pool.query<{
      id: string;
      account_id: string;
      currency: string;
      entry_date: string;
      amount: string;
      fx_rate_to_usd: string | null;
      entry_type: string;
      reversal_of_cash_ledger_entry_id: string | null;
      booked_at: string | null;
    }>(
      `SELECT id, account_id, currency, entry_date::text, amount::text,
              fx_rate_to_usd::text, entry_type, reversal_of_cash_ledger_entry_id, booked_at
       FROM cash_ledger_entries c
       WHERE user_id = $1
         AND reversal_of_cash_ledger_entry_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM cash_ledger_entries r
           WHERE r.user_id = c.user_id
             AND r.reversal_of_cash_ledger_entry_id = c.id
         )
       ORDER BY entry_date ASC, booked_at ASC, id ASC`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      currency: row.currency,
      entryDate: row.entry_date,
      amount: Number(row.amount),
      fxRateToUsd: row.fx_rate_to_usd != null ? Number(row.fx_rate_to_usd) : null,
      entryType: row.entry_type as import("../types/store.js").CashLedgerEntryType,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      bookedAt: row.booked_at ?? undefined,
    }));
  }

  async getSnapshotGenerationInputs(
    userId: string,
    scope?: { accountId: string; ticker: string },
  ): Promise<import("./types.js").SnapshotGenerationInputs> {
    const tradeFilter = scope
      ? "user_id = $1 AND account_id = $2 AND ticker = $3"
      : "user_id = $1";
    const tradeParams = scope ? [userId, scope.accountId, scope.ticker] : [userId];
    const tradesResult = await this.pool.query<{
      id: string; account_id: string; ticker: string; trade_type: string;
      quantity: string; unit_price: string; trade_date: string;
      booking_sequence: number | null; commission_amount: string; tax_amount: string;
      price_currency: string;
    }>(
      `SELECT id, account_id, ticker, trade_type, quantity, unit_price, trade_date::text,
              booking_sequence, commission_amount, tax_amount, price_currency
       FROM trade_events
       WHERE ${tradeFilter}
       ORDER BY trade_date ASC, booking_sequence ASC, id ASC`,
      tradeParams,
    );

    // Dividends: join ledger entries to events so we can scope by ticker.
    // - tenant scoping via accounts.user_id (dividend_ledger_entries has no user_id column)
    // - dividend_events lives in the market_data schema (migration 018)
    // - received_cash_amount was dropped from dividend_ledger_entries in migration 010;
    //   the authoritative value is the sum of cash_ledger_entries with
    //   entry_type='DIVIDEND_RECEIPT' linked via related_dividend_ledger_entry_id.
    const divFilter = scope
      ? "account.user_id = $1 AND dle.account_id = $2 AND de.ticker = $3"
      : "account.user_id = $1";
    const divParams = scope ? [userId, scope.accountId, scope.ticker] : [userId];
    const divResult = await this.pool.query<{
      account_id: string; ticker: string; payment_date: string; amount: string;
    }>(
      `SELECT dle.account_id,
              de.ticker,
              de.payment_date::text,
              COALESCE(receipts.received_cash_amount, 0)::text AS amount
       FROM dividend_ledger_entries dle
       JOIN accounts AS account ON account.id = dle.account_id
       JOIN market_data.dividend_events de ON de.id = dle.dividend_event_id
       LEFT JOIN (
         SELECT related_dividend_ledger_entry_id,
                SUM(amount) AS received_cash_amount
         FROM cash_ledger_entries
         WHERE user_id = $1 AND entry_type = 'DIVIDEND_RECEIPT'
         GROUP BY related_dividend_ledger_entry_id
       ) AS receipts ON receipts.related_dividend_ledger_entry_id = dle.id
       WHERE ${divFilter}
         AND dle.posting_status = 'posted'
         AND dle.reversal_of_dividend_ledger_entry_id IS NULL
         AND dle.superseded_at IS NULL
         AND de.payment_date IS NOT NULL
       ORDER BY de.payment_date ASC`,
      divParams,
    );

    return {
      trades: tradesResult.rows.map(row => ({
        id: row.id,
        accountId: row.account_id,
        ticker: row.ticker,
        type: row.trade_type as "BUY" | "SELL",
        quantity: Number(row.quantity),
        unitPrice: Number(row.unit_price),
        tradeDate: row.trade_date,
        bookingSequence: row.booking_sequence ?? undefined,
        commissionAmount: Number(row.commission_amount),
        taxAmount: Number(row.tax_amount),
        priceCurrency: row.price_currency,
      })),
      postedDividends: divResult.rows.map(r => ({
        accountId: r.account_id,
        ticker: r.ticker,
        paymentDate: r.payment_date,
        amount: Number(r.amount),
      })),
    };
  }

  async bulkUpsertHoldingSnapshots(_userId: string, snapshots: HoldingSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Build a single multi-row INSERT with unnest-style arrays. Each column
      // becomes a parallel array; Postgres expands them into rows server-side.
      await client.query(
        `INSERT INTO daily_holding_snapshots (
           id, user_id, account_id, ticker, snapshot_date, quantity,
           close_price, market_value, cost_basis, unrealized_pnl,
           cumulative_realized_pnl, cumulative_dividends,
           is_provisional, currency, generated_at, generation_run_id,
           value_native, cost_basis_native, unrealized_pnl_native, provider_source
         )
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::date[], $6::numeric[],
           $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[],
           $11::numeric[], $12::numeric[],
           $13::boolean[], $14::text[], $15::timestamptz[], $16::text[],
           $17::numeric[], $18::numeric[], $19::numeric[], $20::text[]
         )
         ON CONFLICT (user_id, account_id, ticker, snapshot_date) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           close_price = EXCLUDED.close_price,
           market_value = EXCLUDED.market_value,
           cost_basis = EXCLUDED.cost_basis,
           unrealized_pnl = EXCLUDED.unrealized_pnl,
           cumulative_realized_pnl = EXCLUDED.cumulative_realized_pnl,
           cumulative_dividends = EXCLUDED.cumulative_dividends,
           is_provisional = EXCLUDED.is_provisional,
           currency = EXCLUDED.currency,
           generated_at = EXCLUDED.generated_at,
           generation_run_id = EXCLUDED.generation_run_id,
           value_native = EXCLUDED.value_native,
           cost_basis_native = EXCLUDED.cost_basis_native,
           unrealized_pnl_native = EXCLUDED.unrealized_pnl_native,
           provider_source = EXCLUDED.provider_source`,
        [
          snapshots.map(s => s.id),
          snapshots.map(s => s.userId),
          snapshots.map(s => s.accountId),
          snapshots.map(s => s.ticker),
          snapshots.map(s => s.snapshotDate),
          snapshots.map(s => s.quantity),
          snapshots.map(s => s.closePrice),
          snapshots.map(s => s.marketValue),
          snapshots.map(s => s.costBasis),
          snapshots.map(s => s.unrealizedPnl),
          snapshots.map(s => s.cumulativeRealizedPnl),
          snapshots.map(s => s.cumulativeDividends),
          snapshots.map(s => s.isProvisional),
          snapshots.map(s => s.currency),
          snapshots.map(s => s.generatedAt),
          snapshots.map(s => s.generationRunId),
          snapshots.map(s => s.valueNative),
          snapshots.map(s => s.costBasisNative),
          snapshots.map(s => s.unrealizedPnlNative),
          snapshots.map(s => s.providerSource),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteHoldingSnapshotsForTicker(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM daily_holding_snapshots
       WHERE user_id = $1 AND account_id = $2 AND ticker = $3 AND snapshot_date >= $4::date`,
      [userId, accountId, ticker, fromDate],
    );
    return result.rowCount ?? 0;
  }

  async deleteAllHoldingSnapshots(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM daily_holding_snapshots WHERE user_id = $1`, [userId]);
  }

  async getAggregatedSnapshots(userId: string, startDate: string, endDate: string): Promise<AggregatedSnapshotPoint[]> {
    const result = await this.pool.query<{
      snapshot_date: string;
      total_cost_basis: string;
      total_market_value: string | null;
      total_unrealized_pnl: string | null;
      cumulative_realized_pnl: string;
      cumulative_dividends: string;
      is_provisional: boolean;
    }>(
      `SELECT
         snapshot_date::text,
         SUM(cost_basis) AS total_cost_basis,
         CASE WHEN bool_or(is_provisional) THEN NULL ELSE SUM(market_value) END AS total_market_value,
         CASE WHEN bool_or(is_provisional) THEN NULL ELSE SUM(unrealized_pnl) END AS total_unrealized_pnl,
         SUM(cumulative_realized_pnl) AS cumulative_realized_pnl,
         SUM(cumulative_dividends) AS cumulative_dividends,
         bool_or(is_provisional) AS is_provisional
       FROM daily_holding_snapshots
       WHERE user_id = $1 AND snapshot_date >= $2::date AND snapshot_date <= $3::date
       GROUP BY snapshot_date
       ORDER BY snapshot_date ASC`,
      [userId, startDate, endDate],
    );
    return result.rows.map(row => {
      const totalCostBasis = Number(row.total_cost_basis);
      const totalMarketValue = row.total_market_value !== null ? Number(row.total_market_value) : null;
      const cumulativeRealizedPnl = Number(row.cumulative_realized_pnl);
      const cumulativeDividends = Number(row.cumulative_dividends);
      const totalReturnAmount = totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;
      return {
        date: row.snapshot_date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl: row.total_unrealized_pnl !== null ? Number(row.total_unrealized_pnl) : null,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional: row.is_provisional,
      };
    });
  }

  async countHoldingSnapshotsAfterDate(userId: string, accountId: string, ticker: string, fromDate: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM daily_holding_snapshots
       WHERE user_id = $1 AND account_id = $2 AND ticker = $3 AND snapshot_date >= $4::date`,
      [userId, accountId, ticker, fromDate],
    );
    return Number(result.rows[0].count);
  }

  async getHoldingSnapshotsForTicker(
    userId: string, accountId: string, ticker: string, startDate: string, endDate: string,
  ): Promise<HoldingSnapshot[]> {
    const result = await this.pool.query<{
      id: string; user_id: string; account_id: string; ticker: string; snapshot_date: string;
      quantity: string; close_price: string | null; market_value: string | null; cost_basis: string;
      unrealized_pnl: string | null; cumulative_realized_pnl: string; cumulative_dividends: string;
      is_provisional: boolean; currency: string; generated_at: string; generation_run_id: string;
      value_native: string | null; cost_basis_native: string | null;
      unrealized_pnl_native: string | null; provider_source: string | null;
    }>(
      `SELECT id, user_id, account_id, ticker, snapshot_date::text,
              quantity, close_price, market_value, cost_basis,
              unrealized_pnl, cumulative_realized_pnl, cumulative_dividends,
              is_provisional, currency, generated_at::text, generation_run_id,
              value_native, cost_basis_native, unrealized_pnl_native, provider_source
       FROM daily_holding_snapshots
       WHERE user_id = $1 AND account_id = $2 AND ticker = $3
         AND snapshot_date >= $4::date AND snapshot_date <= $5::date
       ORDER BY snapshot_date ASC`,
      [userId, accountId, ticker, startDate, endDate],
    );
    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      ticker: row.ticker,
      snapshotDate: row.snapshot_date,
      quantity: Number(row.quantity),
      closePrice: row.close_price !== null ? Number(row.close_price) : null,
      marketValue: row.market_value !== null ? Number(row.market_value) : null,
      costBasis: Number(row.cost_basis),
      unrealizedPnl: row.unrealized_pnl !== null ? Number(row.unrealized_pnl) : null,
      cumulativeRealizedPnl: Number(row.cumulative_realized_pnl),
      cumulativeDividends: Number(row.cumulative_dividends),
      isProvisional: row.is_provisional,
      // CHAR(3) padding: Postgres CHAR returns padded values; trim for safety. The
      // post-migration column is CHAR(3) so this is a no-op for the common case but
      // defends against any pre-migration TEXT row that bypassed the LEFT(_, 3) cast.
      currency: row.currency.trim(),
      valueNative: row.value_native !== null ? Number(row.value_native) : null,
      costBasisNative: row.cost_basis_native !== null ? Number(row.cost_basis_native) : 0,
      unrealizedPnlNative: row.unrealized_pnl_native !== null ? Number(row.unrealized_pnl_native) : null,
      providerSource: row.provider_source,
      generatedAt: row.generated_at,
      generationRunId: row.generation_run_id,
    }));
  }

  // ── Currency wallet snapshots (KZO-165) ───────────────────────────────────
  // Mirrors the unnest-arrays pattern from `bulkUpsertHoldingSnapshots`. PK is
  // (account_id, currency, date) per D7 — no `user_id` in the conflict target
  // even though it's denormalized for indexing. KZO-166 will populate
  // wac_fx_to_usd / realized_fx_pnl_lifetime; KZO-165 always writes null/0 stubs.

  async bulkUpsertCurrencyWalletSnapshots(
    _userId: string,
    snapshots: import("./types.js").CurrencyWalletSnapshot[],
  ): Promise<void> {
    if (snapshots.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO currency_wallet_snapshots (
           user_id, account_id, currency, date,
           balance_native, wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
           generated_at, generation_run_id
         )
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::date[],
           $5::numeric[], $6::numeric[], $7::numeric[], $8::text[],
           $9::timestamp[], $10::text[]
         )
         ON CONFLICT (account_id, currency, date) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           balance_native = EXCLUDED.balance_native,
           wac_fx_to_usd = EXCLUDED.wac_fx_to_usd,
           realized_fx_pnl_lifetime = EXCLUDED.realized_fx_pnl_lifetime,
           provider_source = EXCLUDED.provider_source,
           generated_at = EXCLUDED.generated_at,
           generation_run_id = EXCLUDED.generation_run_id`,
        [
          snapshots.map((s) => s.userId),
          snapshots.map((s) => s.accountId),
          snapshots.map((s) => s.currency),
          snapshots.map((s) => s.date),
          snapshots.map((s) => s.balanceNative),
          snapshots.map((s) => s.wacFxToUsd),
          snapshots.map((s) => s.realizedFxPnlLifetime),
          snapshots.map((s) => s.providerSource),
          snapshots.map((s) => s.generatedAt),
          snapshots.map((s) => s.generationRunId),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAllCurrencyWalletSnapshots(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM currency_wallet_snapshots WHERE user_id = $1`, [userId]);
  }

  async getCurrencyWalletSnapshotsForAccount(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<import("./types.js").CurrencyWalletSnapshot[]> {
    const result = await this.pool.query<{
      user_id: string;
      account_id: string;
      currency: string;
      date: string;
      balance_native: string;
      wac_fx_to_usd: string | null;
      realized_fx_pnl_lifetime: string;
      provider_source: string | null;
      generated_at: string;
      generation_run_id: string;
    }>(
      `SELECT user_id, account_id, currency, date::text,
              balance_native, wac_fx_to_usd, realized_fx_pnl_lifetime, provider_source,
              generated_at::text, generation_run_id
       FROM currency_wallet_snapshots
       WHERE user_id = $1 AND account_id = $2
         AND date >= $3::date AND date <= $4::date
       ORDER BY date ASC, currency ASC`,
      [userId, accountId, startDate, endDate],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      accountId: row.account_id,
      // CHAR(3) is space-padded by Postgres on read; trim defensively.
      currency: row.currency.trim(),
      date: row.date,
      balanceNative: Number(row.balance_native),
      wacFxToUsd: row.wac_fx_to_usd !== null ? Number(row.wac_fx_to_usd) : null,
      realizedFxPnlLifetime: Number(row.realized_fx_pnl_lifetime),
      providerSource: row.provider_source,
      generatedAt: row.generated_at,
      generationRunId: row.generation_run_id,
    }));
  }

  async getCashLedgerEntriesForBalances(
    userId: string,
  ): Promise<import("./types.js").CashLedgerEntryForBalance[]> {
    const result = await this.pool.query<{
      account_id: string;
      currency: string;
      entry_date: string;
      amount: string;
    }>(
      `SELECT account_id, currency, entry_date::text, amount
       FROM cash_ledger_entries
       WHERE user_id = $1
       ORDER BY account_id ASC, currency ASC, entry_date ASC`,
      [userId],
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      currency: row.currency,
      entryDate: row.entry_date,
      amount: Number(row.amount),
    }));
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    const result = await this.pool.query<{
      user_id: string;
      email: string | null;
      display_name: string | null;
      role: UserRole;
      provider_picture_url: string | null;
      provider_display_name: string | null;
      linked_at: string | null;
      last_seen_at: string | null;
    }>(
      `SELECT u.id AS user_id, u.email, u.display_name, u.role,
              e.provider_picture_url, e.provider_display_name,
              e.linked_at, e.last_seen_at
       FROM users u
       LEFT JOIN user_external_identities e ON e.user_id = u.id AND e.provider = 'google'
       WHERE u.id = $1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw routeError(404, "not_found", "Profile not found");
    }
    const row = result.rows[0];
    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      providerPictureUrl: row.provider_picture_url,
      providerDisplayName: row.provider_display_name,
      linkedAt: row.linked_at,
      lastSeenAt: row.last_seen_at,
      role: row.role,
      impersonation: null,
    };
  }

  async updateProfileEmail(userId: string, email: string): Promise<ProfileDto> {
    const normalizedEmail = normalizeEmail(email);
    try {
      await this.pool.query(
        `UPDATE users SET email = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [userId, normalizedEmail],
      );
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
        throw routeError(409, "email_conflict", "Email is already in use");
      }
      throw err;
    }
    return this.getProfile(userId);
  }

  async readiness(): Promise<ReadinessStatus> {
    const status: ReadinessStatus = {
      backend: "postgres",
      postgres: false,
      redis: false,
    };

    try {
      await this.pool.query("SELECT 1");
      status.postgres = true;
    } catch {
      status.postgres = false;
    }

    try {
      if (!this.redis.isOpen) await this.redis.connect();
      await this.redis.ping();
      status.redis = true;
    } catch {
      status.redis = false;
    }

    return status;
  }

  async saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    await this.ensureDefaultPortfolioData(userId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const accountIds = await this.listUserAccountIds(client, userId);
      await this.saveAccountingStoreTx(client, userId, accounting, accountIds);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    await this.ensureDefaultPortfolioData(userId);

    const trade = accounting.facts.tradeEvents.find((item) => item.id === tradeEventId);
    if (!trade) {
      throw new Error(`trade event ${tradeEventId} not found in accounting store`);
    }

    const cashEntry = accounting.facts.cashLedgerEntries.find((entry) => entry.relatedTradeEventId === tradeEventId);
    if (!cashEntry) {
      throw new Error(`cash ledger entry for trade event ${tradeEventId} not found in accounting store`);
    }

    const nextAllocations = accounting.projections.lotAllocations.filter(
      (allocation) => allocation.tradeEventId === tradeEventId,
    );
    const nextLots = accounting.projections.lots.filter(
      (lot) => lot.accountId === trade.accountId && lot.ticker === trade.ticker,
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const feePolicySnapshotId = feePolicySnapshotIdForTrade(trade.id);
      await insertTradeFeePolicySnapshot(client, userId, feePolicySnapshotId, trade, trade.feeSnapshot, trade.bookedAt);

      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, ticker, market_code, instrument_type, trade_type,
           quantity, unit_price, price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
           tax_amount, is_day_trade, fee_policy_snapshot_id, source, source_reference, booked_at,
           reversal_of_trade_event_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20,
           $21
         )`,
        [
          trade.id,
          trade.userId,
          trade.accountId,
          trade.ticker,
          trade.marketCode ?? "TW",
          trade.instrumentType,
          trade.type,
          trade.quantity,
          trade.unitPrice,
          trade.priceCurrency,
          trade.tradeDate,
          trade.tradeTimestamp ?? trade.bookedAt ?? new Date(`${trade.tradeDate}T00:00:00.000Z`).toISOString(),
          trade.bookingSequence ?? 1,
          trade.commissionAmount,
          trade.taxAmount,
          trade.isDayTrade,
          feePolicySnapshotId,
          trade.source ?? "legacy_transaction",
          trade.sourceReference ?? trade.id,
          trade.bookedAt ?? new Date(`${trade.tradeDate}T00:00:00.000Z`).toISOString(),
          trade.reversalOfTradeEventId ?? null,
        ],
      );

      await client.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           related_trade_event_id, related_dividend_ledger_entry_id, source,
           source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
           fx_rate_to_usd
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10,
           $11, $12, $13, $14,
           $15
         )`,
        [
          cashEntry.id,
          cashEntry.userId,
          cashEntry.accountId,
          cashEntry.entryDate,
          cashEntry.entryType,
          cashEntry.amount,
          cashEntry.currency,
          cashEntry.relatedTradeEventId ?? null,
          cashEntry.relatedDividendLedgerEntryId ?? null,
          cashEntry.source,
          cashEntry.sourceReference ?? null,
          cashEntry.note ?? null,
          cashEntry.bookedAt ?? new Date(`${cashEntry.entryDate}T00:00:00.000Z`).toISOString(),
          cashEntry.reversalOfCashLedgerEntryId ?? null,
          cashEntry.fxRateToUsd ?? null,
        ],
      );

      await client.query(
        `DELETE FROM lot_allocations
         WHERE user_id = $1
           AND trade_event_id = $2`,
        [userId, tradeEventId],
      );
      for (const allocation of nextAllocations) {
        await client.query(
          `INSERT INTO lot_allocations (
             id, user_id, account_id, trade_event_id, ticker, lot_id, lot_opened_at,
             lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12
           )`,
          [
            allocation.id,
            allocation.userId,
            allocation.accountId,
            allocation.tradeEventId,
            allocation.ticker,
            allocation.lotId,
            allocation.lotOpenedAt,
            allocation.lotOpenedSequence,
            allocation.allocatedQuantity,
            allocation.allocatedCostAmount,
            allocation.costCurrency,
            allocation.createdAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(
        `DELETE FROM lots
         WHERE account_id = $1
           AND ticker = $2`,
        [trade.accountId, trade.ticker],
      );
        for (const lot of nextLots) {
          await client.query(
            `INSERT INTO lots (id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.ticker, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    marketData: MarketDataFacts,
    dividendLedgerEntryId: string,
  ): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    validateMarketDataInvariants(marketData);
    validateAccountingMarketDataCrossReferences(accounting, marketData);
    await this.ensureDefaultPortfolioData(userId);

    const dividendLedgerEntry = accounting.facts.dividendLedgerEntries.find((entry) => entry.id === dividendLedgerEntryId);
    if (!dividendLedgerEntry) {
      throw new Error(`dividend ledger entry ${dividendLedgerEntryId} not found in accounting store`);
    }

    const dividendEvent = marketData.dividendEvents.find((entry) => entry.id === dividendLedgerEntry.dividendEventId);
    if (!dividendEvent) {
      throw new Error(`dividend event ${dividendLedgerEntry.dividendEventId} not found in accounting store`);
    }

    const linkedCashEntries = accounting.facts.cashLedgerEntries.filter(
      (entry) => entry.relatedDividendLedgerEntryId === dividendLedgerEntryId,
    );
    const dividendDeductions = accounting.facts.dividendDeductionEntries.filter(
      (entry) => entry.dividendLedgerEntryId === dividendLedgerEntryId,
    );
    const dividendSourceLines = accounting.facts.dividendSourceLines.filter(
      (entry) => entry.dividendLedgerEntryId === dividendLedgerEntryId,
    );
    const nextLots = accounting.projections.lots.filter(
      (lot) => lot.accountId === dividendLedgerEntry.accountId && lot.ticker === dividendEvent.ticker,
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existingDividendLedgerEntry = await client.query<{ posting_status: string }>(
        `SELECT posting_status
         FROM dividend_ledger_entries
         WHERE id = $1
         FOR UPDATE`,
        [dividendLedgerEntry.id],
      );
      if (
        existingDividendLedgerEntry.rows[0] &&
        existingDividendLedgerEntry.rows[0].posting_status !== "expected"
      ) {
        throw new Error(
          `posted dividend ledger entry ${dividendLedgerEntry.id} already exists and cannot be overwritten in place`,
        );
      }

      await this.saveDividendEventTx(client, dividendEvent);
      const dividendLedgerVersion = dividendLedgerEntry.version ?? 1;
      const dividendSourceCompositionStatus =
        dividendLedgerEntry.sourceCompositionStatus ?? "unknown_pending_disclosure";

      await client.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity,
           expected_cash_amount, expected_stock_quantity,
           received_stock_quantity,
           posting_status, reconciliation_status, version,
           source_composition_status, reconciliation_note, booked_at,
           reversal_of_dividend_ledger_entry_id, superseded_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6,
           $7,
           $8, $9, $10,
           $11, $12, $13,
           $14, $15
         )
         ON CONFLICT (id)
         DO UPDATE SET
           account_id = EXCLUDED.account_id,
           dividend_event_id = EXCLUDED.dividend_event_id,
           eligible_quantity = EXCLUDED.eligible_quantity,
           expected_cash_amount = EXCLUDED.expected_cash_amount,
           expected_stock_quantity = EXCLUDED.expected_stock_quantity,
           received_stock_quantity = EXCLUDED.received_stock_quantity,
           posting_status = EXCLUDED.posting_status,
           reconciliation_status = EXCLUDED.reconciliation_status,
           version = EXCLUDED.version,
           source_composition_status = EXCLUDED.source_composition_status,
           reconciliation_note = EXCLUDED.reconciliation_note,
           booked_at = EXCLUDED.booked_at,
           reversal_of_dividend_ledger_entry_id = EXCLUDED.reversal_of_dividend_ledger_entry_id,
           superseded_at = EXCLUDED.superseded_at`,
        [
          dividendLedgerEntry.id,
          dividendLedgerEntry.accountId,
          dividendLedgerEntry.dividendEventId,
          dividendLedgerEntry.eligibleQuantity,
          dividendLedgerEntry.expectedCashAmount,
          dividendLedgerEntry.expectedStockQuantity,
          dividendLedgerEntry.receivedStockQuantity,
          dividendLedgerEntry.postingStatus,
          dividendLedgerEntry.reconciliationStatus,
          dividendLedgerVersion,
          dividendSourceCompositionStatus,
          dividendLedgerEntry.reconciliationNote ?? null,
          dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          dividendLedgerEntry.reversalOfDividendLedgerEntryId ?? null,
          dividendLedgerEntry.supersededAt ?? null,
        ],
      );

      await client.query(`DELETE FROM dividend_deduction_entries WHERE dividend_ledger_entry_id = $1`, [dividendLedgerEntry.id]);
      for (const deduction of dividendDeductions) {
        await client.query(
          `INSERT INTO dividend_deduction_entries (
             id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
             withheld_at_source, source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           )`,
          [
            deduction.id,
            deduction.dividendLedgerEntryId,
            deduction.deductionType,
            deduction.amount,
            deduction.currencyCode,
            deduction.withheldAtSource,
            deduction.source,
            deduction.sourceReference ?? null,
            deduction.note ?? null,
            deduction.bookedAt ?? dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(`DELETE FROM dividend_source_lines WHERE dividend_ledger_entry_id = $1`, [dividendLedgerEntry.id]);
      for (const sourceLine of dividendSourceLines) {
        await client.query(
          `INSERT INTO dividend_source_lines (
             id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
             source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9
           )`,
          [
            sourceLine.id,
            sourceLine.dividendLedgerEntryId,
            sourceLine.sourceBucket,
            sourceLine.amount,
            sourceLine.currencyCode,
            sourceLine.source,
            sourceLine.sourceReference ?? null,
            sourceLine.note ?? null,
            sourceLine.bookedAt ?? dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(
        `DELETE FROM cash_ledger_entries
         WHERE user_id = $1
           AND related_dividend_ledger_entry_id = $2`,
        [userId, dividendLedgerEntry.id],
      );
      for (const cashEntry of linkedCashEntries) {
        await client.query(
          `INSERT INTO cash_ledger_entries (
             id, user_id, account_id, entry_date, entry_type, amount, currency,
             related_trade_event_id, related_dividend_ledger_entry_id, source,
             source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
             fx_rate_to_usd
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13, $14,
             $15
           )`,
          [
            cashEntry.id,
            cashEntry.userId,
            cashEntry.accountId,
            cashEntry.entryDate,
            cashEntry.entryType,
            cashEntry.amount,
            cashEntry.currency,
            cashEntry.relatedTradeEventId ?? null,
            cashEntry.relatedDividendLedgerEntryId ?? null,
            cashEntry.source,
            cashEntry.sourceReference ?? null,
            cashEntry.note ?? null,
            cashEntry.bookedAt ?? new Date(`${cashEntry.entryDate}T00:00:00.000Z`).toISOString(),
            cashEntry.reversalOfCashLedgerEntryId ?? null,
            cashEntry.fxRateToUsd ?? null,
          ],
        );
      }

      await client.query(
        `DELETE FROM lots
         WHERE account_id = $1
           AND ticker = $2`,
        [dividendLedgerEntry.accountId, dividendEvent.ticker],
      );
      for (const lot of nextLots) {
        await client.query(
          `INSERT INTO lots (id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.ticker, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceDividendSourceLinesForLedger(
    userId: string,
    ledgerEntryId: string,
    sourceLines: DividendSourceLine[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ownershipResult = await client.query(
        `SELECT 1
         FROM dividend_ledger_entries AS dle
         JOIN accounts AS account
           ON account.id = dle.account_id
         WHERE dle.id = $1
           AND account.user_id = $2
         FOR UPDATE OF dle`,
        [ledgerEntryId, userId],
      );
      if (!ownershipResult.rowCount) {
        throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
      }

      await client.query(`DELETE FROM dividend_source_lines WHERE dividend_ledger_entry_id = $1`, [ledgerEntryId]);
      for (const sourceLine of sourceLines) {
        await client.query(
          `INSERT INTO dividend_source_lines (
             id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
             source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9
           )`,
          [
            sourceLine.id,
            ledgerEntryId,
            sourceLine.sourceBucket,
            sourceLine.amount,
            sourceLine.currencyCode,
            sourceLine.source,
            sourceLine.sourceReference ?? null,
            sourceLine.note ?? null,
            sourceLine.bookedAt ?? new Date().toISOString(),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findDividendLedgerEntryById(userId: string, dividendLedgerEntryId: string): Promise<DividendLedgerEntry | null> {
    const result = await this.pool.query(
      `SELECT dle.id, dle.account_id, dle.dividend_event_id, dle.eligible_quantity,
              dle.expected_cash_amount, dle.expected_stock_quantity, dle.received_stock_quantity,
              dle.posting_status, dle.reconciliation_status, dle.version,
              dle.source_composition_status, dle.reconciliation_note, dle.booked_at,
              dle.reversal_of_dividend_ledger_entry_id, dle.superseded_at,
              COALESCE((
                SELECT SUM(entry.amount)
                FROM cash_ledger_entries AS entry
                WHERE entry.user_id = $2
                  AND entry.related_dividend_ledger_entry_id = dle.id
                  AND entry.entry_type = 'DIVIDEND_RECEIPT'
              ), 0) AS received_cash_amount
       FROM dividend_ledger_entries AS dle
       JOIN accounts AS account
         ON account.id = dle.account_id
       WHERE dle.id = $1
         AND account.user_id = $2`,
      [dividendLedgerEntryId, userId],
    );

    if (!result.rowCount) {
      return null;
    }

    return mapDividendLedgerEntryRow(result.rows[0]);
  }

  async getDividendLedgerEntryWithDetails(
    userId: string,
    dividendLedgerEntryId: string,
  ): Promise<
    | (DividendLedgerEntry & {
        deductions: DividendDeductionEntry[];
        sourceLines: DividendSourceLine[];
      })
    | null
  > {
    const entry = await this.findDividendLedgerEntryById(userId, dividendLedgerEntryId);
    if (!entry) return null;

    const [deductionsResult, sourceLinesResult] = await Promise.all([
      this.pool.query(
        `SELECT id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
                withheld_at_source, source, source_reference, note, booked_at
         FROM dividend_deduction_entries
         WHERE dividend_ledger_entry_id = $1
         ORDER BY booked_at, id`,
        [dividendLedgerEntryId],
      ),
      this.pool.query(
        `SELECT id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
                source, source_reference, note, booked_at
         FROM dividend_source_lines
         WHERE dividend_ledger_entry_id = $1
         ORDER BY booked_at, id`,
        [dividendLedgerEntryId],
      ),
    ]);

    return {
      ...entry,
      deductions: deductionsResult.rows.map((deduction) => ({
        id: String(deduction.id),
        dividendLedgerEntryId: String(deduction.dividend_ledger_entry_id),
        deductionType: String(deduction.deduction_type) as DividendDeductionEntry["deductionType"],
        amount: Number(deduction.amount),
        currencyCode: String(deduction.currency_code),
        withheldAtSource: Boolean(deduction.withheld_at_source),
        source: String(deduction.source),
        sourceReference: deduction.source_reference ? String(deduction.source_reference) : undefined,
        note: deduction.note ? String(deduction.note) : undefined,
        bookedAt: deduction.booked_at ? normalizeDateTime(String(deduction.booked_at)) : undefined,
      })),
      sourceLines: sourceLinesResult.rows.map((sourceLine) => ({
        id: String(sourceLine.id),
        dividendLedgerEntryId: String(sourceLine.dividend_ledger_entry_id),
        sourceBucket: String(sourceLine.source_bucket) as DividendSourceLine["sourceBucket"],
        amount: Number(sourceLine.amount),
        currencyCode: String(sourceLine.currency_code),
        source: String(sourceLine.source),
        sourceReference: sourceLine.source_reference ? String(sourceLine.source_reference) : undefined,
        note: sourceLine.note ? String(sourceLine.note) : undefined,
        bookedAt: sourceLine.booked_at ? normalizeDateTime(String(sourceLine.booked_at)) : undefined,
      })),
    };
  }

  async updateDividendReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: DividendLedgerEntry["reconciliationStatus"],
    note?: string,
  ): Promise<DividendLedgerEntry> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        `SELECT dle.id, dle.account_id, dle.dividend_event_id, dle.eligible_quantity,
                dle.expected_cash_amount, dle.expected_stock_quantity, dle.received_stock_quantity,
                dle.posting_status, dle.reconciliation_status, dle.version,
                dle.source_composition_status, dle.reconciliation_note, dle.booked_at,
                dle.reversal_of_dividend_ledger_entry_id, dle.superseded_at,
                COALESCE((
                  SELECT SUM(entry.amount)
                  FROM cash_ledger_entries AS entry
                  WHERE entry.user_id = $2
                    AND entry.related_dividend_ledger_entry_id = dle.id
                    AND entry.entry_type = 'DIVIDEND_RECEIPT'
                ), 0) AS received_cash_amount
         FROM dividend_ledger_entries AS dle
         JOIN accounts AS account
           ON account.id = dle.account_id
         WHERE dle.id = $1
           AND account.user_id = $2
         FOR UPDATE OF dle`,
        [dividendLedgerEntryId, userId],
      );

      if (!currentResult.rowCount) {
        throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
      }

      const current = currentResult.rows[0];
      if (!["posted", "adjusted"].includes(String(current.posting_status))) {
        throw routeError(409, "reconciliation_requires_posted_status", "Dividend must be posted before reconciliation changes");
      }

      const normalizedNote = note?.trim();
      if (status === "explained" && !normalizedNote) {
        throw routeError(400, "reconciliation_note_required", "A note is required when reconciliation stays explained");
      }

      const nextVersion = Number(current.version) + 1;
      const nextNote = normalizedNote || current.reconciliation_note || null;
      await client.query(
        `UPDATE dividend_ledger_entries
         SET reconciliation_status = $2,
             reconciliation_note = $3,
             version = $4
         WHERE id = $1`,
        [dividendLedgerEntryId, status, nextNote, nextVersion],
      );

      await client.query("COMMIT");
      return {
        ...mapDividendLedgerEntryRow(current),
        reconciliationStatus: status,
        reconciliationNote: nextNote ?? undefined,
        version: nextVersion,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePostedCashDividend(userId: string, input: UpdatePostedCashDividendInput): Promise<DividendLedgerEntry> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        `SELECT dle.id, dle.account_id, dle.dividend_event_id, dle.eligible_quantity,
                dle.expected_cash_amount, dle.expected_stock_quantity, dle.received_stock_quantity,
                dle.posting_status, dle.reconciliation_status, dle.version,
                dle.source_composition_status, dle.reconciliation_note, dle.booked_at,
                dle.reversal_of_dividend_ledger_entry_id, dle.superseded_at,
                event.event_type, event.ticker
         FROM dividend_ledger_entries AS dle
         JOIN accounts AS account
           ON account.id = dle.account_id
         JOIN market_data.dividend_events AS event
           ON event.id = dle.dividend_event_id
         WHERE dle.id = $1
           AND account.user_id = $2
         FOR UPDATE OF dle`,
        [input.dividendLedgerEntry.id, userId],
      );

      if (!currentResult.rowCount) {
        throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
      }

      const current = currentResult.rows[0];
      if (String(current.event_type) !== "CASH") {
        throw routeError(422, "stock_dividend_in_place_edit_unsupported", "Only pure cash dividends can be edited in place");
      }
      if (String(current.posting_status) !== "posted") {
        throw routeError(409, "dividend_update_requires_posted_status", "Only posted dividends can be edited in place");
      }
      if (Number(current.version) !== input.expectedVersion) {
        throw routeError(409, "dividend_version_conflict", "Dividend has been updated by another request");
      }

      const nextVersion = input.expectedVersion + 1;
      await client.query(
        `UPDATE dividend_ledger_entries
         SET account_id = $2,
             dividend_event_id = $3,
             eligible_quantity = $4,
             expected_cash_amount = $5,
             expected_stock_quantity = $6,
             received_stock_quantity = $7,
             posting_status = $8,
             reconciliation_status = $9,
             version = $10,
             source_composition_status = $11,
             reconciliation_note = $12,
             booked_at = $13,
             reversal_of_dividend_ledger_entry_id = $14,
             superseded_at = $15
         WHERE id = $1`,
        [
          input.dividendLedgerEntry.id,
          input.dividendLedgerEntry.accountId,
          input.dividendLedgerEntry.dividendEventId,
          input.dividendLedgerEntry.eligibleQuantity,
          input.dividendLedgerEntry.expectedCashAmount,
          input.dividendLedgerEntry.expectedStockQuantity,
          input.dividendLedgerEntry.receivedStockQuantity,
          input.dividendLedgerEntry.postingStatus,
          "open",
          nextVersion,
          input.dividendLedgerEntry.sourceCompositionStatus,
          null,
          input.dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          input.dividendLedgerEntry.reversalOfDividendLedgerEntryId ?? null,
          input.dividendLedgerEntry.supersededAt ?? null,
        ],
      );

      await client.query(`DELETE FROM dividend_deduction_entries WHERE dividend_ledger_entry_id = $1`, [input.dividendLedgerEntry.id]);
      for (const deduction of input.dividendDeductions) {
        await client.query(
          `INSERT INTO dividend_deduction_entries (
             id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
             withheld_at_source, source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           )`,
          [
            deduction.id,
            deduction.dividendLedgerEntryId,
            deduction.deductionType,
            deduction.amount,
            deduction.currencyCode,
            deduction.withheldAtSource,
            deduction.source,
            deduction.sourceReference ?? null,
            deduction.note ?? null,
            deduction.bookedAt ?? input.dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(`DELETE FROM dividend_source_lines WHERE dividend_ledger_entry_id = $1`, [input.dividendLedgerEntry.id]);
      for (const sourceLine of input.dividendSourceLines) {
        await client.query(
          `INSERT INTO dividend_source_lines (
             id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
             source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9
           )`,
          [
            sourceLine.id,
            sourceLine.dividendLedgerEntryId,
            sourceLine.sourceBucket,
            sourceLine.amount,
            sourceLine.currencyCode,
            sourceLine.source,
            sourceLine.sourceReference ?? null,
            sourceLine.note ?? null,
            sourceLine.bookedAt ?? input.dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(
        `DELETE FROM cash_ledger_entries
         WHERE user_id = $1
           AND related_dividend_ledger_entry_id = $2`,
        [userId, input.dividendLedgerEntry.id],
      );
      for (const cashEntry of input.linkedCashEntries) {
        await client.query(
          `INSERT INTO cash_ledger_entries (
             id, user_id, account_id, entry_date, entry_type, amount, currency,
             related_trade_event_id, related_dividend_ledger_entry_id, source,
             source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
             fx_rate_to_usd
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13, $14,
             $15
           )`,
          [
            cashEntry.id,
            cashEntry.userId,
            cashEntry.accountId,
            cashEntry.entryDate,
            cashEntry.entryType,
            cashEntry.amount,
            cashEntry.currency,
            cashEntry.relatedTradeEventId ?? null,
            cashEntry.relatedDividendLedgerEntryId ?? null,
            cashEntry.source,
            cashEntry.sourceReference ?? null,
            cashEntry.note ?? null,
            cashEntry.bookedAt ?? new Date(`${cashEntry.entryDate}T00:00:00.000Z`).toISOString(),
            cashEntry.reversalOfCashLedgerEntryId ?? null,
            cashEntry.fxRateToUsd ?? null,
          ],
        );
      }

      await client.query(
        `DELETE FROM lots
         WHERE account_id = $1
           AND ticker = $2`,
        [input.dividendLedgerEntry.accountId, current.ticker],
      );
      for (const lot of input.lots) {
        await client.query(
          `INSERT INTO lots (id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.ticker, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
        );
      }

      await client.query("COMMIT");
      return {
        ...input.dividendLedgerEntry,
        reconciliationStatus: "open",
        reconciliationNote: undefined,
        version: nextVersion,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDividendLedgerScopes(): Promise<Array<{ userId: string; accountId: string; ticker: string }>> {
    const result = await this.pool.query<{ user_id: string; account_id: string; ticker: string }>(
      `SELECT DISTINCT a.user_id, dle.account_id, event.ticker
         FROM dividend_ledger_entries AS dle
         JOIN accounts AS a
           ON a.id = dle.account_id
         JOIN market_data.dividend_events AS event
           ON event.id = dle.dividend_event_id
        WHERE dle.superseded_at IS NULL
          AND dle.reversal_of_dividend_ledger_entry_id IS NULL`,
    );
    return result.rows.map((row) => ({
      userId: String(row.user_id),
      accountId: String(row.account_id),
      ticker: String(row.ticker),
    }));
  }

  async applyDividendLedgerRecompute(
    userId: string,
    changes: DividendLedgerRecomputeChange[],
  ): Promise<DividendLedgerRecomputeChange[]> {
    if (changes.length === 0) return [];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const applied: DividendLedgerRecomputeChange[] = [];

      for (const change of changes) {
        // SELECT FOR UPDATE verifies ownership (via account join) and locks
        // the row against concurrent writers. Idempotency: if the current
        // stored version no longer matches change.previousVersion, another
        // writer won the race — skip this change and let the next replay
        // catch up.
        const currentResult = await client.query<{ version: number }>(
          `SELECT dle.version
             FROM dividend_ledger_entries AS dle
             JOIN accounts AS account
               ON account.id = dle.account_id
            WHERE dle.id = $1
              AND account.user_id = $2
              AND dle.account_id = $3
            FOR UPDATE OF dle`,
          [change.ledgerEntryId, userId, change.accountId],
        );
        if (!currentResult.rowCount) continue;
        if (Number(currentResult.rows[0]!.version) !== change.previousVersion) continue;

        await client.query(
          `UPDATE dividend_ledger_entries
              SET eligible_quantity = $2,
                  expected_cash_amount = $3,
                  expected_stock_quantity = $4,
                  reconciliation_status = $5,
                  version = $6
            WHERE id = $1`,
          [
            change.ledgerEntryId,
            change.nextEligibleQuantity,
            change.nextExpectedCashAmount,
            change.nextExpectedStockQuantity,
            change.nextReconciliationStatus,
            change.nextVersion,
          ],
        );

        applied.push(change);
      }

      await client.query("COMMIT");
      return applied;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDividendEventsByPaymentDate(
    userId: string,
    fromPaymentDate?: string,
    toPaymentDate?: string,
    limit: number = 500,
  ): Promise<Store["marketData"]["dividendEvents"]> {
    await this.ensureDefaultPortfolioData(userId);
    const result = await this.pool.query(
      `SELECT id, ticker, event_type, ex_dividend_date, payment_date,
              cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
              source, source_reference, ingested_at AS created_at,
              fiscal_year_period, announcement_date, total_distribution_shares
       FROM market_data.dividend_events
       WHERE payment_date IS NULL
          OR (
            ($1::date IS NULL OR payment_date >= $1::date)
            AND ($2::date IS NULL OR payment_date <= $2::date)
          )
       ORDER BY payment_date NULLS FIRST, ex_dividend_date, id
       LIMIT $3`,
      [fromPaymentDate ?? null, toPaymentDate ?? null, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      eventType: row.event_type,
      exDividendDate: normalizeDate(row.ex_dividend_date),
      paymentDate: row.payment_date ? normalizeDate(row.payment_date) : null,
      cashDividendPerShare: Number(row.cash_dividend_per_share),
      cashDividendCurrency: row.cash_dividend_currency,
      stockDividendPerShare: Number(row.stock_dividend_per_share),
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      createdAt: normalizeDateTime(row.created_at),
      fiscalYearPeriod: row.fiscal_year_period ?? undefined,
      announcementDate: row.announcement_date ? normalizeDate(row.announcement_date) : undefined,
      totalDistributionShares: row.total_distribution_shares != null ? Number(row.total_distribution_shares) : undefined,
    }));
  }

  async listDividendLedgerEntries(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendLedgerListResult> {
    await this.ensureDefaultPortfolioData(userId);

    // Static allowlist maps protect against SQL injection. Sort column and
    // direction are the only user-provided fragments that become SQL literals,
    // and both pass through these maps before interpolation.
    const SORT_COLUMNS: Record<DividendLedgerListOptions["sortBy"], string> = {
      paymentDate: "event.payment_date",
      ticker: "event.ticker",
      account: "account.name",
      expectedCashAmount: "dle.expected_cash_amount",
      receivedCashAmount: "COALESCE(receipts.received_cash_amount, 0)",
      reconciliationStatus: "dle.reconciliation_status",
    };
    const sortColumn = SORT_COLUMNS[opts.sortBy];
    const sortDirection: "ASC" | "DESC" = opts.sortOrder === "asc" ? "ASC" : "DESC";

    // Shared CTE params. $1 = userId is always present; optional filters bind
    // as NULLs so the WHERE clause is the same for every call site and the
    // query planner can reuse prepared statement plans.
    const params = [
      userId, // $1
      opts.accountId ?? null, // $2
      opts.fromPaymentDate ?? null, // $3
      opts.toPaymentDate ?? null, // $4
      opts.reconciliationStatus ?? null, // $5
      opts.postingStatus ?? null, // $6
      opts.ticker ?? null, // $7
    ];

    // Re-usable WHERE clause and FROM join shared by every query below.
    // Must preserve every invariant from the pre-KZO-135 query:
    //   - tenant guard (account.user_id = $1)
    //   - three-way superseded/reversed exclusion
    //   - date-range filter OR null payment-date exclusion (when no dates)
    //   - reconciliation and posting status filters
    //   - optional ticker filter on dividend_events.ticker
    // When dates are provided: keep existing behavior (null payment_date passthrough).
    // When no dates: exclude TBD entries (payment_date IS NOT NULL).
    // CASE always references $3/$4 to avoid PostgreSQL 42P18 indeterminate_datatype.
    const dateClause = `AND (
      CASE WHEN $3::date IS NULL AND $4::date IS NULL THEN
        event.payment_date IS NOT NULL
      ELSE
        event.payment_date IS NULL
        OR (
          ($3::date IS NULL OR event.payment_date >= $3::date)
          AND ($4::date IS NULL OR event.payment_date <= $4::date)
        )
      END
    )`;

    const fromAndWhere = `
      FROM dividend_ledger_entries AS dle
      JOIN accounts AS account
        ON account.id = dle.account_id
      JOIN market_data.dividend_events AS event
        ON event.id = dle.dividend_event_id
      LEFT JOIN (
        SELECT related_dividend_ledger_entry_id,
               SUM(amount) FILTER (WHERE entry_type = 'DIVIDEND_RECEIPT') AS received_cash_amount
        FROM cash_ledger_entries
        WHERE user_id = $1
        GROUP BY related_dividend_ledger_entry_id
      ) AS receipts
        ON receipts.related_dividend_ledger_entry_id = dle.id
      WHERE account.user_id = $1
        AND ($2::text IS NULL OR dle.account_id = $2)
        AND dle.superseded_at IS NULL
        AND dle.reversal_of_dividend_ledger_entry_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM dividend_ledger_entries AS reversal
          WHERE reversal.reversal_of_dividend_ledger_entry_id = dle.id
        )
        ${dateClause}
        AND ($5::text IS NULL OR dle.reconciliation_status = $5)
        AND ($6::text IS NULL OR dle.posting_status = $6)
        AND ($7::text IS NULL OR event.ticker = $7)
    `;

    // Query A — total count + openCount (single row).
    const queryA = `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE dle.reconciliation_status = 'open')::int AS open_count
      ${fromAndWhere}
    `;

    // Query B — totals by currency.
    const queryB = `
      SELECT event.cash_dividend_currency AS currency,
             SUM(dle.expected_cash_amount) AS expected_sum,
             SUM(COALESCE(receipts.received_cash_amount, 0)) AS received_sum
      ${fromAndWhere}
      GROUP BY event.cash_dividend_currency
    `;

    // Query C — byMonth (YYYY-MM × currency).
    const queryC = `
      SELECT to_char(event.payment_date, 'YYYY-MM') AS month_key,
             event.cash_dividend_currency AS currency,
             SUM(dle.expected_cash_amount) AS expected_sum,
             SUM(COALESCE(receipts.received_cash_amount, 0)) AS received_sum
      ${fromAndWhere}
        AND event.payment_date IS NOT NULL
      GROUP BY to_char(event.payment_date, 'YYYY-MM'), event.cash_dividend_currency
    `;

    // Query D — byTicker.
    const queryD = `
      SELECT event.ticker AS ticker,
             event.cash_dividend_currency AS currency,
             SUM(dle.expected_cash_amount) AS expected_sum,
             SUM(COALESCE(receipts.received_cash_amount, 0)) AS received_sum
      ${fromAndWhere}
      GROUP BY event.ticker, event.cash_dividend_currency
    `;

    // Query E — paginated rows with dynamic (allowlisted) ORDER BY and LIMIT/OFFSET.
    // The sort column and direction are injected from the static maps above —
    // no user input reaches the SQL as a string literal.
    const limit = opts.limit;
    const offset = (opts.page - 1) * opts.limit;
    const queryE = `
      SELECT dle.id, dle.account_id, dle.dividend_event_id, dle.eligible_quantity,
             dle.expected_cash_amount, dle.expected_stock_quantity, dle.received_stock_quantity,
             dle.posting_status, dle.reconciliation_status, dle.version,
             dle.source_composition_status, dle.reconciliation_note, dle.booked_at,
             dle.reversal_of_dividend_ledger_entry_id, dle.superseded_at,
             COALESCE(receipts.received_cash_amount, 0) AS received_cash_amount
      ${fromAndWhere}
      ORDER BY ${sortColumn} ${sortDirection} ${sortDirection === "ASC" ? "NULLS FIRST" : "NULLS LAST"}, dle.id ASC
      LIMIT $8 OFFSET $9
    `;

    // Run all five queries inside a REPEATABLE READ transaction so that
    // aggregates (A–D) and the paginated rows (E) reflect the same snapshot.
    // Without this, a concurrent posting/reconciliation between queries could
    // produce a `total`/`aggregates` that doesn't match the returned page.
    const client = await this.pool.connect();
    const [aResult, bResult, cResult, dResult, eResult] = await (async () => {
      try {
        await client.query("BEGIN");
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const results = await Promise.all([
          client.query(queryA, params),
          client.query(queryB, params),
          client.query(queryC, params),
          client.query(queryD, params),
          client.query(queryE, [...params, limit, offset]),
        ]);
        await client.query("COMMIT");
        return results;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })();

    const total = Number(aResult.rows[0]?.total ?? 0);
    const openCount = Number(aResult.rows[0]?.open_count ?? 0);

    const totalExpectedCashAmount: Record<string, number> = {};
    const totalReceivedCashAmount: Record<string, number> = {};
    for (const row of bResult.rows) {
      const currency = String(row.currency);
      totalExpectedCashAmount[currency] = Number(row.expected_sum ?? 0);
      totalReceivedCashAmount[currency] = Number(row.received_sum ?? 0);
    }

    const byMonth: DividendLedgerAggregates["byMonth"] = {};
    for (const row of cResult.rows) {
      const monthKey = String(row.month_key);
      const currency = String(row.currency);
      const bucket = (byMonth[monthKey] ??= {});
      bucket[currency] = {
        expected: Number(row.expected_sum ?? 0),
        received: Number(row.received_sum ?? 0),
      };
    }

    const byTicker: DividendLedgerAggregates["byTicker"] = {};
    for (const row of dResult.rows) {
      const ticker = String(row.ticker);
      const currency = String(row.currency);
      const bucket = (byTicker[ticker] ??= {});
      bucket[currency] = {
        expected: Number(row.expected_sum ?? 0),
        received: Number(row.received_sum ?? 0),
      };
    }

    const aggregates: DividendLedgerAggregates = {
      totalExpectedCashAmount,
      totalReceivedCashAmount,
      openCount,
      byMonth,
      byTicker,
    };

    const ledgerIds = eResult.rows.map((row) => row.id);
    const [deductionsResult, sourceLinesResult] = ledgerIds.length
      ? await Promise.all([
          this.pool.query(
            `SELECT id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
                    withheld_at_source, source, source_reference, note, booked_at
             FROM dividend_deduction_entries
             WHERE dividend_ledger_entry_id = ANY($1)
             ORDER BY dividend_ledger_entry_id, booked_at, id`,
            [ledgerIds],
          ),
          this.pool.query(
            `SELECT id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
                    source, source_reference, note, booked_at
             FROM dividend_source_lines
             WHERE dividend_ledger_entry_id = ANY($1)
             ORDER BY dividend_ledger_entry_id, booked_at, id`,
            [ledgerIds],
          ),
        ])
      : [{ rows: [] as Record<string, unknown>[] }, { rows: [] as Record<string, unknown>[] }];

    const deductionsByLedgerId = groupRowsByKey(deductionsResult.rows, "dividend_ledger_entry_id");
    const sourceLinesByLedgerId = groupRowsByKey(sourceLinesResult.rows, "dividend_ledger_entry_id");

    const ledgerEntries = eResult.rows.map((row) => ({
      ...mapDividendLedgerEntryRow(row),
      deductions: (deductionsByLedgerId.get(String(row.id)) ?? []).map((deduction) => ({
        id: String(deduction.id),
        dividendLedgerEntryId: String(deduction.dividend_ledger_entry_id),
        deductionType: String(deduction.deduction_type) as DividendDeductionEntry["deductionType"],
        amount: Number(deduction.amount),
        currencyCode: String(deduction.currency_code),
        withheldAtSource: Boolean(deduction.withheld_at_source),
        source: String(deduction.source),
        sourceReference: deduction.source_reference ? String(deduction.source_reference) : undefined,
        note: deduction.note ? String(deduction.note) : undefined,
        bookedAt: deduction.booked_at ? normalizeDateTime(String(deduction.booked_at)) : undefined,
      })),
      sourceLines: (sourceLinesByLedgerId.get(String(row.id)) ?? []).map((sourceLine) => ({
        id: String(sourceLine.id),
        dividendLedgerEntryId: String(sourceLine.dividend_ledger_entry_id),
        sourceBucket: String(sourceLine.source_bucket) as DividendSourceLine["sourceBucket"],
        amount: Number(sourceLine.amount),
        currencyCode: String(sourceLine.currency_code),
        source: String(sourceLine.source),
        sourceReference: sourceLine.source_reference ? String(sourceLine.source_reference) : undefined,
        note: sourceLine.note ? String(sourceLine.note) : undefined,
        bookedAt: sourceLine.booked_at ? normalizeDateTime(String(sourceLine.booked_at)) : undefined,
      })),
    }));

    return { ledgerEntries, total, aggregates };
  }

  async listCashLedgerEntries(
    userId: string,
    opts: CashLedgerListOptions,
  ): Promise<CashLedgerListResult> {
    await this.ensureDefaultPortfolioData(userId);

    const CASH_LEDGER_SORT_COLUMNS: Record<CashLedgerSortColumn, string> = {
      entryDate: "entry_date",
      entryType: "entry_type",
      amount: "amount",
      currency: "currency",
      accountId: "account_id",
    };
    const sortColumn = CASH_LEDGER_SORT_COLUMNS[opts.sortBy];
    const sortDirection: "ASC" | "DESC" = opts.sortOrder === "asc" ? "ASC" : "DESC";

    const params = [
      userId, // $1
      opts.accountId ?? null, // $2
      opts.fromEntryDate ?? null, // $3
      opts.toEntryDate ?? null, // $4
      opts.entryType?.length ? opts.entryType : null, // $5
    ];

    const whereClause = `
      WHERE user_id = $1
        AND ($2::text IS NULL OR account_id = $2)
        AND ($3::date IS NULL OR entry_date >= $3)
        AND ($4::date IS NULL OR entry_date <= $4)
        AND ($5::text[] IS NULL OR entry_type = ANY($5))
    `;

    // Query A — COUNT for total
    const queryA = `SELECT COUNT(*)::int AS total FROM cash_ledger_entries ${whereClause}`;

    // Query B — Summary (GROUP BY, full filtered set)
    const queryB = `
      SELECT account_id, currency, SUM(amount)::numeric AS amount
      FROM cash_ledger_entries ${whereClause}
      GROUP BY account_id, currency
    `;

    // Query C — Paginated entries
    const limit = opts.limit;
    const offset = (opts.page - 1) * opts.limit;
    const queryC = `
      SELECT id, user_id, account_id, entry_date, entry_type, amount, currency,
             related_trade_event_id, related_dividend_ledger_entry_id, source,
             source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
             fx_rate_to_usd
      FROM cash_ledger_entries ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}, booked_at DESC NULLS LAST, id ASC
      LIMIT $6 OFFSET $7
    `;

    const client = await this.pool.connect();
    const [aResult, bResult, cResult] = await (async () => {
      try {
        await client.query("BEGIN");
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const results = await Promise.all([
          client.query(queryA, params),
          client.query(queryB, params),
          client.query(queryC, [...params, limit, offset]),
        ]);
        await client.query("COMMIT");
        return results;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })();

    const total = Number(aResult.rows[0]?.total ?? 0);

    const summary = bResult.rows.map((row) => ({
      accountId: String(row.account_id),
      currency: String(row.currency),
      amount: Number(row.amount),
    }));

    const entries: CashLedgerEntry[] = cResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      entryDate: normalizeDate(row.entry_date),
      entryType: row.entry_type,
      amount: Number(row.amount),
      currency: row.currency,
      relatedTradeEventId: row.related_trade_event_id ?? undefined,
      relatedDividendLedgerEntryId: row.related_dividend_ledger_entry_id ?? undefined,
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      bookedAt: row.booked_at ? normalizeDateTime(row.booked_at) : undefined,
      fxRateToUsd: row.fx_rate_to_usd != null ? Number(row.fx_rate_to_usd) : null,
    }));

    return { entries, total, summary };
  }

  async listDividendLedgerYears(userId: string): Promise<{ years: number[] }> {
    await this.ensureDefaultPortfolioData(userId);
    const result = await this.pool.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM event.payment_date)::int AS year
       FROM dividend_ledger_entries AS dle
       JOIN accounts AS account
         ON account.id = dle.account_id
       JOIN market_data.dividend_events AS event
         ON event.id = dle.dividend_event_id
       WHERE account.user_id = $1
         AND event.payment_date IS NOT NULL
         AND dle.superseded_at IS NULL
         AND dle.reversal_of_dividend_ledger_entry_id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM dividend_ledger_entries AS reversal
           WHERE reversal.reversal_of_dividend_ledger_entry_id = dle.id
         )
       ORDER BY 1 DESC`,
      [userId],
    );
    return { years: result.rows.map((row) => Number(row.year)) };
  }

  private async runMigrations(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
    const manifest = await loadMigrationManifest(migrationsDir);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureMigrationLedger(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["tw_portfolio_schema_migrations"]);

      const appliedResult = await client.query<{ name: string; checksum: string | null }>(
        "SELECT name, checksum FROM schema_migrations",
      );
      const applied = new Set(appliedResult.rows.map((row) => row.name));
      const appliedChecksums = new Map(
        appliedResult.rows
          .filter((row) => row.checksum !== null)
          .map((row) => [row.name, row.checksum!]),
      );

      // Verify checksums of already-applied migrations against files on disk
      await this.verifyMigrationChecksums(migrationsDir, appliedChecksums);

      if (await this.shouldBootstrapFromBaseline(client, applied, manifest.baselineMigration)) {
        const baselineSql = await fs.readFile(
          path.join(migrationsDir, manifest.baselineMigration!),
          "utf8",
        );
        await client.query(baselineSql);
        // Baseline and superseded migrations get null checksums — they represent
        // logical bookkeeping entries, not files that were individually executed.
        await this.recordAppliedMigrations(client, [
          { name: manifest.baselineMigration!, checksum: computeChecksum(baselineSql) },
          ...manifest.baselineSupersedes.map((name) => ({ name, checksum: null })),
        ]);
        applied.add(manifest.baselineMigration!);
        for (const file of manifest.baselineSupersedes) applied.add(file);
      } else if (await this.shouldReconcileCurrentSchemaToBaseline(client, applied, manifest)) {
        await this.recordAppliedMigrations(client, [
          { name: manifest.baselineMigration!, checksum: null },
          ...manifest.baselineSupersedes.map((name) => ({ name, checksum: null })),
        ]);
        applied.add(manifest.baselineMigration!);
        for (const file of manifest.baselineSupersedes) applied.add(file);
      }

      for (const file of manifest.numberedMigrations) {
        if (applied.has(file)) continue;
        if (await this.isMigrationAlreadyReflected(client, file)) {
          const reflectedSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
          await this.recordAppliedMigrations(client, [
            { name: file, checksum: computeChecksum(reflectedSql) },
          ]);
          applied.add(file);
          continue;
        }
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
        await this.recordAppliedMigrations(client, [
          { name: file, checksum: computeChecksum(migrationSql) },
        ]);
        applied.add(file);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify that applied migration files have not been modified since they were applied.
   * Skips migrations with null checksums (pre-checksum era or logical bookkeeping entries).
   * Skips migrations whose files no longer exist on disk (superseded by baseline).
   */
  private async verifyMigrationChecksums(
    migrationsDir: string,
    appliedChecksums: Map<string, string>,
  ): Promise<void> {
    const mismatches: string[] = [];

    for (const [name, expectedChecksum] of appliedChecksums) {
      let fileSql: string;
      try {
        fileSql = await fs.readFile(path.join(migrationsDir, name), "utf8");
      } catch {
        // File no longer exists (e.g., superseded by baseline) — skip
        continue;
      }

      const currentChecksum = computeChecksum(fileSql);
      if (currentChecksum !== expectedChecksum) {
        mismatches.push(
          `  ${name}\n    applied:  ${expectedChecksum}\n    current:  ${currentChecksum}`,
        );
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Migration checksum verification failed. The following migrations have been modified after being applied:\n\n${mismatches.join("\n\n")}\n\n` +
        `Applied migrations are immutable. Create a new migration file for additional changes.`,
      );
    }
  }

  private async ensureMigrationLedger(client: PoolClient): Promise<void> {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    // Add checksum column for migration immutability enforcement
    await client.query(
      `ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`,
    );
  }

  private async shouldBootstrapFromBaseline(
    client: PoolClient,
    applied: Set<string>,
    baselineMigration: string | null,
  ): Promise<boolean> {
    if (!baselineMigration || applied.size > 0) return false;

    const tableResult = await client.query<{ has_tables: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
           AND table_name <> 'schema_migrations'
       ) AS has_tables`,
    );

    return !tableResult.rows[0]?.has_tables;
  }

  private async shouldReconcileCurrentSchemaToBaseline(
    client: PoolClient,
    applied: Set<string>,
    manifest: { baselineMigration: string | null; baselineSupersedes: string[] },
  ): Promise<boolean> {
    if (!manifest.baselineMigration || applied.size > 0) return false;
    if (!manifest.baselineSupersedes.length) return false;

    const [hasTables, baselineReflected] = await Promise.all([
      this.hasUserTables(client),
      this.isCurrentBaselineSchemaReflected(client),
    ]);

    return hasTables && baselineReflected;
  }

  private async isCurrentBaselineSchemaReflected(client: PoolClient): Promise<boolean> {
    const [hasCoreTables, migration009Reflected, migration010Reflected, migration011Reflected, migration012Reflected, migration013Reflected] =
      await Promise.all([
      Promise.all([
        this.tableExists(client, "users"),
        this.tableExists(client, "fee_profiles"),
        this.tableExists(client, "accounts"),
        this.tableExists(client, "trade_events"),
      ]).then((results) => results.every(Boolean)),
      this.isMigrationAlreadyReflected(client, "009_retire_twd_ntd_fields.sql"),
      this.isMigrationAlreadyReflected(client, "010_trade_snapshot_recompute_normalization.sql"),
      this.isMigrationAlreadyReflected(client, "011_fee_profile_tax_rule_normalization.sql"),
      this.isMigrationAlreadyReflected(client, "012_market_code_on_symbols_bindings_and_trades.sql"),
      this.isMigrationAlreadyReflected(client, "013_symbol_sync_metadata.sql"),
    ]);

    return (
      hasCoreTables &&
      migration009Reflected &&
      migration010Reflected &&
      migration011Reflected &&
      migration012Reflected &&
      migration013Reflected
    );
  }

  private async isMigrationAlreadyReflected(client: PoolClient, file: string): Promise<boolean> {
    switch (file) {
      case "009_retire_twd_ntd_fields.sql":
        return this.isMigration009Reflected(client);
      case "010_trade_snapshot_recompute_normalization.sql":
        return this.isMigration010Reflected(client);
      case "011_fee_profile_tax_rule_normalization.sql":
        return this.isMigration011Reflected(client);
      case "012_market_code_on_symbols_bindings_and_trades.sql":
        return this.isMigration012Reflected(client);
      case "013_symbol_sync_metadata.sql":
        return this.isMigration013Reflected(client);
      default:
        return false;
    }
  }

  private async isMigration009Reflected(client: PoolClient): Promise<boolean> {
    const [
      hasMinimumCommissionAmount,
      hasLegacyMinCommissionNtd,
      hasTradeEventUnitPrice,
      hasTradeEventLegacyPrice,
      hasLotTotalCostAmount,
      hasLotLegacyTotalCost,
      hasSnapshotCurrency,
      hasSnapshotLegacyNav,
    ] = await Promise.all([
      this.columnExists(client, "fee_profiles", "minimum_commission_amount"),
      this.columnExists(client, "fee_profiles", "min_commission_ntd"),
      this.columnExists(client, "trade_events", "unit_price"),
      this.columnExists(client, "trade_events", "price_ntd"),
      this.columnExists(client, "lots", "total_cost_amount"),
      this.columnExists(client, "lots", "total_cost_ntd"),
      this.columnExists(client, "daily_portfolio_snapshots", "currency"),
      this.columnExists(client, "daily_portfolio_snapshots", "total_nav_ntd"),
    ]);

    return (
      hasMinimumCommissionAmount &&
      !hasLegacyMinCommissionNtd &&
      hasTradeEventUnitPrice &&
      !hasTradeEventLegacyPrice &&
      hasLotTotalCostAmount &&
      !hasLotLegacyTotalCost &&
      hasSnapshotCurrency &&
      !hasSnapshotLegacyNav
    );
  }

  private async isMigration010Reflected(client: PoolClient): Promise<boolean> {
    const [
      hasTradeFeePolicySnapshots,
      hasTradeEventSnapshotId,
      hasLegacyTradeEventSnapshotJson,
      hasRecomputeTradeEventId,
      hasLegacyRecomputeTransactionId,
      hasTransactionsTable,
    ] = await Promise.all([
      this.tableExists(client, "trade_fee_policy_snapshots"),
      this.columnExists(client, "trade_events", "fee_policy_snapshot_id"),
      this.columnExists(client, "trade_events", "fee_snapshot_json"),
      this.columnExists(client, "recompute_job_items", "trade_event_id"),
      this.columnExists(client, "recompute_job_items", "transaction_id"),
      this.tableExists(client, "transactions"),
    ]);

    return (
      hasTradeFeePolicySnapshots &&
      hasTradeEventSnapshotId &&
      !hasLegacyTradeEventSnapshotJson &&
      hasRecomputeTradeEventId &&
      !hasLegacyRecomputeTransactionId &&
      !hasTransactionsTable
    );
  }

  private async isMigration011Reflected(client: PoolClient): Promise<boolean> {
    const [hasFeeProfileTaxRules, hasSnapshotTaxComponents] = await Promise.all([
      this.tableExists(client, "fee_profile_tax_rules"),
      this.tableExists(client, "trade_fee_policy_snapshot_tax_components"),
    ]);

    return hasFeeProfileTaxRules && hasSnapshotTaxComponents;
  }

  private async isMigration012Reflected(client: PoolClient): Promise<boolean> {
    const [hasTradeEventMarketCode, hasBindingMarketCode] = await Promise.all([
      this.columnExists(client, "trade_events", "market_code"),
      this.columnExists(client, "account_fee_profile_overrides", "market_code"),
    ]);
    // symbols may have been migrated to market_data.instruments by migration 018
    const symbolOrInstrument = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE (table_schema = 'public' AND table_name = 'symbols' AND column_name = 'market_code')
            OR (table_schema = 'market_data' AND table_name = 'instruments' AND column_name = 'market_code')
       ) AS exists`,
    );
    return hasTradeEventMarketCode && Boolean(symbolOrInstrument.rows[0]?.exists) && hasBindingMarketCode;
  }

  private async isMigration013Reflected(client: PoolClient): Promise<boolean> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
       WHERE ((table_schema = 'public' AND table_name = 'symbols')
              OR (table_schema = 'market_data' AND table_name = 'instruments'))
         AND column_name IN ('is_provisional', 'last_synced_at')`,
    );
    return parseInt(result.rows[0]?.count ?? "0", 10) >= 2;
  }

  private async hasUserTables(client: PoolClient): Promise<boolean> {
    const tableResult = await client.query<{ has_tables: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
           AND table_name <> 'schema_migrations'
       ) AS has_tables`,
    );

    return Boolean(tableResult.rows[0]?.has_tables);
  }

  private async tableExists(client: PoolClient, tableName: string): Promise<boolean> {
    const tableResult = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = $1
       ) AS exists`,
      [tableName],
    );

    return Boolean(tableResult.rows[0]?.exists);
  }

  private async columnExists(client: PoolClient, tableName: string, columnName: string): Promise<boolean> {
    const columnResult = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
       ) AS exists`,
      [tableName, columnName],
    );

    return Boolean(columnResult.rows[0]?.exists);
  }

  private async recordAppliedMigrations(
    client: PoolClient,
    migrations: Array<{ name: string; checksum: string | null }>,
  ): Promise<void> {
    if (!migrations.length) return;

    const names = migrations.map((m) => m.name);
    const checksums = migrations.map((m) => m.checksum);

    await client.query(
      `INSERT INTO schema_migrations (name, checksum)
       SELECT n, c
       FROM unnest($1::text[], $2::text[]) AS t(n, c)
       ON CONFLICT (name) DO NOTHING`,
      [names, checksums],
    );
  }

  private async seedDefaults(): Promise<void> {
    await this.seedInstruments();
  }

  private async insertInviteWithGeneratedCode(
    input: CreateInviteInput & { shareOwnerUserId?: string | null },
    client: Pool | PoolClient = this.pool,
  ): Promise<InviteRecord> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateInviteCode();
      try {
        const result = await client.query<{
          code: string;
          email: string;
          role: UserRole;
          expires_at: string;
          revoked_at: string | null;
          used_at: string | null;
          issued_by_user_id: string | null;
          share_owner_user_id: string | null;
          created_at: string;
        }>(
          `INSERT INTO invites (code, email, role, expires_at, issued_by_user_id, share_owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING code,
                     email,
                     role,
                     expires_at::text AS expires_at,
                     revoked_at::text AS revoked_at,
                     used_at::text AS used_at,
                     issued_by_user_id,
                     share_owner_user_id,
                     created_at::text AS created_at`,
          [
            code,
            normalizeEmail(input.email),
            input.role,
            input.expiresAt,
            input.issuedByUserId,
            input.shareOwnerUserId ?? null,
          ],
        );
        return mapInviteRow(result.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Failed to generate a unique invite code after 3 attempts");
  }

  private async appendAuditLogTx(client: Pool | PoolClient, input: AuditLogInput): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::inet)`,
      [
        randomUUID(),
        input.actorUserId ?? null,
        input.action,
        input.targetUserId ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.ipAddress ?? null,
      ],
    );
  }

  private async createNotificationTx(
    client: Pool | PoolClient,
    notification: {
      userId: string;
      severity: "info" | "warning" | "error";
      source: string;
      sourceRef?: string;
      title: string;
      body?: string;
      detail?: unknown;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO notifications (user_id, severity, source, source_ref, title, body, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        notification.userId,
        notification.severity,
        notification.source,
        notification.sourceRef ?? null,
        notification.title,
        notification.body ?? null,
        notification.detail ? JSON.stringify(notification.detail) : null,
      ],
    );
    return result.rows[0]!.id;
  }

  private async seedInstruments(): Promise<void> {
    await this.upsertInstrumentDefinitions(createDefaultInstruments());
  }

  private async upsertInstrumentDefinitions(defs: InstrumentDef[]): Promise<void> {
    const merged = upsertInstrumentDefinitions([], defs);

    for (const instrument of merged) {
      await this.pool.query(
        `INSERT INTO market_data.instruments (ticker, instrument_type, market_code, is_provisional, last_synced_at, type_raw, industry_category_raw, finmind_date, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (ticker) DO UPDATE SET
           instrument_type = CASE
             WHEN EXCLUDED.is_provisional THEN instruments.instrument_type
             ELSE EXCLUDED.instrument_type
           END,
           market_code = CASE
             WHEN EXCLUDED.is_provisional THEN instruments.market_code
             ELSE EXCLUDED.market_code
           END,
           is_provisional = CASE
             WHEN EXCLUDED.is_provisional THEN instruments.is_provisional
             ELSE EXCLUDED.is_provisional
           END,
           last_synced_at = COALESCE(EXCLUDED.last_synced_at, instruments.last_synced_at),
           type_raw = COALESCE(instruments.type_raw, EXCLUDED.type_raw),
           industry_category_raw = COALESCE(instruments.industry_category_raw, EXCLUDED.industry_category_raw),
           finmind_date = COALESCE(instruments.finmind_date, EXCLUDED.finmind_date),
           updated_at = NOW()`,
        [
          instrument.ticker,
          instrument.type,
          instrument.marketCode ?? "TW",
          instrument.isProvisional ?? false,
          instrument.lastSyncedAt ?? null,
          instrument.typeRaw ?? null,
          instrument.industryCategoryRaw ?? null,
          instrument.finmindDate ?? null,
        ],
      );
    }
  }

  private defaultFeeProfileId(userId: string): string {
    return `${userId}-fp-default`;
  }

  private defaultAccountId(userId: string): string {
    return `${userId}-acc-1`;
  }

  private async listUserAccountIds(client: PoolClient, userId: string): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      `SELECT id
       FROM accounts
       WHERE user_id = $1
       ORDER BY id`,
      [userId],
    );
    return result.rows.map((row) => row.id);
  }

  private async saveAccountingStoreTx(
    client: PoolClient,
    userId: string,
    accounting: AccountingStore,
    accountIds: string[],
  ): Promise<void> {
    await client.query(`DELETE FROM cash_ledger_entries WHERE user_id = $1`, [userId]);
    if (accountIds.length) {
      await client.query(
        `DELETE FROM dividend_deduction_entries dde
         USING dividend_ledger_entries dle
         WHERE dde.dividend_ledger_entry_id = dle.id
           AND dle.account_id = ANY($1)`,
        [accountIds],
      );
      await client.query(`DELETE FROM dividend_ledger_entries WHERE account_id = ANY($1)`, [accountIds]);
    }
    await client.query(`DELETE FROM lot_allocations WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM trade_events WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM trade_fee_policy_snapshots WHERE user_id = $1`, [userId]);
    for (const dividendLedgerEntry of accounting.facts.dividendLedgerEntries) {
      const dividendLedgerVersion = dividendLedgerEntry.version ?? 1;
      const dividendSourceCompositionStatus =
        dividendLedgerEntry.sourceCompositionStatus ?? "unknown_pending_disclosure";
      await client.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity,
           expected_cash_amount, expected_stock_quantity,
           received_stock_quantity,
           posting_status, reconciliation_status, version,
           source_composition_status, reconciliation_note, booked_at,
           reversal_of_dividend_ledger_entry_id, superseded_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6,
           $7,
           $8, $9, $10,
           $11, $12, $13,
           $14, $15
         )`,
        [
          dividendLedgerEntry.id,
          dividendLedgerEntry.accountId,
          dividendLedgerEntry.dividendEventId,
          dividendLedgerEntry.eligibleQuantity,
          dividendLedgerEntry.expectedCashAmount,
          dividendLedgerEntry.expectedStockQuantity,
          dividendLedgerEntry.receivedStockQuantity,
          dividendLedgerEntry.postingStatus,
          dividendLedgerEntry.reconciliationStatus,
          dividendLedgerVersion,
          dividendSourceCompositionStatus,
          dividendLedgerEntry.reconciliationNote ?? null,
          dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          dividendLedgerEntry.reversalOfDividendLedgerEntryId ?? null,
          dividendLedgerEntry.supersededAt ?? null,
        ],
      );

      for (const deduction of accounting.facts.dividendDeductionEntries.filter(
        (entry) => entry.dividendLedgerEntryId === dividendLedgerEntry.id,
      )) {
        await client.query(
          `INSERT INTO dividend_deduction_entries (
             id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
             withheld_at_source, source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           )`,
          [
            deduction.id,
            deduction.dividendLedgerEntryId,
            deduction.deductionType,
            deduction.amount,
            deduction.currencyCode,
            deduction.withheldAtSource,
            deduction.source,
            deduction.sourceReference ?? null,
            deduction.note ?? null,
            deduction.bookedAt ?? dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }

      for (const sourceLine of accounting.facts.dividendSourceLines.filter(
        (entry) => entry.dividendLedgerEntryId === dividendLedgerEntry.id,
      )) {
        await client.query(
          `INSERT INTO dividend_source_lines (
             id, dividend_ledger_entry_id, source_bucket, amount, currency_code,
             source, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9
           )`,
          [
            sourceLine.id,
            sourceLine.dividendLedgerEntryId,
            sourceLine.sourceBucket,
            sourceLine.amount,
            sourceLine.currencyCode,
            sourceLine.source,
            sourceLine.sourceReference ?? null,
            sourceLine.note ?? null,
            sourceLine.bookedAt ?? dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }
    }

    for (const tx of accounting.facts.tradeEvents) {
      const feePolicySnapshotId = feePolicySnapshotIdForTrade(tx.id);
      await insertTradeFeePolicySnapshot(client, userId, feePolicySnapshotId, tx, tx.feeSnapshot, tx.bookedAt);

      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, ticker, market_code, instrument_type, trade_type,
           quantity, unit_price, price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
           tax_amount, is_day_trade, fee_policy_snapshot_id, source, source_reference, booked_at,
           reversal_of_trade_event_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20,
           $21
         )`,
        [
          tx.id,
          tx.userId,
          tx.accountId,
          tx.ticker,
          tx.marketCode ?? "TW",
          tx.instrumentType,
          tx.type,
          tx.quantity,
          tx.unitPrice,
          tx.priceCurrency,
          tx.tradeDate,
          tx.tradeTimestamp ?? tx.bookedAt ?? new Date(`${tx.tradeDate}T00:00:00.000Z`).toISOString(),
          tx.bookingSequence ?? 1,
          tx.commissionAmount,
          tx.taxAmount,
          tx.isDayTrade,
          feePolicySnapshotId,
          tx.source ?? "legacy_transaction",
          tx.sourceReference ?? tx.id,
          tx.bookedAt ?? new Date(`${tx.tradeDate}T00:00:00.000Z`).toISOString(),
          tx.reversalOfTradeEventId ?? null,
        ],
      );
    }

    for (const entry of accounting.facts.cashLedgerEntries) {
      await client.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           related_trade_event_id, related_dividend_ledger_entry_id, source,
           source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
           fx_rate_to_usd
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10,
           $11, $12, $13, $14,
           $15
         )`,
        [
          entry.id,
          entry.userId,
          entry.accountId,
          entry.entryDate,
          entry.entryType,
          entry.amount,
          entry.currency,
          entry.relatedTradeEventId ?? null,
          entry.relatedDividendLedgerEntryId ?? null,
          entry.source,
          entry.sourceReference ?? null,
          entry.note ?? null,
          entry.bookedAt ?? new Date(`${entry.entryDate}T00:00:00.000Z`).toISOString(),
          entry.reversalOfCashLedgerEntryId ?? null,
          entry.fxRateToUsd ?? null,
        ],
      );
    }

    for (const allocation of accounting.projections.lotAllocations) {
      await client.query(
        `INSERT INTO lot_allocations (
           id, user_id, account_id, trade_event_id, ticker, lot_id, lot_opened_at,
           lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12
         )`,
        [
          allocation.id,
          allocation.userId,
          allocation.accountId,
          allocation.tradeEventId,
          allocation.ticker,
          allocation.lotId,
          allocation.lotOpenedAt,
          allocation.lotOpenedSequence,
          allocation.allocatedQuantity,
          allocation.allocatedCostAmount,
          allocation.costCurrency,
          allocation.createdAt ?? new Date().toISOString(),
        ],
      );
    }

    if (accountIds.length) {
      await client.query(`DELETE FROM lots WHERE account_id = ANY($1)`, [accountIds]);
      for (const lot of accounting.projections.lots) {
        await client.query(
          `INSERT INTO lots (id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.ticker, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
        );
      }

      await client.query(`DELETE FROM corporate_actions WHERE account_id = ANY($1)`, [accountIds]);
      for (const action of accounting.facts.corporateActions) {
        await client.query(
          `INSERT INTO corporate_actions (
             id, account_id, ticker, action_type, numerator, denominator, action_date
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            action.id,
            action.accountId,
            action.ticker,
            action.actionType,
            action.numerator,
            action.denominator,
            action.actionDate,
          ],
        );
      }
    }
  }

  async markDemoUser(userId: string, ttlSeconds: number): Promise<void> {
    await this.pool.query(
      `UPDATE users SET is_demo = true, demo_expires_at = NOW() + $2 * INTERVAL '1 second' WHERE id = $1`,
      [userId, ttlSeconds],
    );
  }

  async getTradeEvent(userId: string, tradeEventId: string): Promise<BookedTradeEvent | null> {
    const tradeResult = await this.pool.query(
      `SELECT te.id, te.user_id, te.account_id, te.ticker,
              te.market_code, te.instrument_type, te.trade_type, te.quantity,
              te.unit_price, te.price_currency, te.trade_date,
              te.trade_timestamp, te.booking_sequence, te.commission_amount,
              te.tax_amount, te.is_day_trade, te.fee_policy_snapshot_id, te.source,
              te.source_reference, te.booked_at, te.reversal_of_trade_event_id, te.fees_source,
              s.profile_id_at_booking, s.profile_name_at_booking, s.board_commission_rate,
              s.commission_discount_percent, s.minimum_commission_amount,
              s.commission_currency, s.commission_rounding_mode, s.tax_rounding_mode,
              s.stock_sell_tax_rate_bps, s.stock_day_trade_tax_rate_bps,
              s.etf_sell_tax_rate_bps, s.bond_etf_sell_tax_rate_bps,
              s.commission_charge_mode
       FROM trade_events AS te
       JOIN trade_fee_policy_snapshots AS s ON s.id = te.fee_policy_snapshot_id
       WHERE te.id = $1 AND te.user_id = $2`,
      [tradeEventId, userId],
    );
    if (tradeResult.rows.length === 0) return null;

    const row = tradeResult.rows[0];
    const snapshotId = String(row.fee_policy_snapshot_id);

    const taxComponentsResult = await this.pool.query(
      `SELECT id, snapshot_id, market_code, trade_side, instrument_type, day_trade_scope,
              tax_component_code, calculation_method, rate_bps, booked_tax_amount, sort_order
       FROM trade_fee_policy_snapshot_tax_components
       WHERE snapshot_id = $1
       ORDER BY sort_order, id`,
      [snapshotId],
    );

    return mapTradeEventRow(row, taxComponentsResult.rows);
  }

  async deleteTradeEvent(userId: string, tradeEventId: string): Promise<DeleteTradeEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Load trade to get accountId, ticker, snapshotId
      const tradeResult = await client.query(
        `SELECT account_id, ticker, fee_policy_snapshot_id FROM trade_events WHERE id = $1 AND user_id = $2`,
        [tradeEventId, userId],
      );
      if (tradeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        throw routeError(404, "trade_event_not_found", "Trade event not found");
      }
      const { account_id: accountId, ticker, fee_policy_snapshot_id: feePolicySnapshotId } = tradeResult.rows[0];

      // 2. Count child rows before delete
      const [cashCount, allocCount] = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS cnt FROM cash_ledger_entries WHERE related_trade_event_id = $1`, [tradeEventId]),
        client.query(`SELECT COUNT(*)::int AS cnt FROM lot_allocations WHERE trade_event_id = $1`, [tradeEventId]),
      ]);

      // 3. Delete trade event (CASCADE handles cash_ledger_entries, lot_allocations, recompute_job_items)
      await client.query(`DELETE FROM trade_events WHERE id = $1 AND user_id = $2`, [tradeEventId, userId]);

      // 4. Delete orphaned fee policy snapshot (FK direction: trade_events → snapshots, cascade doesn't help)
      await client.query(`DELETE FROM trade_fee_policy_snapshot_tax_components WHERE snapshot_id = $1`, [feePolicySnapshotId]);
      await client.query(`DELETE FROM trade_fee_policy_snapshots WHERE id = $1`, [feePolicySnapshotId]);

      await client.query("COMMIT");

      return {
        accountId,
        ticker,
        feePolicySnapshotId,
        deletedChildRows: {
          cashLedgerEntries: cashCount.rows[0].cnt,
          lotAllocations: allocCount.rows[0].cnt,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async updateTradeEvent(userId: string, tradeEventId: string, patch: TradeEventPatch): Promise<{ accountId: string; ticker: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Load the current trade
      const tradeResult = await client.query(
        `SELECT account_id, ticker, trade_date FROM trade_events WHERE id = $1 AND user_id = $2`,
        [tradeEventId, userId],
      );
      if (tradeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        throw routeError(404, "trade_event_not_found", "Trade event not found");
      }
      const { account_id: accountId, ticker, trade_date: oldTradeDate } = tradeResult.rows[0];
      const oldDateStr = normalizeDate(oldTradeDate);

      // Build dynamic UPDATE
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (patch.date !== undefined) {
        setClauses.push(`trade_date = $${paramIndex}`);
        values.push(patch.date);
        paramIndex++;
        setClauses.push(`trade_timestamp = $${paramIndex}`);
        values.push(new Date(`${patch.date}T00:00:00.000Z`).toISOString());
        paramIndex++;
      }
      if (patch.quantity !== undefined) {
        setClauses.push(`quantity = $${paramIndex}`);
        values.push(patch.quantity);
        paramIndex++;
      }
      if (patch.price !== undefined) {
        setClauses.push(`unit_price = $${paramIndex}`);
        values.push(patch.price);
        paramIndex++;
      }
      if (patch.side !== undefined) {
        setClauses.push(`trade_type = $${paramIndex}`);
        values.push(patch.side);
        paramIndex++;
      }
      if (patch.commissionAmount !== undefined) {
        setClauses.push(`commission_amount = $${paramIndex}`);
        values.push(patch.commissionAmount);
        paramIndex++;
      }
      if (patch.taxAmount !== undefined) {
        setClauses.push(`tax_amount = $${paramIndex}`);
        values.push(patch.taxAmount);
        paramIndex++;
      }
      if (patch.feesSource !== undefined) {
        setClauses.push(`fees_source = $${paramIndex}`);
        values.push(patch.feesSource);
        paramIndex++;
      }

      if (setClauses.length > 0) {
        values.push(tradeEventId, userId);
        await client.query(
          `UPDATE trade_events SET ${setClauses.join(", ")} WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}`,
          values,
        );
      }

      // Handle date change: compact old date's booking sequence + assign new sequence
      if (patch.date && patch.date !== oldDateStr) {
        // Get the next available booking_sequence for the new date
        const maxSeqResult = await client.query(
          `SELECT COALESCE(MAX(booking_sequence), 0) + 1 AS next_seq
           FROM trade_events
           WHERE account_id = $1 AND trade_date = $2 AND user_id = $3 AND id <> $4`,
          [accountId, patch.date, userId, tradeEventId],
        );
        await client.query(
          `UPDATE trade_events SET booking_sequence = $1 WHERE id = $2 AND user_id = $3`,
          [maxSeqResult.rows[0].next_seq, tradeEventId, userId],
        );

        // Compact old date's booking sequence
        await client.query(
          `WITH ordered AS (
             SELECT id, ROW_NUMBER() OVER (ORDER BY booking_sequence) AS new_seq
             FROM trade_events
             WHERE account_id = $1 AND trade_date = $2 AND user_id = $3
           )
           UPDATE trade_events AS te
           SET booking_sequence = ordered.new_seq
           FROM ordered
           WHERE te.id = ordered.id
             AND te.booking_sequence <> ordered.new_seq`,
          [accountId, oldDateStr, userId],
        );
      }

      await client.query("COMMIT");
      return { accountId, ticker };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getTradeEventsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<BookedTradeEvent[]> {
    const tradeResult = await this.pool.query(
      `SELECT te.id, te.user_id, te.account_id, te.ticker,
              te.market_code, te.instrument_type, te.trade_type, te.quantity,
              te.unit_price, te.price_currency, te.trade_date,
              te.trade_timestamp, te.booking_sequence, te.commission_amount,
              te.tax_amount, te.is_day_trade, te.fee_policy_snapshot_id, te.source,
              te.source_reference, te.booked_at, te.reversal_of_trade_event_id, te.fees_source,
              s.profile_id_at_booking, s.profile_name_at_booking, s.board_commission_rate,
              s.commission_discount_percent, s.minimum_commission_amount,
              s.commission_currency, s.commission_rounding_mode, s.tax_rounding_mode,
              s.stock_sell_tax_rate_bps, s.stock_day_trade_tax_rate_bps,
              s.etf_sell_tax_rate_bps, s.bond_etf_sell_tax_rate_bps,
              s.commission_charge_mode
       FROM trade_events AS te
       JOIN trade_fee_policy_snapshots AS s ON s.id = te.fee_policy_snapshot_id
       WHERE te.user_id = $1 AND te.account_id = $2 AND te.ticker = $3
       ORDER BY te.trade_date ASC, te.booking_sequence ASC`,
      [userId, accountId, ticker],
    );

    if (tradeResult.rows.length === 0) return [];

    const snapshotIds = tradeResult.rows.map((r) => String(r.fee_policy_snapshot_id));
    const taxComponentsResult = await this.pool.query(
      `SELECT id, snapshot_id, market_code, trade_side, instrument_type, day_trade_scope,
              tax_component_code, calculation_method, rate_bps, booked_tax_amount, sort_order
       FROM trade_fee_policy_snapshot_tax_components
       WHERE snapshot_id = ANY($1)
       ORDER BY snapshot_id, sort_order, id`,
      [snapshotIds],
    );

    const taxBySnapshot = groupRowsByKey(taxComponentsResult.rows, "snapshot_id");

    return tradeResult.rows.map((row) =>
      mapTradeEventRow(row, taxBySnapshot.get(String(row.fee_policy_snapshot_id)) ?? []),
    );
  }

  async deleteLotsForAccountTicker(_userId: string, accountId: string, ticker: string): Promise<number> {
    // lots table has no user_id column — accountId provides tenant scoping
    const result = await this.pool.query(
      `DELETE FROM lots WHERE account_id = $1 AND ticker = $2`,
      [accountId, ticker],
    );
    return result.rowCount ?? 0;
  }

  async deleteLotAllocationsForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM lot_allocations WHERE user_id = $1 AND account_id = $2 AND ticker = $3`,
      [userId, accountId, ticker],
    );
    return result.rowCount ?? 0;
  }

  async deleteTradeCashEntriesForAccountTicker(userId: string, accountId: string, ticker: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM cash_ledger_entries
       WHERE user_id = $1
         AND account_id = $2
         AND entry_type IN ('TRADE_SETTLEMENT_IN', 'TRADE_SETTLEMENT_OUT')
         AND related_trade_event_id IN (
           SELECT id FROM trade_events
           WHERE user_id = $1 AND account_id = $2 AND ticker = $3
         )`,
      [userId, accountId, ticker],
    );
    return result.rowCount ?? 0;
  }

  async bulkUpsertLots(_userId: string, lots: Lot[]): Promise<void> {
    for (const lot of lots) {
      await this.pool.query(
        `INSERT INTO lots (id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           open_quantity = EXCLUDED.open_quantity,
           total_cost_amount = EXCLUDED.total_cost_amount,
           cost_currency = EXCLUDED.cost_currency`,
        [lot.id, lot.accountId, lot.ticker, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
      );
    }
  }

  private async saveMarketDataTx(client: PoolClient, marketData: MarketDataFacts): Promise<void> {
    for (const dividendEvent of marketData.dividendEvents) {
      await this.saveDividendEventTx(client, dividendEvent);
    }
  }

  private async saveDividendEventTx(client: PoolClient, dividendEvent: DividendEvent): Promise<void> {
    await client.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
         source, source_reference, ingested_at,
         fiscal_year_period, announcement_date, total_distribution_shares, raw_provider_data
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11,
         NULL, NULL, NULL, NULL
       )
       ON CONFLICT (id)
       DO UPDATE SET
         ticker = EXCLUDED.ticker,
         event_type = EXCLUDED.event_type,
         ex_dividend_date = EXCLUDED.ex_dividend_date,
         payment_date = EXCLUDED.payment_date,
         cash_dividend_per_share = EXCLUDED.cash_dividend_per_share,
         cash_dividend_currency = EXCLUDED.cash_dividend_currency,
         stock_dividend_per_share = EXCLUDED.stock_dividend_per_share,
         source = EXCLUDED.source,
         source_reference = EXCLUDED.source_reference,
         fiscal_year_period = EXCLUDED.fiscal_year_period,
         announcement_date = EXCLUDED.announcement_date,
         total_distribution_shares = EXCLUDED.total_distribution_shares,
         raw_provider_data = EXCLUDED.raw_provider_data`,
      [
        dividendEvent.id,
        dividendEvent.ticker,
        dividendEvent.eventType,
        dividendEvent.exDividendDate,
        dividendEvent.paymentDate,
        dividendEvent.cashDividendPerShare,
        dividendEvent.cashDividendCurrency,
        dividendEvent.stockDividendPerShare,
        dividendEvent.source,
        dividendEvent.sourceReference ?? null,
        dividendEvent.createdAt ?? new Date().toISOString(),
      ],
    );
  }

  async bulkInsertLotAllocations(_userId: string, allocations: LotAllocationProjection[]): Promise<void> {
    for (const allocation of allocations) {
      await this.pool.query(
        `INSERT INTO lot_allocations (
           id, user_id, account_id, trade_event_id, ticker, lot_id, lot_opened_at,
           lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12
         )`,
        [
          allocation.id,
          allocation.userId,
          allocation.accountId,
          allocation.tradeEventId,
          allocation.ticker,
          allocation.lotId,
          allocation.lotOpenedAt,
          allocation.lotOpenedSequence,
          allocation.allocatedQuantity,
          allocation.allocatedCostAmount,
          allocation.costCurrency,
          allocation.createdAt ?? new Date().toISOString(),
        ],
      );
    }
  }

  async bulkInsertCashLedgerEntries(_userId: string, entries: CashLedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           related_trade_event_id, related_dividend_ledger_entry_id, source,
           source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
           fx_rate_to_usd
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13, $14,
           $15
         )`,
        [
          entry.id,
          entry.userId,
          entry.accountId,
          entry.entryDate,
          entry.entryType,
          entry.amount,
          entry.currency,
          entry.relatedTradeEventId ?? null,
          entry.relatedDividendLedgerEntryId ?? null,
          entry.source,
          entry.sourceReference ?? null,
          entry.note ?? null,
          entry.bookedAt ?? new Date(`${entry.entryDate}T00:00:00.000Z`).toISOString(),
          entry.reversalOfCashLedgerEntryId ?? null,
          entry.fxRateToUsd ?? null,
        ],
      );
    }
  }

  async compactBookingSequence(userId: string, accountId: string, tradeDate: string): Promise<void> {
    await this.pool.query(
      `WITH ordered AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY booking_sequence) AS new_seq
         FROM trade_events
         WHERE account_id = $1 AND trade_date = $2 AND user_id = $3
       )
       UPDATE trade_events AS te
       SET booking_sequence = ordered.new_seq
       FROM ordered
       WHERE te.id = ordered.id
         AND te.booking_sequence <> ordered.new_seq`,
      [accountId, tradeDate, userId],
    );
  }

  // --- Instruments ---

  async getInstrument(ticker: string): Promise<InstrumentRow | null> {
    const result = await this.pool.query<{
      ticker: string;
      instrument_type: string | null;
      market_code: string;
      name: string | null;
      is_provisional: boolean;
      type_raw: string | null;
      industry_category_raw: string | null;
      finmind_date: string | null;
      delisted_at: string | null;
      status_reason: string | null;
      bars_backfill_status: string;
      last_synced_at: string | null;
      last_repair_at: string | null;
      verification_status: string;
      verification_note: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT ticker, instrument_type, market_code, name, is_provisional,
              type_raw, industry_category_raw, finmind_date,
              delisted_at::text, status_reason,
              bars_backfill_status, last_synced_at::text, last_repair_at::text,
              verification_status, verification_note,
              created_at::text, updated_at::text
       FROM market_data.instruments WHERE ticker = $1`,
      [ticker],
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0]!;
    return {
      ticker: r.ticker,
      instrumentType: r.instrument_type as import("@tw-portfolio/domain").InstrumentType | null,
      marketCode: r.market_code,
      name: r.name ?? undefined,
      isProvisional: r.is_provisional,
      lastSyncedAt: r.last_synced_at ?? undefined,
      typeRaw: r.type_raw ?? undefined,
      industryCategoryRaw: r.industry_category_raw ?? undefined,
      finmindDate: r.finmind_date ?? undefined,
      delistedAt: r.delisted_at ?? undefined,
      statusReason: r.status_reason ?? undefined,
      barsBackfillStatus: r.bars_backfill_status as import("@tw-portfolio/domain").BackfillStatus,
      lastRepairAt: r.last_repair_at ?? undefined,
      verificationStatus: r.verification_status as import("@tw-portfolio/domain").VerificationStatus,
      verificationNote: r.verification_note ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateBackfillStatus(ticker: string, status: import("@tw-portfolio/domain").BackfillStatus): Promise<void> {
    const extra = status === "ready" ? ", last_synced_at = CURRENT_TIMESTAMP" : "";
    await this.pool.query(
      `UPDATE market_data.instruments SET bars_backfill_status = $1, updated_at = CURRENT_TIMESTAMP${extra} WHERE ticker = $2`,
      [status, ticker],
    );
  }

  async updateLastRepairAt(ticker: string): Promise<void> {
    await this.pool.query(
      `UPDATE market_data.instruments
       SET last_repair_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE ticker = $1`,
      [ticker],
    );
  }

  async getRepairCooldownMinutes(): Promise<number | null> {
    const r = await this.pool.query<{ repair_cooldown_minutes: number | null }>(
      "SELECT repair_cooldown_minutes FROM public.app_config WHERE id = 1",
    );
    if (r.rowCount === 0) {
      console.warn("[app_config] row missing — falling back to env REPAIR_COOLDOWN_MINUTES");
      return null;
    }
    return r.rows[0].repair_cooldown_minutes;
  }

  async getAppConfig(): Promise<{
    repairCooldownMinutes: number | null;
    dashboardPerformanceRanges: string[] | null;
    updatedAt: string;
  }> {
    const r = await this.pool.query<{
      repair_cooldown_minutes: number | null;
      dashboard_performance_ranges: string[] | null;
      updated_at: Date | string;
    }>(
      "SELECT repair_cooldown_minutes, dashboard_performance_ranges, updated_at FROM public.app_config WHERE id = 1",
    );
    if (r.rowCount === 0) {
      console.warn("[app_config] row missing — falling back to env REPAIR_COOLDOWN_MINUTES");
      return {
        repairCooldownMinutes: null,
        dashboardPerformanceRanges: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const row = r.rows[0];
    const rawUpdatedAt = row.updated_at;
    const updatedAt = rawUpdatedAt instanceof Date ? rawUpdatedAt.toISOString() : new Date(rawUpdatedAt).toISOString();
    return {
      repairCooldownMinutes: row.repair_cooldown_minutes,
      dashboardPerformanceRanges: row.dashboard_performance_ranges,
      updatedAt,
    };
  }

  async setRepairCooldownMinutes(value: number | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.app_config (id, repair_cooldown_minutes, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET repair_cooldown_minutes = $1, updated_at = NOW()`,
      [value],
    );
  }

  async setDashboardPerformanceRanges(value: string[] | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.app_config (id, dashboard_performance_ranges, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET dashboard_performance_ranges = $1::jsonb, updated_at = NOW()`,
      [value === null ? null : JSON.stringify(value)],
    );
  }

  async getUserPreferences(userId: string): Promise<Record<string, unknown>> {
    const r = await this.pool.query<{ preferences: Record<string, unknown> | null }>(
      "SELECT preferences FROM public.user_preferences WHERE user_id = $1",
      [userId],
    );
    if (r.rowCount === 0) {
      return {};
    }
    return r.rows[0].preferences ?? {};
  }

  async setUserPreferencePatch(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Split the patch into two arms:
    //  - non-null keys → merged into the JSONB via `||`
    //  - null-valued keys → removed via `- $3::text[]`
    // This matches the memory backend's top-level merge semantics (D3).
    //
    // KZO-162: `cardOrder` is special-cased so a partial PATCH like
    // `{cardOrder:{transactions:[...]}}` does not wipe `cardOrder.dashboard`.
    // The sub-key merge happens via a dedicated CASE branch below; null
    // sub-key values (`{cardOrder:{transactions:null}}`) are dropped via
    // `jsonb_strip_nulls()`. Top-level `{cardOrder:null}` still routes
    // through the delete-keys arm and removes the entire `cardOrder` key.
    const mergeObj: Record<string, unknown> = {};
    const deleteKeys: string[] = [];
    let cardOrderPatch: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) {
        deleteKeys.push(k);
      } else if (k === "cardOrder" && typeof v === "object" && !Array.isArray(v)) {
        cardOrderPatch = v as Record<string, unknown>;
      } else {
        mergeObj[k] = v;
      }
    }
    const r = await this.pool.query<{ preferences: Record<string, unknown> }>(
      `INSERT INTO public.user_preferences (user_id, preferences, updated_at)
       VALUES ($1, jsonb_strip_nulls(COALESCE($2::jsonb, '{}'::jsonb) || COALESCE(jsonb_build_object('cardOrder', $4::jsonb), '{}'::jsonb)), NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET preferences = CASE
           WHEN $4::jsonb IS NOT NULL THEN
             jsonb_set(
               (public.user_preferences.preferences || EXCLUDED.preferences) - $3::text[],
               '{cardOrder}',
               jsonb_strip_nulls(
                 COALESCE(public.user_preferences.preferences->'cardOrder', '{}'::jsonb)
                 || $4::jsonb
               )
             )
           ELSE
             (public.user_preferences.preferences || EXCLUDED.preferences) - $3::text[]
         END,
         updated_at = NOW()
       RETURNING preferences`,
      [
        userId,
        JSON.stringify(mergeObj),
        deleteKeys,
        cardOrderPatch === null ? null : JSON.stringify(cardOrderPatch),
      ],
    );
    return r.rows[0]?.preferences ?? {};
  }

  /**
   * Test-only helper — directly sets the full preferences JSON for a user.
   * Used by POST /__e2e/seed-user-preferences; never invoked from prod code paths.
   */
  async _setUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.user_preferences (user_id, preferences, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET preferences = EXCLUDED.preferences, updated_at = NOW()`,
      [userId, JSON.stringify(preferences)],
    );
  }

  async upsertInstrumentCatalog(instruments: CatalogInstrument[], delistings: DelistingRecord[]): Promise<CatalogSyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      let upserted = 0;
      if (instruments.length > 0) {
        const tickers: string[] = [];
        const names: string[] = [];
        const typeRaws: string[] = [];
        const industryCategoryRaws: string[] = [];
        const finmindDates: string[] = [];
        const instrumentTypes: (string | null)[] = [];

        for (const inst of instruments) {
          tickers.push(inst.ticker);
          names.push(inst.name);
          typeRaws.push(inst.typeRaw);
          industryCategoryRaws.push(inst.industryCategoryRaw);
          finmindDates.push(inst.finmindDate);
          instrumentTypes.push(inst.instrumentType);
        }

        const result = await client.query(
          `INSERT INTO market_data.instruments
            (ticker, name, type_raw, industry_category_raw, finmind_date, instrument_type, market_code, is_provisional, updated_at)
          SELECT * FROM unnest(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
            array_fill('TW'::text, ARRAY[$7::int]),
            array_fill(FALSE::boolean, ARRAY[$7::int]),
            array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$7::int])
          )
          ON CONFLICT (ticker) DO UPDATE SET
            name = EXCLUDED.name,
            type_raw = EXCLUDED.type_raw,
            industry_category_raw = EXCLUDED.industry_category_raw,
            finmind_date = EXCLUDED.finmind_date,
            instrument_type = EXCLUDED.instrument_type,
            is_provisional = FALSE,
            updated_at = CURRENT_TIMESTAMP`,
          [tickers, names, typeRaws, industryCategoryRaws, finmindDates, instrumentTypes, instruments.length],
        );
        upserted = result.rowCount ?? 0;
      }

      let delisted = 0;
      for (const d of delistings) {
        const result = await client.query(
          `UPDATE market_data.instruments SET delisted_at = $2::timestamp, updated_at = CURRENT_TIMESTAMP
           WHERE ticker = $1 AND delisted_at IS NULL`,
          [d.ticker, d.date],
        );
        delisted += result.rowCount ?? 0;
      }

      await client.query("COMMIT");
      return { upserted, delisted };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Monitored Symbols ---

  async getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]> {
    const result = await this.pool.query<{
      ticker: string;
      source: "manual" | "position";
      name: string | null;
      instrument_type: string | null;
      bars_backfill_status: string | null;
      last_repair_at: string | null;
    }>(
      `WITH manual AS (
         SELECT ums.ticker, 'manual'::text AS source
         FROM user_monitored_tickers ums
         WHERE ums.user_id = $1
       ),
       positions AS (
         SELECT DISTINCT l.ticker, 'position'::text AS source
         FROM lots l
         JOIN accounts a ON l.account_id = a.id
         WHERE a.user_id = $1 AND l.open_quantity > 0
       ),
       combined AS (
         SELECT ticker, source FROM manual
         UNION ALL
         SELECT ticker, source FROM positions
         WHERE ticker NOT IN (SELECT ticker FROM manual)
       )
       SELECT c.ticker, c.source,
              i.name, i.instrument_type, i.bars_backfill_status, i.last_repair_at::text
       FROM combined c
       LEFT JOIN market_data.instruments i ON i.ticker = c.ticker`,
      [userId],
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      source: row.source as MonitoredTickerDto["source"],
      name: row.name,
      instrumentType: (row.instrument_type as MonitoredTickerDto["instrumentType"]) ?? null,
      barsBackfillStatus: row.bars_backfill_status,
      lastRepairAt: row.last_repair_at,
    }));
  }

  async getAllMonitoredTickers(): Promise<string[]> {
    const result = await this.pool.query<{ ticker: string }>(
      `WITH monitored AS (
         SELECT ums.user_id, ums.ticker
         FROM user_monitored_tickers ums
         UNION
         SELECT DISTINCT a.user_id, l.ticker
         FROM lots l
         JOIN accounts a ON a.id = l.account_id
         WHERE l.open_quantity > 0
       )
       SELECT DISTINCT i.ticker
       FROM monitored m
       JOIN users u ON u.id = m.user_id
       JOIN market_data.instruments i ON i.ticker = m.ticker
       WHERE u.is_demo = FALSE
         AND i.bars_backfill_status = 'ready'
         AND i.delisted_at IS NULL
       ORDER BY i.ticker`,
    );
    return result.rows.map((row) => row.ticker);
  }

  async getUsersMonitoringTicker(ticker: string): Promise<string[]> {
    const result = await this.pool.query<{ user_id: string }>(
      `WITH monitored_users AS (
         SELECT ums.user_id
         FROM user_monitored_tickers ums
         WHERE ums.ticker = $1
         UNION
         SELECT a.user_id
         FROM lots l
         JOIN accounts a ON a.id = l.account_id
         WHERE l.ticker = $1 AND l.open_quantity > 0
       )
       SELECT DISTINCT mu.user_id
       FROM monitored_users mu
       JOIN users u ON u.id = mu.user_id
       WHERE u.is_demo = FALSE
       ORDER BY mu.user_id`,
      [ticker],
    );
    return result.rows.map((row) => row.user_id);
  }

  async getManualSelections(userId: string): Promise<{ ticker: string; addedAt: string }[]> {
    const result = await this.pool.query<{ ticker: string; added_at: string }>(
      `SELECT ticker, added_at FROM user_monitored_tickers WHERE user_id = $1 ORDER BY added_at`,
      [userId],
    );
    return result.rows.map((row) => ({
      ticker: row.ticker,
      addedAt: new Date(row.added_at).toISOString(),
    }));
  }

  async replaceManualSelections(userId: string, tickers: string[]): Promise<{ newTickers: string[] }> {
    // Get current full monitored set before replacing
    const currentSet = await this.getMonitoredSet(userId);
    const currentTickers = new Set(currentSet.map((s) => s.ticker));

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_monitored_tickers WHERE user_id = $1", [userId]);
      for (const ticker of tickers) {
        await client.query(
          "INSERT INTO user_monitored_tickers (user_id, ticker) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [userId, ticker],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Compute genuinely new tickers (not in current full monitored set)
    const newTickers = tickers.filter((t) => !currentTickers.has(t));
    return { newTickers };
  }

  async listInstrumentsCatalog(
    search?: string,
    type?: string,
    _userId?: string,
  ): Promise<Omit<InstrumentCatalogItemDto, "repairAvailableAt">[]> {
    const conditions: string[] = ["i.delisted_at IS NULL"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(i.ticker ILIKE $${paramIndex} OR i.name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (type) {
      conditions.push(`i.instrument_type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.pool.query<{
      ticker: string;
      name: string | null;
      instrument_type: string | null;
      market_code: string;
      bars_backfill_status: string;
      last_repair_at: string | null;
    }>(
      `SELECT ticker, name, instrument_type, market_code, bars_backfill_status, last_repair_at::text
       FROM market_data.instruments i ${where}
       ORDER BY ticker`,
      params,
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name,
      instrumentType: (row.instrument_type as InstrumentCatalogItemDto["instrumentType"]) ?? null,
      marketCode: row.market_code,
      barsBackfillStatus: row.bars_backfill_status,
      lastRepairAt: row.last_repair_at,
    }));
  }

  // --- Notifications (KZO-132) ---

  async createNotification(notification: {
    userId: string;
    severity: "info" | "warning" | "error";
    source: string;
    sourceRef?: string;
    title: string;
    body?: string;
    detail?: unknown;
  }): Promise<string> {
    return this.createNotificationTx(this.pool, notification);
  }

  async getNotificationsForUser(
    userId: string,
    opts: { page: number; limit: number },
  ): Promise<{ notifications: NotificationDto[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit;
    const [dataResult, countResult] = await Promise.all([
      this.pool.query<{
        id: string;
        user_id: string;
        severity: string;
        source: string;
        source_ref: string | null;
        title: string;
        body: string | null;
        detail: unknown;
        read_at: string | null;
        escalated_at: string | null;
        dismissed_at: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, user_id, severity, source, source_ref, title, body, detail,
                read_at, escalated_at, dismissed_at, created_at, updated_at
         FROM notifications
         WHERE user_id = $1 AND dismissed_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, opts.limit, offset],
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND dismissed_at IS NULL`,
        [userId],
      ),
    ]);

    return {
      notifications: dataResult.rows.map(mapNotificationRow),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
      [userId],
    );
    return parseInt(result.rows[0].count, 10);
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE notifications SET read_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL`,
      [notificationId, userId],
    );
    if (result.rowCount === 0) {
      throw routeError(404, "notification_not_found", "Notification not found");
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE notifications SET read_at = now(), updated_at = now()
       WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
      [userId],
    );
  }

  async dismissNotification(userId: string, notificationId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE notifications SET dismissed_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL`,
      [notificationId, userId],
    );
    if (result.rowCount === 0) {
      throw routeError(404, "notification_not_found", "Notification not found");
    }
  }

  async markNotificationEscalated(userId: string, notificationId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE notifications SET escalated_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL`,
      [notificationId, userId],
    );
    if (result.rowCount === 0) {
      throw routeError(404, "notification_not_found", "Notification not found");
    }
  }

  // --- Refresh Batches (KZO-132) ---

  async createRefreshBatch(userId: string | null, jobsTotal: number): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO refresh_batches (user_id, jobs_total, status, started_at)
       VALUES ($1, $2, 'running', now())
       RETURNING id`,
      [userId, jobsTotal],
    );
    return result.rows[0].id;
  }

  async updateBatchTickerResult(
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ): Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null> {
    const isSuccess = result.status === "success";
    const tickerResult = JSON.stringify({
      [ticker]: {
        status: result.status,
        ...(result.barsCount !== undefined && { barsCount: result.barsCount }),
        ...(result.dividendsCount !== undefined && { dividendsCount: result.dividendsCount }),
        ...(result.reason !== undefined && { reason: result.reason }),
      },
    });

    const qr = await this.pool.query<{
      jobs_succeeded: number;
      jobs_failed: number;
      jobs_total: number;
    }>(
      `UPDATE refresh_batches
       SET ${isSuccess ? "jobs_succeeded = jobs_succeeded + 1" : "jobs_failed = jobs_failed + 1"},
           ticker_results = ticker_results || $2::jsonb
       WHERE id = $1
       RETURNING jobs_succeeded, jobs_failed, jobs_total`,
      [batchId, tickerResult],
    );

    if (qr.rowCount === 0) return null;

    const row = qr.rows[0];
    return {
      jobsSucceeded: row.jobs_succeeded,
      jobsFailed: row.jobs_failed,
      jobsTotal: row.jobs_total,
    };
  }

  async getRefreshBatch(batchId: string): Promise<{
    id: string;
    status: string;
    jobsTotal: number;
    jobsSucceeded: number;
    jobsFailed: number;
    tickerResults: Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>;
  } | null> {
    const result = await this.pool.query<{
      id: string;
      status: string;
      jobs_total: number;
      jobs_succeeded: number;
      jobs_failed: number;
      ticker_results: Record<string, unknown>;
    }>(
      `SELECT id, status, jobs_total, jobs_succeeded, jobs_failed, ticker_results
       FROM refresh_batches WHERE id = $1`,
      [batchId],
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      status: row.status,
      jobsTotal: row.jobs_total,
      jobsSucceeded: row.jobs_succeeded,
      jobsFailed: row.jobs_failed,
      tickerResults: row.ticker_results as Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>,
    };
  }

  async completeRefreshBatch(batchId: string, status: "completed" | "failed"): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_batches SET status = $2, completed_at = now() WHERE id = $1`,
      [batchId, status],
    );
  }

  getPool(): Pool {
    return this.pool;
  }

  // ── Admin portal methods (KZO-144) ──────────────────────────────────────────

  async listUsers(options: AdminUserListOptions): Promise<AdminUserListResponse> {
    const { page, limit, search, role, status } = options;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Status filter: derive from deactivated_at/deleted_at
    if (status === "active") {
      conditions.push("u.deactivated_at IS NULL AND u.deleted_at IS NULL");
    } else if (status === "disabled") {
      conditions.push("u.deactivated_at IS NOT NULL AND u.deleted_at IS NULL");
    } else if (status === "deleted") {
      conditions.push("u.deleted_at IS NOT NULL");
    }
    // When status is undefined (e.g. "All" tab), no status filter — returns all users

    if (role) {
      conditions.push(`u.role = $${paramIdx}`);
      params.push(role);
      paramIdx++;
    }

    if (search) {
      conditions.push(`(u.email ILIKE $${paramIdx} OR u.display_name ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM users u ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const offset = (page - 1) * limit;
    const dataResult = await this.pool.query<{
      id: string;
      email: string | null;
      display_name: string | null;
      role: string;
      deactivated_at: string | null;
      deleted_at: string | null;
      last_seen_at: string | null;
      created_at: string;
    }>(
      `SELECT u.id, u.email, u.display_name, u.role,
              u.deactivated_at::text, u.deleted_at::text,
              e.last_seen_at::text AS last_seen_at,
              u.created_at::text AS created_at
       FROM users u
       LEFT JOIN user_external_identities e ON e.user_id = u.id AND e.provider = 'google'
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return {
      items: dataResult.rows.map((row) => ({
        userId: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role as UserRole,
        status: row.deleted_at ? "deleted" : row.deactivated_at ? "disabled" : "active",
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at,
      })),
      total,
      page,
      limit,
    };
  }

  async changeUserRole(userId: string, newRole: UserRole, auditInput: Omit<AuditLogInput, "action">): Promise<AuthUserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query<{
        user_id: string; email: string | null; display_name: string | null;
        role: UserRole; session_version: number; is_demo: boolean;
        deactivated_at: string | null; deleted_at: string | null;
      }>(
        `SELECT id AS user_id, email, display_name, role, session_version, is_demo,
                deactivated_at::text AS deactivated_at, deleted_at::text AS deleted_at
         FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const row = result.rows[0];
      const fromRole = row.role;

      // Atomic last-admin guard when demoting an admin
      if (fromRole === "admin" && newRole !== "admin") {
        await this.assertNotLastAdminTx(client);
      }

      await client.query("UPDATE users SET role = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [userId, newRole]);

      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "admin_role_change",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, fromRole, toRole: newRole, targetEmail: row.email },
      });

      await client.query("COMMIT");

      return mapAuthUserRow({ ...row, role: newRole });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async disableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Read role under FOR UPDATE to decide last-admin guard atomically
      const check = await client.query<{ role: string }>(
        "SELECT role FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (check.rows[0]?.role === "admin") {
        await this.assertNotLastAdminTx(client);
      }

      const result = await client.query<{ email: string | null }>(
        `UPDATE users SET deactivated_at = NOW(), session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING email`,
        [userId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const { email } = result.rows[0];

      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "admin_disable_user",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: email },
      });
      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "session_force_logout",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: email, reason: "admin_disable_user" },
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async enableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query<{ email: string | null }>(
        `UPDATE users SET deactivated_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING email`,
        [userId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "admin_enable_user",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: result.rows[0].email },
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async softDeleteUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Read role under FOR UPDATE to decide last-admin guard atomically
      const check = await client.query<{ role: string }>(
        "SELECT role FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (check.rows[0]?.role === "admin") {
        await this.assertNotLastAdminTx(client);
      }

      const result = await client.query<{ email: string | null }>(
        `UPDATE users SET deleted_at = NOW(), session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING email`,
        [userId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const { email } = result.rows[0];

      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "admin_delete_user",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: email },
      });
      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "session_force_logout",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: email, reason: "admin_delete_user" },
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async hardPurgeUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Fetch user info for audit metadata before deletion
      const userResult = await client.query<{ email: string | null; display_name: string | null; role: string }>(
        "SELECT email, display_name, role FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!userResult.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "user_not_found", "User not found");
      }

      const { email, display_name, role } = userResult.rows[0];

      // Atomic last-admin guard
      if (role === "admin") {
        await this.assertNotLastAdminTx(client);
      }

      // Insert audit entries BEFORE user deletion (FK ON DELETE SET NULL preserves them)
      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "admin_hard_purge_user",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: email, targetDisplayName: display_name },
      });
      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "session_force_logout",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, targetEmail: email, reason: "admin_hard_purge_user" },
      });

      // CASCADE: Delete all user-referencing data in dependency order.
      // Tables with user_id FK that must be cleaned before user row deletion.

      // 1. Account-scoped data (depends on accounts)
      const accountIds = await client.query<{ id: string }>(
        "SELECT id FROM accounts WHERE user_id = $1",
        [userId],
      );

      if (accountIds.rows.length > 0) {
        const ids = accountIds.rows.map((r) => r.id);
        await client.query("DELETE FROM daily_holding_snapshots WHERE account_id = ANY($1)", [ids]);
        // KZO-165: composite FK (account_id, user_id) → accounts(id, user_id), so wallet
        // rows must be deleted before the accounts row below. Delete by account_id (PK
        // includes account_id, so this is index-supported).
        await client.query("DELETE FROM currency_wallet_snapshots WHERE account_id = ANY($1)", [ids]);
        await client.query("DELETE FROM cash_ledger_entries WHERE account_id = ANY($1)", [ids]);
        await client.query("DELETE FROM lot_allocations WHERE lot_id IN (SELECT id FROM lots WHERE account_id = ANY($1))", [ids]);
        await client.query("DELETE FROM lots WHERE account_id = ANY($1)", [ids]);
        // dividend_ledger_entries references accounts(id) — no user_id column
        // dividend_deduction_entries FK to dividend_ledger_entries without CASCADE
        await client.query(
          `DELETE FROM dividend_deduction_entries
           WHERE dividend_ledger_entry_id IN (SELECT id FROM dividend_ledger_entries WHERE account_id = ANY($1))`,
          [ids],
        );
        // dividend_source_lines cascades from dividend_ledger_entries (ON DELETE CASCADE)
        await client.query("DELETE FROM dividend_ledger_entries WHERE account_id = ANY($1)", [ids]);
        // corporate_actions references accounts(id) without CASCADE
        await client.query("DELETE FROM corporate_actions WHERE account_id = ANY($1)", [ids]);
        // trade_events must be deleted BEFORE trade_fee_policy_snapshots
        // (trade_events.fee_policy_snapshot_id references trade_fee_policy_snapshots without CASCADE)
        await client.query("DELETE FROM trade_events WHERE account_id = ANY($1)", [ids]);
        // trade_fee_policy_snapshot_tax_components cascades from trade_fee_policy_snapshots
        await client.query("DELETE FROM trade_fee_policy_snapshots WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM accounts WHERE user_id = $1", [userId]);
      }

      // 3. User-scoped data
      await client.query("DELETE FROM user_external_identities WHERE user_id = $1", [userId]);
      // fee_profile_tax_rules cascades from fee_profiles (ON DELETE CASCADE)
      await client.query("DELETE FROM fee_profiles WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM user_monitored_tickers WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM refresh_batches WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM recompute_jobs WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM daily_portfolio_snapshots WHERE user_id = $1", [userId]);

      // 4. SET NULL on invites (preserve invite records)
      await client.query("UPDATE invites SET issued_by_user_id = NULL WHERE issued_by_user_id = $1", [userId]);

      // 5. Notifications
      await client.query("DELETE FROM notifications WHERE user_id = $1", [userId]);

      // 6. Delete user row — FK ON DELETE SET NULL handles audit_log actor/target references
      await client.query("DELETE FROM users WHERE id = $1", [userId]);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async hasActiveJobs(userId: string): Promise<boolean> {
    // Check pgboss.job for active jobs
    const pgbossResult = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM pgboss.job
       WHERE state IN ('created', 'active', 'retry')
       AND data->>'userId' = $1`,
      [userId],
    );
    if (parseInt(pgbossResult.rows[0]!.count, 10) > 0) return true;

    // Check refresh_batches for non-terminal batches
    const batchResult = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM refresh_batches
       WHERE user_id = $1
       AND status NOT IN ('completed', 'failed')`,
      [userId],
    );
    return parseInt(batchResult.rows[0]!.count, 10) > 0;
  }

  async countActiveAdmins(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM users
       WHERE role = 'admin'
       AND deactivated_at IS NULL
       AND deleted_at IS NULL`,
    );
    return parseInt(result.rows[0]!.count, 10);
  }

  /**
   * Transactional last-admin guard: locks all active admin rows with FOR UPDATE
   * to prevent concurrent admin-removal requests from both proceeding.
   * Uses subquery to avoid FOR UPDATE + aggregate (which PostgreSQL prohibits).
   * Must be called inside an existing transaction.
   */
  private async assertNotLastAdminTx(client: PoolClient): Promise<void> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM users
       WHERE role = 'admin'
       AND deactivated_at IS NULL
       AND deleted_at IS NULL
       FOR UPDATE`,
    );
    if (result.rows.length <= 1) {
      throw routeError(409, "last_admin_blocked", "Cannot modify the last remaining admin");
    }
  }

  async listInvites(options: AdminInviteListOptions): Promise<AdminInviteListResponse> {
    const { page, limit, status, email } = options;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (status === "pending") {
      conditions.push("i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()");
    } else if (status === "used") {
      conditions.push("i.used_at IS NOT NULL");
    } else if (status === "expired") {
      conditions.push("i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at <= NOW()");
    } else if (status === "revoked") {
      conditions.push("i.revoked_at IS NOT NULL");
    }

    if (email) {
      conditions.push(`i.email ILIKE $${paramIdx}`);
      params.push(`%${email}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM invites i ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const offset = (page - 1) * limit;
    const dataResult = await this.pool.query<{
      code: string;
      email: string;
      role: string;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
      created_at: string;
      issued_by_email: string | null;
      issued_by_display_name: string | null;
    }>(
      `SELECT i.code, i.email, i.role,
              i.expires_at::text AS expires_at,
              i.used_at::text AS used_at,
              i.revoked_at::text AS revoked_at,
              i.created_at::text AS created_at,
              u.email AS issued_by_email,
              u.display_name AS issued_by_display_name
       FROM invites i
       LEFT JOIN users u ON u.id = i.issued_by_user_id
       ${whereClause}
       ORDER BY i.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return {
      items: dataResult.rows.map((row) => ({
        code: row.code,
        email: row.email,
        role: row.role as UserRole,
        status: deriveInviteStatusFromRow(row),
        expiresAt: row.expires_at,
        usedAt: row.used_at,
        revokedAt: row.revoked_at,
        issuedByEmail: row.issued_by_email,
        issuedByDisplayName: row.issued_by_display_name,
        createdAt: row.created_at,
      })),
      total,
      page,
      limit,
    };
  }

  async listAuditLog(options: AdminAuditLogListOptions): Promise<AdminAuditLogResponse> {
    const { page, limit, actorUserId, targetUserId, actions, fromDate, toDate } = options;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (actorUserId) {
      conditions.push(`a.actor_user_id = $${paramIdx}`);
      params.push(actorUserId);
      paramIdx++;
    }
    if (targetUserId) {
      conditions.push(`a.target_user_id = $${paramIdx}`);
      params.push(targetUserId);
      paramIdx++;
    }
    if (actions && actions.length > 0) {
      conditions.push(`a.action = ANY($${paramIdx})`);
      params.push(actions);
      paramIdx++;
    }
    if (fromDate) {
      conditions.push(`a.created_at >= $${paramIdx}::timestamptz`);
      params.push(fromDate);
      paramIdx++;
    }
    if (toDate) {
      conditions.push(`a.created_at <= $${paramIdx}::timestamptz`);
      params.push(toDate);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM audit_log a ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const offset = (page - 1) * limit;
    const dataResult = await this.pool.query<{
      id: string;
      actor_user_id: string | null;
      action: string;
      target_user_id: string | null;
      metadata: Record<string, unknown>;
      ip_address: string | null;
      created_at: string;
      actor_email: string | null;
    }>(
      `SELECT a.id, a.actor_user_id, a.action, a.target_user_id,
              a.metadata, a.ip_address::text, a.created_at::text AS created_at,
              u.email AS actor_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return {
      items: dataResult.rows.map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor_email ?? (row.metadata?.actorEmail as string) ?? (row.metadata?.email as string) ?? null,
        action: row.action,
        targetUserId: row.target_user_id,
        targetEmail: (row.metadata?.targetEmail as string) ?? (row.metadata?.email as string) ?? null,
        targetDisplayName: (row.metadata?.targetDisplayName as string) ?? null,
        metadata: row.metadata,
        ipAddress: row.ip_address,
        createdAt: row.created_at,
      })),
      total,
      page,
      limit,
    };
  }
}

function isUniqueViolation(error: unknown): error is Error & { code: string } {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

function mapNotificationRow(row: {
  id: string;
  user_id: string;
  severity: string;
  source: string;
  source_ref: string | null;
  title: string;
  body: string | null;
  detail: unknown;
  read_at: string | null;
  escalated_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}): NotificationDto {
  return {
    id: row.id,
    userId: row.user_id,
    severity: row.severity as NotificationDto["severity"],
    source: row.source,
    sourceRef: row.source_ref,
    title: row.title,
    body: row.body,
    detail: row.detail,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    escalatedAt: row.escalated_at ? new Date(row.escalated_at).toISOString() : null,
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validateStoreInvariants(store: Store): void {
  if (!store.userId) {
    throw new Error("store user id is required");
  }

  const profilesById = new Set(store.feeProfiles.map((profile) => profile.id));
  if (profilesById.size === 0) {
    throw new Error("at least one fee profile is required");
  }

  for (const account of store.accounts) {
    if (account.userId !== store.userId) {
      throw new Error(`account ${account.id} belongs to unexpected user`);
    }

    if (!profilesById.has(account.feeProfileId)) {
      throw new Error(`account ${account.id} references missing fee profile ${account.feeProfileId}`);
    }
  }

  const accountIds = new Set(store.accounts.map((account) => account.id));
  for (const profile of store.feeProfiles) {
    if (profile.commissionDiscountPercent < 0 || profile.commissionDiscountPercent > 100) {
      throw new Error(`fee profile ${profile.id} has invalid commission discount percent`);
    }
    if (!isCurrencyCode(profile.commissionCurrency)) {
      throw new Error(`fee profile ${profile.id} has invalid commission currency ${profile.commissionCurrency}`);
    }
    for (const taxRule of materializeFeeProfileTaxRules(profile)) {
      if (taxRule.rateBps < 0) {
        throw new Error(`fee profile ${profile.id} has invalid tax rule ${taxRule.id}`);
      }
    }
  }
  validateMarketDataInvariants(store.marketData);
  validateAccountingStoreInvariants(store.accounting, accountIds);
  validateAccountingMarketDataCrossReferences(store.accounting, store.marketData);
  for (const binding of store.feeProfileBindings) {
    if (!accountIds.has(binding.accountId)) {
      throw new Error(`fee profile binding references unknown account ${binding.accountId}`);
    }
    if (!profilesById.has(binding.feeProfileId)) {
      throw new Error(`fee profile binding references unknown profile ${binding.feeProfileId}`);
    }
    if (!/^[A-Za-z0-9]{1,16}$/.test(binding.ticker)) {
      throw new Error(`fee profile binding has invalid ticker ${binding.ticker}`);
    }
    if (binding.marketCode && !/^[A-Z]{2,8}$/.test(binding.marketCode)) {
      throw new Error(`fee profile binding has invalid market code ${binding.marketCode}`);
    }
  }
}

function validateAccountingStoreInvariants(accounting: AccountingStore, accountIds?: Set<string>): void {
  if (accounting.policy.inventoryModel !== "LOT_CAPABLE") {
    throw new Error("accounting policy must preserve lot-capable inventory");
  }

  if (accounting.policy.disposalPolicy !== "WEIGHTED_AVERAGE") {
    throw new Error("accounting policy must define weighted-average disposal behavior");
  }

  const tradeIds = new Set(accounting.facts.tradeEvents.map((trade) => trade.id));
  const lotIds = new Set(accounting.projections.lots.map((lot) => lot.id));
  const dividendLedgerIds = new Set(accounting.facts.dividendLedgerEntries.map((entry) => entry.id));
  const tradeBookingKeys = new Set<string>();

  for (const trade of accounting.facts.tradeEvents) {
    if (!isCurrencyCode(trade.priceCurrency)) {
      throw new Error(`trade ${trade.id} has invalid price currency ${trade.priceCurrency}`);
    }
    if (trade.marketCode && !/^[A-Z]{2,8}$/.test(trade.marketCode)) {
      throw new Error(`trade ${trade.id} has invalid market code ${trade.marketCode}`);
    }

    if (trade.bookingSequence !== undefined && trade.bookingSequence <= 0) {
      throw new Error(`trade ${trade.id} has invalid booking sequence`);
    }

    if (trade.bookingSequence !== undefined) {
      const bookingKey = `${trade.accountId}:${trade.tradeDate}:${trade.bookingSequence}`;
      if (tradeBookingKeys.has(bookingKey)) {
        throw new Error(
          `trade ${trade.id} duplicates booking sequence ${trade.bookingSequence} for ${trade.accountId} on ${trade.tradeDate}`,
        );
      }
      tradeBookingKeys.add(bookingKey);
    }
  }

  const lotOpenedKeys = new Set<string>();
  const supersededDividendLedgerEntryIds = new Set(
    accounting.facts.dividendLedgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((entry): entry is string => Boolean(entry)),
  );
  const activeDividendKeys = new Set<string>();

  for (const lot of accounting.projections.lots) {
    if (!isCurrencyCode(lot.costCurrency)) {
      throw new Error(`lot ${lot.id} has invalid cost currency ${lot.costCurrency}`);
    }

    if (lot.openedSequence !== undefined && lot.openedSequence <= 0) {
      throw new Error(`lot ${lot.id} has invalid opened sequence`);
    }

    if (lot.openedSequence !== undefined) {
      const openedKey = `${lot.accountId}:${lot.ticker}:${lot.openedAt}:${lot.openedSequence}`;
      if (lotOpenedKeys.has(openedKey)) {
        throw new Error(
          `lot ${lot.id} duplicates opened sequence ${lot.openedSequence} for ${lot.accountId} ${lot.ticker} on ${lot.openedAt}`,
        );
      }
      lotOpenedKeys.add(openedKey);
    }
  }

  for (const dividendLedgerEntry of accounting.facts.dividendLedgerEntries) {
    if (accountIds && !accountIds.has(dividendLedgerEntry.accountId)) {
      throw new Error(
        `dividend ledger entry ${dividendLedgerEntry.id} references unknown account ${dividendLedgerEntry.accountId}`,
      );
    }
    const version = dividendLedgerEntry.version ?? 1;
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`dividend ledger entry ${dividendLedgerEntry.id} has invalid version ${dividendLedgerEntry.version}`);
    }
    if (dividendLedgerEntry.postingStatus === "expected" && dividendLedgerEntry.reconciliationStatus !== "open") {
      throw new Error(`expected dividend ledger entry ${dividendLedgerEntry.id} must remain reconciliation open`);
    }
    if (
      ["matched", "explained", "resolved"].includes(dividendLedgerEntry.reconciliationStatus) &&
      !["posted", "adjusted"].includes(dividendLedgerEntry.postingStatus)
    ) {
      throw new Error(`dividend ledger entry ${dividendLedgerEntry.id} has invalid posting/reconciliation status pair`);
    }
    if (dividendLedgerEntry.reconciliationStatus === "explained" && !dividendLedgerEntry.reconciliationNote?.trim()) {
      throw new Error(`dividend ledger entry ${dividendLedgerEntry.id} requires reconciliation note when explained`);
    }
    if (
      !dividendLedgerEntry.reversalOfDividendLedgerEntryId &&
      !dividendLedgerEntry.supersededAt &&
      !supersededDividendLedgerEntryIds.has(dividendLedgerEntry.id)
    ) {
      const activeKey = `${dividendLedgerEntry.accountId}:${dividendLedgerEntry.dividendEventId}`;
      if (activeDividendKeys.has(activeKey)) {
        throw new Error(`dividend ledger entry ${dividendLedgerEntry.id} duplicates active row for ${activeKey}`);
      }
      activeDividendKeys.add(activeKey);
    }
  }

  for (const allocation of accounting.projections.lotAllocations) {
    if (!tradeIds.has(allocation.tradeEventId)) {
      throw new Error(`lot allocation ${allocation.id} references unknown trade ${allocation.tradeEventId}`);
    }
    if (!lotIds.has(allocation.lotId)) {
      throw new Error(`lot allocation ${allocation.id} references unknown lot ${allocation.lotId}`);
    }
    if (!isCurrencyCode(allocation.costCurrency)) {
      throw new Error(`lot allocation ${allocation.id} has invalid cost currency ${allocation.costCurrency}`);
    }
  }

  for (const cashEntry of accounting.facts.cashLedgerEntries) {
    if (!isCurrencyCode(cashEntry.currency)) {
      throw new Error(`cash ledger entry ${cashEntry.id} has invalid currency ${cashEntry.currency}`);
    }

    if (
      cashEntry.relatedDividendLedgerEntryId &&
      !dividendLedgerIds.has(cashEntry.relatedDividendLedgerEntryId)
    ) {
      throw new Error(
        `cash ledger entry ${cashEntry.id} references unknown dividend ledger ${cashEntry.relatedDividendLedgerEntryId}`,
      );
    }
  }

  for (const deduction of accounting.facts.dividendDeductionEntries) {
    if (!dividendLedgerIds.has(deduction.dividendLedgerEntryId)) {
      throw new Error(
        `dividend deduction ${deduction.id} references unknown dividend ledger ${deduction.dividendLedgerEntryId}`,
      );
    }
    if (!isCurrencyCode(deduction.currencyCode)) {
      throw new Error(`dividend deduction ${deduction.id} has invalid currency ${deduction.currencyCode}`);
    }
  }

  for (const sourceLine of accounting.facts.dividendSourceLines) {
    if (!dividendLedgerIds.has(sourceLine.dividendLedgerEntryId)) {
      throw new Error(
        `dividend source line ${sourceLine.id} references unknown dividend ledger ${sourceLine.dividendLedgerEntryId}`,
      );
    }
    if (sourceLine.currencyCode !== "TWD") {
      throw new Error(`dividend source line ${sourceLine.id} has invalid currency ${sourceLine.currencyCode}`);
    }
  }

}

function validateMarketDataInvariants(marketData: MarketDataFacts): void {
  const dividendEventIds = new Set<string>();

  for (const dividendEvent of marketData.dividendEvents) {
    if (dividendEventIds.has(dividendEvent.id)) {
      throw new Error(`duplicate dividend event ${dividendEvent.id}`);
    }
    dividendEventIds.add(dividendEvent.id);

    if (!isCurrencyCode(dividendEvent.cashDividendCurrency)) {
      throw new Error(`dividend event ${dividendEvent.id} has invalid cash currency ${dividendEvent.cashDividendCurrency}`);
    }
  }

  for (const instrument of marketData.instruments) {
    if (!/^[A-Za-z0-9]{1,16}$/.test(instrument.ticker)) {
      throw new Error(`instrument ${instrument.ticker} has invalid ticker`);
    }
    if (!/^[A-Z]{2,8}$/.test(instrument.marketCode)) {
      throw new Error(`instrument ${instrument.ticker} has invalid market code ${instrument.marketCode}`);
    }
  }
}

function validateAccountingMarketDataCrossReferences(accounting: AccountingStore, marketData: MarketDataFacts): void {
  const eventById = new Map(marketData.dividendEvents.map((event) => [event.id, event]));
  const dividendLedgerIds = new Set(accounting.facts.dividendLedgerEntries.map((entry) => entry.id));

  for (const dividendLedgerEntry of accounting.facts.dividendLedgerEntries) {
    if (!eventById.has(dividendLedgerEntry.dividendEventId)) {
      throw new Error(
        `dividend ledger entry ${dividendLedgerEntry.id} references unknown dividend event ${dividendLedgerEntry.dividendEventId}`,
      );
    }
  }

  const dividendEventCurrencyByLedgerId = new Map(
    accounting.facts.dividendLedgerEntries.map((entry) => [entry.id, eventById.get(entry.dividendEventId)?.cashDividendCurrency]),
  );

  for (const deduction of accounting.facts.dividendDeductionEntries) {
    if (!dividendLedgerIds.has(deduction.dividendLedgerEntryId)) {
      continue;
    }

    const expectedCurrency = dividendEventCurrencyByLedgerId.get(deduction.dividendLedgerEntryId);
    if (!expectedCurrency) {
      throw new Error(`dividend deduction ${deduction.id} is missing parent dividend currency context`);
    }

    if (deduction.currencyCode !== expectedCurrency) {
      throw new Error(`dividend deduction ${deduction.id} currency must match parent dividend currency ${expectedCurrency}`);
    }
  }
}

function mapTradeEventRow(row: Record<string, unknown>, taxRuleRows: Record<string, unknown>[]): BookedTradeEvent {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    accountId: String(row.account_id),
    ticker: String(row.ticker),
    marketCode: row.market_code ? String(row.market_code) : undefined,
    instrumentType: String(row.instrument_type) as BookedTradeEvent["instrumentType"],
    type: String(row.trade_type) as BookedTradeEvent["type"],
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    priceCurrency: String(row.price_currency) as BookedTradeEvent["priceCurrency"],
    tradeDate: normalizeDate(row.trade_date as string | Date),
    tradeTimestamp: normalizeDateTime(row.trade_timestamp as string | Date),
    bookingSequence: Number(row.booking_sequence),
    commissionAmount: Number(row.commission_amount),
    taxAmount: Number(row.tax_amount),
    isDayTrade: Boolean(row.is_day_trade),
    feeSnapshot: hydrateTradeFeeSnapshot(row, taxRuleRows),
    source: String(row.source),
    sourceReference: row.source_reference ? String(row.source_reference) : undefined,
    bookedAt: normalizeDateTime(row.booked_at as string | Date),
    realizedPnlCurrency: String(row.price_currency) as BookedTradeEvent["priceCurrency"],
    reversalOfTradeEventId: row.reversal_of_trade_event_id ? String(row.reversal_of_trade_event_id) : undefined,
    feesSource: row.fees_source ? (String(row.fees_source) as BookedTradeEvent["feesSource"]) : undefined,
  };
}

function normalizeDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateTime(value: string | Date): string {
  if (typeof value === "string") return new Date(value).toISOString();
  return value.toISOString();
}

function mapDividendLedgerEntryRow(row: Record<string, unknown>): DividendLedgerEntry {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    dividendEventId: String(row.dividend_event_id),
    eligibleQuantity: Number(row.eligible_quantity),
    expectedCashAmount: Number(row.expected_cash_amount),
    expectedStockQuantity: Number(row.expected_stock_quantity),
    receivedCashAmount: Number(row.received_cash_amount ?? 0),
    receivedStockQuantity: Number(row.received_stock_quantity),
    postingStatus: String(row.posting_status) as DividendLedgerEntry["postingStatus"],
    reconciliationStatus: String(row.reconciliation_status) as DividendLedgerEntry["reconciliationStatus"],
    version: Number(row.version ?? 1),
    sourceCompositionStatus: String(row.source_composition_status ?? "unknown_pending_disclosure") as DividendLedgerEntry["sourceCompositionStatus"],
    reconciliationNote: row.reconciliation_note ? String(row.reconciliation_note) : undefined,
    reversalOfDividendLedgerEntryId: row.reversal_of_dividend_ledger_entry_id ? String(row.reversal_of_dividend_ledger_entry_id) : undefined,
    supersededAt: row.superseded_at ? normalizeDateTime(String(row.superseded_at)) : undefined,
    bookedAt: row.booked_at ? normalizeDateTime(String(row.booked_at)) : undefined,
  };
}

function feePolicySnapshotIdForTrade(tradeEventId: string): string {
  return `trade-fee-snapshot:${tradeEventId}`;
}

async function insertTradeFeePolicySnapshot(
  client: PoolClient,
  userId: string,
  snapshotId: string,
  trade: Transaction,
  feeSnapshot: FeeProfile,
  bookedAt?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO trade_fee_policy_snapshots (
       id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
       commission_discount_percent, minimum_commission_amount, commission_currency,
       commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
       stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
       commission_charge_mode, booked_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11,
       $12, $13, $14,
       $15, $16
     )`,
    [
      snapshotId,
      userId,
      feeSnapshot.id,
      feeSnapshot.name,
      feeSnapshot.boardCommissionRate,
      feeSnapshot.commissionDiscountPercent,
      feeSnapshot.minimumCommissionAmount,
      feeSnapshot.commissionCurrency,
      feeSnapshot.commissionRoundingMode,
      feeSnapshot.taxRoundingMode,
      feeSnapshot.stockSellTaxRateBps,
      feeSnapshot.stockDayTradeTaxRateBps,
      feeSnapshot.etfSellTaxRateBps,
      feeSnapshot.bondEtfSellTaxRateBps,
      feeSnapshot.commissionChargeMode,
      bookedAt ?? new Date().toISOString(),
    ],
  );

  if (trade.type !== "SELL") {
    return;
  }

  const calculatedTaxComponents = calculateAppliedTaxComponents(feeSnapshot, {
    tradeValueAmount: roundToDecimal(trade.quantity * trade.unitPrice, 2),
    instrumentType: trade.instrumentType,
    isDayTrade: trade.isDayTrade,
    marketCode: trade.marketCode ?? "TW",
  });
  if (!calculatedTaxComponents.length) {
    return;
  }

  const bookedTaxAmounts = alignBookedTaxComponentAmounts(trade.taxAmount, calculatedTaxComponents.map((component) => component.taxAmount));
  for (const [index, component] of calculatedTaxComponents.entries()) {
    await client.query(
      `INSERT INTO trade_fee_policy_snapshot_tax_components (
         id, snapshot_id, market_code, trade_side, instrument_type, day_trade_scope,
         tax_component_code, calculation_method, rate_bps, booked_tax_amount, sort_order
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11
       )`,
      [
        `${snapshotId}:tax:${component.sortOrder}`,
        snapshotId,
        component.marketCode,
        component.tradeSide,
        component.instrumentType,
        component.dayTradeScope,
        component.taxComponentCode,
        component.calculationMethod,
        component.rateBps,
        bookedTaxAmounts[index] ?? 0,
        component.sortOrder,
      ],
    );
  }
}

function legacyCommissionRateBps(boardCommissionRate: number): number {
  return Math.round(boardCommissionRate * 10);
}

function legacyCommissionDiscountBps(commissionDiscountPercent: number): number {
  return Math.round((100 - commissionDiscountPercent) * 100);
}

function legacyCommissionDiscountPercent(commissionDiscountBps: number | null | undefined): number {
  return Number(((10_000 - Number(commissionDiscountBps ?? 10_000)) / 100).toFixed(2));
}

function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function hydrateEditableFeeProfile(row: Record<string, unknown>, taxRuleRows: Record<string, unknown>[]): FeeProfile {
  const base = buildFeeProfileFromRow(row, "id", "name");
  const taxRules = hydrateTaxRulesFromRows(taxRuleRows, base);
  const legacyTaxFields = projectLegacyFeeProfileTaxFields(taxRules);
  return {
    ...base,
    ...legacyTaxFields,
    taxRules,
  };
}

function hydrateTradeFeeSnapshot(row: Record<string, unknown>, taxRuleRows: Record<string, unknown>[]): FeeProfile {
  const base = buildFeeProfileFromRow(row, "profile_id_at_booking", "profile_name_at_booking");
  const taxRules = hydrateTaxRulesFromRows(taxRuleRows, base);
  const legacyTaxFields = projectLegacyFeeProfileTaxFields(taxRules);
  return {
    ...base,
    ...legacyTaxFields,
    taxRules,
  };
}

function buildFeeProfileFromRow(
  row: Record<string, unknown>,
  idKey: string,
  nameKey: string,
): FeeProfile {
  return {
    id: String(row[idKey]),
    name: String(row[nameKey]),
    boardCommissionRate: Number(row.board_commission_rate ?? Number(row.commission_rate_bps) / 10),
    commissionDiscountPercent:
      row.commission_discount_percent !== null && row.commission_discount_percent !== undefined
        ? Number(row.commission_discount_percent)
        : legacyCommissionDiscountPercent(row.commission_discount_bps as number | null | undefined),
    minimumCommissionAmount: Number(row.minimum_commission_amount),
    commissionCurrency: String(row.commission_currency),
    commissionRoundingMode: String(row.commission_rounding_mode) as FeeProfile["commissionRoundingMode"],
    taxRoundingMode: String(row.tax_rounding_mode) as FeeProfile["taxRoundingMode"],
    stockSellTaxRateBps: Number(row.stock_sell_tax_rate_bps ?? 0),
    stockDayTradeTaxRateBps: Number(row.stock_day_trade_tax_rate_bps ?? 0),
    etfSellTaxRateBps: Number(row.etf_sell_tax_rate_bps ?? 0),
    bondEtfSellTaxRateBps: Number(row.bond_etf_sell_tax_rate_bps ?? 0),
    commissionChargeMode: String(row.commission_charge_mode ?? "CHARGED_UPFRONT") as FeeProfile["commissionChargeMode"],
  };
}

function hydrateTaxRulesFromRows(
  rows: Record<string, unknown>[],
  fallbackProfile: FeeProfile,
): FeeProfileTaxRule[] {
  if (!rows.length) {
    return materializeFeeProfileTaxRules(fallbackProfile);
  }

  return rows.map((row) => ({
    id: String(row.id),
    marketCode: String(row.market_code),
    tradeSide: String(row.trade_side) as FeeProfileTaxRule["tradeSide"],
    instrumentType: String(row.instrument_type) as FeeProfileTaxRule["instrumentType"],
    dayTradeScope: String(row.day_trade_scope) as FeeProfileTaxRule["dayTradeScope"],
    taxComponentCode: String(row.tax_component_code),
    calculationMethod: String(row.calculation_method) as FeeProfileTaxRule["calculationMethod"],
    rateBps: Number(row.rate_bps),
    sortOrder: Number(row.sort_order),
    effectiveFrom: row.effective_from ? normalizeDate(String(row.effective_from)) : undefined,
    effectiveTo: row.effective_to ? normalizeDate(String(row.effective_to)) : undefined,
  })).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
}

function groupRowsByKey(rows: Record<string, unknown>[], key: string): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const rowKey = String(row[key]);
    const current = grouped.get(rowKey);
    if (current) {
      current.push(row);
      continue;
    }
    grouped.set(rowKey, [row]);
  }
  return grouped;
}

async function replaceFeeProfileTaxRules(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  userId: string,
  profile: FeeProfile,
): Promise<void> {
  const taxRules = materializeFeeProfileTaxRules(profile);
  await client.query(`DELETE FROM fee_profile_tax_rules WHERE fee_profile_id = $1`, [profile.id]);

  for (const rule of taxRules) {
    await client.query(
      `INSERT INTO fee_profile_tax_rules (
         id, user_id, fee_profile_id, market_code, trade_side, instrument_type, day_trade_scope,
         tax_component_code, calculation_method, rate_bps, effective_from, effective_to, sort_order
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13
       )`,
      [
        rule.id,
        userId,
        profile.id,
        rule.marketCode,
        rule.tradeSide,
        rule.instrumentType,
        rule.dayTradeScope,
        rule.taxComponentCode,
        rule.calculationMethod,
        rule.rateBps,
        rule.effectiveFrom ?? null,
        rule.effectiveTo ?? null,
        rule.sortOrder,
      ],
    );
  }
}

/** Idempotent insert of default tax rules — safe under concurrent calls. */
async function ensureFeeProfileTaxRules(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  userId: string,
  profile: FeeProfile,
): Promise<void> {
  const taxRules = materializeFeeProfileTaxRules(profile);

  for (const rule of taxRules) {
    await client.query(
      `INSERT INTO fee_profile_tax_rules (
         id, user_id, fee_profile_id, market_code, trade_side, instrument_type, day_trade_scope,
         tax_component_code, calculation_method, rate_bps, effective_from, effective_to, sort_order
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        rule.id,
        userId,
        profile.id,
        rule.marketCode,
        rule.tradeSide,
        rule.instrumentType,
        rule.dayTradeScope,
        rule.taxComponentCode,
        rule.calculationMethod,
        rule.rateBps,
        rule.effectiveFrom ?? null,
        rule.effectiveTo ?? null,
        rule.sortOrder,
      ],
    );
  }
}

function alignBookedTaxComponentAmounts(bookedTaxAmount: number, calculatedComponentAmounts: number[]): number[] {
  if (!calculatedComponentAmounts.length) return [];
  if (calculatedComponentAmounts.length === 1) return [bookedTaxAmount];

  const aligned = [...calculatedComponentAmounts];
  const calculatedTotal = aligned.reduce((total, amount) => total + amount, 0);
  aligned[aligned.length - 1] = Math.max(0, aligned[aligned.length - 1] + (bookedTaxAmount - calculatedTotal));
  return aligned;
}
