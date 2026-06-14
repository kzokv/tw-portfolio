import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, types, type PoolClient } from "pg";
import { createClient, type RedisClientType } from "redis";
import { Env } from "@vakwen/config";
import {
  calculateAppliedTaxComponents,
  materializeFeeProfileTaxRules,
  projectLegacyFeeProfileTaxFields,
  type FeeProfile,
  type FeeProfileTaxRule,
} from "@vakwen/domain";
import type { DailyBar, DailyBarWithMarket, InstrumentType, MarketCode } from "@vakwen/domain";
import type { FxRate } from "../services/market-data/types.js";
import { buildRedisSocketOptions } from "../lib/redisClientOptions.js";
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
  AiConnectorAccessKind,
  AiConnectorAccessResult,
  AiConnectorPolicySettingsDto,
  AiConnectorProvider,
  AiConnectorScope,
  AiConnectorStatus,
  AiTransactionDraftBatchStatus,
  AiTransactionDraftEventType,
  AiTransactionDraftRowState,
  AiTransactionDraftSourceChannel,
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
  ShareCapability,
  TickerFundamentalsDto,
} from "@vakwen/shared-types";
import { marketCodeFor, normalizeInstrumentSector } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import { roundToDecimal } from "@vakwen/domain";
import type { Lot } from "@vakwen/domain";
import type { BookedTradeEvent } from "../types/store.js";
import type {
  AdminAuditLogListOptions,
  AdminInviteListOptions,
  AdminUserListOptions,
  AnonymousShareTokenRecord,
  AuditLogInput,
  AuthUserRecord,
  ConfirmAiTransactionDraftPostingInput,
  ConfirmAiTransactionDraftPostingResult,
  CreateAnonymousShareTokenInput,
  CreateAnonymousShareTokenResult,
  CreateShareCoupledInviteInput,
  CreateShareGrantInput,
  ConsumeInviteResult,
  CreateInviteInput,
  AccountWithLiveBalancesRecord,
  CashLedgerEnrichmentResult,
  CashLedgerListOptions,
  CashLedgerListResult,
  CashLedgerSortColumn,
  CatalogInstrument,
  CatalogSyncResult,
  DelistingRecord,
  DeleteTradeEventResult,
  DividendLedgerListOptions,
  DividendLedgerListResult,
  DividendReviewListResult,
  DividendReviewRowWithDetails,
  InstrumentRow,
  InviteRecord,
  InviteStatus,
  ListInboundSharesForGranteeResult,
  ListSharesForOwnerResult,
  MaterializePendingSharesInput,
  OAuthClaims,
  PendingShareInviteRecord,
  Persistence,
  PersistedTickerFundamentalsRecord,
  ReadinessStatus,
  RecordTickerFundamentalsRefreshFailureInput,
  ResolveOrCreateUserOptions,
  ResolveOrCreateUserResult,
  RevokeAnonymousShareTokenInput,
  RevokeAnonymousShareTokenResult,
  SaveTickerFundamentalsSnapshotInput,
  ShareGrantRecord,
  TradeEventPatch,
  UpdatePostedCashDividendInput,
  HoldingSnapshot,
  AggregatedSnapshotPoint,
  ActivateAiConnectorConnectionReplacingProviderInput,
  ActivateAiConnectorConnectionReplacingProviderResult,
  AiConnectorAccessLogRecord,
  AiConnectorCredentialRecord,
  AiConnectorConnectionRecord,
  AdminMarketDataBackfillTargetRow,
  AdminMarketDataPurgeCounts,
  AdminMarketDataPurgeInput,
  McpOAuthAuthorizationCodeRecord,
  McpOAuthAuthorizationRequestRecord,
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftBatchRecord,
  AiTransactionDraftEventRecord,
  AiTransactionDraftRowRecord,
  AiTransactionDraftUnsupportedItemRecord,
  AppendAiConnectorAccessLogInput,
  AppendAiTransactionDraftEventInput,
  ApproveMcpOAuthAuthorizationRequestInput,
  ApproveMcpOAuthAuthorizationRequestResult,
  CreateProviderOperationInput,
  CreateProviderOperationLogInput,
  DeleteProviderResolutionMappingInput,
  ListProviderErrorTrailOptions,
  ListProviderErrorTrailResult,
  ListProviderIncidentsOptions,
  ListProviderIncidentsResult,
  ListProviderOperationLogsOptions,
  ListProviderOperationLogsResult,
  ListProviderOperationOutcomesOptions,
  ListProviderOperationOutcomesResult,
  ListProviderOperationsOptions,
  ListProviderOperationsResult,
  ListProviderResolutionMappingsOptions,
  ListProviderResolutionMappingsResult,
  ListProviderUnresolvedItemsOptions,
  ListProviderUnresolvedItemsResult,
  ProviderErrorTrailInput,
  ProviderErrorTrailRow,
  ProviderHealthRow,
  ProviderHealthStatus,
  ProviderHealthUpsert,
  ProviderErrorClass,
  ProviderIncidentRecord,
  ProviderLogPurgeCounts,
  ProviderOperationLogRecord,
  ProviderOperationPhase,
  ProviderOperationRecord,
  ProviderOperationLogLevel,
  ProviderOperationOutcomeRecord,
  ProviderResolutionMappingRecord,
  ProviderUnresolvedItemRecord,
  ResolveProviderUnresolvedItemsInput,
  SaveAiConnectorCredentialInput,
  SaveAiConnectorConnectionInput,
  SaveAiConnectorPolicySettingsInput,
  SaveMcpOAuthAuthorizationCodeInput,
  SaveMcpOAuthAuthorizationRequestInput,
  SaveAiTransactionDraftBatchInput,
  SaveAiTransactionDraftRowInput,
  SaveAiTransactionDraftUnsupportedItemInput,
  SetPendingShareInviteCapabilitiesInput,
  SetShareCapabilitiesInput,
  UpdateProviderIncidentStatusInput,
  UpdateProviderOperationInput,
  UpdateProviderUnresolvedItemStateInput,
  UpsertProviderIncidentInput,
  UpsertProviderOperationOutcomeInput,
  UpsertProviderUnresolvedItemInput,
  UpsertProviderResolutionMappingInput,
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
import { createEmptyTickerFundamentals, normalizeTickerFundamentals } from "../services/fundamentals/types.js";
import {
  providerIncidentInputFromErrorTrail,
  providerUnresolvedItemInputFromErrorTrail,
} from "../services/market-data/providerErrorNormalization.js";

types.setTypeParser(types.builtins.DATE, (value: string) => value);

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

function mapAiConnectorConnectionRow(row: {
  id: string;
  user_id: string;
  provider: AiConnectorProvider;
  display_name: string;
  status: AiConnectorStatus;
  oauth_client_id: string | null;
  oauth_subject: string | null;
  scopes: AiConnectorScope[] | null;
  tool_toggles: Record<string, boolean> | null;
  expires_at: string | null;
  expiry_notified_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
}): AiConnectorConnectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    oauthClientId: row.oauth_client_id,
    oauthSubject: row.oauth_subject,
    scopes: [...(row.scopes ?? [])].sort(),
    toolToggles: { ...(row.tool_toggles ?? {}) },
    expiresAt: row.expires_at,
    expiryNotifiedAt: row.expiry_notified_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    revocationReason: row.revocation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAiConnectorPolicySettingsRow(row: {
  enabled: boolean;
  max_active_connections_per_user: number;
  allow_chatgpt: boolean;
  allow_self_hosted: boolean;
  read_tools_enabled: boolean;
  draft_tools_enabled: boolean;
  write_tools_enabled: boolean;
  inactivity_expiry_days: number;
  expiration_warning_days: number;
  fresh_auth_max_age_ms: number;
  max_connector_lifetime_days: number;
  oauth_public_issuer: string | null;
  oauth_redirect_uri_allowlist: string[] | null;
  oauth_token_secret_set?: boolean;
  updated_at: string;
}): AiConnectorPolicySettingsDto {
  return {
    enabled: row.enabled,
    maxActiveConnectionsPerUser: row.max_active_connections_per_user,
    allowedProviders: {
      chatgpt: row.allow_chatgpt,
      self_hosted: row.allow_self_hosted,
    },
    groupToggles: {
      read: row.read_tools_enabled,
      drafts: row.draft_tools_enabled,
      write: row.write_tools_enabled,
    },
    inactivityExpiryDays: row.inactivity_expiry_days,
    expirationWarningDays: row.expiration_warning_days,
    freshAuthMaxAgeMs: row.fresh_auth_max_age_ms,
    maxConnectorLifetimeDays: row.max_connector_lifetime_days,
    oauthPublicIssuer: row.oauth_public_issuer,
    oauthRedirectUriAllowlist: [...(row.oauth_redirect_uri_allowlist ?? [])],
    oauthTokenSecretSet: row.oauth_token_secret_set ?? false,
    updatedAt: row.updated_at,
  };
}

function mapMcpOAuthAuthorizationRequestRow(row: {
  id: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  resource: string;
  scopes: AiConnectorScope[] | null;
  code_challenge: string;
  code_challenge_method: "S256";
  csrf_token_hash: string;
  expires_at: string;
  approved_at: string | null;
  denied_at: string | null;
  created_at: string;
}): McpOAuthAuthorizationRequestRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    state: row.state,
    resource: row.resource,
    scopes: [...(row.scopes ?? [])].sort(),
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    csrfTokenHash: row.csrf_token_hash,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
    deniedAt: row.denied_at,
    createdAt: row.created_at,
  };
}

function mapMcpOAuthAuthorizationCodeRow(row: {
  id: string;
  code_hash: string;
  connection_id: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  scopes: AiConnectorScope[] | null;
  code_challenge: string;
  code_challenge_method: "S256";
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}): McpOAuthAuthorizationCodeRecord {
  return {
    id: row.id,
    codeHash: row.code_hash,
    connectionId: row.connection_id,
    userId: row.user_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    resource: row.resource,
    scopes: [...(row.scopes ?? [])].sort(),
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

function mapAiConnectorCredentialRow(row: {
  id: string;
  connection_id: string;
  credential_type: "oauth_refresh_token" | "self_hosted_token";
  token_hash: string;
  token_hint: string | null;
  token_family_id: string | null;
  predecessor_credential_id: string | null;
  replaced_by_credential_id: string | null;
  oauth_client_id: string | null;
  resource: string | null;
  scopes: AiConnectorScope[] | null;
  session_version: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}): AiConnectorCredentialRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    credentialType: row.credential_type,
    tokenHash: row.token_hash,
    tokenHint: row.token_hint,
    tokenFamilyId: row.token_family_id,
    predecessorCredentialId: row.predecessor_credential_id,
    replacedByCredentialId: row.replaced_by_credential_id,
    oauthClientId: row.oauth_client_id,
    resource: row.resource,
    scopes: [...(row.scopes ?? [])].sort(),
    sessionVersion: row.session_version,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function mapAiConnectorAccessLogRow(row: {
  id: string;
  connection_id: string | null;
  user_id: string;
  portfolio_context_user_id: string;
  share_id: string | null;
  tool_name: string;
  access_kind: AiConnectorAccessKind;
  result: AiConnectorAccessResult;
  denial_reason: string | null;
  request_id: string | null;
  source_ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}): AiConnectorAccessLogRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    userId: row.user_id,
    portfolioContextUserId: row.portfolio_context_user_id,
    shareId: row.share_id,
    toolName: row.tool_name,
    accessKind: row.access_kind,
    result: row.result,
    denialReason: row.denial_reason,
    requestId: row.request_id,
    sourceIp: row.source_ip,
    userAgent: row.user_agent,
    metadata: { ...(row.metadata ?? {}) },
    createdAt: row.created_at,
  };
}

function mapAiTransactionDraftBatchRow(row: {
  id: string;
  owner_user_id: string;
  created_by_user_id: string;
  connector_connection_id: string | null;
  share_id: string | null;
  source_channel: AiTransactionDraftSourceChannel;
  status: AiTransactionDraftBatchStatus;
  version: number;
  source_label: string | null;
  source_filename: string | null;
  note: string | null;
  provenance: Record<string, unknown> | null;
  row_count: number;
  unsupported_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by_user_id: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
}): AiTransactionDraftBatchRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    createdByUserId: row.created_by_user_id,
    connectorConnectionId: row.connector_connection_id,
    shareId: row.share_id,
    sourceChannel: row.source_channel,
    status: row.status,
    version: Number(row.version),
    sourceLabel: row.source_label,
    sourceFilename: row.source_filename,
    note: row.note,
    provenance: { ...(row.provenance ?? {}) },
    rowCount: Number(row.row_count),
    unsupportedCount: Number(row.unsupported_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    archivedByUserId: row.archived_by_user_id,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
  };
}

function mapAiTransactionDraftRowRow(row: {
  id: string;
  batch_id: string;
  owner_user_id: string;
  row_number: number;
  state: AiTransactionDraftRowState;
  version: number;
  account_id: string | null;
  account_name_input: string | null;
  trade_type: "BUY" | "SELL" | null;
  ticker: string | null;
  market_code: string | null;
  quantity: number | null;
  unit_price: string | number | null;
  price_currency: string | null;
  trade_date: string | null;
  trade_timestamp: string | null;
  booking_sequence: number | null;
  is_day_trade: boolean | null;
  commission_amount: string | number | null;
  tax_amount: string | number | null;
  fees_source: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
  note: string | null;
  source_row_ref: string | null;
  source_snippet: string | null;
  normalized_payload: Record<string, unknown> | null;
  preflight_issues: unknown[] | null;
  warnings: unknown[] | null;
  duplicate_trade_event_id: string | null;
  confirmed_trade_event_id: string | null;
  confirmed_at: string | null;
  confirmed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}): AiTransactionDraftRowRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    ownerUserId: row.owner_user_id,
    rowNumber: Number(row.row_number),
    state: row.state,
    version: Number(row.version),
    accountId: row.account_id,
    accountNameInput: row.account_name_input,
    tradeType: row.trade_type,
    ticker: row.ticker,
    marketCode: row.market_code,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    priceCurrency: row.price_currency,
    tradeDate: row.trade_date,
    tradeTimestamp: row.trade_timestamp,
    bookingSequence: row.booking_sequence === null ? null : Number(row.booking_sequence),
    isDayTrade: row.is_day_trade,
    commissionAmount: row.commission_amount === null ? null : Number(row.commission_amount),
    taxAmount: row.tax_amount === null ? null : Number(row.tax_amount),
    feesSource: row.fees_source,
    note: row.note,
    sourceRowRef: row.source_row_ref,
    sourceSnippet: row.source_snippet,
    normalizedPayload: { ...(row.normalized_payload ?? {}) },
    preflightIssues: [...(row.preflight_issues ?? [])],
    warnings: [...(row.warnings ?? [])],
    duplicateTradeEventId: row.duplicate_trade_event_id,
    confirmedTradeEventId: row.confirmed_trade_event_id,
    confirmedAt: row.confirmed_at,
    confirmedByUserId: row.confirmed_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAiTransactionDraftUnsupportedItemRow(row: {
  id: string;
  batch_id: string;
  row_number: number | null;
  category: string;
  reason: string;
  source_snippet: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}): AiTransactionDraftUnsupportedItemRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    rowNumber: row.row_number === null ? null : Number(row.row_number),
    category: row.category,
    reason: row.reason,
    sourceSnippet: row.source_snippet,
    rawPayload: { ...(row.raw_payload ?? {}) },
    createdAt: row.created_at,
  };
}

function mapAiTransactionDraftEventRow(row: {
  id: string;
  batch_id: string;
  row_id: string | null;
  owner_user_id: string | null;
  actor_user_id: string | null;
  connector_connection_id: string | null;
  event_type: AiTransactionDraftEventType;
  summary: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  source_ip: string | null;
  created_at: string;
}): AiTransactionDraftEventRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    rowId: row.row_id,
    ownerUserId: row.owner_user_id,
    actorUserId: row.actor_user_id,
    connectorConnectionId: row.connector_connection_id,
    eventType: row.event_type,
    summary: row.summary,
    beforeState: row.before_state ? { ...row.before_state } : null,
    afterState: row.after_state ? { ...row.after_state } : null,
    metadata: { ...(row.metadata ?? {}) },
    sourceIp: row.source_ip,
    createdAt: row.created_at,
  };
}

function mapTickerFundamentalsRow(row: {
  ticker: string;
  market_code: string;
  provider_id: string | null;
  fundamentals: TickerFundamentalsDto | Record<string, unknown> | null;
  refreshed_at: string | null;
  next_refresh_at: string | null;
  last_attempted_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}): PersistedTickerFundamentalsRecord {
  return {
    ticker: row.ticker,
    marketCode: row.market_code as MarketCode,
    providerId: row.provider_id,
    fundamentals: normalizeTickerFundamentals(row.fundamentals),
    refreshedAt: row.refreshed_at,
    nextRefreshAt: row.next_refresh_at,
    lastAttemptedAt: row.last_attempted_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      // KZO-199 — env-tunable (restart-required); default 20.
      max: Env.POSTGRES_POOL_MAX,
      connectionTimeoutMillis: Env.POSTGRES_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
    });
    this.redis = createClient({
      url: options.redisUrl,
      socket: buildRedisSocketOptions(),
    });
  }

  async init(): Promise<void> {
    if (process.env.POSTGRES_PERSISTENCE_SKIP_REDIS_INIT !== "1") {
      await this.ensureRedisOpen();
    }
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

    // KZO-183: the seed rows must be inserted in the same transaction
    // so the deferred composite FK (accounts_fee_profile_owner_fk) resolves at
    // COMMIT — pool.query auto-commits each statement individually, which fires
    // the deferred FK before the fee_profile row exists.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lazy user creation for dev_bypass mode: create placeholder user if not exists.
      // In OAuth mode, resolveOrCreateUser creates the user first.
      // Deterministic placeholder email for dev_bypass mode — not used in production.
      await client.query(
        `INSERT INTO users (id, email, display_name, locale, cost_basis_method, quote_poll_interval_seconds, role)
         VALUES ($1, $2, NULL, 'en', 'WEIGHTED_AVERAGE', 10, 'member')
         ON CONFLICT (id) DO NOTHING`,
        [userId, normalizeEmail(`${userId}@placeholder.local`)],
      );

      await client.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, 'Main', $3, 'TWD', 'broker')
         ON CONFLICT (id) DO NOTHING`,
        [accountId, userId, feeProfileId],
      );

      const profileResult = await client.query(
        `INSERT INTO fee_profiles (
           id, account_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
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
        [feeProfileId, accountId],
      );

      // Only seed tax rules when the fee profile was actually created;
      // avoids a destructive DELETE+INSERT race when concurrent requests
      // both call ensureDefaultPortfolioData for the same user.
      if (profileResult.rowCount && profileResult.rowCount > 0) {
        await ensureFeeProfileTaxRules(client, {
          id: feeProfileId,
          accountId,
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

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
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

        await client.query(
          `INSERT INTO portfolio_share_capabilities (share_id, capability, granted_by_user_id, granted_at)
           SELECT $2, capability, granted_by_user_id, granted_at
           FROM pending_share_invite_capabilities
           WHERE invite_code = $1
           ON CONFLICT (share_id, capability) DO NOTHING`,
          [invite.code, share.id],
        );

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

  async getShareCapabilities(shareId: string): Promise<ShareCapability[]> {
    const result = await this.pool.query<{ capability: ShareCapability }>(
      `SELECT capability
       FROM portfolio_share_capabilities
       WHERE share_id = $1
       ORDER BY capability ASC`,
      [shareId],
    );
    return result.rows.map((row) => row.capability);
  }

  async setShareCapabilities(input: SetShareCapabilitiesInput): Promise<ShareCapability[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const shareExists = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM portfolio_shares WHERE id = $1) AS exists`,
        [input.shareId],
      );
      if (!shareExists.rows[0]?.exists) {
        await client.query("ROLLBACK");
        throw routeError(404, "share_not_found", "Share not found");
      }
      await client.query(`DELETE FROM portfolio_share_capabilities WHERE share_id = $1`, [input.shareId]);
      const capabilities = [...new Set(input.capabilities)].sort();
      for (const capability of capabilities) {
        await client.query(
          `INSERT INTO portfolio_share_capabilities (share_id, capability, granted_by_user_id)
           VALUES ($1, $2, $3)`,
          [input.shareId, capability, input.grantedByUserId],
        );
      }
      await client.query("COMMIT");
      return capabilities;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getPendingShareInviteCapabilities(inviteCode: string): Promise<ShareCapability[]> {
    const result = await this.pool.query<{ capability: ShareCapability }>(
      `SELECT capability
       FROM pending_share_invite_capabilities
       WHERE invite_code = $1
       ORDER BY capability ASC`,
      [inviteCode],
    );
    return result.rows.map((row) => row.capability);
  }

  async setPendingShareInviteCapabilities(input: SetPendingShareInviteCapabilitiesInput): Promise<ShareCapability[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inviteExists = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM invites WHERE code = $1) AS exists`,
        [input.inviteCode],
      );
      if (!inviteExists.rows[0]?.exists) {
        await client.query("ROLLBACK");
        throw routeError(404, "share_pending_not_found", "Pending share invite not found");
      }
      await client.query(`DELETE FROM pending_share_invite_capabilities WHERE invite_code = $1`, [input.inviteCode]);
      const capabilities = [...new Set(input.capabilities)].sort();
      for (const capability of capabilities) {
        await client.query(
          `INSERT INTO pending_share_invite_capabilities (invite_code, capability, granted_by_user_id)
           VALUES ($1, $2, $3)`,
          [input.inviteCode, capability, input.grantedByUserId],
        );
      }
      await client.query("COMMIT");
      return capabilities;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async saveAiConnectorConnection(input: SaveAiConnectorConnectionInput): Promise<AiConnectorConnectionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = input.updatedAt ?? new Date().toISOString();
      await client.query(
        `INSERT INTO ai_connector_connections (
           id,
           user_id,
           provider,
           display_name,
           status,
           oauth_client_id,
           oauth_subject,
           expires_at,
           expiry_notified_at,
           last_used_at,
           revoked_at,
           revoked_by_user_id,
           revocation_reason,
           created_at,
           updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, $13,
           COALESCE($14::timestamptz, NOW()),
           $15::timestamptz
         )
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           provider = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           oauth_client_id = EXCLUDED.oauth_client_id,
           oauth_subject = EXCLUDED.oauth_subject,
           expires_at = EXCLUDED.expires_at,
           expiry_notified_at = EXCLUDED.expiry_notified_at,
           last_used_at = EXCLUDED.last_used_at,
           revoked_at = EXCLUDED.revoked_at,
           revoked_by_user_id = EXCLUDED.revoked_by_user_id,
           revocation_reason = EXCLUDED.revocation_reason,
           updated_at = EXCLUDED.updated_at`,
        [
          input.id,
          input.userId,
          input.provider,
          input.displayName,
          input.status,
          input.oauthClientId ?? null,
          input.oauthSubject ?? null,
          input.expiresAt ?? null,
          input.expiryNotifiedAt ?? null,
          input.lastUsedAt ?? null,
          input.revokedAt ?? null,
          input.revokedByUserId ?? null,
          input.revocationReason ?? null,
          input.createdAt ?? null,
          now,
        ],
      );
      await client.query(`DELETE FROM ai_connector_connection_scopes WHERE connection_id = $1`, [input.id]);
      for (const scope of [...new Set(input.scopes)].sort()) {
        await client.query(
          `INSERT INTO ai_connector_connection_scopes (connection_id, scope)
           VALUES ($1, $2)`,
          [input.id, scope],
        );
      }
      await client.query(`DELETE FROM ai_connector_tool_toggles WHERE connection_id = $1`, [input.id]);
      for (const [toolName, enabled] of Object.entries(input.toolToggles ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        await client.query(
          `INSERT INTO ai_connector_tool_toggles (connection_id, tool_name, enabled, updated_at)
           VALUES ($1, $2, $3, $4::timestamptz)`,
          [input.id, toolName, enabled, now],
        );
      }
      const record = await this.getAiConnectorConnectionTx(client, input.id);
      await client.query("COMMIT");
      return record!;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getAiConnectorConnection(id: string): Promise<AiConnectorConnectionRecord | null> {
    return this.getAiConnectorConnectionTx(this.pool, id);
  }

  async listAiConnectorConnectionsForUser(userId: string): Promise<AiConnectorConnectionRecord[]> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      provider: AiConnectorProvider;
      display_name: string;
      status: AiConnectorStatus;
      oauth_client_id: string | null;
      oauth_subject: string | null;
      scopes: AiConnectorScope[] | null;
      tool_toggles: Record<string, boolean> | null;
      expires_at: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      revoked_by_user_id: string | null;
      revocation_reason: string | null;
      expiry_notified_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT c.id,
              c.user_id,
              c.provider,
              c.display_name,
              c.status,
              c.oauth_client_id,
              c.oauth_subject,
              COALESCE(
                ARRAY(
                  SELECT s.scope
                  FROM ai_connector_connection_scopes s
                  WHERE s.connection_id = c.id
                  ORDER BY s.scope ASC
                ),
                ARRAY[]::text[]
              ) AS scopes,
              COALESCE(
                (
                  SELECT jsonb_object_agg(t.tool_name, t.enabled ORDER BY t.tool_name)
                  FROM ai_connector_tool_toggles t
                  WHERE t.connection_id = c.id
                ),
                '{}'::jsonb
              ) AS tool_toggles,
              c.expires_at::text AS expires_at,
              c.expiry_notified_at::text AS expiry_notified_at,
              c.last_used_at::text AS last_used_at,
              c.revoked_at::text AS revoked_at,
              c.revoked_by_user_id,
              c.revocation_reason,
              c.created_at::text AS created_at,
              c.updated_at::text AS updated_at
       FROM ai_connector_connections c
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => mapAiConnectorConnectionRow(row));
  }

  async getAiConnectorPolicySettings(): Promise<AiConnectorPolicySettingsDto> {
    const result = await this.pool.query<Parameters<typeof mapAiConnectorPolicySettingsRow>[0]>(
      `SELECT enabled,
              max_active_connections_per_user,
              allow_chatgpt,
              allow_self_hosted,
              read_tools_enabled,
              draft_tools_enabled,
              write_tools_enabled,
              inactivity_expiry_days,
              expiration_warning_days,
              fresh_auth_max_age_ms,
              max_connector_lifetime_days,
              oauth_public_issuer,
              oauth_redirect_uri_allowlist,
              EXISTS (
                SELECT 1
                FROM public.app_config
                WHERE id = 1 AND mcp_oauth_token_secret IS NOT NULL
              ) AS oauth_token_secret_set,
              updated_at::text AS updated_at
       FROM ai_connector_policy_settings
       WHERE id = TRUE`,
    );
    if (result.rows[0]) return mapAiConnectorPolicySettingsRow(result.rows[0]);

    const inserted = await this.pool.query<Parameters<typeof mapAiConnectorPolicySettingsRow>[0]>(
      `INSERT INTO ai_connector_policy_settings (id)
       VALUES (TRUE)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
       RETURNING enabled,
                 max_active_connections_per_user,
                 allow_chatgpt,
                 allow_self_hosted,
                 read_tools_enabled,
                 draft_tools_enabled,
                 write_tools_enabled,
                 inactivity_expiry_days,
                 expiration_warning_days,
                 fresh_auth_max_age_ms,
                 max_connector_lifetime_days,
                 oauth_public_issuer,
                 oauth_redirect_uri_allowlist,
                 EXISTS (
                   SELECT 1
                   FROM public.app_config
                   WHERE id = 1 AND mcp_oauth_token_secret IS NOT NULL
                 ) AS oauth_token_secret_set,
                 updated_at::text AS updated_at`,
    );
    return mapAiConnectorPolicySettingsRow(inserted.rows[0]!);
  }

  async saveAiConnectorPolicySettings(input: SaveAiConnectorPolicySettingsInput): Promise<AiConnectorPolicySettingsDto> {
    const current = await this.getAiConnectorPolicySettings();
    const next = {
      enabled: input.enabled ?? current.enabled,
      maxActiveConnectionsPerUser: input.maxActiveConnectionsPerUser ?? current.maxActiveConnectionsPerUser,
      allowedProviders: {
        chatgpt: input.allowedProviders?.chatgpt ?? current.allowedProviders.chatgpt,
        self_hosted: input.allowedProviders?.self_hosted ?? current.allowedProviders.self_hosted,
      },
      groupToggles: {
        read: input.groupToggles?.read ?? current.groupToggles.read,
        drafts: input.groupToggles?.drafts ?? current.groupToggles.drafts,
        write: input.groupToggles?.write ?? current.groupToggles.write,
      },
      inactivityExpiryDays: input.inactivityExpiryDays ?? current.inactivityExpiryDays,
      expirationWarningDays: input.expirationWarningDays ?? current.expirationWarningDays,
      freshAuthMaxAgeMs: input.freshAuthMaxAgeMs ?? current.freshAuthMaxAgeMs,
      maxConnectorLifetimeDays: input.maxConnectorLifetimeDays ?? current.maxConnectorLifetimeDays,
      oauthPublicIssuer: input.oauthPublicIssuer === undefined ? current.oauthPublicIssuer : input.oauthPublicIssuer,
      oauthRedirectUriAllowlist:
        input.oauthRedirectUriAllowlist === undefined
          ? current.oauthRedirectUriAllowlist
          : input.oauthRedirectUriAllowlist,
    };
    const result = await this.pool.query<Parameters<typeof mapAiConnectorPolicySettingsRow>[0]>(
      `INSERT INTO ai_connector_policy_settings (
         id,
         enabled,
         max_active_connections_per_user,
         allow_chatgpt,
         allow_self_hosted,
         read_tools_enabled,
         draft_tools_enabled,
         write_tools_enabled,
         inactivity_expiry_days,
         expiration_warning_days,
         fresh_auth_max_age_ms,
         max_connector_lifetime_days,
         oauth_public_issuer,
         oauth_redirect_uri_allowlist,
         updated_at
       ) VALUES (
         TRUE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         max_active_connections_per_user = EXCLUDED.max_active_connections_per_user,
         allow_chatgpt = EXCLUDED.allow_chatgpt,
         allow_self_hosted = EXCLUDED.allow_self_hosted,
         read_tools_enabled = EXCLUDED.read_tools_enabled,
         draft_tools_enabled = EXCLUDED.draft_tools_enabled,
         write_tools_enabled = EXCLUDED.write_tools_enabled,
         inactivity_expiry_days = EXCLUDED.inactivity_expiry_days,
         expiration_warning_days = EXCLUDED.expiration_warning_days,
         fresh_auth_max_age_ms = EXCLUDED.fresh_auth_max_age_ms,
         max_connector_lifetime_days = EXCLUDED.max_connector_lifetime_days,
         oauth_public_issuer = EXCLUDED.oauth_public_issuer,
         oauth_redirect_uri_allowlist = EXCLUDED.oauth_redirect_uri_allowlist,
         updated_at = EXCLUDED.updated_at
       RETURNING enabled,
                 max_active_connections_per_user,
                 allow_chatgpt,
                 allow_self_hosted,
                 read_tools_enabled,
                 draft_tools_enabled,
                 write_tools_enabled,
                 inactivity_expiry_days,
                 expiration_warning_days,
                 fresh_auth_max_age_ms,
                 max_connector_lifetime_days,
                 oauth_public_issuer,
                 oauth_redirect_uri_allowlist,
                 EXISTS (
                   SELECT 1
                   FROM public.app_config
                   WHERE id = 1 AND mcp_oauth_token_secret IS NOT NULL
                 ) AS oauth_token_secret_set,
                 updated_at::text AS updated_at`,
      [
        next.enabled,
        next.maxActiveConnectionsPerUser,
        next.allowedProviders.chatgpt,
        next.allowedProviders.self_hosted,
        next.groupToggles.read,
        next.groupToggles.drafts,
        next.groupToggles.write,
        next.inactivityExpiryDays,
        next.expirationWarningDays,
        next.freshAuthMaxAgeMs,
        next.maxConnectorLifetimeDays,
        next.oauthPublicIssuer,
        next.oauthRedirectUriAllowlist,
      ],
    );
    return mapAiConnectorPolicySettingsRow(result.rows[0]!);
  }

  async saveMcpOAuthAuthorizationRequest(
    input: SaveMcpOAuthAuthorizationRequestInput,
  ): Promise<McpOAuthAuthorizationRequestRecord> {
    const result = await this.pool.query<Parameters<typeof mapMcpOAuthAuthorizationRequestRow>[0]>(
      `INSERT INTO mcp_oauth_authorization_requests (
         id,
         user_id,
         client_id,
         redirect_uri,
         state,
         resource,
         scopes,
         code_challenge,
         code_challenge_method,
         csrf_token_hash,
         expires_at,
         approved_at,
         denied_at,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10,
         $11::timestamptz, $12::timestamptz, $13::timestamptz, COALESCE($14::timestamptz, NOW())
       )
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         client_id = EXCLUDED.client_id,
         redirect_uri = EXCLUDED.redirect_uri,
         state = EXCLUDED.state,
         resource = EXCLUDED.resource,
         scopes = EXCLUDED.scopes,
         code_challenge = EXCLUDED.code_challenge,
         code_challenge_method = EXCLUDED.code_challenge_method,
         csrf_token_hash = EXCLUDED.csrf_token_hash,
         expires_at = EXCLUDED.expires_at,
         approved_at = EXCLUDED.approved_at,
         denied_at = EXCLUDED.denied_at
       RETURNING id,
                 user_id,
                 client_id,
                 redirect_uri,
                 state,
                 resource,
                 scopes,
                 code_challenge,
                 code_challenge_method,
                 csrf_token_hash,
                 expires_at::text AS expires_at,
                 approved_at::text AS approved_at,
                 denied_at::text AS denied_at,
                 created_at::text AS created_at`,
      [
        input.id,
        input.userId,
        input.clientId,
        input.redirectUri,
        input.state ?? null,
        input.resource,
        [...new Set(input.scopes)].sort(),
        input.codeChallenge,
        input.codeChallengeMethod,
        input.csrfTokenHash,
        input.expiresAt,
        input.approvedAt ?? null,
        input.deniedAt ?? null,
        input.createdAt ?? null,
      ],
    );
    return mapMcpOAuthAuthorizationRequestRow(result.rows[0]!);
  }

  async getMcpOAuthAuthorizationRequest(id: string): Promise<McpOAuthAuthorizationRequestRecord | null> {
    const result = await this.pool.query<Parameters<typeof mapMcpOAuthAuthorizationRequestRow>[0]>(
      `SELECT id,
              user_id,
              client_id,
              redirect_uri,
              state,
              resource,
              scopes,
              code_challenge,
              code_challenge_method,
              csrf_token_hash,
              expires_at::text AS expires_at,
              approved_at::text AS approved_at,
              denied_at::text AS denied_at,
              created_at::text AS created_at
       FROM mcp_oauth_authorization_requests
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapMcpOAuthAuthorizationRequestRow(result.rows[0]) : null;
  }

  async approveMcpOAuthAuthorizationRequest(
    input: ApproveMcpOAuthAuthorizationRequestInput,
  ): Promise<ApproveMcpOAuthAuthorizationRequestResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query<Parameters<typeof mapMcpOAuthAuthorizationRequestRow>[0]>(
        `SELECT id,
                user_id,
                client_id,
                redirect_uri,
                state,
                resource,
                scopes,
                code_challenge,
                code_challenge_method,
                csrf_token_hash,
                expires_at::text AS expires_at,
                approved_at::text AS approved_at,
                denied_at::text AS denied_at,
                created_at::text AS created_at
         FROM mcp_oauth_authorization_requests
         WHERE id = $1
         FOR UPDATE`,
        [input.requestId],
      );
      const request = requestResult.rows[0] ? mapMcpOAuthAuthorizationRequestRow(requestResult.rows[0]) : null;
      if (
        !request
        || request.userId !== input.userId
        || request.approvedAt
        || request.deniedAt
        || Date.parse(request.expiresAt) <= Date.now()
      ) {
        await client.query("COMMIT");
        return null;
      }
      if (
        input.connection.userId !== request.userId
        || input.code.userId !== request.userId
        || input.code.connectionId !== input.connection.id
      ) {
        throw routeError(400, "mcp_oauth_invalid_transition", "OAuth approval artifacts do not match the pending request");
      }

      const connectionInput = input.connection;
      const now = connectionInput.updatedAt ?? new Date().toISOString();
      await client.query(
        `INSERT INTO ai_connector_connections (
           id,
           user_id,
           provider,
           display_name,
           status,
           oauth_client_id,
           oauth_subject,
           expires_at,
           expiry_notified_at,
           last_used_at,
           revoked_at,
           revoked_by_user_id,
           revocation_reason,
           created_at,
           updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, $13,
           COALESCE($14::timestamptz, NOW()),
           $15::timestamptz
         )`,
        [
          connectionInput.id,
          connectionInput.userId,
          connectionInput.provider,
          connectionInput.displayName,
          connectionInput.status,
          connectionInput.oauthClientId ?? null,
          connectionInput.oauthSubject ?? null,
          connectionInput.expiresAt ?? null,
          connectionInput.expiryNotifiedAt ?? null,
          connectionInput.lastUsedAt ?? null,
          connectionInput.revokedAt ?? null,
          connectionInput.revokedByUserId ?? null,
          connectionInput.revocationReason ?? null,
          connectionInput.createdAt ?? null,
          now,
        ],
      );
      for (const scope of [...new Set(connectionInput.scopes)].sort()) {
        await client.query(
          `INSERT INTO ai_connector_connection_scopes (connection_id, scope)
           VALUES ($1, $2)`,
          [connectionInput.id, scope],
        );
      }
      for (const [toolName, enabled] of Object.entries(connectionInput.toolToggles ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        await client.query(
          `INSERT INTO ai_connector_tool_toggles (connection_id, tool_name, enabled, updated_at)
           VALUES ($1, $2, $3, $4::timestamptz)`,
          [connectionInput.id, toolName, enabled, now],
        );
      }

      const codeInput = input.code;
      await client.query(
        `INSERT INTO mcp_oauth_authorization_codes (
           id,
           code_hash,
           connection_id,
           user_id,
           client_id,
           redirect_uri,
           resource,
           scopes,
           code_challenge,
           code_challenge_method,
           expires_at,
           consumed_at,
           created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10,
           $11::timestamptz, $12::timestamptz, COALESCE($13::timestamptz, NOW())
         )`,
        [
          codeInput.id,
          codeInput.codeHash,
          codeInput.connectionId,
          codeInput.userId,
          codeInput.clientId,
          codeInput.redirectUri,
          codeInput.resource,
          [...new Set(codeInput.scopes)].sort(),
          codeInput.codeChallenge,
          codeInput.codeChallengeMethod,
          codeInput.expiresAt,
          codeInput.consumedAt ?? null,
          codeInput.createdAt ?? null,
        ],
      );

      const settledResult = await client.query<Parameters<typeof mapMcpOAuthAuthorizationRequestRow>[0]>(
        `UPDATE mcp_oauth_authorization_requests
         SET approved_at = $3::timestamptz
         WHERE id = $1
           AND user_id = $2
           AND approved_at IS NULL
           AND denied_at IS NULL
           AND expires_at > NOW()
         RETURNING id,
                   user_id,
                   client_id,
                   redirect_uri,
                   state,
                   resource,
                   scopes,
                   code_challenge,
                   code_challenge_method,
                   csrf_token_hash,
                   expires_at::text AS expires_at,
                   approved_at::text AS approved_at,
                   denied_at::text AS denied_at,
                   created_at::text AS created_at`,
        [input.requestId, input.userId, input.approvedAt],
      );
      if (!settledResult.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const connection = await this.getAiConnectorConnectionTx(client, connectionInput.id);
      await client.query("COMMIT");
      return {
        request: mapMcpOAuthAuthorizationRequestRow(settledResult.rows[0]),
        connection: connection!,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async settleMcpOAuthAuthorizationRequest(
    id: string,
    userId: string,
    decision: "approved" | "denied",
    decidedAt: string,
  ): Promise<McpOAuthAuthorizationRequestRecord | null> {
    const result = await this.pool.query<Parameters<typeof mapMcpOAuthAuthorizationRequestRow>[0]>(
      `UPDATE mcp_oauth_authorization_requests
       SET approved_at = CASE WHEN $3::text = 'approved' THEN $4::timestamptz ELSE approved_at END,
           denied_at = CASE WHEN $3::text = 'denied' THEN $4::timestamptz ELSE denied_at END
       WHERE id = $1
         AND user_id = $2
         AND approved_at IS NULL
         AND denied_at IS NULL
         AND expires_at > NOW()
       RETURNING id,
                 user_id,
                 client_id,
                 redirect_uri,
                 state,
                 resource,
                 scopes,
                 code_challenge,
                 code_challenge_method,
                 csrf_token_hash,
                 expires_at::text AS expires_at,
                 approved_at::text AS approved_at,
                 denied_at::text AS denied_at,
                 created_at::text AS created_at`,
      [id, userId, decision, decidedAt],
    );
    return result.rows[0] ? mapMcpOAuthAuthorizationRequestRow(result.rows[0]) : null;
  }

  async saveMcpOAuthAuthorizationCode(
    input: SaveMcpOAuthAuthorizationCodeInput,
  ): Promise<McpOAuthAuthorizationCodeRecord> {
    const result = await this.pool.query<Parameters<typeof mapMcpOAuthAuthorizationCodeRow>[0]>(
      `INSERT INTO mcp_oauth_authorization_codes (
         id,
         code_hash,
         connection_id,
         user_id,
         client_id,
         redirect_uri,
         resource,
         scopes,
         code_challenge,
         code_challenge_method,
         expires_at,
         consumed_at,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10,
         $11::timestamptz, $12::timestamptz, COALESCE($13::timestamptz, NOW())
       )
       ON CONFLICT (id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         connection_id = EXCLUDED.connection_id,
         user_id = EXCLUDED.user_id,
         client_id = EXCLUDED.client_id,
         redirect_uri = EXCLUDED.redirect_uri,
         resource = EXCLUDED.resource,
         scopes = EXCLUDED.scopes,
         code_challenge = EXCLUDED.code_challenge,
         code_challenge_method = EXCLUDED.code_challenge_method,
         expires_at = EXCLUDED.expires_at,
         consumed_at = EXCLUDED.consumed_at
       RETURNING id,
                 code_hash,
                 connection_id,
                 user_id,
                 client_id,
                 redirect_uri,
                 resource,
                 scopes,
                 code_challenge,
                 code_challenge_method,
                 expires_at::text AS expires_at,
                 consumed_at::text AS consumed_at,
                 created_at::text AS created_at`,
      [
        input.id,
        input.codeHash,
        input.connectionId,
        input.userId,
        input.clientId,
        input.redirectUri,
        input.resource,
        [...new Set(input.scopes)].sort(),
        input.codeChallenge,
        input.codeChallengeMethod,
        input.expiresAt,
        input.consumedAt ?? null,
        input.createdAt ?? null,
      ],
    );
    return mapMcpOAuthAuthorizationCodeRow(result.rows[0]!);
  }

  async consumeMcpOAuthAuthorizationCode(codeHash: string): Promise<McpOAuthAuthorizationCodeRecord | null> {
    const result = await this.pool.query<Parameters<typeof mapMcpOAuthAuthorizationCodeRow>[0]>(
      `UPDATE mcp_oauth_authorization_codes
       SET consumed_at = NOW()
       WHERE code_hash = $1
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING id,
                 code_hash,
                 connection_id,
                 user_id,
                 client_id,
                 redirect_uri,
                 resource,
                 scopes,
                 code_challenge,
                 code_challenge_method,
                 expires_at::text AS expires_at,
                 consumed_at::text AS consumed_at,
                 created_at::text AS created_at`,
      [codeHash],
    );
    return result.rows[0] ? mapMcpOAuthAuthorizationCodeRow(result.rows[0]) : null;
  }

  async activateAiConnectorConnectionReplacingProvider(
    input: ActivateAiConnectorConnectionReplacingProviderInput,
  ): Promise<ActivateAiConnectorConnectionReplacingProviderResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        id: string;
        status: AiConnectorStatus;
        provider: AiConnectorProvider;
        expires_at: string | null;
      }>(
        `SELECT id,
                status,
                provider,
                expires_at::text AS expires_at
         FROM ai_connector_connections
         WHERE user_id = $1
           AND status NOT IN ('revoked', 'expired')
         ORDER BY id
         FOR UPDATE`,
        [input.userId],
      );
      const target = locked.rows.find((row) => row.id === input.connectionId && row.provider === input.provider);
      if (!target || target.status !== "pending") {
        await client.query("COMMIT");
        return null;
      }

      const activeOtherProviderCount = locked.rows.filter((row) =>
        row.provider !== input.provider
        && row.status === "active"
        && (!row.expires_at || Date.parse(row.expires_at) > Date.now())
      ).length;
      if (activeOtherProviderCount >= input.maxActiveConnectionsPerUser) {
        await client.query("COMMIT");
        return null;
      }

      const now = new Date().toISOString();
      const revokedConnectionIds = locked.rows
        .filter((row) => row.provider === input.provider && row.id !== input.connectionId)
        .map((row) => row.id);

      if (revokedConnectionIds.length > 0) {
        await client.query(
          `UPDATE ai_connector_connections
           SET status = 'revoked',
               revoked_at = $2::timestamptz,
               revoked_by_user_id = $3,
               revocation_reason = $4,
               updated_at = $2::timestamptz
           WHERE id = ANY($1::text[])`,
          [
            revokedConnectionIds,
            now,
            input.revokedByUserId ?? null,
            input.revocationReason,
          ],
        );
        await client.query(
          `UPDATE ai_connector_credentials
           SET revoked_at = COALESCE(revoked_at, $2::timestamptz)
           WHERE connection_id = ANY($1::text[])
             AND revoked_at IS NULL`,
          [revokedConnectionIds, now],
        );
      }

      await client.query(
        `UPDATE ai_connector_connections
         SET status = 'active',
             oauth_client_id = $2,
             oauth_subject = $3,
             last_used_at = $4::timestamptz,
             updated_at = $4::timestamptz
         WHERE id = $1
           AND user_id = $5
           AND provider = $6
           AND status = 'pending'`,
        [
          input.connectionId,
          input.oauthClientId ?? null,
          input.oauthSubject ?? null,
          input.lastUsedAt ?? now,
          input.userId,
          input.provider,
        ],
      );
      const connection = await this.getAiConnectorConnectionTx(client, input.connectionId);
      await client.query("COMMIT");
      return connection ? { connection, revokedConnectionIds } : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async saveAiConnectorCredential(input: SaveAiConnectorCredentialInput): Promise<AiConnectorCredentialRecord> {
    const result = await this.pool.query<Parameters<typeof mapAiConnectorCredentialRow>[0]>(
      `INSERT INTO ai_connector_credentials (
         id,
         connection_id,
         credential_type,
         token_hash,
         token_hint,
         token_family_id,
         predecessor_credential_id,
         replaced_by_credential_id,
         oauth_client_id,
         resource,
         scopes,
         session_version,
         expires_at,
         revoked_at,
         created_at,
         last_used_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12,
         $13::timestamptz, $14::timestamptz, COALESCE($15::timestamptz, NOW()), $16::timestamptz
       )
       ON CONFLICT (id) DO UPDATE SET
         connection_id = EXCLUDED.connection_id,
         credential_type = EXCLUDED.credential_type,
         token_hash = EXCLUDED.token_hash,
         token_hint = EXCLUDED.token_hint,
         token_family_id = EXCLUDED.token_family_id,
         predecessor_credential_id = EXCLUDED.predecessor_credential_id,
         replaced_by_credential_id = EXCLUDED.replaced_by_credential_id,
         oauth_client_id = EXCLUDED.oauth_client_id,
         resource = EXCLUDED.resource,
         scopes = EXCLUDED.scopes,
         session_version = EXCLUDED.session_version,
         expires_at = EXCLUDED.expires_at,
         revoked_at = EXCLUDED.revoked_at,
         last_used_at = EXCLUDED.last_used_at
       RETURNING id,
                 connection_id,
                 credential_type,
                 token_hash,
                 token_hint,
                 token_family_id,
                 predecessor_credential_id,
                 replaced_by_credential_id,
                 oauth_client_id,
                 resource,
                 scopes,
                 session_version,
                 expires_at::text AS expires_at,
                 revoked_at::text AS revoked_at,
                 created_at::text AS created_at,
                 last_used_at::text AS last_used_at`,
      [
        input.id,
        input.connectionId,
        input.credentialType,
        input.tokenHash,
        input.tokenHint ?? null,
        input.tokenFamilyId ?? null,
        input.predecessorCredentialId ?? null,
        input.replacedByCredentialId ?? null,
        input.oauthClientId ?? null,
        input.resource ?? null,
        [...new Set(input.scopes ?? [])].sort(),
        input.sessionVersion ?? null,
        input.expiresAt ?? null,
        input.revokedAt ?? null,
        input.createdAt ?? null,
        input.lastUsedAt ?? null,
      ],
    );
    return mapAiConnectorCredentialRow(result.rows[0]!);
  }

  async getAiConnectorCredentialByHash(tokenHash: string): Promise<AiConnectorCredentialRecord | null> {
    const result = await this.pool.query<Parameters<typeof mapAiConnectorCredentialRow>[0]>(
      `SELECT id,
              connection_id,
              credential_type,
              token_hash,
              token_hint,
              token_family_id,
              predecessor_credential_id,
              replaced_by_credential_id,
              oauth_client_id,
              resource,
              scopes,
              session_version,
              expires_at::text AS expires_at,
              revoked_at::text AS revoked_at,
              created_at::text AS created_at,
              last_used_at::text AS last_used_at
       FROM ai_connector_credentials
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ? mapAiConnectorCredentialRow(result.rows[0]) : null;
  }

  async consumeAiConnectorCredential(id: string): Promise<AiConnectorCredentialRecord | null> {
    const result = await this.pool.query<Parameters<typeof mapAiConnectorCredentialRow>[0]>(
      `UPDATE ai_connector_credentials
       SET revoked_at = NOW(),
           last_used_at = NOW()
       WHERE id = $1
         AND revoked_at IS NULL
         AND replaced_by_credential_id IS NULL
       RETURNING id,
                 connection_id,
                 credential_type,
                 token_hash,
                 token_hint,
                 token_family_id,
                 predecessor_credential_id,
                 replaced_by_credential_id,
                 oauth_client_id,
                 resource,
                 scopes,
                 session_version,
                 expires_at::text AS expires_at,
                 revoked_at::text AS revoked_at,
                 created_at::text AS created_at,
                 last_used_at::text AS last_used_at`,
      [id],
    );
    return result.rows[0] ? mapAiConnectorCredentialRow(result.rows[0]) : null;
  }

  async revokeAiConnectorCredential(
    id: string,
    replacedByCredentialId: string | null = null,
  ): Promise<AiConnectorCredentialRecord | null> {
    const result = await this.pool.query<Parameters<typeof mapAiConnectorCredentialRow>[0]>(
      `UPDATE ai_connector_credentials
       SET revoked_at = COALESCE(revoked_at, NOW()),
           replaced_by_credential_id = COALESCE($2, replaced_by_credential_id),
           last_used_at = NOW()
       WHERE id = $1
       RETURNING id,
                 connection_id,
                 credential_type,
                 token_hash,
                 token_hint,
                 token_family_id,
                 predecessor_credential_id,
                 replaced_by_credential_id,
                 oauth_client_id,
                 resource,
                 scopes,
                 session_version,
                 expires_at::text AS expires_at,
                 revoked_at::text AS revoked_at,
                 created_at::text AS created_at,
                 last_used_at::text AS last_used_at`,
      [id, replacedByCredentialId],
    );
    return result.rows[0] ? mapAiConnectorCredentialRow(result.rows[0]) : null;
  }

  async revokeAiConnectorCredentialsForConnection(connectionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_connector_credentials
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE connection_id = $1`,
      [connectionId],
    );
  }

  async revokeAiConnectorConnectionsForProvider(
    provider: AiConnectorProvider,
    reason: string,
    revokedByUserId: string | null = null,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const revoked = await client.query<{ id: string }>(
        `UPDATE ai_connector_connections
         SET status = 'revoked',
             revoked_at = COALESCE(revoked_at, NOW()),
             revoked_by_user_id = $2,
             revocation_reason = $3,
             updated_at = NOW()
         WHERE provider = $1
           AND status IN ('active', 'pending')
         RETURNING id`,
        [provider, revokedByUserId, reason],
      );
      const ids = revoked.rows.map((row) => row.id);
      if (ids.length > 0) {
        await client.query(
          `UPDATE ai_connector_credentials
           SET revoked_at = COALESCE(revoked_at, NOW())
           WHERE connection_id = ANY($1::text[])`,
          [ids],
        );
      }
      await client.query("COMMIT");
      return ids.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAiConnectorAccessLog(input: AppendAiConnectorAccessLogInput): Promise<AiConnectorAccessLogRecord> {
    const result = await this.pool.query<{
      id: string;
      connection_id: string | null;
      user_id: string;
      portfolio_context_user_id: string;
      share_id: string | null;
      tool_name: string;
      access_kind: AiConnectorAccessKind;
      result: AiConnectorAccessResult;
      denial_reason: string | null;
      request_id: string | null;
      source_ip: string | null;
      user_agent: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(
      `INSERT INTO ai_connector_access_logs (
         id,
         connection_id,
         user_id,
         portfolio_context_user_id,
         share_id,
         tool_name,
         access_kind,
         result,
         denial_reason,
         request_id,
         source_ip,
         user_agent,
         metadata,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11::inet, $12, $13::jsonb, COALESCE($14::timestamptz, NOW())
       )
       RETURNING id,
                 connection_id,
                 user_id,
                 portfolio_context_user_id,
                 share_id,
                 tool_name,
                 access_kind,
                 result,
                 denial_reason,
                 request_id,
                 source_ip::text AS source_ip,
                 user_agent,
                 metadata,
                 created_at::text AS created_at`,
      [
        input.id ?? randomUUID(),
        input.connectionId,
        input.userId,
        input.portfolioContextUserId,
        input.shareId ?? null,
        input.toolName,
        input.accessKind,
        input.result,
        input.denialReason ?? null,
        input.requestId ?? null,
        input.sourceIp ?? null,
        input.userAgent ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.createdAt ?? null,
      ],
    );
    return mapAiConnectorAccessLogRow(result.rows[0]!);
  }

  async listAiConnectorAccessLogsForUser(
    userId: string,
    options?: { limit?: number },
  ): Promise<AiConnectorAccessLogRecord[]> {
    const params: [string] | [string, number] = options?.limit === undefined
      ? [userId]
      : [userId, options.limit];
    const limitClause = options?.limit === undefined ? "" : " LIMIT $2";
    const result = await this.pool.query<{
      id: string;
      connection_id: string | null;
      user_id: string;
      portfolio_context_user_id: string;
      share_id: string | null;
      tool_name: string;
      access_kind: AiConnectorAccessKind;
      result: AiConnectorAccessResult;
      denial_reason: string | null;
      request_id: string | null;
      source_ip: string | null;
      user_agent: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT id,
              connection_id,
              user_id,
              portfolio_context_user_id,
              share_id,
              tool_name,
              access_kind,
              result,
              denial_reason,
              request_id,
              source_ip::text AS source_ip,
              user_agent,
              metadata,
              created_at::text AS created_at
       FROM ai_connector_access_logs
       WHERE user_id = $1
       ORDER BY created_at DESC${limitClause}`,
      params,
    );
    return result.rows.map((row) => mapAiConnectorAccessLogRow(row));
  }

  async saveAiTransactionDraftBatch(input: SaveAiTransactionDraftBatchInput): Promise<AiTransactionDraftBatchRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
        const existing = await client.query<{ version: number }>(
          `SELECT version
           FROM ai_transaction_draft_batches
           WHERE id = $1
           FOR UPDATE`,
          [input.id],
        );
        if (!existing.rows[0] || Number(existing.rows[0].version) !== input.expectedVersion) {
          await client.query("ROLLBACK");
          return null;
        }
      }
      const now = input.updatedAt ?? new Date().toISOString();
      const result = await client.query<{
        id: string;
        owner_user_id: string;
        created_by_user_id: string;
        connector_connection_id: string | null;
        share_id: string | null;
        source_channel: AiTransactionDraftSourceChannel;
        status: AiTransactionDraftBatchStatus;
        version: number;
        source_label: string | null;
        source_filename: string | null;
        note: string | null;
        provenance: Record<string, unknown> | null;
        row_count: number;
        unsupported_count: number;
        created_at: string;
        updated_at: string;
        archived_at: string | null;
        archived_by_user_id: string | null;
        deleted_at: string | null;
        deleted_by_user_id: string | null;
      }>(
        `INSERT INTO ai_transaction_draft_batches (
           id,
           owner_user_id,
           created_by_user_id,
           connector_connection_id,
           share_id,
           source_channel,
           status,
           version,
           source_label,
           source_filename,
           note,
           provenance,
           row_count,
           unsupported_count,
           archived_at,
           archived_by_user_id,
           deleted_at,
           deleted_by_user_id,
           created_at,
           updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
           $13, $14, $15::timestamptz, $16, $17::timestamptz, $18,
           COALESCE($19::timestamptz, NOW()), $20::timestamptz
         )
         ON CONFLICT (id) DO UPDATE SET
           owner_user_id = EXCLUDED.owner_user_id,
           created_by_user_id = EXCLUDED.created_by_user_id,
           connector_connection_id = EXCLUDED.connector_connection_id,
           share_id = EXCLUDED.share_id,
           source_channel = EXCLUDED.source_channel,
           status = EXCLUDED.status,
           version = EXCLUDED.version,
           source_label = EXCLUDED.source_label,
           source_filename = EXCLUDED.source_filename,
           note = EXCLUDED.note,
           provenance = EXCLUDED.provenance,
           row_count = EXCLUDED.row_count,
           unsupported_count = EXCLUDED.unsupported_count,
           archived_at = EXCLUDED.archived_at,
           archived_by_user_id = EXCLUDED.archived_by_user_id,
           deleted_at = EXCLUDED.deleted_at,
           deleted_by_user_id = EXCLUDED.deleted_by_user_id,
           updated_at = EXCLUDED.updated_at
         WHERE $21::int IS NULL OR ai_transaction_draft_batches.version = $21
         RETURNING id,
                   owner_user_id,
                   created_by_user_id,
                   connector_connection_id,
                   share_id,
                   source_channel,
                   status,
                   version,
                   source_label,
                   source_filename,
                   note,
                   provenance,
                   row_count,
                   unsupported_count,
                   created_at::text AS created_at,
                   updated_at::text AS updated_at,
                   archived_at::text AS archived_at,
                   archived_by_user_id,
                   deleted_at::text AS deleted_at,
                   deleted_by_user_id`,
        [
          input.id,
          input.ownerUserId,
          input.createdByUserId,
          input.connectorConnectionId ?? null,
          input.shareId ?? null,
          input.sourceChannel,
          input.status,
          input.version,
          input.sourceLabel ?? null,
          input.sourceFilename ?? null,
          input.note ?? null,
          JSON.stringify(input.provenance ?? {}),
          input.rowCount,
          input.unsupportedCount,
          input.archivedAt ?? null,
          input.archivedByUserId ?? null,
          input.deletedAt ?? null,
          input.deletedByUserId ?? null,
          input.createdAt ?? null,
          now,
          input.expectedVersion ?? null,
        ],
      );
      await client.query("COMMIT");
      return result.rows[0] ? mapAiTransactionDraftBatchRow(result.rows[0]) : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getAiTransactionDraftBatch(id: string): Promise<AiTransactionDraftBatchAggregate | null> {
    const batchResult = await this.pool.query<{
      id: string;
      owner_user_id: string;
      created_by_user_id: string;
      connector_connection_id: string | null;
      share_id: string | null;
      source_channel: AiTransactionDraftSourceChannel;
      status: AiTransactionDraftBatchStatus;
      version: number;
      source_label: string | null;
      source_filename: string | null;
      note: string | null;
      provenance: Record<string, unknown> | null;
      row_count: number;
      unsupported_count: number;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
      archived_by_user_id: string | null;
      deleted_at: string | null;
      deleted_by_user_id: string | null;
    }>(
      `SELECT id,
              owner_user_id,
              created_by_user_id,
              connector_connection_id,
              share_id,
              source_channel,
              status,
              version,
              source_label,
              source_filename,
              note,
              provenance,
              row_count,
              unsupported_count,
              created_at::text AS created_at,
              updated_at::text AS updated_at,
              archived_at::text AS archived_at,
              archived_by_user_id,
              deleted_at::text AS deleted_at,
              deleted_by_user_id
       FROM ai_transaction_draft_batches
       WHERE id = $1`,
      [id],
    );
    const batch = batchResult.rows[0];
    if (!batch) return null;
    const [rows, unsupportedItems, events] = await Promise.all([
      this.listAiTransactionDraftRows(id),
      this.listAiTransactionDraftUnsupportedItems(id),
      this.listAiTransactionDraftEvents(id),
    ]);
    return {
      batch: mapAiTransactionDraftBatchRow(batch),
      rows,
      unsupportedItems,
      events,
    };
  }

  async listAiTransactionDraftBatchesForOwner(ownerUserId: string): Promise<AiTransactionDraftBatchRecord[]> {
    const result = await this.pool.query<{
      id: string;
      owner_user_id: string;
      created_by_user_id: string;
      connector_connection_id: string | null;
      share_id: string | null;
      source_channel: AiTransactionDraftSourceChannel;
      status: AiTransactionDraftBatchStatus;
      version: number;
      source_label: string | null;
      source_filename: string | null;
      note: string | null;
      provenance: Record<string, unknown> | null;
      row_count: number;
      unsupported_count: number;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
      archived_by_user_id: string | null;
      deleted_at: string | null;
      deleted_by_user_id: string | null;
    }>(
      `SELECT id,
              owner_user_id,
              created_by_user_id,
              connector_connection_id,
              share_id,
              source_channel,
              status,
              version,
              source_label,
              source_filename,
              note,
              provenance,
              row_count,
              unsupported_count,
              created_at::text AS created_at,
              updated_at::text AS updated_at,
              archived_at::text AS archived_at,
              archived_by_user_id,
              deleted_at::text AS deleted_at,
              deleted_by_user_id
       FROM ai_transaction_draft_batches
       WHERE owner_user_id = $1
       ORDER BY updated_at DESC`,
      [ownerUserId],
    );
    return result.rows.map((row) => mapAiTransactionDraftBatchRow(row));
  }

  async saveAiTransactionDraftRow(input: SaveAiTransactionDraftRowInput): Promise<AiTransactionDraftRowRecord | null> {
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      const existing = await this.pool.query<{ version: number }>(
        `SELECT version
         FROM ai_transaction_draft_rows
         WHERE id = $1`,
        [input.id],
      );
      if (!existing.rows[0] || Number(existing.rows[0].version) !== input.expectedVersion) {
        return null;
      }
    }
    const result = await this.pool.query<{
      id: string;
      batch_id: string;
      owner_user_id: string;
      row_number: number;
      state: AiTransactionDraftRowState;
      version: number;
      account_id: string | null;
      account_name_input: string | null;
      trade_type: "BUY" | "SELL" | null;
      ticker: string | null;
      market_code: string | null;
      quantity: number | null;
      unit_price: string | number | null;
      price_currency: string | null;
      trade_date: string | null;
      trade_timestamp: string | null;
      booking_sequence: number | null;
      is_day_trade: boolean | null;
      commission_amount: string | number | null;
      tax_amount: string | number | null;
      fees_source: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
      note: string | null;
      source_row_ref: string | null;
      source_snippet: string | null;
      normalized_payload: Record<string, unknown> | null;
      preflight_issues: unknown[] | null;
      warnings: unknown[] | null;
      duplicate_trade_event_id: string | null;
      confirmed_trade_event_id: string | null;
      confirmed_at: string | null;
      confirmed_by_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO ai_transaction_draft_rows (
         id,
         batch_id,
         owner_user_id,
         row_number,
         state,
         version,
         account_id,
         account_name_input,
         trade_type,
         ticker,
         market_code,
         quantity,
         unit_price,
         price_currency,
         trade_date,
         trade_timestamp,
         booking_sequence,
         is_day_trade,
         commission_amount,
         tax_amount,
         fees_source,
         note,
         source_row_ref,
         source_snippet,
         normalized_payload,
         preflight_issues,
         warnings,
         duplicate_trade_event_id,
         confirmed_trade_event_id,
         confirmed_at,
         confirmed_by_user_id,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15::date, $16::timestamptz, $17, $18, $19, $20,
         $21, $22, $23, $24, $25::jsonb, $26::jsonb, $27::jsonb, $28, $29,
         $30::timestamptz, $31, COALESCE($32::timestamptz, NOW()), $33::timestamptz
       )
       ON CONFLICT (id) DO UPDATE SET
         batch_id = EXCLUDED.batch_id,
         owner_user_id = EXCLUDED.owner_user_id,
         row_number = EXCLUDED.row_number,
         state = EXCLUDED.state,
         version = EXCLUDED.version,
         account_id = EXCLUDED.account_id,
         account_name_input = EXCLUDED.account_name_input,
         trade_type = EXCLUDED.trade_type,
         ticker = EXCLUDED.ticker,
         market_code = EXCLUDED.market_code,
         quantity = EXCLUDED.quantity,
         unit_price = EXCLUDED.unit_price,
         price_currency = EXCLUDED.price_currency,
         trade_date = EXCLUDED.trade_date,
         trade_timestamp = EXCLUDED.trade_timestamp,
         booking_sequence = EXCLUDED.booking_sequence,
         is_day_trade = EXCLUDED.is_day_trade,
         commission_amount = EXCLUDED.commission_amount,
         tax_amount = EXCLUDED.tax_amount,
         fees_source = EXCLUDED.fees_source,
         note = EXCLUDED.note,
         source_row_ref = EXCLUDED.source_row_ref,
         source_snippet = EXCLUDED.source_snippet,
         normalized_payload = EXCLUDED.normalized_payload,
         preflight_issues = EXCLUDED.preflight_issues,
         warnings = EXCLUDED.warnings,
         duplicate_trade_event_id = EXCLUDED.duplicate_trade_event_id,
         confirmed_trade_event_id = EXCLUDED.confirmed_trade_event_id,
         confirmed_at = EXCLUDED.confirmed_at,
         confirmed_by_user_id = EXCLUDED.confirmed_by_user_id,
         updated_at = EXCLUDED.updated_at
       WHERE $34::int IS NULL OR ai_transaction_draft_rows.version = $34
       RETURNING id,
                 batch_id,
                 owner_user_id,
                 row_number,
                 state,
                 version,
                 account_id,
                 account_name_input,
                 trade_type,
                 ticker,
                 market_code,
                 quantity,
                 unit_price,
                 price_currency,
                 trade_date::text AS trade_date,
                 trade_timestamp::text AS trade_timestamp,
                 booking_sequence,
                 is_day_trade,
                 commission_amount,
                 tax_amount,
                 fees_source,
                 note,
                 source_row_ref,
                 source_snippet,
                 normalized_payload,
                 preflight_issues,
                 warnings,
                 duplicate_trade_event_id,
                 confirmed_trade_event_id,
                 confirmed_at::text AS confirmed_at,
                 confirmed_by_user_id,
                 created_at::text AS created_at,
                 updated_at::text AS updated_at`,
      [
        input.id,
        input.batchId,
        input.ownerUserId,
        input.rowNumber,
        input.state,
        input.version,
        input.accountId ?? null,
        input.accountNameInput ?? null,
        input.tradeType ?? null,
        input.ticker ?? null,
        input.marketCode ?? null,
        input.quantity ?? null,
        input.unitPrice ?? null,
        input.priceCurrency ?? null,
        input.tradeDate ?? null,
        input.tradeTimestamp ?? null,
        input.bookingSequence ?? null,
        input.isDayTrade ?? null,
        input.commissionAmount ?? null,
        input.taxAmount ?? null,
        input.feesSource ?? null,
        input.note ?? null,
        input.sourceRowRef ?? null,
        input.sourceSnippet ?? null,
        JSON.stringify(input.normalizedPayload ?? {}),
        JSON.stringify(input.preflightIssues ?? []),
        JSON.stringify(input.warnings ?? []),
        input.duplicateTradeEventId ?? null,
        input.confirmedTradeEventId ?? null,
        input.confirmedAt ?? null,
        input.confirmedByUserId ?? null,
        input.createdAt ?? null,
        input.updatedAt ?? new Date().toISOString(),
        input.expectedVersion ?? null,
      ],
    );
    return result.rows[0] ? mapAiTransactionDraftRowRow(result.rows[0]) : null;
  }

  async listAiTransactionDraftRows(batchId: string): Promise<AiTransactionDraftRowRecord[]> {
    const result = await this.pool.query<{
      id: string;
      batch_id: string;
      owner_user_id: string;
      row_number: number;
      state: AiTransactionDraftRowState;
      version: number;
      account_id: string | null;
      account_name_input: string | null;
      trade_type: "BUY" | "SELL" | null;
      ticker: string | null;
      market_code: string | null;
      quantity: number | null;
      unit_price: string | number | null;
      price_currency: string | null;
      trade_date: string | null;
      trade_timestamp: string | null;
      booking_sequence: number | null;
      is_day_trade: boolean | null;
      commission_amount: string | number | null;
      tax_amount: string | number | null;
      fees_source: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
      note: string | null;
      source_row_ref: string | null;
      source_snippet: string | null;
      normalized_payload: Record<string, unknown> | null;
      preflight_issues: unknown[] | null;
      warnings: unknown[] | null;
      duplicate_trade_event_id: string | null;
      confirmed_trade_event_id: string | null;
      confirmed_at: string | null;
      confirmed_by_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id,
              batch_id,
              owner_user_id,
              row_number,
              state,
              version,
              account_id,
              account_name_input,
              trade_type,
              ticker,
              market_code,
              quantity,
              unit_price,
              price_currency,
              trade_date::text AS trade_date,
              trade_timestamp::text AS trade_timestamp,
              booking_sequence,
              is_day_trade,
              commission_amount,
              tax_amount,
              fees_source,
              note,
              source_row_ref,
              source_snippet,
              normalized_payload,
              preflight_issues,
              warnings,
              duplicate_trade_event_id,
              confirmed_trade_event_id,
              confirmed_at::text AS confirmed_at,
              confirmed_by_user_id,
              created_at::text AS created_at,
              updated_at::text AS updated_at
       FROM ai_transaction_draft_rows
       WHERE batch_id = $1
       ORDER BY row_number ASC, created_at ASC`,
      [batchId],
    );
    return result.rows.map((row) => mapAiTransactionDraftRowRow(row));
  }

  async replaceAiTransactionDraftUnsupportedItems(
    batchId: string,
    items: SaveAiTransactionDraftUnsupportedItemInput[],
  ): Promise<AiTransactionDraftUnsupportedItemRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ai_transaction_draft_unsupported_items WHERE batch_id = $1`, [batchId]);
      for (const item of items) {
        await client.query(
          `INSERT INTO ai_transaction_draft_unsupported_items (
             id,
             batch_id,
             row_number,
             category,
             reason,
             source_snippet,
             raw_payload,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, NOW()))`,
          [
            item.id,
            batchId,
            item.rowNumber ?? null,
            item.category,
            item.reason,
            item.sourceSnippet ?? null,
            JSON.stringify(item.rawPayload ?? {}),
            item.createdAt ?? null,
          ],
        );
      }
      const rows = await client.query<{
        id: string;
        batch_id: string;
        row_number: number | null;
        category: string;
        reason: string;
        source_snippet: string | null;
        raw_payload: Record<string, unknown> | null;
        created_at: string;
      }>(
        `SELECT id,
                batch_id,
                row_number,
                category,
                reason,
                source_snippet,
                raw_payload,
                created_at::text AS created_at
         FROM ai_transaction_draft_unsupported_items
         WHERE batch_id = $1
         ORDER BY row_number NULLS LAST, created_at ASC`,
        [batchId],
      );
      await client.query("COMMIT");
      return rows.rows.map((row) => mapAiTransactionDraftUnsupportedItemRow(row));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listAiTransactionDraftUnsupportedItems(batchId: string): Promise<AiTransactionDraftUnsupportedItemRecord[]> {
    const result = await this.pool.query<{
      id: string;
      batch_id: string;
      row_number: number | null;
      category: string;
      reason: string;
      source_snippet: string | null;
      raw_payload: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT id,
              batch_id,
              row_number,
              category,
              reason,
              source_snippet,
              raw_payload,
              created_at::text AS created_at
       FROM ai_transaction_draft_unsupported_items
       WHERE batch_id = $1
       ORDER BY row_number NULLS LAST, created_at ASC`,
      [batchId],
    );
    return result.rows.map((row) => mapAiTransactionDraftUnsupportedItemRow(row));
  }

  async appendAiTransactionDraftEvent(input: AppendAiTransactionDraftEventInput): Promise<AiTransactionDraftEventRecord> {
    const result = await this.pool.query<{
      id: string;
      batch_id: string;
      row_id: string | null;
      owner_user_id: string | null;
      actor_user_id: string | null;
      connector_connection_id: string | null;
      event_type: AiTransactionDraftEventType;
      summary: string | null;
      before_state: Record<string, unknown> | null;
      after_state: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null;
      source_ip: string | null;
      created_at: string;
    }>(
      `INSERT INTO ai_transaction_draft_events (
         id,
         batch_id,
         row_id,
         owner_user_id,
         actor_user_id,
         connector_connection_id,
         event_type,
         summary,
         before_state,
         after_state,
         metadata,
         source_ip,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         $12::inet, COALESCE($13::timestamptz, NOW())
       )
       RETURNING id,
                 batch_id,
                 row_id,
                 owner_user_id,
                 actor_user_id,
                 connector_connection_id,
                 event_type,
                 summary,
                 before_state,
                 after_state,
                 metadata,
                 source_ip::text AS source_ip,
                 created_at::text AS created_at`,
      [
        input.id ?? randomUUID(),
        input.batchId,
        input.rowId ?? null,
        input.ownerUserId ?? null,
        input.actorUserId ?? null,
        input.connectorConnectionId ?? null,
        input.eventType,
        input.summary ?? null,
        input.beforeState ? JSON.stringify(input.beforeState) : null,
        input.afterState ? JSON.stringify(input.afterState) : null,
        JSON.stringify(input.metadata ?? {}),
        input.sourceIp ?? null,
        input.createdAt ?? null,
      ],
    );
    return mapAiTransactionDraftEventRow(result.rows[0]!);
  }

  async confirmAiTransactionDraftPosting(
    input: ConfirmAiTransactionDraftPostingInput,
  ): Promise<ConfirmAiTransactionDraftPostingResult | null> {
    validateAccountingStoreInvariants(input.accounting);
    await this.ensureDefaultPortfolioData(input.ownerUserId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of input.rows) {
        if (!row.confirmedTradeEventId) {
          throw new Error(`confirmed draft row ${row.id} is missing a trade event id`);
        }
        await this.savePostedTradeTx(client, input.ownerUserId, input.accounting, row.confirmedTradeEventId);
      }

      const savedRows: AiTransactionDraftRowRecord[] = [];
      for (const row of input.rows) {
        const result = await client.query<{
          id: string;
          batch_id: string;
          owner_user_id: string;
          row_number: number;
          state: AiTransactionDraftRowState;
          version: number;
          account_id: string | null;
          account_name_input: string | null;
          trade_type: "BUY" | "SELL" | null;
          ticker: string | null;
          market_code: string | null;
          quantity: number | null;
          unit_price: string | number | null;
          price_currency: string | null;
          trade_date: string | null;
          trade_timestamp: string | null;
          booking_sequence: number | null;
          is_day_trade: boolean | null;
          commission_amount: string | number | null;
          tax_amount: string | number | null;
          fees_source: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
          note: string | null;
          source_row_ref: string | null;
          source_snippet: string | null;
          normalized_payload: Record<string, unknown> | null;
          preflight_issues: unknown[] | null;
          warnings: unknown[] | null;
          duplicate_trade_event_id: string | null;
          confirmed_trade_event_id: string | null;
          confirmed_at: string | null;
          confirmed_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        }>(
          `UPDATE ai_transaction_draft_rows
           SET state = $2,
               version = $3,
               fees_source = $4,
               confirmed_trade_event_id = $5,
               confirmed_at = $6::timestamptz,
               confirmed_by_user_id = $7,
               updated_at = $8::timestamptz
           WHERE id = $1
             AND batch_id = $9
             AND owner_user_id = $10
             AND version = $11
           RETURNING id,
                     batch_id,
                     owner_user_id,
                     row_number,
                     state,
                     version,
                     account_id,
                     account_name_input,
                     trade_type,
                     ticker,
                     market_code,
                     quantity,
                     unit_price,
                     price_currency,
                     trade_date::text AS trade_date,
                     trade_timestamp::text AS trade_timestamp,
                     booking_sequence,
                     is_day_trade,
                     commission_amount,
                     tax_amount,
                     fees_source,
                     note,
                     source_row_ref,
                     source_snippet,
                     normalized_payload,
                     preflight_issues,
                     warnings,
                     duplicate_trade_event_id,
                     confirmed_trade_event_id,
                     confirmed_at::text AS confirmed_at,
                     confirmed_by_user_id,
                     created_at::text AS created_at,
                     updated_at::text AS updated_at`,
          [
            row.id,
            row.state,
            row.version,
            row.feesSource ?? null,
            row.confirmedTradeEventId ?? null,
            row.confirmedAt ?? null,
            row.confirmedByUserId ?? null,
            row.updatedAt ?? new Date().toISOString(),
            row.batchId,
            row.ownerUserId,
            row.expectedVersion ?? null,
          ],
        );
        const saved = result.rows[0];
        if (!saved) {
          await client.query("ROLLBACK");
          return null;
        }
        savedRows.push(mapAiTransactionDraftRowRow(saved));
      }

      const batchResult = await client.query<{
        id: string;
        owner_user_id: string;
        created_by_user_id: string;
        connector_connection_id: string | null;
        share_id: string | null;
        source_channel: AiTransactionDraftSourceChannel;
        status: AiTransactionDraftBatchStatus;
        version: number;
        source_label: string | null;
        source_filename: string | null;
        note: string | null;
        provenance: Record<string, unknown> | null;
        row_count: number;
        unsupported_count: number;
        created_at: string;
        updated_at: string;
        archived_at: string | null;
        archived_by_user_id: string | null;
        deleted_at: string | null;
        deleted_by_user_id: string | null;
      }>(
        `UPDATE ai_transaction_draft_batches
         SET status = $2,
             version = $3,
             updated_at = $4::timestamptz
         WHERE id = $1
           AND owner_user_id = $5
           AND version = $6
         RETURNING id,
                   owner_user_id,
                   created_by_user_id,
                   connector_connection_id,
                   share_id,
                   source_channel,
                   status,
                   version,
                   source_label,
                   source_filename,
                   note,
                   provenance,
                   row_count,
                   unsupported_count,
                   created_at::text AS created_at,
                   updated_at::text AS updated_at,
                   archived_at::text AS archived_at,
                   archived_by_user_id,
                   deleted_at::text AS deleted_at,
                   deleted_by_user_id`,
        [
          input.batch.id,
          input.batch.status,
          input.batch.version,
          input.batch.updatedAt ?? new Date().toISOString(),
          input.batch.ownerUserId,
          input.batch.expectedVersion ?? null,
        ],
      );
      const savedBatch = batchResult.rows[0];
      if (!savedBatch) {
        await client.query("ROLLBACK");
        return null;
      }

      const eventResult = await client.query<{
        id: string;
        batch_id: string;
        row_id: string | null;
        owner_user_id: string | null;
        actor_user_id: string | null;
        connector_connection_id: string | null;
        event_type: AiTransactionDraftEventType;
        summary: string | null;
        before_state: Record<string, unknown> | null;
        after_state: Record<string, unknown> | null;
        metadata: Record<string, unknown> | null;
        source_ip: string | null;
        created_at: string;
      }>(
        `INSERT INTO ai_transaction_draft_events (
           id,
           batch_id,
           row_id,
           owner_user_id,
           actor_user_id,
           connector_connection_id,
           event_type,
           summary,
           before_state,
           after_state,
           metadata,
           source_ip,
           created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
           $12::inet, COALESCE($13::timestamptz, NOW())
         )
         RETURNING id,
                   batch_id,
                   row_id,
                   owner_user_id,
                   actor_user_id,
                   connector_connection_id,
                   event_type,
                   summary,
                   before_state,
                   after_state,
                   metadata,
                   source_ip::text AS source_ip,
                   created_at::text AS created_at`,
        [
          input.event.id ?? randomUUID(),
          input.event.batchId,
          input.event.rowId ?? null,
          input.event.ownerUserId ?? null,
          input.event.actorUserId ?? null,
          input.event.connectorConnectionId ?? null,
          input.event.eventType,
          input.event.summary ?? null,
          input.event.beforeState ? JSON.stringify(input.event.beforeState) : null,
          input.event.afterState ? JSON.stringify(input.event.afterState) : null,
          JSON.stringify(input.event.metadata ?? {}),
          input.event.sourceIp ?? null,
          input.event.createdAt ?? null,
        ],
      );

      await client.query("COMMIT");
      return {
        rows: savedRows,
        batch: mapAiTransactionDraftBatchRow(savedBatch),
        event: mapAiTransactionDraftEventRow(eventResult.rows[0]!),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listAiTransactionDraftEvents(batchId: string): Promise<AiTransactionDraftEventRecord[]> {
    const result = await this.pool.query<{
      id: string;
      batch_id: string;
      row_id: string | null;
      owner_user_id: string | null;
      actor_user_id: string | null;
      connector_connection_id: string | null;
      event_type: AiTransactionDraftEventType;
      summary: string | null;
      before_state: Record<string, unknown> | null;
      after_state: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null;
      source_ip: string | null;
      created_at: string;
    }>(
      `SELECT id,
              batch_id,
              row_id,
              owner_user_id,
              actor_user_id,
              connector_connection_id,
              event_type,
              summary,
              before_state,
              after_state,
              metadata,
              source_ip::text AS source_ip,
              created_at::text AS created_at
       FROM ai_transaction_draft_events
       WHERE batch_id = $1
       ORDER BY created_at ASC`,
      [batchId],
    );
    return result.rows.map((row) => mapAiTransactionDraftEventRow(row));
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
      if (activeCount >= getEffectiveAnonymousShareTokenCap()) {
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
    const retentionCutoff = new Date(Date.now() - getEffectiveAnonymousShareTokenRetentionMs()).toISOString();
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
        // ui-enhancement: soft-deleted accounts (deleted_at IS NOT NULL) are
        // excluded from the active store. They are surfaced separately via
        // `listSoftDeletedAccounts` for the "Recently deleted" UI section and
        // selected for hard-purge by the daily cron.
        // [active-only filter ADDED]
        `SELECT id, user_id, name, fee_profile_id, default_currency, account_type
         FROM accounts
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY id`,
        [userId],
      ),
      // KZO-183: fee_profiles is account-scoped. user_id was dropped in
      // migration 042; ownership flows fee_profiles.account_id → accounts →
      // users. Filter via JOIN through accounts.
      this.pool.query(
        // ui-enhancement: when an account is soft-deleted, loadStore excludes
        // it from `store.accounts` (active-only filter); the JOIN here MUST
        // also exclude its fee profiles, otherwise `validateStoreInvariants`
        // sees `profile.accountId` pointing at an account not in `accountIds`
        // and throws on the next saveStore. [active-only filter ADDED]
        `SELECT fp.id, fp.account_id, fp.name, fp.commission_rate_bps, fp.board_commission_rate,
                fp.commission_discount_percent, fp.commission_discount_bps, fp.minimum_commission_amount,
                fp.commission_currency,
                fp.commission_rounding_mode, fp.tax_rounding_mode,
                fp.stock_sell_tax_rate_bps, fp.stock_day_trade_tax_rate_bps, fp.commission_charge_mode,
                fp.etf_sell_tax_rate_bps, fp.bond_etf_sell_tax_rate_bps
         FROM fee_profiles fp
         JOIN accounts a ON a.id = fp.account_id
         WHERE a.user_id = $1 AND a.deleted_at IS NULL
         ORDER BY fp.id`,
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
           AND trade_event.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
         ORDER BY trade_event.trade_date, trade_event.booking_sequence, trade_event.trade_timestamp, trade_event.booked_at, trade_event.id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, user_id, account_id, trade_event_id, ticker, lot_id, lot_opened_at,
                lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
         FROM lot_allocations
         WHERE user_id = $1
           AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
         ORDER BY trade_event_id, lot_opened_at, lot_opened_sequence, lot_id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, ticker, market_code, event_type, ex_dividend_date, payment_date,
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
           AND (
             account_id IS NULL
             OR account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
           )
         ORDER BY created_at, id`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, user_id, account_id, entry_date, entry_type, amount, currency,
                related_trade_event_id, related_dividend_ledger_entry_id, source,
                source_reference, note, booked_at, reversal_of_cash_ledger_entry_id,
                fx_rate_to_usd, fx_transfer_id::text AS fx_transfer_id
         FROM cash_ledger_entries
         WHERE user_id = $1
           AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
         ORDER BY entry_date, booked_at, id`,
        [userId],
      ),
      this.pool.query(
        `SELECT ticker, name, instrument_type, market_code, is_provisional, last_synced_at
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
      // KZO-183: market_code column dropped from account_fee_profile_overrides
      // in migration 042. PK is now (account_id, ticker).
      accountIds.length
        ? this.pool.query(
            `SELECT account_id, ticker, fee_profile_id
             FROM account_fee_profile_overrides
             WHERE account_id = ANY($1)
             ORDER BY account_id, ticker`,
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
      fxTransferId: row.fx_transfer_id ?? null,
    }));

    const dividendEvents: DividendEvent[] = dividendEventsResult.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      marketCode: row.market_code,
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
    const instruments = symbolsResult.rows
      // Guard against index tickers (e.g. ^DJI) that may have been stored by an
      // earlier catalog sync before the deduplicateInstruments filter was in place.
      .filter((row) => /^[A-Za-z0-9]{1,16}$/.test(row.ticker as string))
      .map((row) => ({
        ticker: row.ticker,
        name: row.name ?? undefined,
        instrumentType: row.instrument_type,
        // KZO-169: market_code is NOT NULL on `symbols`/`instruments` (since
        // migration 012). Strip the `?? "TW"` provider-stamping fallback (G1).
        marketCode: String(row.market_code) as InstrumentDef["marketCode"],
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
        defaultCurrency: row.default_currency,
        accountType: row.account_type,
      })),
      feeProfileBindings: bindingsResult.rows.map((row) => ({
        accountId: row.account_id,
        ticker: row.ticker,
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

  async getUserSettings(userId: string) {
    await this.ensureDefaultPortfolioData(userId);
    const result = await this.pool.query<{
      id: string;
      display_name: string | null;
      locale: Store["settings"]["locale"];
      cost_basis_method: Store["settings"]["costBasisMethod"];
      quote_poll_interval_seconds: number;
    }>(
      `SELECT id,
              display_name,
              locale,
              cost_basis_method,
              quote_poll_interval_seconds
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`User ${userId} not found`);
    }
    return {
      userId: row.id,
      displayName: row.display_name ?? null,
      locale: row.locale,
      costBasisMethod: row.cost_basis_method,
      quotePollIntervalSeconds: row.quote_poll_interval_seconds,
    };
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
      const accountIds = store.accounts.map((item) => item.id);

      // KZO-183: persistence order is now (1) accounts → (2) fee_profiles →
      // (3) overrides. fee_profiles.account_id has a regular FK to accounts,
      // so accounts must be upserted first. accounts.fee_profile_id has a
      // composite FK to fee_profiles(id, account_id) that is DEFERRABLE
      // INITIALLY DEFERRED — so an account can transiently reference a
      // not-yet-inserted profile within the transaction.
      //
      // Constraint check defers to COMMIT time. The trailing DELETE FROM
      // fee_profiles does NOT need user_id filtering anymore (fee_profiles
      // has no user_id column post-rescope) — instead it's scoped via
      // account_id ∈ this user's accounts.

      // Step 1: UPSERT accounts.
      for (const account of store.accounts) {
        const upsertAccount = await client.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             fee_profile_id = EXCLUDED.fee_profile_id,
             default_currency = EXCLUDED.default_currency,
             account_type = EXCLUDED.account_type
           WHERE accounts.user_id = EXCLUDED.user_id`,
          [account.id, account.userId, account.name, account.feeProfileId, account.defaultCurrency, account.accountType],
        );

        if (upsertAccount.rowCount !== 1) {
          throw new Error(`Account id conflict for id=${account.id}`);
        }
      }

      // Step 2: UPSERT fee_profiles. Each profile.account_id must reference
      // an account that exists post-step-1.
      for (const profile of store.feeProfiles) {
        const upsertProfile = await client.query(
          `INSERT INTO fee_profiles (
             id, account_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
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
           WHERE fee_profiles.account_id = EXCLUDED.account_id`,
          [
            profile.id,
            profile.accountId,
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

        await replaceFeeProfileTaxRules(client, profile);
      }

      // Step 3: DELETE old accounts not in store. Cascades to fee_profiles
      // via accounts.fee_profile_id ON DELETE CASCADE (composite FK from
      // accounts is the deferred owner-of-profile FK; the regular FK on
      // fee_profiles.account_id → accounts(id) cascades when an account is
      // deleted).
      //
      // ui-enhancement: PRESERVE soft-deleted rows (deleted_at IS NOT NULL).
      // `loadStore` filters them out of `store.accounts`, so without this
      // guard the cleanup would hard-delete every soft-deleted row on every
      // saveStore — wiping the entire "Recently deleted" surface. The guard
      // makes the cleanup active-only.
      if (accountIds.length) {
        await client.query(
          `DELETE FROM accounts
           WHERE user_id = $1
             AND deleted_at IS NULL
             AND id <> ALL($2)`,
          [store.userId, accountIds],
        );
      } else {
        await client.query(
          `DELETE FROM accounts WHERE user_id = $1 AND deleted_at IS NULL`,
          [store.userId],
        );
      }

      // Step 4: UPSERT account_fee_profile_overrides. Per migration 042,
      // overrides no longer carry market_code; PK is (account_id, ticker).
      if (accountIds.length) {
        await client.query(`DELETE FROM account_fee_profile_overrides WHERE account_id = ANY($1)`, [accountIds]);
        for (const binding of store.feeProfileBindings) {
          await client.query(
            `INSERT INTO account_fee_profile_overrides (account_id, ticker, fee_profile_id)
             VALUES ($1, $2, $3)`,
            [binding.accountId, binding.ticker, binding.feeProfileId],
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

      // Step 5: DELETE stale fee_profiles. fee_profiles has no user_id
      // post-KZO-183 — scope deletes to profiles owned by accounts of the
      // current user that weren't included in the save set.
      //
      // ui-enhancement: PRESERVE fee profiles owned by soft-deleted accounts.
      // loadStore filters them out of `store.feeProfiles`, so without the
      // `a.deleted_at IS NULL` guard the cleanup would hard-delete them on
      // every saveStore — leaving the soft-deleted account FK-orphaned and
      // breaking hardPurgeAccount's eventual cascade. [active-only filter ADDED]
      if (feeProfileIds.length) {
        await client.query(
          `DELETE FROM fee_profiles
           WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
             AND id <> ALL($2)`,
          [store.userId, feeProfileIds],
        );
      } else {
        await client.query(
          `DELETE FROM fee_profiles
           WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)`,
          [store.userId],
        );
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
    await this.ensureRedisOpen();
    const result = await this.redis.set(redisKey, "1", { EX: 86_400, NX: true });
    return result === "OK";
  }

  async releaseIdempotencyKey(userId: string, key: string): Promise<void> {
    await this.ensureRedisOpen();
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

  async getLatestBarsByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
    limit: number,
  ): Promise<DailyBarWithMarket[]> {
    if (pairs.length === 0) return [];
    const tickers = pairs.map((p) => p.ticker);
    const markets = pairs.map((p) => p.marketCode);
    const result = await this.pool.query<{
      ticker: string; market_code: string; bar_date: string; open: string; high: string; low: string;
      close: string; volume: string; source: string; ingested_at: string;
    }>(
      `WITH input AS (
         SELECT DISTINCT ticker, market_code
         FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code)
       ),
       ranked AS (
         SELECT b.ticker, b.market_code, b.bar_date, b.open, b.high, b.low, b.close,
                b.volume, b.source, b.ingested_at,
                ROW_NUMBER() OVER (
                  PARTITION BY b.ticker, b.market_code
                  ORDER BY b.bar_date DESC
                ) AS rn
         FROM market_data.daily_bars b
         INNER JOIN input i
           ON i.ticker = b.ticker AND i.market_code = b.market_code
       )
       SELECT ticker, market_code, bar_date::text, open, high, low, close, volume, source, ingested_at::text
       FROM ranked WHERE rn <= $3
       ORDER BY ticker, market_code, bar_date DESC`,
      [tickers, markets, limit],
    );
    return result.rows.map(row => ({
      ticker: row.ticker,
      marketCode: row.market_code,
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

  async getLatestBarDatesByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (pairs.length === 0) return result;
    for (const p of pairs) result.set(`${p.ticker}:${p.marketCode}`, null);
    // Use `unnest` to batch the (ticker, marketCode) pairs in one round-trip.
    // `MAX(bar_date)` per group produces the freshest bar per pair.
    const tickers = pairs.map((p) => p.ticker);
    const markets = pairs.map((p) => p.marketCode);
    const rows = await this.pool.query<{ ticker: string; market_code: string; latest: string | null }>(
      `SELECT input.ticker, input.market_code,
              MAX(b.bar_date)::text AS latest
         FROM unnest($1::text[], $2::text[]) AS input(ticker, market_code)
         LEFT JOIN market_data.daily_bars b
           ON b.ticker = input.ticker AND b.market_code = input.market_code
         GROUP BY input.ticker, input.market_code`,
      [tickers, markets],
    );
    for (const row of rows.rows) {
      result.set(`${row.ticker}:${row.market_code}`, row.latest);
    }
    return result;
  }

  async getLatestBarDatesForReconciliation(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (pairs.length === 0) return result;
    for (const pair of pairs) {
      result.set(`${pair.ticker}:${pair.marketCode}`, null);
    }
    const tickers = pairs.map((pair) => pair.ticker);
    const markets = pairs.map((pair) => pair.marketCode);
    const rows = await this.pool.query<{ ticker: string; market_code: string; latest_bar_date: string | null }>(
      `SELECT input.ticker, input.market_code, latest.bar_date::text AS latest_bar_date
         FROM unnest($1::text[], $2::text[]) AS input(ticker, market_code)
         LEFT JOIN LATERAL (
           SELECT b.bar_date
             FROM market_data.daily_bars b
            WHERE b.ticker = input.ticker
              AND b.market_code = input.market_code
            ORDER BY b.bar_date DESC
            LIMIT 1
         ) latest ON true`,
      [tickers, markets],
    );
    for (const row of rows.rows) {
      result.set(`${row.ticker}:${row.market_code}`, row.latest_bar_date);
    }
    return result;
  }

  async getDistinctBarDates(market: MarketCode, fromDate: string): Promise<string[]> {
    const result = await this.pool.query<{ bar_date: string }>(
      `SELECT DISTINCT bar_date::text AS bar_date
       FROM market_data.daily_bars
       WHERE market_code = $1 AND bar_date >= $2::date
       ORDER BY bar_date ASC`,
      [market, fromDate],
    );
    return result.rows.map((row) => row.bar_date);
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

  async getDailyBarsForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
    startDate: string,
    endDate: string,
  ): Promise<DailyBar[]> {
    const result = await this.pool.query<{
      ticker: string; bar_date: string; open: string; high: string; low: string;
      close: string; volume: string; source: string; ingested_at: string;
    }>(
      `SELECT ticker, bar_date::text, open, high, low, close, volume, source, ingested_at::text
         FROM market_data.daily_bars
        WHERE ticker = $1
          AND market_code = $2
          AND bar_date >= $3::date
          AND bar_date <= $4::date
        ORDER BY bar_date ASC`,
      [ticker, marketCode, startDate, endDate],
    );
    return result.rows.map((row) => ({
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

  async getDailyBarsForTickerMarkets(
    pairs: readonly { ticker: string; marketCode: MarketCode }[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, DailyBar[]>> {
    const result = new Map<string, DailyBar[]>();
    for (const pair of pairs) result.set(`${pair.ticker}\0${pair.marketCode}`, []);
    if (pairs.length === 0) return result;

    const rows = await this.pool.query<{
      ticker: string; market_code: MarketCode; bar_date: string; open: string; high: string; low: string;
      close: string; volume: string; source: string; ingested_at: string;
    }>(
      `WITH requested_pairs AS (
         SELECT DISTINCT ticker, "marketCode" AS market_code
           FROM jsonb_to_recordset($1::jsonb) AS pair(ticker text, "marketCode" text)
          WHERE ticker IS NOT NULL
            AND "marketCode" IS NOT NULL
       )
       SELECT b.ticker, b.market_code, b.bar_date::text, b.open, b.high, b.low, b.close, b.volume, b.source, b.ingested_at::text
         FROM market_data.daily_bars b
         JOIN requested_pairs pair
           ON pair.ticker = b.ticker
          AND pair.market_code = b.market_code
        WHERE b.bar_date >= $2::date
          AND b.bar_date <= $3::date
        ORDER BY b.ticker ASC, b.market_code ASC, b.bar_date ASC`,
      [JSON.stringify(pairs), startDate, endDate],
    );

    for (const row of rows.rows) {
      const key = `${row.ticker}\0${row.market_code}`;
      const list = result.get(key) ?? [];
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
      result.set(key, list);
    }

    return result;
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

  async listHoldingSnapshotRepairScopesForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<import("./types.js").HoldingSnapshotRepairScope[]> {
    const result = await this.pool.query<{
      user_id: string;
      account_id: string;
      ticker: string;
      market_code: MarketCode;
    }>(
       `SELECT DISTINCT
          a.user_id,
          l.account_id,
          l.ticker,
          $2::text AS market_code
       FROM lots l
       JOIN accounts a
         ON a.id = l.account_id
        AND a.deleted_at IS NULL
       JOIN users u
         ON u.id = a.user_id
       WHERE l.ticker = $1
         AND l.open_quantity > 0
         AND u.is_demo = FALSE
         AND u.deactivated_at IS NULL
         AND u.deleted_at IS NULL
         AND EXISTS (
           SELECT 1
             FROM trade_events te
            WHERE te.account_id = l.account_id
              AND te.ticker = l.ticker
              AND te.market_code = $2
         )
       ORDER BY a.user_id, l.account_id, l.ticker, market_code`,
      [ticker, marketCode],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      accountId: row.account_id,
      ticker: row.ticker,
      marketCode: row.market_code,
    }));
  }

  async listHoldingSnapshotRepairTargets(
    options: import("./types.js").HoldingSnapshotRepairTargetOptions,
  ): Promise<import("./types.js").HoldingSnapshotRepairTarget[]> {
    const result = await this.pool.query<{
      ticker: string;
      market_code: MarketCode;
      from_date: string;
      affected_scope_count: string;
      repairable_rows: string;
      missing_rows: string;
      incomplete_rows: string;
    }>(
      `WITH trade_scopes AS (
         SELECT
           te.user_id,
           te.account_id,
           te.ticker,
           te.market_code,
           MIN(te.trade_date)::date AS first_trade_date
         FROM trade_events te
         JOIN accounts a
           ON a.id = te.account_id
          AND a.user_id = te.user_id
          AND a.deleted_at IS NULL
         JOIN users u
           ON u.id = te.user_id
        WHERE u.is_demo = FALSE
        GROUP BY te.user_id, te.account_id, te.ticker, te.market_code
       ),
       repairable AS (
         SELECT
           ts.user_id,
           ts.account_id,
           ts.ticker,
           ts.market_code,
           b.bar_date::date AS repair_date,
           CASE WHEN s.id IS NULL THEN 1 ELSE 0 END AS missing_row,
           CASE
             WHEN s.id IS NOT NULL
              AND (
                s.is_provisional
                OR s.close_price IS NULL
                OR s.quantity IS NULL
                OR (
                  s.quantity > 0
                  AND (
                    s.market_value IS NULL
                    OR s.value_native IS NULL
                  )
                )
                OR s.provider_source IS NULL
              )
             THEN 1
             ELSE 0
           END AS incomplete_row
         FROM trade_scopes ts
         JOIN market_data.daily_bars b
           ON b.ticker = ts.ticker
          AND b.market_code = ts.market_code
          AND b.bar_date >= GREATEST(ts.first_trade_date, $1::date)
          AND b.bar_date <= $2::date
         LEFT JOIN daily_holding_snapshots s
           ON s.user_id = ts.user_id
          AND s.account_id = ts.account_id
          AND s.ticker = ts.ticker
          AND s.market_code = ts.market_code
          AND s.snapshot_date = b.bar_date
        WHERE s.id IS NULL
           OR s.is_provisional
           OR s.close_price IS NULL
           OR s.quantity IS NULL
           OR (
             s.quantity > 0
             AND (
               s.market_value IS NULL
               OR s.value_native IS NULL
             )
           )
           OR s.provider_source IS NULL
       )
       SELECT
         ticker,
         market_code,
         MIN(repair_date)::text AS from_date,
         COUNT(DISTINCT user_id || E'\\x1f' || account_id)::text AS affected_scope_count,
         COUNT(*)::text AS repairable_rows,
         COALESCE(SUM(missing_row), 0)::text AS missing_rows,
         COALESCE(SUM(incomplete_row), 0)::text AS incomplete_rows
       FROM repairable
       GROUP BY ticker, market_code
       ORDER BY MIN(repair_date) ASC, ticker ASC, market_code ASC
       LIMIT $3`,
      [options.fromDate, options.toDate, options.limit],
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      marketCode: row.market_code,
      fromDate: row.from_date,
      affectedScopeCount: Number(row.affected_scope_count),
      repairableRows: Number(row.repairable_rows),
      missingRows: Number(row.missing_rows),
      incompleteRows: Number(row.incomplete_rows),
    }));
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
    const pivot = "TWD";
    const result = await this.pool.query<{
      direct_rate: string | null;
      inverse_rate: string | null;
      base_to_pivot_direct_rate: string | null;
      pivot_to_base_rate: string | null;
      quote_to_pivot_direct_rate: string | null;
      pivot_to_quote_rate: string | null;
    }>(
      `SELECT
         (
           SELECT rate::text FROM market_data.fx_rates
            WHERE base_currency = $1 AND quote_currency = $2 AND date <= $3
            ORDER BY date DESC LIMIT 1
         ) AS direct_rate,
         (
           SELECT rate::text FROM market_data.fx_rates
            WHERE base_currency = $2 AND quote_currency = $1 AND date <= $3
            ORDER BY date DESC LIMIT 1
         ) AS inverse_rate,
         (
           SELECT rate::text FROM market_data.fx_rates
            WHERE base_currency = $1 AND quote_currency = $4 AND date <= $3
            ORDER BY date DESC LIMIT 1
         ) AS base_to_pivot_direct_rate,
         (
           SELECT rate::text FROM market_data.fx_rates
            WHERE base_currency = $4 AND quote_currency = $1 AND date <= $3
            ORDER BY date DESC LIMIT 1
         ) AS pivot_to_base_rate,
         (
           SELECT rate::text FROM market_data.fx_rates
            WHERE base_currency = $2 AND quote_currency = $4 AND date <= $3
            ORDER BY date DESC LIMIT 1
         ) AS quote_to_pivot_direct_rate,
         (
           SELECT rate::text FROM market_data.fx_rates
            WHERE base_currency = $4 AND quote_currency = $2 AND date <= $3
            ORDER BY date DESC LIMIT 1
         ) AS pivot_to_quote_rate`,
      [base, quote, asOfDate, pivot],
    );
    const row = result.rows[0];
    if (!row) return null;

    const directRate = row.direct_rate === null ? null : Number(row.direct_rate);
    if (directRate !== null) return directRate;

    const inverseRate = row.inverse_rate === null ? null : Number(row.inverse_rate);
    if (inverseRate !== null && inverseRate !== 0) return 1 / inverseRate;

    const baseToPivot = base === pivot
      ? 1.0
      : rateOrInverse(row.base_to_pivot_direct_rate, row.pivot_to_base_rate);
    const quoteToPivot = quote === pivot
      ? 1.0
      : rateOrInverse(row.quote_to_pivot_direct_rate, row.pivot_to_quote_rate);

    if (baseToPivot !== null && quoteToPivot !== null && quoteToPivot !== 0) {
      return baseToPivot / quoteToPivot;
    }
    return null;
  }

  async getFxTransferById(
    userId: string,
    fxTransferId: string,
  ): Promise<{ legs: CashLedgerEntry[]; reversed: boolean } | null> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      account_id: string;
      entry_date: string;
      entry_type: string;
      amount: string;
      currency: string;
      related_trade_event_id: string | null;
      related_dividend_ledger_entry_id: string | null;
      source: string;
      source_reference: string | null;
      note: string | null;
      booked_at: string | null;
      reversal_of_cash_ledger_entry_id: string | null;
      fx_rate_to_usd: string | null;
      fx_transfer_id: string | null;
    }>(
      `SELECT id, user_id, account_id, entry_date::text, entry_type, amount::text, currency,
              related_trade_event_id, related_dividend_ledger_entry_id, source,
              source_reference, note, booked_at::text, reversal_of_cash_ledger_entry_id,
              fx_rate_to_usd::text, fx_transfer_id::text
       FROM cash_ledger_entries
       WHERE user_id = $1
         AND fx_transfer_id = $2::uuid
       ORDER BY reversal_of_cash_ledger_entry_id NULLS FIRST, entry_type ASC, id ASC`,
      [userId, fxTransferId],
    );
    if (result.rows.length === 0) return null;
    const legs: CashLedgerEntry[] = result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      entryDate: row.entry_date,
      entryType: row.entry_type as CashLedgerEntry["entryType"],
      amount: Number(row.amount),
      currency: row.currency as CashLedgerEntry["currency"],
      relatedTradeEventId: row.related_trade_event_id ?? undefined,
      relatedDividendLedgerEntryId: row.related_dividend_ledger_entry_id ?? undefined,
      source: row.source,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      bookedAt: row.booked_at ? normalizeDateTime(row.booked_at) : undefined,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      fxRateToUsd: row.fx_rate_to_usd != null ? Number(row.fx_rate_to_usd) : null,
      fxTransferId: row.fx_transfer_id ?? null,
    }));
    return {
      legs,
      reversed: legs.some((leg) => Boolean(leg.reversalOfCashLedgerEntryId)),
    };
  }

  async getAccountAvailableBalance(userId: string, accountId: string, currency: string): Promise<number> {
    const result = await this.pool.query<{ amount: string }>(
      `SELECT COALESCE(SUM(c.amount), 0)::text AS amount
       FROM cash_ledger_entries c
       WHERE c.user_id = $1
         AND c.account_id = $2
         AND c.currency = $3
         AND c.reversal_of_cash_ledger_entry_id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM cash_ledger_entries r
           WHERE r.reversal_of_cash_ledger_entry_id = c.id
         )`,
      [userId, accountId, currency],
    );
    // COALESCE + aggregate guarantees exactly one row with a non-null `amount`
    // string; no null/empty fallback needed.
    return Number(result.rows[0].amount);
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
      fx_transfer_id: string | null;
      entry_type: string;
      reversal_of_cash_ledger_entry_id: string | null;
      booked_at: string | null;
    }>(
      // ui-enhancement: filter wallet-replay inputs to active accounts so the
      // memory backend (which delegates to the filtered loadStore) and the
      // Postgres backend agree on the active-only invariant.
      // [active-only filter ADDED]
      `SELECT id, account_id, currency, entry_date::text, amount::text,
              fx_rate_to_usd::text, fx_transfer_id::text, entry_type,
              reversal_of_cash_ledger_entry_id, booked_at
       FROM cash_ledger_entries c
       WHERE user_id = $1
         AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
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
      fxTransferId: row.fx_transfer_id ?? null,
      entryType: row.entry_type as import("../types/store.js").CashLedgerEntryType,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      bookedAt: row.booked_at ?? undefined,
    }));
  }

  async getSnapshotGenerationInputs(
    userId: string,
    scope?: { accountId: string; ticker: string; marketCode?: MarketCode },
  ): Promise<import("./types.js").SnapshotGenerationInputs> {
    // ui-enhancement: the no-scope path aggregates across every owned account;
    // it must exclude trade events belonging to soft-deleted accounts. The
    // scoped path takes a single accountId — soft-deleted account IDs are
    // unreachable from the UI (GET /accounts filters them) so the per-account
    // filter is sufficient; we add the predicate to both branches for defense.
    // [active-only filter ADDED]
    const tradeFilter = scope
      ? "user_id = $1 AND account_id = $2 AND ticker = $3 AND ($4::text IS NULL OR market_code = $4)"
      : "user_id = $1 AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)";
    const tradeParams = scope ? [userId, scope.accountId, scope.ticker, scope.marketCode ?? null] : [userId];
    const tradesResult = await this.pool.query<{
      id: string; account_id: string; ticker: string; trade_type: string;
      quantity: string; unit_price: string; trade_date: string;
      booking_sequence: number | null; commission_amount: string; tax_amount: string;
      price_currency: string; market_code: string;
    }>(
      `SELECT id, account_id, ticker, trade_type, quantity, unit_price, trade_date::text,
              booking_sequence, commission_amount, tax_amount, price_currency, market_code
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
    // ui-enhancement — hide soft-deleted accounts' dividend entries from the
    // snapshot aggregator. [active-only filter ADDED]
    const divFilter = scope
      ? "account.user_id = $1 AND account.deleted_at IS NULL AND dle.account_id = $2 AND de.ticker = $3 AND ($4::text IS NULL OR de.market_code = $4)"
      : "account.user_id = $1 AND account.deleted_at IS NULL";
    const divParams = scope ? [userId, scope.accountId, scope.ticker, scope.marketCode ?? null] : [userId];
    const divResult = await this.pool.query<{
      account_id: string; ticker: string; market_code: MarketCode; payment_date: string; amount: string;
    }>(
       `SELECT dle.account_id,
               de.ticker,
               de.market_code,
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
        // KZO-185: forward `market_code` so the walker can stamp each
        // (ticker, market_code) pair on the `tickersNeedingBackfill` payload.
        marketCode: row.market_code,
      })),
      postedDividends: divResult.rows.map(r => ({
        accountId: r.account_id,
        ticker: r.ticker,
        marketCode: r.market_code,
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
           id, user_id, account_id, ticker, market_code, snapshot_date, quantity,
           close_price, market_value, cost_basis, unrealized_pnl,
           cumulative_realized_pnl, cumulative_dividends,
           is_provisional, currency, generated_at, generation_run_id,
           value_native, cost_basis_native, unrealized_pnl_native, provider_source
         )
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::date[], $7::numeric[],
           $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[],
           $12::numeric[], $13::numeric[],
           $14::boolean[], $15::text[], $16::timestamptz[], $17::text[],
           $18::numeric[], $19::numeric[], $20::numeric[], $21::text[]
         )
         ON CONFLICT (user_id, account_id, ticker, market_code, snapshot_date) DO UPDATE SET
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
          snapshots.map(s => s.marketCode),
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

  async deleteHoldingSnapshotsForTicker(
    userId: string,
    accountId: string,
    ticker: string,
    fromDate: string,
    marketCode?: MarketCode,
  ): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM daily_holding_snapshots
       WHERE user_id = $1
         AND account_id = $2
         AND ticker = $3
         AND snapshot_date >= $4::date
         AND ($5::text IS NULL OR market_code = $5)`,
      [userId, accountId, ticker, fromDate, marketCode ?? null],
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
      snapshot_contributor_keys: string | null;
    }>(
      `SELECT
         snapshot_date::text,
         SUM(cost_basis) AS total_cost_basis,
         CASE WHEN bool_or(is_provisional) THEN NULL ELSE SUM(market_value) END AS total_market_value,
         CASE WHEN bool_or(is_provisional) THEN NULL ELSE SUM(unrealized_pnl) END AS total_unrealized_pnl,
         SUM(cumulative_realized_pnl) AS cumulative_realized_pnl,
         SUM(cumulative_dividends) AS cumulative_dividends,
         bool_or(is_provisional) AS is_provisional,
         string_agg(
           DISTINCT account_id || ':' || COALESCE(market_code, '') || ':' || ticker,
           ',' ORDER BY account_id || ':' || COALESCE(market_code, '') || ':' || ticker
         ) AS snapshot_contributor_keys
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
        // Legacy method does no FX translation — every row is trivially "available".
        fxAvailable: true,
        snapshotContributorKeys: parseSnapshotContributorKeys(row.snapshot_contributor_keys),
      };
    });
  }

  // KZO-180 — FX-aware aggregator. See `Persistence.getAggregatedSnapshotsInReportingCurrency`
  // doc for v1 deviation + D8 self-pair guard rationale.
  async getAggregatedSnapshotsInReportingCurrency(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
  ): Promise<AggregatedSnapshotPoint[]> {
    // D8 self-pair guard — the `needed_fx` CTE excludes self-pair currencies,
    // so reporting-currency rows skip the FX lookup entirely. The
    // multiplication uses `CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END`
    // so self-pair rows multiply by 1.0 (not NULL). Without this guard, every
    // TWD-only row's `value_native * fx.rate` evaluates to NULL and the entire
    // SUM degrades to NULL. The integration test suite asserts this is preserved
    // (case 1 — TWD-only self-pair).
    //
    // We intentionally translate `cost_basis_native`/`value_native`/`unrealized_pnl_native`
    // (the per-currency columns introduced in KZO-165). The legacy
    // `cost_basis`/`market_value`/`unrealized_pnl` columns are dual-written for
    // TWD but undefined for non-TWD; the native columns are authoritative.
    //
    // `cumulative_realized_pnl` and `cumulative_dividends` use the legacy
    // (non-native) columns because they don't have a per-currency split today.
    // For TWD-only users this is exact; for mixed-currency users this is the
    // v1 deviation flagged in KZO-180 D4 and owned by KZO-176.
    const result = await this.pool.query<{
      snapshot_date: string;
      total_cost_basis: string;
      total_market_value: string | null;
      total_unrealized_pnl: string | null;
      cumulative_realized_pnl: string;
      cumulative_dividends: string;
      is_provisional: boolean;
      fx_available: boolean;
      snapshot_contributor_keys: string | null;
    }>(
      `WITH snapshot_rows AS (
         SELECT s.*
           FROM daily_holding_snapshots s
          WHERE s.user_id = $1
            AND s.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
            AND s.snapshot_date >= $2::date
            AND s.snapshot_date <= $3::date
       ),
       needed_fx AS (
         SELECT DISTINCT snapshot_date, currency
           FROM snapshot_rows
          WHERE currency <> $4
       ),
       resolved_fx AS (
         SELECT nf.snapshot_date, nf.currency, fx.rate
           FROM needed_fx nf
           LEFT JOIN LATERAL (
             WITH resolved AS (
               SELECT
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = nf.currency AND quote_currency = $4 AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS direct_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = $4 AND quote_currency = nf.currency AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS inverse_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = nf.currency AND quote_currency = 'TWD' AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS base_to_pivot_direct_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = 'TWD' AND quote_currency = nf.currency AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS pivot_to_base_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = $4 AND quote_currency = 'TWD' AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS quote_to_pivot_direct_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = 'TWD' AND quote_currency = $4 AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS pivot_to_quote_rate
             )
             SELECT COALESCE(
               direct_rate,
               CASE WHEN inverse_rate IS NOT NULL AND inverse_rate <> 0 THEN 1.0 / inverse_rate END,
               CASE
                 WHEN base_to_pivot_rate IS NOT NULL AND quote_to_pivot_rate IS NOT NULL AND quote_to_pivot_rate <> 0
                 THEN base_to_pivot_rate / quote_to_pivot_rate
               END
             ) AS rate
             FROM (
               SELECT
                 direct_rate,
                 inverse_rate,
                 CASE
                   WHEN nf.currency = 'TWD' THEN 1.0
                   ELSE COALESCE(
                     base_to_pivot_direct_rate,
                     CASE WHEN pivot_to_base_rate IS NOT NULL AND pivot_to_base_rate <> 0 THEN 1.0 / pivot_to_base_rate END
                   )
                 END AS base_to_pivot_rate,
                 CASE
                   WHEN $4 = 'TWD' THEN 1.0
                   ELSE COALESCE(
                     quote_to_pivot_direct_rate,
                     CASE WHEN pivot_to_quote_rate IS NOT NULL AND pivot_to_quote_rate <> 0 THEN 1.0 / pivot_to_quote_rate END
                   )
                 END AS quote_to_pivot_rate
               FROM resolved
             ) rates
           ) fx ON true
       )
       SELECT s.snapshot_date::text,
              SUM(s.cost_basis_native      * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS total_cost_basis,
              CASE WHEN bool_or(s.is_provisional) THEN NULL ELSE
                SUM(s.value_native           * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END)
              END AS total_market_value,
              CASE WHEN bool_or(s.is_provisional) THEN NULL ELSE
                SUM(s.unrealized_pnl_native  * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END)
              END AS total_unrealized_pnl,
              SUM(s.cumulative_realized_pnl  * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS cumulative_realized_pnl,
              SUM(s.cumulative_dividends     * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS cumulative_dividends,
              bool_or(s.is_provisional) AS is_provisional,
              bool_and(s.currency = $4 OR fx.rate IS NOT NULL) AS fx_available,
              string_agg(
                DISTINCT s.account_id || ':' || COALESCE(s.market_code, '') || ':' || s.ticker,
                ',' ORDER BY s.account_id || ':' || COALESCE(s.market_code, '') || ':' || s.ticker
              ) AS snapshot_contributor_keys
         FROM snapshot_rows s
         LEFT JOIN resolved_fx fx
           ON fx.snapshot_date = s.snapshot_date
          AND fx.currency = s.currency
        GROUP BY s.snapshot_date
        ORDER BY s.snapshot_date ASC`,
      [userId, startDate, endDate, reportingCurrency],
    );
    return result.rows.map(row => {
      // Postgres `SUM(value * CASE...)` ignores NULL multiplications, so a row
      // with a self-pair contributor AND a missing-FX contributor produces a
      // partial sum (only the self-pair half lands). Without explicit zeroing,
      // the persistence DTO would diverge from the memory backend (which never
      // accumulates partial sums when `allFxResolved=false`). KZO-180 review
      // M1: align both backends — when `fx_available=false`, every numeric
      // contribution is gated. The wire layer (`dashboardReportingCurrency.ts`)
      // surfaces null externally regardless, but persistence-DTO consumers
      // (KZO-176, future internal reports) now see the same shape on both
      // backends.
      const fxAvailable = row.fx_available;
      const totalCostBasisRaw = row.total_cost_basis !== null ? Number(row.total_cost_basis) : null;
      const totalMarketValue = fxAvailable && row.total_market_value !== null ? Number(row.total_market_value) : null;
      const totalUnrealizedPnl = fxAvailable && row.total_unrealized_pnl !== null ? Number(row.total_unrealized_pnl) : null;
      const cumulativeRealizedPnlRaw = row.cumulative_realized_pnl !== null ? Number(row.cumulative_realized_pnl) : null;
      const cumulativeDividendsRaw = row.cumulative_dividends !== null ? Number(row.cumulative_dividends) : null;
      // Coerce non-nullable persistence-DTO fields to 0 on fx_available=false
      // (mirrors memory.ts:1776-1780).
      const totalCostBasis = fxAvailable ? (totalCostBasisRaw ?? 0) : 0;
      const cumulativeRealizedPnl = fxAvailable ? (cumulativeRealizedPnlRaw ?? 0) : 0;
      const cumulativeDividends = fxAvailable ? (cumulativeDividendsRaw ?? 0) : 0;
      const totalReturnAmount = fxAvailable && totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;
      return {
        date: row.snapshot_date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional: row.is_provisional,
        fxAvailable,
        snapshotContributorKeys: parseSnapshotContributorKeys(row.snapshot_contributor_keys),
      };
    });
  }

  async getAggregatedSnapshotsInReportingCurrencyForScope(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
    pairs: readonly import("./types.js").HoldingSnapshotScopePair[],
  ): Promise<AggregatedSnapshotPoint[]> {
    if (pairs.length === 0) return [];
    const scopedPairsJson = JSON.stringify(pairs);
    const result = await this.pool.query<{
      snapshot_date: string;
      total_cost_basis: string;
      total_market_value: string | null;
      total_unrealized_pnl: string | null;
      cumulative_realized_pnl: string;
      cumulative_dividends: string;
      is_provisional: boolean;
      fx_available: boolean;
      snapshot_contributor_keys: string | null;
    }>(
      `WITH scoped_pairs AS (
         SELECT DISTINCT "accountId" AS account_id, ticker, "marketCode" AS market_code
           FROM jsonb_to_recordset($5::jsonb) AS pair("accountId" text, ticker text, "marketCode" text)
          WHERE "accountId" IS NOT NULL
            AND ticker IS NOT NULL
       ),
       snapshot_rows AS (
         SELECT s.*
           FROM daily_holding_snapshots s
           JOIN scoped_pairs pair
             ON pair.account_id = s.account_id
            AND pair.ticker = s.ticker
            AND (pair.market_code IS NULL OR pair.market_code = s.market_code)
          WHERE s.user_id = $1
            AND s.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
            AND s.snapshot_date >= $2::date
            AND s.snapshot_date <= $3::date
       ),
       needed_fx AS (
         SELECT DISTINCT snapshot_date, currency
           FROM snapshot_rows
          WHERE currency <> $4
       ),
       resolved_fx AS (
         SELECT nf.snapshot_date, nf.currency, fx.rate
           FROM needed_fx nf
           LEFT JOIN LATERAL (
             WITH resolved AS (
               SELECT
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = nf.currency AND quote_currency = $4 AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS direct_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = $4 AND quote_currency = nf.currency AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS inverse_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = nf.currency AND quote_currency = 'TWD' AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS base_to_pivot_direct_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = 'TWD' AND quote_currency = nf.currency AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS pivot_to_base_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = $4 AND quote_currency = 'TWD' AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS quote_to_pivot_direct_rate,
                 (
                   SELECT rate FROM market_data.fx_rates
                    WHERE base_currency = 'TWD' AND quote_currency = $4 AND date <= nf.snapshot_date
                    ORDER BY date DESC LIMIT 1
                 ) AS pivot_to_quote_rate
             )
             SELECT COALESCE(
               direct_rate,
               CASE WHEN inverse_rate IS NOT NULL AND inverse_rate <> 0 THEN 1.0 / inverse_rate END,
               CASE
                 WHEN base_to_pivot_rate IS NOT NULL AND quote_to_pivot_rate IS NOT NULL AND quote_to_pivot_rate <> 0
                 THEN base_to_pivot_rate / quote_to_pivot_rate
               END
             ) AS rate
             FROM (
               SELECT
                 direct_rate,
                 inverse_rate,
                 CASE
                   WHEN nf.currency = 'TWD' THEN 1.0
                   ELSE COALESCE(
                     base_to_pivot_direct_rate,
                     CASE WHEN pivot_to_base_rate IS NOT NULL AND pivot_to_base_rate <> 0 THEN 1.0 / pivot_to_base_rate END
                   )
                 END AS base_to_pivot_rate,
                 CASE
                   WHEN $4 = 'TWD' THEN 1.0
                   ELSE COALESCE(
                     quote_to_pivot_direct_rate,
                     CASE WHEN pivot_to_quote_rate IS NOT NULL AND pivot_to_quote_rate <> 0 THEN 1.0 / pivot_to_quote_rate END
                   )
                 END AS quote_to_pivot_rate
               FROM resolved
             ) rates
           ) fx ON true
       )
       SELECT s.snapshot_date::text,
              SUM(s.cost_basis_native      * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS total_cost_basis,
              CASE WHEN bool_or(s.is_provisional) THEN NULL ELSE
                SUM(s.value_native           * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END)
              END AS total_market_value,
              CASE WHEN bool_or(s.is_provisional) THEN NULL ELSE
                SUM(s.unrealized_pnl_native  * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END)
              END AS total_unrealized_pnl,
              SUM(s.cumulative_realized_pnl  * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS cumulative_realized_pnl,
              SUM(s.cumulative_dividends     * CASE WHEN s.currency = $4 THEN 1.0 ELSE fx.rate END) AS cumulative_dividends,
              bool_or(s.is_provisional) AS is_provisional,
              bool_and(s.currency = $4 OR fx.rate IS NOT NULL) AS fx_available,
              string_agg(
                DISTINCT s.account_id || ':' || COALESCE(s.market_code, '') || ':' || s.ticker,
                ',' ORDER BY s.account_id || ':' || COALESCE(s.market_code, '') || ':' || s.ticker
              ) AS snapshot_contributor_keys
         FROM snapshot_rows s
         LEFT JOIN resolved_fx fx
           ON fx.snapshot_date = s.snapshot_date
          AND fx.currency = s.currency
        GROUP BY s.snapshot_date
        ORDER BY s.snapshot_date ASC`,
      [userId, startDate, endDate, reportingCurrency, scopedPairsJson],
    );
    return result.rows.map(row => {
      const fxAvailable = row.fx_available;
      const totalCostBasisRaw = row.total_cost_basis !== null ? Number(row.total_cost_basis) : null;
      const totalMarketValue = fxAvailable && row.total_market_value !== null ? Number(row.total_market_value) : null;
      const totalUnrealizedPnl = fxAvailable && row.total_unrealized_pnl !== null ? Number(row.total_unrealized_pnl) : null;
      const cumulativeRealizedPnlRaw = row.cumulative_realized_pnl !== null ? Number(row.cumulative_realized_pnl) : null;
      const cumulativeDividendsRaw = row.cumulative_dividends !== null ? Number(row.cumulative_dividends) : null;
      const totalCostBasis = fxAvailable ? (totalCostBasisRaw ?? 0) : 0;
      const cumulativeRealizedPnl = fxAvailable ? (cumulativeRealizedPnlRaw ?? 0) : 0;
      const cumulativeDividends = fxAvailable ? (cumulativeDividendsRaw ?? 0) : 0;
      const totalReturnAmount = fxAvailable && totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;
      return {
        date: row.snapshot_date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional: row.is_provisional,
        fxAvailable,
        snapshotContributorKeys: parseSnapshotContributorKeys(row.snapshot_contributor_keys),
      };
    });
  }

  async countHoldingSnapshotsAfterDate(
    userId: string,
    accountId: string,
    ticker: string,
    fromDate: string,
    marketCode?: MarketCode,
  ): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM daily_holding_snapshots
       WHERE user_id = $1
         AND account_id = $2
         AND ticker = $3
         AND snapshot_date >= $4::date
         AND ($5::text IS NULL OR market_code = $5)`,
      [userId, accountId, ticker, fromDate, marketCode ?? null],
    );
    return Number(result.rows[0].count);
  }

  async getLatestSnapshotDiagnostics(
    userId: string,
    pairs?: readonly import("./types.js").HoldingSnapshotScopePair[],
  ): Promise<import("./types.js").SnapshotScopeDiagnostics> {
    const scopedPairsJson = pairs && pairs.length > 0 ? JSON.stringify(pairs) : null;
    const result = await this.pool.query<{
      latest_snapshot_date: string | null;
      missing_provider_source_count: string;
      markets: string;
    }>(
      `WITH scoped_pairs AS (
         SELECT DISTINCT "accountId" AS account_id, ticker, "marketCode" AS market_code
           FROM jsonb_to_recordset(COALESCE($2::jsonb, '[]'::jsonb)) AS pair("accountId" text, ticker text, "marketCode" text)
          WHERE "accountId" IS NOT NULL
            AND ticker IS NOT NULL
       ),
       scoped_snapshots AS (
         SELECT s.snapshot_date, s.provider_source, s.market_code
           FROM daily_holding_snapshots s
          WHERE s.user_id = $1
            AND s.account_id IN (
              SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL
            )
            AND (
              $2::jsonb IS NULL
              OR EXISTS (
                SELECT 1
                  FROM scoped_pairs pair
                 WHERE pair.account_id = s.account_id
                   AND pair.ticker = s.ticker
                   AND (pair.market_code IS NULL OR pair.market_code = s.market_code)
              )
            )
       ),
       latest_snapshot AS (
         SELECT MAX(snapshot_date) AS latest_snapshot_date
           FROM scoped_snapshots
       ),
       latest_snapshot_per_market AS (
         SELECT market_code, MAX(snapshot_date) AS latest_snapshot_date
           FROM scoped_snapshots
          GROUP BY market_code
       ),
       market_rows AS (
         SELECT
           latest_snapshot_per_market.market_code,
           latest_snapshot_per_market.latest_snapshot_date,
           COALESCE(SUM(CASE
             WHEN scoped_snapshots.provider_source IS NULL THEN 1
             ELSE 0
           END), 0) AS missing_provider_source_count,
           COALESCE(
             ARRAY_AGG(DISTINCT scoped_snapshots.provider_source ORDER BY scoped_snapshots.provider_source)
               FILTER (WHERE scoped_snapshots.provider_source IS NOT NULL),
             ARRAY[]::text[]
           ) AS provider_sources
         FROM latest_snapshot_per_market
         LEFT JOIN scoped_snapshots
           ON scoped_snapshots.market_code = latest_snapshot_per_market.market_code
          AND scoped_snapshots.snapshot_date = latest_snapshot_per_market.latest_snapshot_date
         GROUP BY latest_snapshot_per_market.market_code, latest_snapshot_per_market.latest_snapshot_date
       )
       SELECT
         latest_snapshot.latest_snapshot_date::text AS latest_snapshot_date,
         COALESCE(SUM(CASE
           WHEN scoped_snapshots.snapshot_date = latest_snapshot.latest_snapshot_date
            AND scoped_snapshots.provider_source IS NULL
           THEN 1
           ELSE 0
         END), 0)::text AS missing_provider_source_count
         ,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'marketCode', market_rows.market_code,
             'latestSnapshotDate', market_rows.latest_snapshot_date::text,
             'missingProviderSourceCount', market_rows.missing_provider_source_count,
             'providerSources', market_rows.provider_sources
           ) ORDER BY market_rows.market_code)
           FROM market_rows
         ), '[]'::jsonb)::text AS markets
       FROM latest_snapshot
       LEFT JOIN scoped_snapshots
         ON scoped_snapshots.snapshot_date = latest_snapshot.latest_snapshot_date
       GROUP BY latest_snapshot.latest_snapshot_date`,
      [userId, scopedPairsJson],
    );
    const row = result.rows[0];
    return {
      latestSnapshotDate: row?.latest_snapshot_date ?? null,
      missingProviderSourceCount: Number(row?.missing_provider_source_count ?? 0),
      markets: row?.markets
        ? (JSON.parse(row.markets) as Array<{
          marketCode: MarketCode;
          latestSnapshotDate: string | null;
          missingProviderSourceCount: number;
          providerSources: string[];
        }>)
        : [],
    };
  }

  async getLatestHoldingSnapshotDatesByScope(
    userId: string,
    pairs: readonly import("./types.js").HoldingSnapshotLatestDateScopePair[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (pairs.length === 0) return result;
    for (const pair of pairs) {
      result.set(`${pair.accountId}\0${pair.ticker}\0${pair.marketCode}`, null);
    }
    const rows = await this.pool.query<{
      account_id: string;
      ticker: string;
      market_code: MarketCode;
      latest_snapshot_date: string | null;
    }>(
      `SELECT input.account_id, input.ticker, input.market_code, MAX(s.snapshot_date)::text AS latest_snapshot_date
         FROM jsonb_to_recordset($2::jsonb) AS input(account_id text, ticker text, market_code text)
         LEFT JOIN daily_holding_snapshots s
           ON s.user_id = $1
          AND s.account_id = input.account_id
          AND s.ticker = input.ticker
          AND s.market_code = input.market_code
         GROUP BY input.account_id, input.ticker, input.market_code`,
      [
        userId,
        JSON.stringify(pairs.map((pair) => ({
          account_id: pair.accountId,
          ticker: pair.ticker,
          market_code: pair.marketCode,
        }))),
      ],
    );
    for (const row of rows.rows) {
      result.set(`${row.account_id}\0${row.ticker}\0${row.market_code}`, row.latest_snapshot_date);
    }
    return result;
  }

  async getHoldingSnapshotsForTicker(
    userId: string, accountId: string, ticker: string, startDate: string, endDate: string,
  ): Promise<HoldingSnapshot[]> {
    const result = await this.pool.query<{
      id: string; user_id: string; account_id: string; ticker: string; market_code: MarketCode; snapshot_date: string;
      quantity: string; close_price: string | null; market_value: string | null; cost_basis: string;
      unrealized_pnl: string | null; cumulative_realized_pnl: string; cumulative_dividends: string;
      is_provisional: boolean; currency: string; generated_at: string; generation_run_id: string;
      value_native: string | null; cost_basis_native: string | null;
      unrealized_pnl_native: string | null; provider_source: string | null;
    }>(
      `SELECT id, user_id, account_id, ticker, market_code, snapshot_date::text,
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
      marketCode: row.market_code,
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
      user_profile: { displayName?: unknown; pictureUrl?: unknown } | null;
    }>(
      `SELECT u.id AS user_id, u.email, u.display_name, u.role,
              e.provider_picture_url, e.provider_display_name,
              e.linked_at, e.last_seen_at,
              up.preferences->'userProfile' AS user_profile
       FROM users u
       LEFT JOIN user_external_identities e ON e.user_id = u.id AND e.provider = 'google'
       LEFT JOIN public.user_preferences up ON up.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw routeError(404, "not_found", "Profile not found");
    }
    const row = result.rows[0];
    // ui-reshape Phase 3d S7 — JSONB-backed user override storage. Narrow
    // each field independently; reject non-string values gracefully (the
    // JSONB blob is opaque on read, so we cannot assume shape).
    const userProfileRaw = row.user_profile ?? {};
    const userDisplayName = typeof userProfileRaw.displayName === "string"
      ? userProfileRaw.displayName
      : null;
    const userPictureUrl = typeof userProfileRaw.pictureUrl === "string"
      ? userProfileRaw.pictureUrl
      : null;
    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      providerPictureUrl: row.provider_picture_url,
      providerDisplayName: row.provider_display_name,
      userDisplayName,
      userPictureUrl,
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

  /**
   * ui-reshape Phase 3d S7 — JSONB-backed user override write. Per
   * architect-design §7.1 LOCKED decision: storage lives in
   * `user_preferences.preferences.userProfile.{displayName, pictureUrl}`,
   * no DB migration. The CASE expression below has three branches per field:
   *   - field undefined (not in `fields`)  → leave alone
   *   - field === null                      → remove that JSONB key
   *   - field === string                    → set/replace that JSONB key
   * If both keys are removed and `userProfile` becomes empty (`{}`), the
   * parent `userProfile` key is stripped via `jsonb_strip_nulls`-style cleanup
   * by the route layer; here we keep the empty object — harmless on read.
   *
   * Validation (HTTPS-only on pictureUrl, length on displayName) is enforced
   * at the route layer; this method assumes input has already been validated.
   */
  async updateProfileFields(
    userId: string,
    fields: { displayName?: string | null; pictureUrl?: string | null },
  ): Promise<ProfileDto> {
    // Confirm the user exists first — getProfile throws 404 otherwise.
    const userExists = await this.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [userId],
    );
    if (userExists.rowCount === 0) {
      throw routeError(404, "not_found", "Profile not found");
    }

    // Compute the next userProfile JSONB by reading current then merging.
    const current = await this.pool.query<{ user_profile: Record<string, unknown> | null }>(
      `SELECT preferences->'userProfile' AS user_profile
       FROM public.user_preferences WHERE user_id = $1`,
      [userId],
    );
    const existingUserProfile: Record<string, unknown> =
      current.rowCount && current.rows[0].user_profile && typeof current.rows[0].user_profile === "object"
        ? { ...current.rows[0].user_profile }
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

    // Upsert: keep top-level preferences merge semantics, but specifically
    // replace (or strip) the `userProfile` sub-key.
    const userProfileEmpty = Object.keys(existingUserProfile).length === 0;
    if (userProfileEmpty) {
      // Strip the userProfile key entirely.
      await this.pool.query(
        `INSERT INTO public.user_preferences (user_id, preferences, updated_at)
         VALUES ($1, '{}'::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET preferences = public.user_preferences.preferences - 'userProfile',
               updated_at = NOW()`,
        [userId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO public.user_preferences (user_id, preferences, updated_at)
         VALUES ($1, jsonb_build_object('userProfile', $2::jsonb), NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET preferences = jsonb_set(
                 public.user_preferences.preferences,
                 '{userProfile}',
                 $2::jsonb,
                 true
               ),
               updated_at = NOW()`,
        [userId, JSON.stringify(existingUserProfile)],
      );
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
      await this.ensureRedisOpen();
      await this.redis.ping();
      status.redis = true;
    } catch {
      status.redis = false;
    }

    return status;
  }

  private async ensureRedisOpen(): Promise<void> {
    if (!this.redis.isOpen) await this.redis.connect();
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

  async saveAccountingStoreWithAudit(
    userId: string,
    accounting: AccountingStore,
    auditEntry: AuditLogInput,
  ): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    await this.ensureDefaultPortfolioData(userId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const accountIds = await this.listUserAccountIds(client, userId);
      await this.saveAccountingStoreTx(client, userId, accounting, accountIds);
      await this.appendAuditLogTx(client, auditEntry);
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
          // KZO-169: marketCode is required on BookedTradeEvent.
          trade.marketCode,
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
           fx_rate_to_usd, fx_transfer_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16
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
          cashEntry.fxTransferId ?? null,
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

  private async savePostedTradeTx(
    client: PoolClient,
    userId: string,
    accounting: AccountingStore,
    tradeEventId: string,
  ): Promise<void> {
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
        // KZO-169: marketCode is required on BookedTradeEvent.
        trade.marketCode,
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
         fx_rate_to_usd, fx_transfer_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13, $14,
         $15, $16
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
        cashEntry.fxTransferId ?? null,
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
        [
          lot.id,
          lot.accountId,
          lot.ticker,
          lot.openQuantity,
          lot.totalCostAmount,
          lot.costCurrency,
          lot.openedAt,
          lot.openedSequence ?? 1,
        ],
      );
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
             fx_rate_to_usd, fx_transfer_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13, $14,
             $15, $16
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
            cashEntry.fxTransferId ?? null,
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
        // ui-enhancement — ownership check rejects writes to soft-deleted
        // accounts' ledger entries. [active-only filter ADDED]
        `SELECT 1
         FROM dividend_ledger_entries AS dle
         JOIN accounts AS account
           ON account.id = dle.account_id
         WHERE dle.id = $1
           AND account.user_id = $2
           AND account.deleted_at IS NULL
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
         AND account.user_id = $2
         -- ui-enhancement — hide soft-deleted account ledger entries.
         -- [active-only filter ADDED]
         AND account.deleted_at IS NULL`,
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
           -- ui-enhancement — block writes to soft-deleted account's posted
           -- cash dividend rows. [active-only filter ADDED]
           AND account.deleted_at IS NULL
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
           -- ui-enhancement — block update on soft-deleted account dividend.
           -- [active-only filter ADDED]
           AND account.deleted_at IS NULL
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
             fx_rate_to_usd, fx_transfer_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13, $14,
             $15, $16
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
            cashEntry.fxTransferId ?? null,
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
          AND dle.reversal_of_dividend_ledger_entry_id IS NULL
          -- ui-enhancement — startup recompute scope skips soft-deleted
          -- accounts. They will resume recompute on restore.
          -- [active-only filter ADDED]
          AND a.deleted_at IS NULL`,
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
              -- ui-enhancement — skip recompute writes for soft-deleted accounts.
              -- [active-only filter ADDED]
              AND account.deleted_at IS NULL
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
      exDividendDate: normalizeDate(String(row.ex_dividend_date)),
      paymentDate: row.payment_date ? normalizeDate(String(row.payment_date)) : null,
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
        AND account.deleted_at IS NULL  -- ui-enhancement: hide soft-deleted accounts' dividend ledger entries [active-only filter ADDED]
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

  async listDividendReviewRows(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendReviewListResult> {
    await this.ensureDefaultPortfolioData(userId);

    const SORT_COLUMNS: Record<DividendLedgerListOptions["sortBy"], string> = {
      paymentDate: "payment_date",
      ticker: "ticker",
      account: "account_name",
      expectedCashAmount: "expected_cash_amount",
      receivedCashAmount: "received_cash_amount",
      reconciliationStatus: "reconciliation_status",
    };
    const sortColumn = SORT_COLUMNS[opts.sortBy];
    const sortDirection: "ASC" | "DESC" = opts.sortOrder === "asc" ? "ASC" : "DESC";

    const params = [
      userId,
      opts.accountId ?? null,
      opts.fromPaymentDate ?? null,
      opts.toPaymentDate ?? null,
      opts.reconciliationStatus ?? null,
      opts.postingStatus ?? null,
      opts.ticker ?? null,
    ];

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

    const baseCte = `
      WITH receipts AS (
        SELECT related_dividend_ledger_entry_id,
               SUM(amount) FILTER (WHERE entry_type = 'DIVIDEND_RECEIPT') AS received_cash_amount
        FROM cash_ledger_entries
        WHERE user_id = $1
        GROUP BY related_dividend_ledger_entry_id
      ),
      active_ledger AS (
        SELECT
          'ledger'::text AS row_kind,
          dle.id,
          dle.account_id,
          account.name AS account_name,
          dle.dividend_event_id,
          event.ticker,
          COALESCE(instrument.instrument_type, 'STOCK') AS instrument_type,
          event.event_type,
          event.ex_dividend_date,
          event.payment_date,
          event.cash_dividend_currency AS cash_currency,
          dle.eligible_quantity,
          dle.expected_cash_amount,
          dle.expected_stock_quantity,
          COALESCE(receipts.received_cash_amount, 0) AS received_cash_amount,
          dle.received_stock_quantity,
          dle.posting_status,
          dle.reconciliation_status,
          dle.version,
          dle.source_composition_status,
          dle.reconciliation_note,
          dle.booked_at,
          dle.reversal_of_dividend_ledger_entry_id,
          dle.superseded_at
        FROM dividend_ledger_entries AS dle
        JOIN accounts AS account
          ON account.id = dle.account_id
        JOIN market_data.dividend_events AS event
          ON event.id = dle.dividend_event_id
        LEFT JOIN market_data.instruments AS instrument
          ON instrument.ticker = event.ticker
         AND instrument.market_code = event.market_code
        LEFT JOIN receipts
          ON receipts.related_dividend_ledger_entry_id = dle.id
        WHERE account.user_id = $1
          AND account.deleted_at IS NULL
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
      ),
      expected_rows AS (
        SELECT
          'expected'::text AS row_kind,
          ('expected:' || account.id || ':' || event.id) AS id,
          account.id AS account_id,
          account.name AS account_name,
          event.id AS dividend_event_id,
          event.ticker,
          COALESCE(instrument.instrument_type, 'STOCK') AS instrument_type,
          event.event_type,
          event.ex_dividend_date,
          event.payment_date,
          event.cash_dividend_currency AS cash_currency,
          eligibility.eligible_quantity,
          GREATEST(0, ROUND(eligibility.eligible_quantity * event.cash_dividend_per_share))::int AS expected_cash_amount,
          FLOOR(eligibility.eligible_quantity * event.stock_dividend_per_share)::int AS expected_stock_quantity,
          0::numeric AS received_cash_amount,
          0::int AS received_stock_quantity,
          'expected'::text AS posting_status,
          'open'::text AS reconciliation_status,
          0::int AS version,
          'unknown_pending_disclosure'::text AS source_composition_status,
          NULL::text AS reconciliation_note,
          NULL::timestamptz AS booked_at,
          NULL::text AS reversal_of_dividend_ledger_entry_id,
          NULL::timestamptz AS superseded_at
        FROM accounts AS account
        JOIN market_data.dividend_events AS event
          ON event.cash_dividend_currency = account.default_currency
        LEFT JOIN market_data.instruments AS instrument
          ON instrument.ticker = event.ticker
         AND instrument.market_code = event.market_code
        JOIN LATERAL (
          SELECT COALESCE(
            SUM(CASE WHEN trade.trade_type = 'BUY' THEN trade.quantity ELSE -trade.quantity END),
            0
          )::int AS eligible_quantity
          FROM trade_events AS trade
          WHERE trade.user_id = $1
            AND trade.account_id = account.id
            AND trade.ticker = event.ticker
            AND trade.market_code = event.market_code
            AND trade.trade_date < event.ex_dividend_date
            AND trade.reversal_of_trade_event_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM trade_events AS reversal
              WHERE reversal.reversal_of_trade_event_id = trade.id
            )
        ) AS eligibility ON eligibility.eligible_quantity > 0
        WHERE account.user_id = $1
          AND account.deleted_at IS NULL
          AND ($2::text IS NULL OR account.id = $2)
          ${dateClause}
          AND ($5::text IS NULL OR $5 = 'open')
          AND ($6::text IS NULL OR $6 = 'expected')
          AND ($7::text IS NULL OR event.ticker = $7)
          AND NOT EXISTS (
            SELECT 1
            FROM dividend_ledger_entries AS existing
            WHERE existing.account_id = account.id
              AND existing.dividend_event_id = event.id
              AND existing.superseded_at IS NULL
              AND existing.reversal_of_dividend_ledger_entry_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM dividend_ledger_entries AS reversal
                WHERE reversal.reversal_of_dividend_ledger_entry_id = existing.id
              )
          )
      ),
      base AS MATERIALIZED (
        SELECT * FROM active_ledger
        UNION ALL
        SELECT * FROM expected_rows
      )
    `;

    const limit = opts.limit;
    const offset = (opts.page - 1) * opts.limit;
    const query = `
      ${baseCte}
      , paged AS MATERIALIZED (
        SELECT *
        FROM base
        ORDER BY ${sortColumn} ${sortDirection} ${sortDirection === "ASC" ? "NULLS FIRST" : "NULLS LAST"}, id ASC
        LIMIT $8 OFFSET $9
      ),
      summary AS (
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE reconciliation_status = 'open')::int AS open_count
        FROM base
      ),
      currency_totals AS (
        SELECT cash_currency AS currency,
               SUM(expected_cash_amount) AS expected_sum,
               SUM(received_cash_amount) AS received_sum
        FROM base
        GROUP BY cash_currency
      ),
      monthly_totals AS (
        SELECT to_char(payment_date, 'YYYY-MM') AS month_key,
               cash_currency AS currency,
               SUM(expected_cash_amount) AS expected_sum,
               SUM(received_cash_amount) AS received_sum
        FROM base
        WHERE payment_date IS NOT NULL
        GROUP BY to_char(payment_date, 'YYYY-MM'), cash_currency
      ),
      ticker_totals AS (
        SELECT ticker,
               cash_currency AS currency,
               SUM(expected_cash_amount) AS expected_sum,
               SUM(received_cash_amount) AS received_sum
        FROM base
        GROUP BY ticker, cash_currency
      )
      SELECT
        summary.total,
        summary.open_count,
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(currency_totals) ORDER BY currency) FROM currency_totals),
          '[]'::jsonb
        ) AS currency_totals,
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(monthly_totals) ORDER BY month_key, currency) FROM monthly_totals),
          '[]'::jsonb
        ) AS monthly_totals,
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(ticker_totals) ORDER BY ticker, currency) FROM ticker_totals),
          '[]'::jsonb
        ) AS ticker_totals,
        COALESCE(
          (
            SELECT jsonb_agg(
              to_jsonb(paged)
              ORDER BY ${sortColumn} ${sortDirection} ${sortDirection === "ASC" ? "NULLS FIRST" : "NULLS LAST"}, id ASC
            )
            FROM paged
          ),
          '[]'::jsonb
        ) AS page_rows
      FROM summary
    `;

    const result = await this.pool.query(query, [...params, limit, offset]);
    const resultRow = result.rows[0] ?? {};
    const currencyTotalRows = Array.isArray(resultRow.currency_totals)
      ? resultRow.currency_totals as Record<string, unknown>[]
      : [];
    const monthlyTotalRows = Array.isArray(resultRow.monthly_totals)
      ? resultRow.monthly_totals as Record<string, unknown>[]
      : [];
    const tickerTotalRows = Array.isArray(resultRow.ticker_totals)
      ? resultRow.ticker_totals as Record<string, unknown>[]
      : [];
    const pageRows = Array.isArray(resultRow.page_rows)
      ? resultRow.page_rows as Record<string, unknown>[]
      : [];

    const totalExpectedCashAmount: Record<string, number> = {};
    const totalReceivedCashAmount: Record<string, number> = {};
    for (const row of currencyTotalRows) {
      const currency = String(row.currency);
      totalExpectedCashAmount[currency] = Number(row.expected_sum ?? 0);
      totalReceivedCashAmount[currency] = Number(row.received_sum ?? 0);
    }

    const byMonth: DividendLedgerAggregates["byMonth"] = {};
    for (const row of monthlyTotalRows) {
      const monthKey = String(row.month_key);
      const currency = String(row.currency);
      const bucket = (byMonth[monthKey] ??= {});
      bucket[currency] = {
        expected: Number(row.expected_sum ?? 0),
        received: Number(row.received_sum ?? 0),
      };
    }

    const byTicker: DividendLedgerAggregates["byTicker"] = {};
    for (const row of tickerTotalRows) {
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
      openCount: Number(resultRow.open_count ?? 0),
      byMonth,
      byTicker,
    };

    const ledgerIds = pageRows.filter((row) => row.row_kind === "ledger").map((row) => row.id);
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
    const rows: DividendReviewRowWithDetails[] = pageRows.map((row) => ({
      ...mapDividendLedgerEntryRow(row),
      rowKind: String(row.row_kind) as DividendReviewRowWithDetails["rowKind"],
      ticker: String(row.ticker),
      instrumentType: String(row.instrument_type) as InstrumentType,
      eventType: String(row.event_type) as DividendReviewRowWithDetails["eventType"],
      exDividendDate: normalizeDate(String(row.ex_dividend_date)),
      paymentDate: row.payment_date ? normalizeDate(String(row.payment_date)) : null,
      cashCurrency: String(row.cash_currency) as DividendReviewRowWithDetails["cashCurrency"],
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

    return { rows, total: Number(resultRow.total ?? 0), aggregates };
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

    // ui-enhancement: filter out cash_ledger entries belonging to soft-deleted
    // accounts. Without this, the cash-ledger list would surface entries for
    // accounts the user can no longer see in the account picker.
    // [active-only filter ADDED]
    const whereClause = `
      WHERE user_id = $1
        AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
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
             fx_rate_to_usd, fx_transfer_id::text AS fx_transfer_id
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
      fxTransferId: row.fx_transfer_id ?? null,
    }));

    return { entries, total, summary };
  }

  async listAccountsWithLiveBalances(userId: string): Promise<AccountWithLiveBalancesRecord[]> {
    await this.ensureDefaultPortfolioData(userId);
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      name: string;
      fee_profile_id: string;
      default_currency: AccountWithLiveBalancesRecord["defaultCurrency"];
      account_type: AccountWithLiveBalancesRecord["accountType"];
      currency: string | null;
      amount: string | null;
    }>(
      `WITH active_accounts AS (
         SELECT id, user_id, name, fee_profile_id, default_currency, account_type
         FROM accounts
         WHERE user_id = $1
           AND deleted_at IS NULL
       ),
       reversed_entries AS (
         SELECT reversal_of_cash_ledger_entry_id AS entry_id
         FROM cash_ledger_entries
         WHERE user_id = $1
           AND reversal_of_cash_ledger_entry_id IS NOT NULL
       ),
       balances AS (
         SELECT entry.account_id, entry.currency, ROUND(SUM(entry.amount)::numeric, 2) AS amount
         FROM cash_ledger_entries AS entry
         JOIN active_accounts AS account
           ON account.id = entry.account_id
         LEFT JOIN reversed_entries AS reversed
           ON reversed.entry_id = entry.id
         WHERE entry.user_id = $1
           AND entry.reversal_of_cash_ledger_entry_id IS NULL
           AND reversed.entry_id IS NULL
         GROUP BY entry.account_id, entry.currency
       )
       SELECT account.id,
              account.user_id,
              account.name,
              account.fee_profile_id,
              account.default_currency,
              account.account_type,
              balance.currency,
              balance.amount::text AS amount
       FROM active_accounts AS account
       LEFT JOIN balances AS balance
         ON balance.account_id = account.id
       ORDER BY account.id, balance.currency NULLS LAST`,
      [userId],
    );

    const accountsById = new Map<string, AccountWithLiveBalancesRecord>();
    for (const row of result.rows) {
      const existing = accountsById.get(row.id) ?? {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        feeProfileId: row.fee_profile_id,
        defaultCurrency: row.default_currency,
        accountType: row.account_type,
        liveBalance: [],
      };
      if (row.currency && row.amount !== null) {
        existing.liveBalance.push({
          currency: row.currency,
          amount: Number(row.amount),
        });
      }
      accountsById.set(row.id, existing);
    }

    return [...accountsById.values()];
  }

  async getCashLedgerEnrichment(
    userId: string,
    input: {
      accountIds: string[];
      relatedTradeEventIds: string[];
      relatedDividendLedgerEntryIds: string[];
      fxTransferIds: string[];
    },
  ): Promise<CashLedgerEnrichmentResult> {
    await this.ensureDefaultPortfolioData(userId);

    const accountIds = [...new Set(input.accountIds)];
    const relatedTradeEventIds = [...new Set(input.relatedTradeEventIds)];
    const relatedDividendLedgerEntryIds = [...new Set(input.relatedDividendLedgerEntryIds)];
    const fxTransferIds = [...new Set(input.fxTransferIds)];

    const accountNamesPromise = accountIds.length
      ? this.pool.query<{ id: string; name: string }>(
          `SELECT id, name
           FROM accounts
           WHERE user_id = $1
             AND deleted_at IS NULL
             AND id = ANY($2)
           ORDER BY id`,
          [userId, accountIds],
        )
      : Promise.resolve({ rows: [] as Array<{ id: string; name: string }> });

    const tradesPromise = relatedTradeEventIds.length
      ? this.pool.query<{
          id: string;
          ticker: string;
          trade_type: "BUY" | "SELL";
          quantity: string;
          unit_price: string;
          commission_amount: string;
          tax_amount: string;
        }>(
          `SELECT trade_event.id,
                  trade_event.ticker,
                  trade_event.trade_type,
                  trade_event.quantity::text AS quantity,
                  trade_event.unit_price::text AS unit_price,
                  trade_event.commission_amount::text AS commission_amount,
                  trade_event.tax_amount::text AS tax_amount
           FROM trade_events AS trade_event
           WHERE trade_event.user_id = $1
             AND trade_event.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
             AND trade_event.id = ANY($2)`,
          [userId, relatedTradeEventIds],
        )
      : Promise.resolve({ rows: [] as Array<{
          id: string;
          ticker: string;
          trade_type: "BUY" | "SELL";
          quantity: string;
          unit_price: string;
          commission_amount: string;
          tax_amount: string;
        }> });

    const dividendsPromise = relatedDividendLedgerEntryIds.length
      ? this.pool.query<{
          id: string;
          ticker: string | null;
          expected_cash_amount: string;
          received_cash_amount: string;
          deduction_total: string;
        }>(
          `SELECT entry.id,
                  event.ticker,
                  entry.expected_cash_amount::text AS expected_cash_amount,
                  entry.received_cash_amount::text AS received_cash_amount,
                  COALESCE(SUM(deduction.amount), 0)::text AS deduction_total
           FROM dividend_ledger_entries AS entry
           JOIN accounts AS account
             ON account.id = entry.account_id
           LEFT JOIN market_data.dividend_events AS event
             ON event.id = entry.dividend_event_id
           LEFT JOIN dividend_deduction_entries AS deduction
             ON deduction.dividend_ledger_entry_id = entry.id
           WHERE account.user_id = $1
             AND account.deleted_at IS NULL
             AND entry.id = ANY($2)
           GROUP BY entry.id, event.ticker, entry.expected_cash_amount, entry.received_cash_amount`,
          [userId, relatedDividendLedgerEntryIds],
        )
      : Promise.resolve({ rows: [] as Array<{
          id: string;
          ticker: string | null;
          expected_cash_amount: string;
          received_cash_amount: string;
          deduction_total: string;
        }> });

    const fxTransfersPromise = fxTransferIds.length
      ? this.pool.query<{
          fx_transfer_id: string;
          id: string;
          account_id: string;
          account_name: string;
          entry_type: CashLedgerEntry["entryType"];
          amount: string;
          currency: string;
          reversal_of_cash_ledger_entry_id: string | null;
        }>(
          `SELECT entry.fx_transfer_id::text AS fx_transfer_id,
                  entry.id,
                  entry.account_id,
                  account.name AS account_name,
                  entry.entry_type,
                  entry.amount::text AS amount,
                  entry.currency,
                  entry.reversal_of_cash_ledger_entry_id
           FROM cash_ledger_entries AS entry
           JOIN accounts AS account
             ON account.id = entry.account_id
           WHERE entry.user_id = $1
             AND account.deleted_at IS NULL
             AND entry.fx_transfer_id = ANY($2)`,
          [userId, fxTransferIds],
        )
      : Promise.resolve({ rows: [] as Array<{
          fx_transfer_id: string;
          id: string;
          account_id: string;
          account_name: string;
          entry_type: CashLedgerEntry["entryType"];
          amount: string;
          currency: string;
          reversal_of_cash_ledger_entry_id: string | null;
        }> });

    const [accountNamesResult, tradesResult, dividendsResult, fxTransfersResult] = await Promise.all([
      accountNamesPromise,
      tradesPromise,
      dividendsPromise,
      fxTransfersPromise,
    ]);

    const accountNamesById = new Map(accountNamesResult.rows.map((row) => [row.id, row.name] as const));
    const tradesById = new Map(tradesResult.rows.map((row) => [row.id, {
      id: row.id,
      ticker: row.ticker,
      side: row.trade_type,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      commissionAmount: Number(row.commission_amount),
      taxAmount: Number(row.tax_amount),
    }] as const));
    const dividendsById = new Map(dividendsResult.rows.map((row) => [row.id, {
      id: row.id,
      ticker: row.ticker,
      expectedCashAmount: Number(row.expected_cash_amount),
      receivedCashAmount: Number(row.received_cash_amount),
      deductionTotal: Number(row.deduction_total),
    }] as const));

    const fxTransferLegsByTransferId = new Map<string, Array<{
      entryId: string;
      accountId: string;
      accountName: string;
      entryType: CashLedgerEntry["entryType"];
      amount: number;
      currency: string;
      reversalOfCashLedgerEntryId?: string;
    }>>();
    const reversedFxTransferIds = new Set<string>();
    for (const row of fxTransfersResult.rows) {
      const legs = fxTransferLegsByTransferId.get(row.fx_transfer_id) ?? [];
      legs.push({
        entryId: row.id,
        accountId: row.account_id,
        accountName: row.account_name,
        entryType: row.entry_type,
        amount: Number(row.amount),
        currency: row.currency,
        reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      });
      if (row.reversal_of_cash_ledger_entry_id) {
        reversedFxTransferIds.add(row.fx_transfer_id);
      }
      fxTransferLegsByTransferId.set(row.fx_transfer_id, legs);
      accountNamesById.set(row.account_id, row.account_name);
    }

    return {
      accountNamesById,
      tradesById,
      dividendsById,
      fxTransferLegsByTransferId,
      reversedFxTransferIds,
    };
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
         -- ui-enhancement — exclude years derived solely from dividends on
         -- soft-deleted accounts. [active-only filter ADDED]
         AND account.deleted_at IS NULL
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

  async getTickerFundamentals(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<PersistedTickerFundamentalsRecord | null> {
    const result = await this.pool.query<{
      ticker: string;
      market_code: string;
      provider_id: string | null;
      fundamentals: TickerFundamentalsDto | Record<string, unknown> | null;
      refreshed_at: string | null;
      next_refresh_at: string | null;
      last_attempted_at: string | null;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT ticker,
              market_code,
              provider_id,
              fundamentals,
              refreshed_at::text,
              next_refresh_at::text,
              last_attempted_at::text,
              last_error,
              created_at::text,
              updated_at::text
         FROM market_data.ticker_fundamentals
        WHERE ticker = $1
          AND market_code = $2`,
      [ticker, marketCode],
    );

    const row = result.rows[0];
    return row ? mapTickerFundamentalsRow(row) : null;
  }

  async saveTickerFundamentalsSnapshot(
    input: SaveTickerFundamentalsSnapshotInput,
  ): Promise<PersistedTickerFundamentalsRecord> {
    const result = await this.pool.query<{
      ticker: string;
      market_code: string;
      provider_id: string | null;
      fundamentals: TickerFundamentalsDto | Record<string, unknown> | null;
      refreshed_at: string | null;
      next_refresh_at: string | null;
      last_attempted_at: string | null;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO market_data.ticker_fundamentals (
         ticker,
         market_code,
         provider_id,
         fundamentals,
         refreshed_at,
         next_refresh_at,
         last_attempted_at,
         last_error
       ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $5::timestamptz, NULL)
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET provider_id = EXCLUDED.provider_id,
             fundamentals = EXCLUDED.fundamentals,
             refreshed_at = EXCLUDED.refreshed_at,
             next_refresh_at = EXCLUDED.next_refresh_at,
             last_attempted_at = EXCLUDED.last_attempted_at,
             last_error = NULL,
             updated_at = CURRENT_TIMESTAMP
       RETURNING ticker,
                 market_code,
                 provider_id,
                 fundamentals,
                 refreshed_at::text,
                 next_refresh_at::text,
                 last_attempted_at::text,
                 last_error,
                 created_at::text,
                 updated_at::text`,
      [
        input.ticker,
        input.marketCode,
        input.providerId,
        JSON.stringify(normalizeTickerFundamentals(input.fundamentals)),
        input.refreshedAt,
        input.nextRefreshAt,
      ],
    );

    return mapTickerFundamentalsRow(result.rows[0]!);
  }

  async recordTickerFundamentalsRefreshFailure(
    input: RecordTickerFundamentalsRefreshFailureInput,
  ): Promise<PersistedTickerFundamentalsRecord> {
    const result = await this.pool.query<{
      ticker: string;
      market_code: string;
      provider_id: string | null;
      fundamentals: TickerFundamentalsDto | Record<string, unknown> | null;
      refreshed_at: string | null;
      next_refresh_at: string | null;
      last_attempted_at: string | null;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO market_data.ticker_fundamentals (
         ticker,
         market_code,
         provider_id,
         fundamentals,
         refreshed_at,
         next_refresh_at,
         last_attempted_at,
         last_error
       ) VALUES ($1, $2, $3, $4::jsonb, NULL, $5::timestamptz, $6::timestamptz, $7)
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET provider_id = EXCLUDED.provider_id,
             next_refresh_at = EXCLUDED.next_refresh_at,
             last_attempted_at = EXCLUDED.last_attempted_at,
             last_error = EXCLUDED.last_error,
             updated_at = CURRENT_TIMESTAMP
       RETURNING ticker,
                 market_code,
                 provider_id,
                 fundamentals,
                 refreshed_at::text,
                 next_refresh_at::text,
                 last_attempted_at::text,
                 last_error,
                 created_at::text,
                 updated_at::text`,
      [
        input.ticker,
        input.marketCode,
        input.providerId,
        JSON.stringify(createEmptyTickerFundamentals()),
        input.nextRefreshAt,
        input.attemptedAt,
        input.errorMessage,
      ],
    );

    return mapTickerFundamentalsRow(result.rows[0]!);
  }

  private async runMigrations(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
    const manifest = await loadMigrationManifest(migrationsDir);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureMigrationLedger(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["vakwen_schema_migrations"]);

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
      case "042_kzo183_account_scoped_fee_profiles.sql":
        return this.isMigration042Reflected(client);
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
    // KZO-183 drops account_fee_profile_overrides.market_code via migration 042.
    // If 042 has already been applied, the binding column is intentionally absent — still counts as 012 reflected.
    const migration042Applied = await this.isMigration042Reflected(client);
    return (
      hasTradeEventMarketCode &&
      Boolean(symbolOrInstrument.rows[0]?.exists) &&
      (hasBindingMarketCode || migration042Applied)
    );
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

  private async isMigration042Reflected(client: PoolClient): Promise<boolean> {
    const [hasFeeProfileAccountId, hasFeeProfileUserId] = await Promise.all([
      this.columnExists(client, "fee_profiles", "account_id"),
      this.columnExists(client, "fee_profiles", "user_id"),
    ]);
    return hasFeeProfileAccountId && !hasFeeProfileUserId;
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

  private async getAiConnectorConnectionTx(
    client: Pool | PoolClient,
    id: string,
  ): Promise<AiConnectorConnectionRecord | null> {
    const result = await client.query<{
      id: string;
      user_id: string;
      provider: AiConnectorProvider;
      display_name: string;
      status: AiConnectorStatus;
      oauth_client_id: string | null;
      oauth_subject: string | null;
      scopes: AiConnectorScope[] | null;
      tool_toggles: Record<string, boolean> | null;
      expires_at: string | null;
      expiry_notified_at: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      revoked_by_user_id: string | null;
      revocation_reason: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT c.id,
              c.user_id,
              c.provider,
              c.display_name,
              c.status,
              c.oauth_client_id,
              c.oauth_subject,
              COALESCE(
                ARRAY(
                  SELECT s.scope
                  FROM ai_connector_connection_scopes s
                  WHERE s.connection_id = c.id
                  ORDER BY s.scope ASC
                ),
                ARRAY[]::text[]
              ) AS scopes,
              COALESCE(
                (
                  SELECT jsonb_object_agg(t.tool_name, t.enabled ORDER BY t.tool_name)
                  FROM ai_connector_tool_toggles t
                  WHERE t.connection_id = c.id
                ),
                '{}'::jsonb
              ) AS tool_toggles,
              c.expires_at::text AS expires_at,
              c.expiry_notified_at::text AS expiry_notified_at,
              c.last_used_at::text AS last_used_at,
              c.revoked_at::text AS revoked_at,
              c.revoked_by_user_id,
              c.revocation_reason,
              c.created_at::text AS created_at,
              c.updated_at::text AS updated_at
       FROM ai_connector_connections c
       WHERE c.id = $1`,
      [id],
    );
    return result.rows[0] ? mapAiConnectorConnectionRow(result.rows[0]) : null;
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
         -- KZO-169: composite PK after migration 044.
         ON CONFLICT (ticker, market_code) DO UPDATE SET
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
          // KZO-169: required after Slice 4 tightening of InstrumentDef.
          instrument.marketCode,
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
    // ui-enhancement: only ACTIVE accounts. saveAccountingStoreTx uses this
    // list to scope its DELETE-then-INSERT round-trip on dividend/lot tables.
    // Including soft-deleted IDs here would silently wipe their accounting
    // data on every recompute call (the active in-memory accounting.facts
    // doesn't carry rows for those accounts). [active-only filter ADDED]
    const result = await client.query<{ id: string }>(
      `SELECT id
       FROM accounts
       WHERE user_id = $1 AND deleted_at IS NULL
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
          // KZO-169: marketCode is required on BookedTradeEvent.
          tx.marketCode,
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
           fx_rate_to_usd, fx_transfer_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16
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
          entry.fxTransferId ?? null,
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

  async getTradeEventsForAccountTicker(userId: string, accountId: string, ticker: string, marketCode?: MarketCode): Promise<BookedTradeEvent[]> {
    const params = marketCode ? [userId, accountId, ticker, marketCode] : [userId, accountId, ticker];
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
         ${marketCode ? "AND te.market_code = $4" : ""}
       ORDER BY te.trade_date ASC, te.booking_sequence ASC`,
      params,
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

  async deleteLotsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds: readonly string[] = [],
  ): Promise<number> {
    // lots table has no user_id column — accountId provides tenant scoping
    if (marketCode) {
      const result = await this.pool.query(
        `DELETE FROM lots
         WHERE account_id = $2
           AND ticker = $3
           AND id IN (
             SELECT 'lot-' || id
             FROM trade_events
             WHERE user_id = $1 AND account_id = $2 AND ticker = $3 AND market_code = $4
             UNION
             SELECT 'lot-' || dle.id
             FROM dividend_ledger_entries AS dle
             JOIN accounts AS a ON a.id = dle.account_id
             JOIN market_data.dividend_events AS event ON event.id = dle.dividend_event_id
             WHERE a.user_id = $1
               AND dle.account_id = $2
               AND event.ticker = $3
               AND event.market_code = $4
               AND dle.received_stock_quantity > 0
             UNION
             SELECT 'lot-' || unnest($5::text[])
           )`,
        [userId, accountId, ticker, marketCode, additionalTradeEventIds],
      );
      return result.rowCount ?? 0;
    }

    const result = await this.pool.query(
      `DELETE FROM lots WHERE account_id = $1 AND ticker = $2`,
      [accountId, ticker],
    );
    return result.rowCount ?? 0;
  }

  async deleteLotAllocationsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds: readonly string[] = [],
  ): Promise<number> {
    if (marketCode) {
      const result = await this.pool.query(
        `DELETE FROM lot_allocations
         WHERE user_id = $1
           AND account_id = $2
           AND ticker = $3
           AND (
             trade_event_id IN (
               SELECT id FROM trade_events
               WHERE user_id = $1 AND account_id = $2 AND ticker = $3 AND market_code = $4
               UNION
               SELECT unnest($5::text[])
             )
             OR lot_id IN (
               SELECT 'lot-' || id FROM trade_events
               WHERE user_id = $1 AND account_id = $2 AND ticker = $3 AND market_code = $4
               UNION
               SELECT 'lot-' || dle.id
               FROM dividend_ledger_entries AS dle
               JOIN accounts AS a ON a.id = dle.account_id
               JOIN market_data.dividend_events AS event ON event.id = dle.dividend_event_id
               WHERE a.user_id = $1
                 AND dle.account_id = $2
                 AND event.ticker = $3
                 AND event.market_code = $4
                 AND dle.received_stock_quantity > 0
               UNION
               SELECT 'lot-' || unnest($5::text[])
             )
           )`,
        [userId, accountId, ticker, marketCode, additionalTradeEventIds],
      );
      return result.rowCount ?? 0;
    }

    const result = await this.pool.query(
      `DELETE FROM lot_allocations WHERE user_id = $1 AND account_id = $2 AND ticker = $3`,
      [userId, accountId, ticker],
    );
    return result.rowCount ?? 0;
  }

  async deleteTradeCashEntriesForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds: readonly string[] = [],
  ): Promise<number> {
    if (marketCode) {
      const result = await this.pool.query(
        `DELETE FROM cash_ledger_entries
         WHERE user_id = $1
           AND account_id = $2
           AND entry_type IN ('TRADE_SETTLEMENT_IN', 'TRADE_SETTLEMENT_OUT')
           AND related_trade_event_id IN (
             SELECT id FROM trade_events
             WHERE user_id = $1 AND account_id = $2 AND ticker = $3 AND market_code = $4
             UNION
             SELECT unnest($5::text[])
           )`,
        [userId, accountId, ticker, marketCode, additionalTradeEventIds],
      );
      return result.rowCount ?? 0;
    }

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
         id, ticker, market_code, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
         source, source_reference, ingested_at,
         fiscal_year_period, announcement_date, total_distribution_shares, raw_provider_data
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9,
         $10, $11, $12,
         NULL, NULL, NULL, NULL
       )
       ON CONFLICT (id)
       DO UPDATE SET
         ticker = EXCLUDED.ticker,
         market_code = EXCLUDED.market_code,
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
        dividendEvent.marketCode ?? marketCodeFor(dividendEvent.cashDividendCurrency),
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
           fx_rate_to_usd, fx_transfer_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13, $14,
           $15, $16
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
          entry.fxTransferId ?? null,
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

  async getInstrument(ticker: string, marketCode?: string): Promise<InstrumentRow | null> {
    // KZO-169: when `marketCode` is supplied, the lookup uses the composite
    // (ticker, market_code) PK established by migration 044. When omitted,
    // the legacy ticker-only lookup is preserved for callers that haven't yet
    // been threaded with market context — they get the first match (TW
    // priority is enforced by the `ORDER BY` in catalog code paths upstream).
    const conditions = marketCode ? "ticker = $1 AND market_code = $2" : "ticker = $1";
    const params: unknown[] = marketCode ? [ticker, marketCode] : [ticker];
    const result = await this.pool.query<{
      ticker: string;
      instrument_type: string | null;
      market_code: string;
      name: string | null;
      is_provisional: boolean;
      type_raw: string | null;
      industry_category_raw: string | null;
      catalog_exchange_raw: string | null;
      catalog_mic_code: string | null;
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
              type_raw, industry_category_raw, catalog_exchange_raw, catalog_mic_code, finmind_date,
              delisted_at::text, status_reason,
              bars_backfill_status, last_synced_at::text, last_repair_at::text,
              verification_status, verification_note,
              created_at::text, updated_at::text
       FROM market_data.instruments
       WHERE ${conditions}
       ORDER BY market_code = 'TW' DESC, market_code ASC
       LIMIT 1`,
      params,
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0]!;
    return {
      ticker: r.ticker,
      instrumentType: r.instrument_type as import("@vakwen/domain").InstrumentType | null,
      marketCode: r.market_code,
      name: r.name ?? undefined,
      isProvisional: r.is_provisional,
      lastSyncedAt: r.last_synced_at ?? undefined,
      typeRaw: r.type_raw ?? undefined,
      industryCategoryRaw: r.industry_category_raw ?? undefined,
      catalogExchangeRaw: r.catalog_exchange_raw ?? null,
      catalogMicCode: r.catalog_mic_code ?? null,
      finmindDate: r.finmind_date ?? undefined,
      delistedAt: r.delisted_at ?? undefined,
      statusReason: r.status_reason ?? undefined,
      barsBackfillStatus: r.bars_backfill_status as import("@vakwen/domain").BackfillStatus,
      lastRepairAt: r.last_repair_at ?? undefined,
      verificationStatus: r.verification_status as import("@vakwen/domain").VerificationStatus,
      verificationNote: r.verification_note ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateBackfillStatus(
    ticker: string,
    marketCode: import("@vakwen/domain").MarketCode,
    status: import("@vakwen/domain").BackfillStatus,
  ): Promise<void> {
    // KZO-197 P2-2: composite scope on (ticker, marketCode). Without the
    // market_code filter, a bare-ticker WHERE silently mutates cross-listed
    // sibling rows (BHP/AU vs BHP/US, etc.).
    const extra = status === "ready" ? ", last_synced_at = CURRENT_TIMESTAMP" : "";
    await this.pool.query(
      `UPDATE market_data.instruments SET bars_backfill_status = $1, updated_at = CURRENT_TIMESTAMP${extra} WHERE ticker = $2 AND market_code = $3`,
      [status, ticker, marketCode],
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
    metadataEnrichmentMode: "unconditional" | "conditional" | null;
    finmindApiTokenEncrypted: string | null;
    twelveDataApiKeyEncrypted: string | null;
    mcpOauthTokenSecretEncrypted: string | null;
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
    providerFixerDangerousMatchThreshold: number | null;
    providerFixerPreviewSampleLimit: number | null;
    providerFixerUiPageSize: number | null;
    providerFixerAutoPauseFailuresPerMinute: number | null;
    providerFixerPreviewTokenTtlMinutes: number | null;
    providerOperationAutoRenewIntervalMinutes: number | null;
    providerIncidentRecurrenceWindowMinutes: number | null;
    providerHealthWarningUnresolvedThreshold: number | null;
    providerHealthCriticalUnresolvedThreshold: number | null;
    providerOperationStaleHeartbeatMinutes: number | null;
    providerOperationSummaryRetentionDays: number | null;
    providerOperationLogRetentionDays: number | null;
    providerIncidentRetentionDays: number | null;
    providerResolvedItemRetentionDays: number | null;
    finmindProviderRateLimitPerHour: number | null;
    twelveDataProviderRateLimitPerMinute: number | null;
    yahooAuProviderRateLimitPerMinute: number | null;
    yahooKrProviderRateLimitPerMinute: number | null;
    frankfurterProviderRateLimitPerMinute: number | null;
    asxGicsProviderRateLimitPerHour: number | null;
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
    valuationHealthRelativeBps: number | null;
    valuationHealthAbsoluteAud: number | null;
    valuationHealthAbsoluteUsd: number | null;
    valuationHealthAbsoluteTwd: number | null;
    valuationHealthAbsoluteKrw: number | null;
    routeCachePolicyMode: import("./types.js").RouteCachePolicyMode | null;
    routeCacheDashboardPrimaryTtlMs: number | null;
    routeCacheDashboardEnrichmentTtlMs: number | null;
    routeCacheDashboardPerformanceTtlMs: number | null;
    routeCachePortfolioTtlMs: number | null;
    routeCacheReportsTtlMs: number | null;
    routeCacheStaleUsableTtlMs: number | null;
    updatedAt: string;
  }> {
    const r = await this.pool.query<{
      repair_cooldown_minutes: number | null;
      dashboard_performance_ranges: string[] | null;
      metadata_enrichment_mode: "unconditional" | "conditional" | null;
      finmind_api_token: string | null;
      twelve_data_api_key: string | null;
      mcp_oauth_token_secret: string | null;
      market_data_price_window_ms: number | null;
      market_data_price_limit: number | null;
      market_data_search_window_ms: number | null;
      market_data_search_limit: number | null;
      invite_status_window_ms: number | null;
      invite_status_limit: number | null;
      provider_down_notification_suppression_ms: number | string | null;
      provider_error_trail_retention_days: number | null;
      provider_rerun_cooldown_ms: number | string | null;
      yahoo_au_rerun_cooldown_ms: number | string | null;
      provider_fixer_dangerous_match_threshold: number | null;
      provider_fixer_preview_sample_limit: number | null;
      provider_fixer_ui_page_size: number | null;
      provider_fixer_auto_pause_failures_per_minute: number | null;
      provider_fixer_preview_token_ttl_minutes: number | null;
      provider_operation_auto_renew_interval_minutes: number | null;
      provider_incident_recurrence_window_minutes: number | null;
      provider_health_warning_unresolved_threshold: number | null;
      provider_health_critical_unresolved_threshold: number | null;
      provider_operation_stale_heartbeat_minutes: number | null;
      provider_operation_summary_retention_days: number | null;
      provider_operation_log_retention_days: number | null;
      provider_incident_retention_days: number | null;
      provider_resolved_item_retention_days: number | null;
      finmind_provider_rate_limit_per_hour: number | null;
      twelve_data_provider_rate_limit_per_minute: number | null;
      yahoo_au_provider_rate_limit_per_minute: number | null;
      yahoo_kr_provider_rate_limit_per_minute: number | null;
      frankfurter_provider_rate_limit_per_minute: number | null;
      asx_gics_provider_rate_limit_per_hour: number | null;
      backfill_retry_limit: number | null;
      backfill_retry_delay_seconds: number | null;
      backfill_finmind_402_retry_ms: number | string | null;
      daily_refresh_lookback_days: number | null;
      daily_refresh_priority: number | null;
      sse_heartbeat_interval_ms: number | null;
      sse_max_connections_per_user: number | null;
      sse_buffer_default_ttl_ms: number | string | null;
      catalog_absence_threshold: number | null;
      catalog_absence_guard_percent: number | string | null;
      catalog_absence_guard_floor: number | null;
      asx_gics_refresh_cron: string | null;
      anonymous_share_token_cap: number | null;
      anonymous_share_rate_limit_max: number | null;
      anonymous_share_rate_limit_window_ms: number | null;
      anonymous_share_token_retention_ms: number | string | null;
      user_preferences_max_bytes: number | null;
      account_hard_purge_days: number | null;
      valuation_health_relative_bps: number | null;
      valuation_health_absolute_aud: number | string | null;
      valuation_health_absolute_usd: number | string | null;
      valuation_health_absolute_twd: number | string | null;
      valuation_health_absolute_krw: number | string | null;
      route_cache_policy_mode: import("./types.js").RouteCachePolicyMode | null;
      route_cache_dashboard_primary_ttl_ms: number | string | null;
      route_cache_dashboard_enrichment_ttl_ms: number | string | null;
      route_cache_dashboard_performance_ttl_ms: number | string | null;
      route_cache_portfolio_ttl_ms: number | string | null;
      route_cache_reports_ttl_ms: number | string | null;
      route_cache_stale_usable_ttl_ms: number | string | null;
      updated_at: Date | string;
    }>(
      `SELECT
         repair_cooldown_minutes, dashboard_performance_ranges, metadata_enrichment_mode,
         finmind_api_token, twelve_data_api_key, mcp_oauth_token_secret,
         market_data_price_window_ms, market_data_price_limit,
         market_data_search_window_ms, market_data_search_limit,
         invite_status_window_ms, invite_status_limit,
         provider_down_notification_suppression_ms, provider_error_trail_retention_days, provider_rerun_cooldown_ms,
         yahoo_au_rerun_cooldown_ms,
         provider_fixer_dangerous_match_threshold, provider_fixer_preview_sample_limit,
         provider_fixer_ui_page_size, provider_fixer_auto_pause_failures_per_minute,
         provider_fixer_preview_token_ttl_minutes,
         provider_operation_auto_renew_interval_minutes, provider_incident_recurrence_window_minutes,
         provider_health_warning_unresolved_threshold, provider_health_critical_unresolved_threshold,
         provider_operation_stale_heartbeat_minutes,
         provider_operation_summary_retention_days, provider_operation_log_retention_days,
         provider_incident_retention_days, provider_resolved_item_retention_days,
         finmind_provider_rate_limit_per_hour, twelve_data_provider_rate_limit_per_minute,
         yahoo_au_provider_rate_limit_per_minute, yahoo_kr_provider_rate_limit_per_minute,
         frankfurter_provider_rate_limit_per_minute, asx_gics_provider_rate_limit_per_hour,
         backfill_retry_limit, backfill_retry_delay_seconds, backfill_finmind_402_retry_ms,
         daily_refresh_lookback_days, daily_refresh_priority,
         sse_heartbeat_interval_ms, sse_max_connections_per_user, sse_buffer_default_ttl_ms,
         catalog_absence_threshold, catalog_absence_guard_percent, catalog_absence_guard_floor,
         asx_gics_refresh_cron,
         anonymous_share_token_cap, anonymous_share_rate_limit_max, anonymous_share_rate_limit_window_ms,
         anonymous_share_token_retention_ms, user_preferences_max_bytes,
         account_hard_purge_days,
         valuation_health_relative_bps, valuation_health_absolute_aud, valuation_health_absolute_usd,
         valuation_health_absolute_twd, valuation_health_absolute_krw,
         route_cache_policy_mode,
         route_cache_dashboard_primary_ttl_ms, route_cache_dashboard_enrichment_ttl_ms,
         route_cache_dashboard_performance_ttl_ms, route_cache_portfolio_ttl_ms,
         route_cache_reports_ttl_ms, route_cache_stale_usable_ttl_ms,
         updated_at
       FROM public.app_config WHERE id = 1`,
    );
    if (r.rowCount === 0) {
      console.warn("[app_config] row missing — falling back to env defaults");
      return {
        repairCooldownMinutes: null,
        dashboardPerformanceRanges: null,
        metadataEnrichmentMode: null,
        finmindApiTokenEncrypted: null,
        twelveDataApiKeyEncrypted: null,
        mcpOauthTokenSecretEncrypted: null,
        marketDataPriceWindowMs: null,
        marketDataPriceLimit: null,
        marketDataSearchWindowMs: null,
        marketDataSearchLimit: null,
        inviteStatusWindowMs: null,
        inviteStatusLimit: null,
        providerDownNotificationSuppressionMs: null,
        providerErrorTrailRetentionDays: null,
        providerRerunCooldownMs: null,
        yahooAuRerunCooldownMs: null,
        providerFixerDangerousMatchThreshold: null,
        providerFixerPreviewSampleLimit: null,
        providerFixerUiPageSize: null,
        providerFixerAutoPauseFailuresPerMinute: null,
        providerFixerPreviewTokenTtlMinutes: null,
        providerOperationAutoRenewIntervalMinutes: null,
        providerIncidentRecurrenceWindowMinutes: null,
        providerHealthWarningUnresolvedThreshold: null,
        providerHealthCriticalUnresolvedThreshold: null,
        providerOperationStaleHeartbeatMinutes: null,
        providerOperationSummaryRetentionDays: null,
        providerOperationLogRetentionDays: null,
        providerIncidentRetentionDays: null,
        providerResolvedItemRetentionDays: null,
        finmindProviderRateLimitPerHour: null,
        twelveDataProviderRateLimitPerMinute: null,
        yahooAuProviderRateLimitPerMinute: null,
        yahooKrProviderRateLimitPerMinute: null,
        frankfurterProviderRateLimitPerMinute: null,
        asxGicsProviderRateLimitPerHour: null,
        backfillRetryLimit: null,
        backfillRetryDelaySeconds: null,
        backfillFinmind402RetryMs: null,
        dailyRefreshLookbackDays: null,
        dailyRefreshPriority: null,
        sseHeartbeatIntervalMs: null,
        sseMaxConnectionsPerUser: null,
        sseBufferDefaultTtlMs: null,
        catalogAbsenceThreshold: null,
        catalogAbsenceGuardPercent: null,
        catalogAbsenceGuardFloor: null,
        asxGicsRefreshCron: null,
        anonymousShareTokenCap: null,
        anonymousShareRateLimitMax: null,
        anonymousShareRateLimitWindowMs: null,
        anonymousShareTokenRetentionMs: null,
        userPreferencesMaxBytes: null,
        accountHardPurgeDays: null,
        valuationHealthRelativeBps: null,
        valuationHealthAbsoluteAud: null,
        valuationHealthAbsoluteUsd: null,
        valuationHealthAbsoluteTwd: null,
        valuationHealthAbsoluteKrw: null,
        routeCachePolicyMode: null,
        routeCacheDashboardPrimaryTtlMs: null,
        routeCacheDashboardEnrichmentTtlMs: null,
        routeCacheDashboardPerformanceTtlMs: null,
        routeCachePortfolioTtlMs: null,
        routeCacheReportsTtlMs: null,
        routeCacheStaleUsableTtlMs: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const row = r.rows[0];
    const rawUpdatedAt = row.updated_at;
    const updatedAt = rawUpdatedAt instanceof Date ? rawUpdatedAt.toISOString() : new Date(rawUpdatedAt).toISOString();
    // pg returns BIGINT as string by default. Coerce to number for the cache;
    // values fit comfortably in JS Number range (≤ ~7 days in ms).
    const num = (v: number | string | null): number | null =>
      v === null ? null : typeof v === "number" ? v : Number(v);
    return {
      repairCooldownMinutes: row.repair_cooldown_minutes,
      dashboardPerformanceRanges: row.dashboard_performance_ranges,
      metadataEnrichmentMode: row.metadata_enrichment_mode,
      finmindApiTokenEncrypted: row.finmind_api_token,
      twelveDataApiKeyEncrypted: row.twelve_data_api_key,
      mcpOauthTokenSecretEncrypted: row.mcp_oauth_token_secret,
      marketDataPriceWindowMs: row.market_data_price_window_ms,
      marketDataPriceLimit: row.market_data_price_limit,
      marketDataSearchWindowMs: row.market_data_search_window_ms,
      marketDataSearchLimit: row.market_data_search_limit,
      inviteStatusWindowMs: row.invite_status_window_ms,
      inviteStatusLimit: row.invite_status_limit,
      providerDownNotificationSuppressionMs: num(row.provider_down_notification_suppression_ms),
      providerErrorTrailRetentionDays: row.provider_error_trail_retention_days,
      providerRerunCooldownMs: num(row.provider_rerun_cooldown_ms),
      yahooAuRerunCooldownMs: num(row.yahoo_au_rerun_cooldown_ms),
      providerFixerDangerousMatchThreshold: row.provider_fixer_dangerous_match_threshold,
      providerFixerPreviewSampleLimit: row.provider_fixer_preview_sample_limit,
      providerFixerUiPageSize: row.provider_fixer_ui_page_size,
      providerFixerAutoPauseFailuresPerMinute: row.provider_fixer_auto_pause_failures_per_minute,
      providerFixerPreviewTokenTtlMinutes: row.provider_fixer_preview_token_ttl_minutes,
      providerOperationAutoRenewIntervalMinutes: row.provider_operation_auto_renew_interval_minutes,
      providerIncidentRecurrenceWindowMinutes: row.provider_incident_recurrence_window_minutes,
      providerHealthWarningUnresolvedThreshold: row.provider_health_warning_unresolved_threshold,
      providerHealthCriticalUnresolvedThreshold: row.provider_health_critical_unresolved_threshold,
      providerOperationStaleHeartbeatMinutes: row.provider_operation_stale_heartbeat_minutes,
      providerOperationSummaryRetentionDays: row.provider_operation_summary_retention_days,
      providerOperationLogRetentionDays: row.provider_operation_log_retention_days,
      providerIncidentRetentionDays: row.provider_incident_retention_days,
      providerResolvedItemRetentionDays: row.provider_resolved_item_retention_days,
      finmindProviderRateLimitPerHour: row.finmind_provider_rate_limit_per_hour,
      twelveDataProviderRateLimitPerMinute: row.twelve_data_provider_rate_limit_per_minute,
      yahooAuProviderRateLimitPerMinute: row.yahoo_au_provider_rate_limit_per_minute,
      yahooKrProviderRateLimitPerMinute: row.yahoo_kr_provider_rate_limit_per_minute,
      frankfurterProviderRateLimitPerMinute: row.frankfurter_provider_rate_limit_per_minute,
      asxGicsProviderRateLimitPerHour: row.asx_gics_provider_rate_limit_per_hour,
      backfillRetryLimit: row.backfill_retry_limit,
      backfillRetryDelaySeconds: row.backfill_retry_delay_seconds,
      backfillFinmind402RetryMs: num(row.backfill_finmind_402_retry_ms),
      dailyRefreshLookbackDays: row.daily_refresh_lookback_days,
      dailyRefreshPriority: row.daily_refresh_priority,
      sseHeartbeatIntervalMs: row.sse_heartbeat_interval_ms,
      sseMaxConnectionsPerUser: row.sse_max_connections_per_user,
      sseBufferDefaultTtlMs: num(row.sse_buffer_default_ttl_ms),
      catalogAbsenceThreshold: row.catalog_absence_threshold,
      catalogAbsenceGuardPercent: num(row.catalog_absence_guard_percent),
      catalogAbsenceGuardFloor: row.catalog_absence_guard_floor,
      asxGicsRefreshCron: row.asx_gics_refresh_cron,
      anonymousShareTokenCap: row.anonymous_share_token_cap,
      anonymousShareRateLimitMax: row.anonymous_share_rate_limit_max,
      anonymousShareRateLimitWindowMs: row.anonymous_share_rate_limit_window_ms,
      anonymousShareTokenRetentionMs: num(row.anonymous_share_token_retention_ms),
      userPreferencesMaxBytes: row.user_preferences_max_bytes,
      accountHardPurgeDays: row.account_hard_purge_days,
      valuationHealthRelativeBps: row.valuation_health_relative_bps,
      valuationHealthAbsoluteAud: num(row.valuation_health_absolute_aud),
      valuationHealthAbsoluteUsd: num(row.valuation_health_absolute_usd),
      valuationHealthAbsoluteTwd: num(row.valuation_health_absolute_twd),
      valuationHealthAbsoluteKrw: num(row.valuation_health_absolute_krw),
      routeCachePolicyMode: row.route_cache_policy_mode,
      routeCacheDashboardPrimaryTtlMs: num(row.route_cache_dashboard_primary_ttl_ms),
      routeCacheDashboardEnrichmentTtlMs: num(row.route_cache_dashboard_enrichment_ttl_ms),
      routeCacheDashboardPerformanceTtlMs: num(row.route_cache_dashboard_performance_ttl_ms),
      routeCachePortfolioTtlMs: num(row.route_cache_portfolio_ttl_ms),
      routeCacheReportsTtlMs: num(row.route_cache_reports_ttl_ms),
      routeCacheStaleUsableTtlMs: num(row.route_cache_stale_usable_ttl_ms),
      updatedAt,
    };
  }

  async setAppConfigField(
    field: import("./types.js").AppConfigPlainField,
    value: number | null,
  ): Promise<void> {
    const { APP_CONFIG_PLAIN_COLUMNS } = await import("./types.js");
    const column = APP_CONFIG_PLAIN_COLUMNS[field];
    if (!column) {
      throw new Error(`unknown AppConfigPlainField: ${field}`);
    }
    // Identifier interpolation is safe — `column` comes from a static const map.
    await this.pool.query(
      `INSERT INTO public.app_config (id, ${column}, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET ${column} = $1, updated_at = NOW()`,
      [value],
    );
  }

  async setAppConfigEncryptedSecret(
    field: "finmindApiToken" | "twelveDataApiKey" | "mcpOauthTokenSecret",
    plaintext: string | null,
  ): Promise<void> {
    const { encryptSecret } = await import("../services/appConfig/encryption.js");
    const column = field === "finmindApiToken"
      ? "finmind_api_token"
      : field === "twelveDataApiKey"
        ? "twelve_data_api_key"
        : "mcp_oauth_token_secret";
    const stored = plaintext === null ? null : encryptSecret(plaintext);
    await this.pool.query(
      `INSERT INTO public.app_config (id, ${column}, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET ${column} = $1, updated_at = NOW()`,
      [stored],
    );
  }

  async setAppConfigPatch(patch: import("./types.js").AppConfigPatch): Promise<void> {
    const { APP_CONFIG_PLAIN_COLUMNS } = await import("./types.js");
    const columns: string[] = [];
    const values: Array<number | string | null> = [];

    for (const [key, column] of Object.entries(APP_CONFIG_PLAIN_COLUMNS) as Array<[
      import("./types.js").AppConfigPlainField,
      string,
    ]>) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        columns.push(column);
        values.push(patch[key] ?? null);
      }
    }

    // Tier 0 secrets — encrypt inline so plaintext never lives outside this
    // method.
    let encryptSecret: ((p: string) => string) | null = null;
    if (
      Object.prototype.hasOwnProperty.call(patch, "finmindApiToken") ||
      Object.prototype.hasOwnProperty.call(patch, "twelveDataApiKey") ||
      Object.prototype.hasOwnProperty.call(patch, "mcpOauthTokenSecret")
    ) {
      const mod = await import("../services/appConfig/encryption.js");
      encryptSecret = mod.encryptSecret;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "finmindApiToken")) {
      columns.push("finmind_api_token");
      values.push(patch.finmindApiToken == null ? null : encryptSecret!(patch.finmindApiToken));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "twelveDataApiKey")) {
      columns.push("twelve_data_api_key");
      values.push(patch.twelveDataApiKey == null ? null : encryptSecret!(patch.twelveDataApiKey));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "mcpOauthTokenSecret")) {
      columns.push("mcp_oauth_token_secret");
      values.push(patch.mcpOauthTokenSecret == null ? null : encryptSecret!(patch.mcpOauthTokenSecret));
    }

    if (columns.length === 0) return;

    const insertCols = columns.join(", ");
    const insertPlaceholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(", ");
    await this.pool.query(
      `INSERT INTO public.app_config (id, ${insertCols}, updated_at)
       VALUES (1, ${insertPlaceholders}, NOW())
       ON CONFLICT (id) DO UPDATE SET ${setClause}, updated_at = NOW()`,
      values,
    );
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

  // KZO-189: AU metadata enrichment mode override.
  async getMetadataEnrichmentMode(): Promise<"unconditional" | "conditional" | null> {
    const r = await this.pool.query<{ metadata_enrichment_mode: "unconditional" | "conditional" | null }>(
      "SELECT metadata_enrichment_mode FROM public.app_config WHERE id = 1",
    );
    if (r.rowCount === 0) {
      console.warn("[app_config] row missing — falling back to env METADATA_ENRICHMENT_MODE");
      return null;
    }
    return r.rows[0].metadata_enrichment_mode;
  }

  async setMetadataEnrichmentMode(value: "unconditional" | "conditional" | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.app_config (id, metadata_enrichment_mode, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET metadata_enrichment_mode = $1, updated_at = NOW()`,
      [value],
    );
  }

  async setRouteCachePolicyMode(value: import("./types.js").RouteCachePolicyMode | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.app_config (id, route_cache_policy_mode, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET route_cache_policy_mode = $1, updated_at = NOW()`,
      [value],
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
         SET preferences = user_preferences.preferences || EXCLUDED.preferences,
             updated_at = NOW()`,
      [userId, JSON.stringify(preferences)],
    );
  }

  async upsertInstrumentCatalog(
    instruments: CatalogInstrument[],
    delistings: DelistingRecord[],
    options?: import("./types.js").UpsertInstrumentCatalogOptions,
  ): Promise<CatalogSyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      let upserted = 0;
      const presentTickers: string[] = [];
      if (instruments.length > 0) {
        const tickers: string[] = [];
        const names: string[] = [];
        const typeRaws: string[] = [];
        const industryCategoryRaws: string[] = [];
        const finmindDates: string[] = [];
        const instrumentTypes: (string | null)[] = [];
        // KZO-170 S4: per-row market code threaded as `$8::text[]` instead of the previous
        // `array_fill('TW'::text, ...)`. Required-field on `CatalogInstrument` post-KZO-170,
        // so the source of truth is the catalog row's `marketCode`.
        const marketCodes: string[] = [];
        const catalogExchangeRaws: (string | null)[] = [];
        const catalogMicCodes: (string | null)[] = [];

        for (const inst of instruments) {
          tickers.push(inst.ticker);
          names.push(inst.name);
          typeRaws.push(inst.typeRaw);
          industryCategoryRaws.push(inst.industryCategoryRaw);
          finmindDates.push(inst.finmindDate);
          instrumentTypes.push(inst.instrumentType);
          marketCodes.push(inst.marketCode);
          catalogExchangeRaws.push(inst.catalogExchangeRaw ?? null);
          catalogMicCodes.push(inst.catalogMicCode ?? null);
          presentTickers.push(inst.ticker);
        }

        const result = await client.query(
          `INSERT INTO market_data.instruments
            (ticker, name, type_raw, industry_category_raw, finmind_date, instrument_type, market_code,
             catalog_exchange_raw, catalog_mic_code, is_provisional, updated_at)
          SELECT * FROM unnest(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
            $8::text[],
            $9::text[], $10::text[],
            array_fill(FALSE::boolean, ARRAY[$7::int]),
            array_fill(CURRENT_TIMESTAMP::timestamp, ARRAY[$7::int])
          )
          -- KZO-170 S4: composite PK from KZO-169 + per-row market_code. The catalog sync
          -- now stamps market_code from the per-market sync invocation, supporting US (KZO-170),
          -- TW (legacy), and AU (KZO-171 placeholder) without code changes.
          ON CONFLICT (ticker, market_code) DO UPDATE SET
            name = EXCLUDED.name,
            type_raw = EXCLUDED.type_raw,
            industry_category_raw = EXCLUDED.industry_category_raw,
            finmind_date = EXCLUDED.finmind_date,
            instrument_type = EXCLUDED.instrument_type,
            catalog_exchange_raw = EXCLUDED.catalog_exchange_raw,
            catalog_mic_code = EXCLUDED.catalog_mic_code,
            is_provisional = FALSE,
            updated_at = CURRENT_TIMESTAMP`,
          [
            tickers,
            names,
            typeRaws,
            industryCategoryRaws,
            finmindDates,
            instrumentTypes,
            instruments.length,
            marketCodes,
            catalogExchangeRaws,
            catalogMicCodes,
          ],
        );
        upserted = result.rowCount ?? 0;
      }

      // KZO-195 — for absence-detection-capable markets, stamp present rows
      // with `last_seen_in_catalog_at = NOW()` and reset their `absence_streak`.
      // This MUST run before the absent-candidate SELECT so present rows are
      // excluded from the candidate set (`last_seen < NOW()` filter below).
      if (options?.absenceDetection && presentTickers.length > 0) {
        await client.query(
          `UPDATE market_data.instruments
             SET last_seen_in_catalog_at = CURRENT_TIMESTAMP,
                 absence_streak = 0,
                 updated_at = CURRENT_TIMESTAMP
           WHERE market_code = $1
             AND ticker = ANY($2::text[])`,
          [options.absenceDetection.marketCode, presentTickers],
        );
      }

      let delisted = 0;
      for (const d of delistings) {
        // KZO-170 S4: filter the delisting UPDATE by `market_code` when the caller
        // provides one. Without this, a TW delisting for ticker `X` would also flip a
        // cross-listed US row with the same ticker. Older callers that omit `marketCode`
        // preserve the pre-KZO-170 TW-only behavior — the WHERE clause then matches any
        // listed row for that ticker (the dataset only ever held TW rows pre-KZO-170).
        if (d.marketCode) {
          const result = await client.query(
            `UPDATE market_data.instruments SET delisted_at = $2::timestamp, updated_at = CURRENT_TIMESTAMP
             WHERE ticker = $1 AND market_code = $3 AND delisted_at IS NULL`,
            [d.ticker, d.date, d.marketCode],
          );
          delisted += result.rowCount ?? 0;
        } else {
          const result = await client.query(
            `UPDATE market_data.instruments SET delisted_at = $2::timestamp, updated_at = CURRENT_TIMESTAMP
             WHERE ticker = $1 AND delisted_at IS NULL`,
            [d.ticker, d.date],
          );
          delisted += result.rowCount ?? 0;
        }
      }

      // KZO-195 — Absence detection branch (AU, plus US once flipped on).
      let absent = 0;
      let guardTripped = false;
      let absentTickersResult: string[] = [];
      if (options?.absenceDetection) {
        const { marketCode, categorize, actorUserId } = options.absenceDetection;

        // SELECT absent candidates: market matches, has been observed before,
        // is not admin-excluded, is not already delisted, AND was not just
        // stamped present in this transaction. The "not just-stamped" filter
        // is `last_seen_in_catalog_at < CURRENT_TIMESTAMP` — any row we just
        // updated above has `last_seen_in_catalog_at = CURRENT_TIMESTAMP`.
        const absentRowsResult = await client.query<{
          ticker: string;
          absence_streak: number;
          last_seen_in_catalog_at: Date | null;
          delisting_detection_excluded: boolean;
        }>(
          `SELECT ticker, absence_streak, last_seen_in_catalog_at, delisting_detection_excluded
             FROM market_data.instruments
            WHERE market_code = $1
              AND last_seen_in_catalog_at IS NOT NULL
              AND last_seen_in_catalog_at < CURRENT_TIMESTAMP
              AND delisted_at IS NULL`,
          [marketCode],
        );

        const absentRows = absentRowsResult.rows.map((r) => ({
          ticker: r.ticker,
          absenceStreak: r.absence_streak,
          lastSeenInCatalogAt:
            r.last_seen_in_catalog_at instanceof Date
              ? r.last_seen_in_catalog_at.toISOString()
              : r.last_seen_in_catalog_at,
          delistingDetectionExcluded: r.delisting_detection_excluded,
        }));

        // prevCatalogSize: count of non-excluded, non-delisted rows for this market.
        const sizeResult = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM market_data.instruments
            WHERE market_code = $1
              AND delisted_at IS NULL
              AND delisting_detection_excluded = FALSE`,
          [marketCode],
        );
        const prevCatalogSize = Number(sizeResult.rows[0]?.count ?? "0");

        const plan = categorize(absentRows, prevCatalogSize);
        guardTripped = plan.guardTripped;
        absentTickersResult = plan.absentTickers;

        if (plan.guardTripped) {
          // Persistence-side audit row — captures the candidate list. The
          // route-layer also surfaces this via a notification fan-out.
          await client.query(
            `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
             VALUES ($1, $2, 'instrument_absence_guard_tripped', NULL, $3::jsonb, NULL)`,
            [
              randomUUID(),
              actorUserId ?? null,
              JSON.stringify({
                marketCode,
                candidateCount: absentRows.length,
                prevCatalogSize,
                absentTickers: plan.absentTickers.slice(0, 50),
              }),
            ],
          );
        } else {
          if (plan.toBump.length > 0) {
            await client.query(
              `UPDATE market_data.instruments
                  SET absence_streak = absence_streak + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE market_code = $1
                  AND ticker = ANY($2::text[])`,
              [marketCode, plan.toBump],
            );
            // Per-bumped audit row.
            for (const ticker of plan.toBump) {
              await client.query(
                `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
                 VALUES ($1, $2, 'instrument_absence_streak_bumped', NULL, $3::jsonb, NULL)`,
                [
                  randomUUID(),
                  actorUserId ?? null,
                  JSON.stringify({ ticker, marketCode }),
                ],
              );
            }
          }
          if (plan.toStamp.length > 0) {
            await client.query(
              `UPDATE market_data.instruments
                  SET delisted_at = CURRENT_TIMESTAMP,
                      status_reason = 'absence_detected',
                      updated_at = CURRENT_TIMESTAMP
                WHERE market_code = $1
                  AND ticker = ANY($2::text[])
                  AND delisted_at IS NULL`,
              [marketCode, plan.toStamp],
            );
            // Per-stamped audit row.
            for (const ticker of plan.toStamp) {
              await client.query(
                `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
                 VALUES ($1, $2, 'instrument_delisted_via_absence', NULL, $3::jsonb, NULL)`,
                [
                  randomUUID(),
                  actorUserId ?? null,
                  JSON.stringify({ ticker, marketCode, source: "absence_detected" }),
                ],
              );
            }
            delisted += plan.toStamp.length;
          }
        }

        absent = absentRows.length;
      }

      await client.query("COMMIT");
      return { upserted, delisted, absent, guardTripped, absentTickers: absentTickersResult };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // KZO-195 — admin instrument overrides ────────────────────────────────────

  private _mapAdminInstrumentRow(row: {
    ticker: string;
    market_code: string;
    name: string | null;
    instrument_type: string | null;
    support_state: "supported" | "retired_by_admin" | "unsupported_by_provider";
    bars_backfill_status: "pending" | "backfilling" | "ready" | "failed";
    delisted_at: Date | string | null;
    status_reason: string | null;
    last_seen_in_catalog_at: Date | string | null;
    absence_streak: number;
    delisting_detection_excluded: boolean;
    updated_at: Date | string;
  }): import("./types.js").AdminInstrumentRow {
    const toIso = (v: Date | string | null): string | null =>
      v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
    return {
      ticker: row.ticker,
      marketCode: row.market_code,
      name: row.name,
      instrumentType: row.instrument_type,
      supportState: row.support_state,
      barsBackfillStatus: row.bars_backfill_status,
      delistedAt: toIso(row.delisted_at),
      statusReason: row.status_reason,
      lastSeenInCatalogAt: toIso(row.last_seen_in_catalog_at),
      absenceStreak: row.absence_streak,
      delistingDetectionExcluded: row.delisting_detection_excluded,
      updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
    };
  }

  async instrumentAdminGet(
    ticker: string,
    marketCode: string,
  ): Promise<import("./types.js").AdminInstrumentRow | null> {
    const r = await this.pool.query(
      `SELECT ticker, market_code, name, instrument_type, support_state, bars_backfill_status,
              delisted_at, status_reason,
              last_seen_in_catalog_at, absence_streak, delisting_detection_excluded, updated_at
         FROM market_data.instruments
        WHERE ticker = $1 AND market_code = $2`,
      [ticker, marketCode],
    );
    if (r.rowCount === 0) return null;
    return this._mapAdminInstrumentRow(r.rows[0]);
  }

  async listAdminInstruments(opts: {
    marketCode: string;
    page: number;
    limit: number;
    status?: "listed" | "delisted" | "excluded" | "all";
    supportState?: import("./types.js").AdminInstrumentRow["supportState"] | "all";
    search?: string;
    instrumentType?: import("@vakwen/domain").InstrumentType | "all";
    backfillStatus?: "pending" | "backfilling" | "ready" | "failed" | "all";
    sort?: "ticker_asc" | "ticker_desc" | "updated_desc" | "updated_asc";
  }): Promise<{
    items: import("./types.js").AdminInstrumentRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Math.floor(opts.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(opts.limit) || 50));
    const offset = (page - 1) * limit;
    const where: string[] = ["market_code = $1"];
    const params: unknown[] = [opts.marketCode];
    if (opts.status && opts.status !== "all") {
      if (opts.status === "delisted") {
        where.push("delisted_at IS NOT NULL");
      } else if (opts.status === "excluded") {
        where.push("delisted_at IS NULL AND delisting_detection_excluded = TRUE");
      } else {
        where.push("delisted_at IS NULL AND delisting_detection_excluded = FALSE");
      }
    }
    if (opts.supportState && opts.supportState !== "all") {
      params.push(opts.supportState);
      where.push(`support_state = $${params.length}`);
    }
    if (opts.instrumentType && opts.instrumentType !== "all") {
      params.push(opts.instrumentType);
      where.push(`instrument_type = $${params.length}`);
    }
    if (opts.backfillStatus && opts.backfillStatus !== "all") {
      params.push(opts.backfillStatus);
      where.push(`bars_backfill_status = $${params.length}`);
    }
    const search = opts.search?.trim();
    if (search) {
      params.push(`%${search}%`);
      where.push(`(ticker ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    const whereSql = where.join(" AND ");
    const orderBy =
      opts.sort === "ticker_desc"
        ? "ticker DESC"
        : opts.sort === "updated_asc"
          ? "updated_at ASC, ticker ASC"
          : opts.sort === "updated_desc"
            ? "updated_at DESC, ticker ASC"
            : "ticker ASC";
    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM market_data.instruments
        WHERE ${whereSql}`,
      params,
    );
    const total = Number(totalRes.rows[0]?.count ?? "0");
    const rowsParams = [...params, limit, offset];
    const rowsRes = await this.pool.query(
      `SELECT ticker, market_code, name, instrument_type, support_state, bars_backfill_status,
              delisted_at, status_reason,
              last_seen_in_catalog_at, absence_streak, delisting_detection_excluded, updated_at
         FROM market_data.instruments
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      rowsParams,
    );
    const items = rowsRes.rows.map((row) => this._mapAdminInstrumentRow(row));
    return { items, total, page, limit };
  }

  async listAdminMarketDataBackfillTargets(options: {
    marketCode: MarketCode;
    includeDemoUsers?: boolean;
  }): Promise<AdminMarketDataBackfillTargetRow[]> {
    const params: unknown[] = [options.marketCode];
    const demoPredicate = options.includeDemoUsers === true ? "" : "AND u.is_demo = FALSE";
    const result = await this.pool.query<{ ticker: string; market_code: string }>(
      `WITH monitored AS (
         SELECT ums.user_id, ums.ticker, ums.market_code, NULL::text AS account_id
           FROM user_monitored_tickers ums
         UNION
         SELECT DISTINCT a.user_id, l.ticker,
                COALESCE(
                  (SELECT te.market_code
                     FROM trade_events te
                    WHERE te.account_id = l.account_id
                      AND te.ticker = l.ticker
                    LIMIT 1),
                  'TW'
                ) AS market_code,
                l.account_id
           FROM lots l
           JOIN accounts a ON a.id = l.account_id
          WHERE a.deleted_at IS NULL
            AND l.open_quantity > 0
       )
       SELECT DISTINCT i.ticker, i.market_code
         FROM monitored m
         JOIN users u ON u.id = m.user_id
         JOIN market_data.instruments i
           ON i.ticker = m.ticker
          AND i.market_code = m.market_code
        WHERE i.market_code = $1
          ${demoPredicate}
          AND i.delisted_at IS NULL
          AND i.support_state = 'supported'
        ORDER BY i.ticker, i.market_code`,
      params,
    );
    return result.rows.map((row) => ({
      ticker: row.ticker,
      marketCode: row.market_code as MarketCode,
    }));
  }

  async countAdminMarketDataTargetOwnership(options: {
    targets: AdminMarketDataBackfillTargetRow[];
  }): Promise<{ userCount: number; accountCount: number }> {
    if (options.targets.length === 0) return { userCount: 0, accountCount: 0 };
    const tickers = options.targets.map((target) => target.ticker);
    const marketCodes = options.targets.map((target) => target.marketCode);
    const result = await this.pool.query<{ user_count: string; account_count: string }>(
      `WITH targets AS (
         SELECT *
           FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code)
       ),
       manual AS (
         SELECT ums.user_id, NULL::text AS account_id
           FROM user_monitored_tickers ums
           JOIN targets t ON t.ticker = ums.ticker AND t.market_code = ums.market_code
       ),
       positions AS (
         SELECT DISTINCT a.user_id, l.account_id
           FROM lots l
           JOIN accounts a ON a.id = l.account_id
           JOIN targets t
             ON t.ticker = l.ticker
            AND t.market_code = COALESCE(
              (SELECT te.market_code
                 FROM trade_events te
                WHERE te.account_id = l.account_id
                  AND te.ticker = l.ticker
                LIMIT 1),
              'TW'
            )
          WHERE a.deleted_at IS NULL
            AND l.open_quantity > 0
       ),
       combined AS (
         SELECT user_id, account_id FROM manual
         UNION ALL
         SELECT user_id, account_id FROM positions
       )
       SELECT count(DISTINCT user_id)::text AS user_count,
              (count(DISTINCT account_id) FILTER (WHERE account_id IS NOT NULL))::text AS account_count
         FROM combined`,
      [tickers, marketCodes],
    );
    return {
      userCount: Number(result.rows[0]?.user_count ?? "0"),
      accountCount: Number(result.rows[0]?.account_count ?? "0"),
    };
  }

  async purgeAdminMarketData(input: AdminMarketDataPurgeInput): Promise<AdminMarketDataPurgeCounts> {
    const empty: AdminMarketDataPurgeCounts = {
      priceBars: 0,
      dividends: 0,
      backfillJobs: 0,
      providerOperationOutcomes: 0,
      providerErrorTrail: 0,
      providerResolutionMappings: 0,
      asxGicsEnrichment: 0,
      adminStateReset: 0,
      total: 0,
    };
    if (input.targets.length === 0) return empty;
    const tickers = input.targets.map((target) => target.ticker);
    const marketCodes = input.targets.map((target) => target.marketCode);
    const datePredicate = input.fullHistory === false
      ? {
          bars: "AND ($3::date IS NULL OR bar_date >= $3::date) AND ($4::date IS NULL OR bar_date <= $4::date)",
          dividends: "AND ($3::date IS NULL OR ex_dividend_date >= $3::date) AND ($4::date IS NULL OR ex_dividend_date <= $4::date)",
          params: [input.startDate ?? null, input.endDate ?? null] as const,
        }
      : {
          bars: "",
          dividends: "",
          params: [] as const,
        };
    const counts = { ...empty };
    const client = await this.pool.connect();
    const countOrDelete = async (countSql: string, deleteSql: string, params: unknown[]): Promise<number> => {
      if (input.dryRun) {
        const result = await client.query<{ count: string }>(countSql, params);
        return Number(result.rows[0]?.count ?? "0");
      }
      const result = await client.query(deleteSql, params);
      return result.rowCount ?? 0;
    };
    try {
      await client.query("BEGIN");
      if (input.categories.includes("price_bars")) {
        const params = [tickers, marketCodes, ...datePredicate.params];
        counts.priceBars = await countOrDelete(
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           SELECT count(*)::text AS count
             FROM market_data.daily_bars b
             JOIN targets t ON t.ticker = b.ticker AND t.market_code = b.market_code
            WHERE TRUE ${datePredicate.bars}`,
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           DELETE FROM market_data.daily_bars b
            USING targets t
            WHERE t.ticker = b.ticker
              AND t.market_code = b.market_code
              ${datePredicate.bars}`,
          params,
        );
      }
      if (input.categories.includes("dividends")) {
        const params = [tickers, marketCodes, ...datePredicate.params];
        counts.dividends = await countOrDelete(
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           SELECT count(*)::text AS count
             FROM market_data.dividend_events d
             JOIN targets t ON t.ticker = d.ticker AND t.market_code = d.market_code
            WHERE NOT EXISTS (
                    SELECT 1 FROM dividend_ledger_entries dle WHERE dle.dividend_event_id = d.id
                  )
              ${datePredicate.dividends}`,
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           DELETE FROM market_data.dividend_events d
            USING targets t
            WHERE t.ticker = d.ticker
              AND t.market_code = d.market_code
              AND NOT EXISTS (
                    SELECT 1 FROM dividend_ledger_entries dle WHERE dle.dividend_event_id = d.id
                  )
              ${datePredicate.dividends}`,
          params,
        );
      }
      if (input.categories.includes("provider_operation_outcomes")) {
        counts.providerOperationOutcomes = await countOrDelete(
          `SELECT count(*)::text AS count
             FROM market_data.provider_operation_outcomes
            WHERE provider_id = $1
              AND market_code = $2
              AND source_symbol = ANY($3::text[])`,
          `DELETE FROM market_data.provider_operation_outcomes
            WHERE provider_id = $1
              AND market_code = $2
              AND source_symbol = ANY($3::text[])`,
          [input.providerId, input.marketCode, tickers],
        );
      }
      if (input.categories.includes("provider_error_trail")) {
        counts.providerErrorTrail = await countOrDelete(
          `SELECT count(*)::text AS count
             FROM market_data.provider_error_trail
            WHERE provider_id = $1
              AND (context->>'marketCode' IS NULL OR context->>'marketCode' = $2)
              AND COALESCE(context->>'ticker', context->>'symbol', context->>'sourceSymbol', '') = ANY($3::text[])`,
          `DELETE FROM market_data.provider_error_trail
            WHERE provider_id = $1
              AND (context->>'marketCode' IS NULL OR context->>'marketCode' = $2)
              AND COALESCE(context->>'ticker', context->>'symbol', context->>'sourceSymbol', '') = ANY($3::text[])`,
          [input.providerId, input.marketCode, tickers],
        );
      }
      if (input.categories.includes("provider_resolution_mappings")) {
        counts.providerResolutionMappings = await countOrDelete(
          `SELECT count(*)::text AS count
             FROM market_data.provider_resolution_mappings
            WHERE provider_id = $1
              AND market_code = $2
              AND source_symbol = ANY($3::text[])`,
          `DELETE FROM market_data.provider_resolution_mappings
            WHERE provider_id = $1
              AND market_code = $2
              AND source_symbol = ANY($3::text[])`,
          [input.providerId, input.marketCode, tickers],
        );
      }
      if (input.categories.includes("asx_gics_enrichment") && input.marketCode === "AU") {
        counts.asxGicsEnrichment = await countOrDelete(
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           SELECT count(*)::text AS count
             FROM market_data.instruments i
             JOIN targets t ON t.ticker = i.ticker AND t.market_code = i.market_code
            WHERE i.market_code = 'AU'
              AND i.gics_industry_group IS NOT NULL`,
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           UPDATE market_data.instruments i
              SET gics_industry_group = NULL,
                  updated_at = CURRENT_TIMESTAMP
             FROM targets t
            WHERE t.ticker = i.ticker
              AND t.market_code = i.market_code
              AND i.market_code = 'AU'
              AND i.gics_industry_group IS NOT NULL`,
          [tickers, marketCodes],
        );
      }
      if (input.categories.includes("admin_state_reset")) {
        counts.adminStateReset = await countOrDelete(
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           SELECT count(*)::text AS count
             FROM market_data.instruments i
             JOIN targets t ON t.ticker = i.ticker AND t.market_code = i.market_code
            WHERE i.support_state <> 'supported'
               OR i.bars_backfill_status <> 'pending'`,
          `WITH targets AS (SELECT * FROM unnest($1::text[], $2::text[]) AS t(ticker, market_code))
           UPDATE market_data.instruments i
              SET support_state = 'supported',
                  bars_backfill_status = 'pending',
                  updated_at = CURRENT_TIMESTAMP
             FROM targets t
            WHERE t.ticker = i.ticker
              AND t.market_code = i.market_code
              AND (i.support_state <> 'supported' OR i.bars_backfill_status <> 'pending')`,
          [tickers, marketCodes],
        );
      }
      counts.total =
        counts.priceBars
        + counts.dividends
        + counts.backfillJobs
        + counts.providerOperationOutcomes
        + counts.providerErrorTrail
        + counts.providerResolutionMappings
        + counts.asxGicsEnrichment
        + counts.adminStateReset;
      await client.query(input.dryRun ? "ROLLBACK" : "COMMIT");
      return counts;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async undeleteInstrument(
    ticker: string,
    marketCode: string,
    actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query<{
        delisted_at: Date | string | null;
        absence_streak: number;
        last_seen_in_catalog_at: Date | string | null;
        status_reason: string | null;
      }>(
        `SELECT delisted_at, absence_streak, last_seen_in_catalog_at, status_reason
           FROM market_data.instruments
          WHERE ticker = $1 AND market_code = $2`,
        [ticker, marketCode],
      );
      if (before.rowCount === 0) {
        await client.query("ROLLBACK");
        throw routeError(404, "instrument_not_found", `Instrument not found: ${ticker}/${marketCode}`);
      }
      const r = await client.query(
        `UPDATE market_data.instruments
            SET delisted_at = NULL,
                status_reason = NULL,
                absence_streak = 0,
                last_seen_in_catalog_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE ticker = $1 AND market_code = $2
          RETURNING ticker, market_code, name, instrument_type, support_state, bars_backfill_status,
                    delisted_at, status_reason,
                    last_seen_in_catalog_at, absence_streak, delisting_detection_excluded, updated_at`,
        [ticker, marketCode],
      );
      const beforeRow = before.rows[0];
      const beforeIso = (v: Date | string | null): string | null =>
        v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
      await client.query(
        `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
         VALUES ($1, $2, 'instrument_undelete', NULL, $3::jsonb, NULL)`,
        [
          randomUUID(),
          actorUserId,
          JSON.stringify({
            ticker,
            marketCode,
            before: {
              delistedAt: beforeIso(beforeRow.delisted_at),
              absenceStreak: beforeRow.absence_streak,
              statusReason: beforeRow.status_reason,
              lastSeenInCatalogAt: beforeIso(beforeRow.last_seen_in_catalog_at),
            },
          }),
        ],
      );
      await client.query("COMMIT");
      return this._mapAdminInstrumentRow(r.rows[0]);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async setInstrumentDelistingDetectionExcluded(
    ticker: string,
    marketCode: string,
    excluded: boolean,
    actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query<{ delisting_detection_excluded: boolean }>(
        `SELECT delisting_detection_excluded
           FROM market_data.instruments
          WHERE ticker = $1 AND market_code = $2`,
        [ticker, marketCode],
      );
      if (before.rowCount === 0) {
        await client.query("ROLLBACK");
        throw routeError(404, "instrument_not_found", `Instrument not found: ${ticker}/${marketCode}`);
      }
      const r = await client.query(
        `UPDATE market_data.instruments
            SET delisting_detection_excluded = $3,
                updated_at = CURRENT_TIMESTAMP
          WHERE ticker = $1 AND market_code = $2
          RETURNING ticker, market_code, name, instrument_type, support_state, bars_backfill_status,
                    delisted_at, status_reason,
                    last_seen_in_catalog_at, absence_streak, delisting_detection_excluded, updated_at`,
        [ticker, marketCode, excluded],
      );
      await client.query(
        `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
         VALUES ($1, $2, 'instrument_exclusion_toggle', NULL, $3::jsonb, NULL)`,
        [
          randomUUID(),
          actorUserId,
          JSON.stringify({
            ticker,
            marketCode,
            before: { delistingDetectionExcluded: before.rows[0].delisting_detection_excluded },
            after: { delistingDetectionExcluded: excluded },
          }),
        ],
      );
      await client.query("COMMIT");
      return this._mapAdminInstrumentRow(r.rows[0]);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async setInstrumentSupportState(
    ticker: string,
    marketCode: string,
    supportState: import("./types.js").AdminInstrumentRow["supportState"],
    actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query<{ support_state: string }>(
        `SELECT support_state
           FROM market_data.instruments
          WHERE ticker = $1 AND market_code = $2`,
        [ticker, marketCode],
      );
      if (before.rowCount === 0) {
        await client.query("ROLLBACK");
        throw routeError(404, "instrument_not_found", `Instrument not found: ${ticker}/${marketCode}`);
      }
      const r = await client.query(
        `UPDATE market_data.instruments
            SET support_state = $3,
                updated_at = CURRENT_TIMESTAMP
          WHERE ticker = $1 AND market_code = $2
          RETURNING ticker, market_code, name, instrument_type, support_state, bars_backfill_status,
                    delisted_at, status_reason,
                    last_seen_in_catalog_at, absence_streak, delisting_detection_excluded, updated_at`,
        [ticker, marketCode, supportState],
      );
      await client.query(
        `INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, ip_address)
         VALUES ($1, $2, 'instrument_support_state_update', NULL, $3::jsonb, NULL)`,
        [
          randomUUID(),
          actorUserId,
          JSON.stringify({
            ticker,
            marketCode,
            before: { supportState: before.rows[0].support_state },
            after: { supportState },
          }),
        ],
      );
      await client.query("COMMIT");
      return this._mapAdminInstrumentRow(r.rows[0]);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Monitored Symbols ---

  async getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]> {
    // KZO-169: every monitored row now carries `market_code`, sourced from
    // `user_monitored_tickers` for manual rows or from `lots.market_code`
    // for position-derived rows (lots inherit market from the trade event).
    // The JOIN to `market_data.instruments` becomes a composite-key match
    // — see scope-todo §D10 / postgres.ts:6074.
    const result = await this.pool.query<{
      ticker: string;
      market_code: string;
      source: "manual" | "position";
      name: string | null;
      instrument_type: string | null;
      bars_backfill_status: string | null;
      last_repair_at: string | null;
    }>(
      `WITH manual AS (
         SELECT ums.ticker, ums.market_code, 'manual'::text AS source
         FROM user_monitored_tickers ums
         WHERE ums.user_id = $1
       ),
       positions AS (
         -- Lots don't carry market_code directly; derive it from a
         -- representative trade event for the (account, ticker). The
         -- post-KZO-169 invariant ensures every trade in a given
         -- (account, ticker) carries the same market_code (account-currency
         -- match), so any matching row is correct. Fall back to 'TW' for the
         -- legacy zero-row case.
         SELECT DISTINCT l.ticker,
                COALESCE(
                  (SELECT te.market_code
                     FROM trade_events te
                     WHERE te.account_id = l.account_id
                       AND te.ticker = l.ticker
                     LIMIT 1),
                  'TW'
                ) AS market_code,
                'position'::text AS source
         FROM lots l
         JOIN accounts a ON l.account_id = a.id
         -- ui-enhancement — hide positions belonging to soft-deleted accounts
         -- from the monitored-ticker set. Otherwise the daily-refresh cron and
         -- backfill enqueue could still tickle tickers the user has retired.
         -- [active-only filter ADDED]
         WHERE a.user_id = $1 AND a.deleted_at IS NULL AND l.open_quantity > 0
       ),
       combined AS (
         SELECT ticker, market_code, source FROM manual
         UNION ALL
         SELECT ticker, market_code, source FROM positions p
         WHERE NOT EXISTS (
           SELECT 1 FROM manual m
           WHERE m.ticker = p.ticker AND m.market_code = p.market_code
         )
       )
       SELECT c.ticker, c.market_code, c.source,
              i.name, i.instrument_type, i.bars_backfill_status, i.last_repair_at::text
       FROM combined c
       LEFT JOIN market_data.instruments i
         ON i.ticker = c.ticker AND i.market_code = c.market_code`,
      [userId],
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      marketCode: row.market_code,
      source: row.source as MonitoredTickerDto["source"],
      name: row.name,
      instrumentType: (row.instrument_type as MonitoredTickerDto["instrumentType"]) ?? null,
      barsBackfillStatus: row.bars_backfill_status,
      lastRepairAt: row.last_repair_at,
    }));
  }

  async getAllMonitoredTickers(): Promise<{ ticker: string; marketCode: string }[]> {
    // KZO-169 / KZO-185 / KZO-170: composite (ticker, market_code) JOIN. Manual
    // rows + position-derived rows union into distinct (ticker, market_code)
    // pairs, then filter to ready+listed instruments. Producers (daily-refresh
    // cron, post-recompute auto-backfill) consume `marketCode` directly. The
    // legacy `resolveMarketCode(ticker)` heuristic was deleted in KZO-170.
    const result = await this.pool.query<{ ticker: string; market_code: string }>(
      `WITH monitored AS (
         SELECT ums.user_id, ums.ticker, ums.market_code
         FROM user_monitored_tickers ums
         UNION
         SELECT DISTINCT a.user_id, l.ticker,
                COALESCE(
                  (SELECT te.market_code
                     FROM trade_events te
                     WHERE te.account_id = l.account_id
                       AND te.ticker = l.ticker
                     LIMIT 1),
                  'TW'
                ) AS market_code
         FROM lots l
         JOIN accounts a ON a.id = l.account_id
         -- ui-enhancement — exclude positions in soft-deleted accounts from
         -- the global monitored set (daily-refresh cron input).
         -- [active-only filter ADDED]
         WHERE a.deleted_at IS NULL AND l.open_quantity > 0
       )
       SELECT DISTINCT i.ticker, i.market_code
       FROM monitored m
       JOIN users u ON u.id = m.user_id
       JOIN market_data.instruments i
         ON i.ticker = m.ticker AND i.market_code = m.market_code
       WHERE u.is_demo = FALSE
         AND i.bars_backfill_status = 'ready'
         AND i.delisted_at IS NULL
       ORDER BY i.ticker, i.market_code`,
    );
    return result.rows.map((row) => ({ ticker: row.ticker, marketCode: row.market_code }));
  }

  async listAuCatalogBarsBackfillCandidates(): Promise<Array<{ ticker: string; marketCode: "AU" }>> {
    // KZO-197 — fresh-deploy AU catalog warm-up. Read directly from
    // `market_data.instruments` (NOT the monitored set) because the
    // bootstrap state has zero monitored AU tickers — the catalog rows
    // exist (TW Twelve Data sync seeded them), they're just unbacked.
    // Filter on `bars_backfill_status IN ('pending','failed')` and
    // `delisted_at IS NULL` per scope-todo. Schema-qualified per
    // `.claude/rules/integration-test-persistence-direct.md`.
    const result = await this.pool.query<{ ticker: string }>(
      `SELECT ticker
         FROM market_data.instruments
        WHERE market_code = 'AU'
          AND bars_backfill_status IN ('pending', 'failed')
          AND delisted_at IS NULL
        ORDER BY ticker`,
    );
    return result.rows.map((row) => ({ ticker: row.ticker, marketCode: "AU" as const }));
  }

  async listCatalogBarsBackfillCandidates(marketCode: MarketCode): Promise<Array<{ ticker: string; marketCode: MarketCode }>> {
    const result = await this.pool.query<{ ticker: string; market_code: string }>(
      `SELECT ticker, market_code
         FROM market_data.instruments
        WHERE market_code = $1
          AND bars_backfill_status IN ('pending', 'failed')
          AND delisted_at IS NULL
        ORDER BY ticker`,
      [marketCode],
    );
    return result.rows.map((row) => ({ ticker: row.ticker, marketCode: row.market_code }));
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
         -- ui-enhancement — hide soft-deleted accounts' positions from the
         -- "who monitors this ticker?" fan-out used by backfill notifications.
         -- [active-only filter ADDED]
         WHERE l.ticker = $1 AND l.open_quantity > 0 AND a.deleted_at IS NULL
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

  async getManualSelections(userId: string): Promise<{ ticker: string; marketCode: string; addedAt: string }[]> {
    const result = await this.pool.query<{ ticker: string; market_code: string; added_at: string }>(
      `SELECT ticker, market_code, added_at
       FROM user_monitored_tickers
       WHERE user_id = $1
       ORDER BY added_at`,
      [userId],
    );
    return result.rows.map((row) => ({
      ticker: row.ticker,
      marketCode: row.market_code,
      addedAt: new Date(row.added_at).toISOString(),
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
    // Get current full monitored set before replacing — diffed by composite
    // (ticker|marketCode) key so a switch from BHP/AU → BHP/US is reported
    // as a "new" entry per KZO-169.
    const currentSet = await this.getMonitoredSet(userId);
    const currentKeys = new Set(currentSet.map((s) => `${s.ticker}|${s.marketCode}`));

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_monitored_tickers WHERE user_id = $1", [userId]);
      for (const sel of selections) {
        // KZO-188: live-sourced AU picks (e.g. CBA) are not in the catalog
        // sync feed, so the FK insert below would fail without an instrument
        // row. Upsert the catalog row first when the client provides
        // metadata. ON CONFLICT DO NOTHING preserves any pre-existing row's
        // enriched fields (instrument_type from sync, last_synced_at, etc.).
        if (sel.name !== undefined && sel.instrumentType !== undefined) {
          await client.query(
            `INSERT INTO market_data.instruments
               (ticker, name, instrument_type, market_code, is_provisional, bars_backfill_status, updated_at)
             VALUES ($1, $2, $3, $4, FALSE, 'pending', NOW())
             ON CONFLICT (ticker, market_code) DO NOTHING`,
            [sel.ticker, sel.name, sel.instrumentType, sel.marketCode],
          );
        }
        await client.query(
          `INSERT INTO user_monitored_tickers (user_id, ticker, market_code)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, sel.ticker, sel.marketCode],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // newTickers reports the ticker portion (back-compat with KZO-132 refresh
    // batch consumers that key by ticker only) for selections whose composite
    // key was not previously monitored.
    const newTickers = selections
      .filter((sel) => !currentKeys.has(`${sel.ticker}|${sel.marketCode}`))
      .map((sel) => sel.ticker);
    return { newTickers };
  }

  async listInstrumentsCatalog(
    search?: string,
    type?: string,
    marketCode?: string,
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

    // KZO-169: optional `market_code` server-side filter. Routes pass
    // `undefined` for the ALL chip and a closed-set value for TW/US/AU.
    if (marketCode) {
      conditions.push(`i.market_code = $${paramIndex}`);
      params.push(marketCode);
      paramIndex++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.pool.query<{
      ticker: string;
      name: string | null;
      instrument_type: string | null;
      market_code: string;
      industry_category_raw: string | null;
      bars_backfill_status: string;
      last_repair_at: string | null;
      // KZO-196 — GICS industry-group projection.
      gics_industry_group: string | null;
    }>(
      `SELECT ticker, name, instrument_type, market_code, industry_category_raw, bars_backfill_status, last_repair_at::text,
              gics_industry_group
       FROM market_data.instruments i ${where}
       ORDER BY ticker, market_code`,
      params,
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name,
      instrumentType: (row.instrument_type as InstrumentCatalogItemDto["instrumentType"]) ?? null,
      sector: normalizeInstrumentSector({
        marketCode: row.market_code,
        instrumentType: (row.instrument_type as InstrumentCatalogItemDto["instrumentType"]) ?? null,
        industryCategoryRaw: row.industry_category_raw ?? null,
        gicsIndustryGroup: row.gics_industry_group ?? null,
      }),
      marketCode: row.market_code,
      barsBackfillStatus: row.bars_backfill_status,
      lastRepairAt: row.last_repair_at,
      // KZO-196 — null when the GICS sync has not enriched this row yet.
      gicsIndustryGroup: row.gics_industry_group ?? null,
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
      // KZO-183: fee_profiles has no user_id post-migration-042. Profiles
      // cascade via fee_profiles.account_id → accounts(id) ON DELETE CASCADE
      // when the accounts row was deleted in step 2 above. Tax rules cascade
      // through fee_profiles.
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

  // ── ui-enhancement — Account lifecycle ──────────────────────────────────

  async softDeleteAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<{ deletedAt: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock row and verify ownership.
      const lookup = await client.query<{
        name: string;
        account_type: string;
        default_currency: string;
        deleted_at: Date | string | null;
      }>(
        `SELECT name, account_type, default_currency, deleted_at
         FROM accounts
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [accountId, userId],
      );
      if (!lookup.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "account_not_found", "Account not found.");
      }
      const existingDeletedAt = lookup.rows[0].deleted_at;
      if (existingDeletedAt !== null) {
        // Idempotent — already soft-deleted.
        await client.query("COMMIT");
        const iso = existingDeletedAt instanceof Date
          ? existingDeletedAt.toISOString()
          : new Date(existingDeletedAt).toISOString();
        return { deletedAt: iso };
      }
      const result = await client.query<{ deleted_at: Date | string }>(
        `UPDATE accounts SET deleted_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING deleted_at`,
        [accountId, userId],
      );
      const deletedAtRaw = result.rows[0]!.deleted_at;
      const deletedAt = deletedAtRaw instanceof Date
        ? deletedAtRaw.toISOString()
        : new Date(deletedAtRaw).toISOString();

      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "account_soft_deleted",
        targetUserId: userId,
        metadata: {
          ...auditInput.metadata,
          accountId,
          accountName: lookup.rows[0].name,
          accountType: lookup.rows[0].account_type,
          defaultCurrency: lookup.rows[0].default_currency,
        },
      });

      await client.query("COMMIT");
      return { deletedAt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<{ accountId: string; finalName: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock + verify soft-deleted state.
      const lookup = await client.query<{ name: string; deleted_at: Date | string | null }>(
        `SELECT name, deleted_at FROM accounts
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [accountId, userId],
      );
      if (!lookup.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "account_not_found", "Account not found.");
      }
      if (lookup.rows[0].deleted_at === null) {
        await client.query("ROLLBACK");
        throw routeError(404, "account_not_soft_deleted", "Account is not soft-deleted.");
      }
      const priorName = lookup.rows[0].name;

      // Resolve name collision against ACTIVE accounts only.
      const activeNamesResult = await client.query<{ name: string }>(
        `SELECT name FROM accounts
         WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId],
      );
      const activeNames = new Set(activeNamesResult.rows.map((r) => r.name));
      let finalName = priorName;
      if (activeNames.has(priorName)) {
        finalName = `${priorName} (restored)`;
        let suffix = 2;
        while (activeNames.has(finalName) && suffix <= 20) {
          finalName = `${priorName} (restored ${suffix})`;
          suffix += 1;
        }
        if (activeNames.has(finalName)) {
          await client.query("ROLLBACK");
          throw routeError(
            409,
            "account_restore_name_unresolvable",
            "Could not auto-rename restored account: too many name collisions (>20 candidates tried).",
          );
        }
      }

      await client.query(
        `UPDATE accounts SET deleted_at = NULL, name = $3
         WHERE id = $1 AND user_id = $2`,
        [accountId, userId, finalName],
      );

      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "account_restored",
        targetUserId: userId,
        metadata: { ...auditInput.metadata, accountId, priorName, finalName },
      });

      await client.query("COMMIT");
      return { accountId, finalName };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async hardPurgeAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
    options: { mustBeSoftDeleted?: boolean } = {},
  ): Promise<void> {
    const mustBeSoftDeleted = options.mustBeSoftDeleted ?? true;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 1. Lock + verify ownership and state.
      const lookup = await client.query<{
        name: string;
        account_type: string;
        default_currency: string;
        deleted_at: Date | string | null;
      }>(
        `SELECT name, account_type, default_currency, deleted_at
         FROM accounts
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [accountId, userId],
      );
      if (!lookup.rows[0]) {
        await client.query("ROLLBACK");
        throw routeError(404, "account_not_found", "Account not found.");
      }
      const { name, account_type, default_currency, deleted_at } = lookup.rows[0];
      if (mustBeSoftDeleted && deleted_at === null) {
        await client.query("ROLLBACK");
        throw routeError(
          404,
          "account_not_soft_deleted",
          "Account must be soft-deleted before cron-driven hard-purge.",
        );
      }
      const deletedAtIso = deleted_at === null
        ? null
        : deleted_at instanceof Date
          ? deleted_at.toISOString()
          : new Date(deleted_at).toISOString();

      // 2. Audit row BEFORE row deletion. audit_log.target_user_id has FK ON
      // DELETE SET NULL, so the user row survives untouched and the entry is
      // preserved past purge.
      await this.appendAuditLogTx(client, {
        ...auditInput,
        action: "account_hard_purged",
        targetUserId: userId,
        metadata: {
          ...auditInput.metadata,
          accountId,
          accountName: name,
          accountType: account_type,
          defaultCurrency: default_currency,
          deletedAt: deletedAtIso,
        },
      });

      // 3. Account-scoped child rows in dependency order (mirrors hardPurgeUser
      // restricted to a single accountId). composite-FK currency_wallet_snapshots
      // before accounts row. trade_fee_policy_snapshots intentionally LEFT in
      // place (user-scoped; per-account snapshot scoping is non-trivial and
      // adds zero user-observable benefit; reaped on user hard-purge or remain
      // harmless. Same orphan tolerance pattern as fee_profiles).
      await client.query("DELETE FROM daily_holding_snapshots WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM currency_wallet_snapshots WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM cash_ledger_entries WHERE account_id = $1", [accountId]);
      await client.query(
        `DELETE FROM lot_allocations
         WHERE lot_id IN (SELECT id FROM lots WHERE account_id = $1)`,
        [accountId],
      );
      await client.query("DELETE FROM lots WHERE account_id = $1", [accountId]);
      await client.query(
        `DELETE FROM dividend_deduction_entries
         WHERE dividend_ledger_entry_id IN (
           SELECT id FROM dividend_ledger_entries WHERE account_id = $1
         )`,
        [accountId],
      );
      // dividend_source_lines cascade from dividend_ledger_entries.
      await client.query("DELETE FROM dividend_ledger_entries WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM corporate_actions WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM trade_events WHERE account_id = $1", [accountId]);

      // 4. fee_profiles + tax_rules + account_fee_profile_overrides cascade
      // automatically via ON DELETE CASCADE on fee_profiles.account_id.
      await client.query("DELETE FROM accounts WHERE id = $1 AND user_id = $2", [accountId, userId]);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listSoftDeletedAccounts(
    userId: string,
  ): Promise<Array<import("@vakwen/shared-types").AccountDto & { deletedAt: string }>> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      name: string;
      fee_profile_id: string;
      default_currency: import("@vakwen/shared-types").AccountDefaultCurrency;
      account_type: import("@vakwen/shared-types").AccountType;
      deleted_at: Date | string;
    }>(
      `SELECT id, user_id, name, fee_profile_id, default_currency, account_type, deleted_at
       FROM accounts
       WHERE user_id = $1 AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      feeProfileId: row.fee_profile_id,
      defaultCurrency: row.default_currency,
      accountType: row.account_type,
      deletedAt: row.deleted_at instanceof Date
        ? row.deleted_at.toISOString()
        : new Date(row.deleted_at).toISOString(),
    }));
  }

  async getAccountIncludingDeleted(
    accountId: string,
    userId: string,
  ): Promise<
    | (import("@vakwen/shared-types").AccountDto & { deletedAt: string | null })
    | null
  > {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      name: string;
      fee_profile_id: string;
      default_currency: import("@vakwen/shared-types").AccountDefaultCurrency;
      account_type: import("@vakwen/shared-types").AccountType;
      deleted_at: Date | string | null;
    }>(
      `SELECT id, user_id, name, fee_profile_id, default_currency, account_type, deleted_at
       FROM accounts
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      feeProfileId: row.fee_profile_id,
      defaultCurrency: row.default_currency,
      accountType: row.account_type,
      deletedAt: row.deleted_at === null
        ? null
        : row.deleted_at instanceof Date
          ? row.deleted_at.toISOString()
          : new Date(row.deleted_at).toISOString(),
    };
  }

  async selectAccountsForHardPurge(
    graceDays: number,
  ): Promise<Array<{ accountId: string; userId: string }>> {
    // graceDays is admin-tunable via app_config.account_hard_purge_days; the
    // cron worker reads it AT TICK TIME and passes it in here. Parameterize
    // the interval with `make_interval(days => $1)` (NOT string concatenation)
    // to keep this query SQL-injection-safe.
    const result = await this.pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM accounts
       WHERE deleted_at IS NOT NULL
         AND deleted_at < NOW() - make_interval(days => $1)
       ORDER BY deleted_at ASC`,
      [graceDays],
    );
    return result.rows.map((row) => ({ accountId: row.id, userId: row.user_id }));
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

  // ── Provider health (KZO-177) ─────────────────────────────────────────────

  async getProviderHealthStatus(providerId: string): Promise<ProviderHealthRow | null> {
    const result = await this.pool.query<ProviderHealthRowSql>(
      `SELECT provider_id,
              status,
              last_successful_run,
              last_failed_run,
              last_error_message,
              last_down_notification_at,
              last_manual_rerun_at,
              updated_at
         FROM market_data.provider_health_status
         WHERE provider_id = $1`,
      [providerId],
    );
    return result.rows[0] ? mapProviderHealthRow(result.rows[0]) : null;
  }

  async getAllProviderHealthStatuses(): Promise<ProviderHealthRow[]> {
    const result = await this.pool.query<ProviderHealthRowSql>(
      `SELECT provider_id,
              status,
              last_successful_run,
              last_failed_run,
              last_error_message,
              last_down_notification_at,
              last_manual_rerun_at,
              updated_at
         FROM market_data.provider_health_status
         ORDER BY provider_id ASC`,
    );
    return result.rows.map(mapProviderHealthRow);
  }

  async upsertProviderHealthStatus(patch: ProviderHealthUpsert): Promise<ProviderHealthRow> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (patch.status !== undefined) { sets.push(`status = $${i++}`); params.push(patch.status); }
    if (patch.lastSuccessfulRun !== undefined) {
      sets.push(`last_successful_run = $${i++}`);
      params.push(patch.lastSuccessfulRun);
    }
    if (patch.lastFailedRun !== undefined) {
      sets.push(`last_failed_run = $${i++}`);
      params.push(patch.lastFailedRun);
    }
    if (patch.lastErrorMessage !== undefined) {
      sets.push(`last_error_message = $${i++}`);
      params.push(patch.lastErrorMessage);
    }
    if (patch.lastDownNotificationAt !== undefined) {
      sets.push(`last_down_notification_at = $${i++}`);
      params.push(patch.lastDownNotificationAt);
    }
    if (patch.lastManualRerunAt !== undefined) {
      sets.push(`last_manual_rerun_at = $${i++}`);
      params.push(patch.lastManualRerunAt);
    }
    sets.push(`updated_at = NOW()`);
    params.push(patch.providerId);
    const sql = `UPDATE market_data.provider_health_status
                 SET ${sets.join(", ")}
                 WHERE provider_id = $${i}
                 RETURNING provider_id, status, last_successful_run, last_failed_run,
                           last_error_message, last_down_notification_at,
                           last_manual_rerun_at, updated_at`;
    const result = await this.pool.query<ProviderHealthRowSql>(sql, params);
    if (result.rows.length === 0) {
      throw new Error(`provider_health_status row missing for providerId=${patch.providerId}`);
    }
    return mapProviderHealthRow(result.rows[0]!);
  }

  async clearProviderDownNotificationCas(
    providerId: string,
    expectedPreviousNotificationAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE market_data.provider_health_status
         SET last_down_notification_at = NULL,
             updated_at = NOW()
         WHERE provider_id = $1
           AND last_down_notification_at = $2`,
      [providerId, expectedPreviousNotificationAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async claimProviderDownNotificationSlot(
    providerId: string,
    suppressionWindowMs: number,
  ): Promise<boolean> {
    // KZO-177 (P2 Fix 5): atomic CAS. Stamp `last_down_notification_at = NOW()`
    // only if no notification has fired inside the suppression window. The
    // `seconds`-based interval keeps the parameter type narrow (bigint) and
    // matches the pattern used by `pruneOldProviderErrorTrail`.
    const seconds = Math.max(0, Math.floor(suppressionWindowMs / 1000));
    const result = await this.pool.query(
      `UPDATE market_data.provider_health_status
         SET last_down_notification_at = NOW(),
             updated_at = NOW()
         WHERE provider_id = $1
           AND (last_down_notification_at IS NULL
                OR last_down_notification_at < NOW() - ($2::bigint || ' seconds')::INTERVAL)`,
      [providerId, seconds],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async insertProviderErrorTrailEntry(
    input: ProviderErrorTrailInput,
  ): Promise<ProviderErrorTrailRow> {
    const result = await this.pool.query<ProviderErrorTrailRowSql>(
      `INSERT INTO market_data.provider_error_trail
         (provider_id, error_class, error_message, context)
         VALUES ($1, $2, $3, $4)
         RETURNING id, provider_id, occurred_at, error_class, error_message, context`,
      [
        input.providerId,
        input.errorClass,
        input.errorMessage ?? null,
        input.context ? JSON.stringify(input.context) : null,
      ],
    );
    const row = mapProviderErrorTrailRow(result.rows[0]!);
    await this.upsertProviderIncident(providerIncidentInputFromErrorTrail(row));
    const unresolvedItem = providerUnresolvedItemInputFromErrorTrail(row);
    if (unresolvedItem) {
      await this.upsertProviderUnresolvedItem(unresolvedItem);
    }
    return row;
  }

  async getRecentProviderErrors(
    providerId: string,
    limit: number,
  ): Promise<ProviderErrorTrailRow[]> {
    const result = await this.pool.query<ProviderErrorTrailRowSql>(
      `SELECT id, provider_id, occurred_at, error_class, error_message, context
         FROM market_data.provider_error_trail
         WHERE provider_id = $1
         ORDER BY occurred_at DESC
         LIMIT $2`,
      [providerId, Math.max(0, limit)],
    );
    return result.rows.map(mapProviderErrorTrailRow);
  }

  async computeErrorCount24h(providerId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_error_trail
         WHERE provider_id = $1
           AND error_class <> 'rate_limit'
           AND occurred_at >= NOW() - INTERVAL '24 hours'`,
      [providerId],
    );
    return parseInt(result.rows[0]!.count, 10);
  }

  async computeErrorCount7d(providerId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_error_trail
         WHERE provider_id = $1
           AND error_class <> 'rate_limit'
           AND occurred_at >= NOW() - INTERVAL '7 days'`,
      [providerId],
    );
    return parseInt(result.rows[0]!.count, 10);
  }

  async computeRateLimitCount24h(providerId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_error_trail
         WHERE provider_id = $1
           AND error_class = 'rate_limit'
           AND occurred_at >= NOW() - INTERVAL '24 hours'`,
      [providerId],
    );
    return parseInt(result.rows[0]!.count, 10);
  }

  async pruneOldProviderErrorTrail(olderThanDays: number): Promise<number> {
    const seconds = Math.max(0, Math.floor(olderThanDays * 24 * 60 * 60));
    const result = await this.pool.query(
      `DELETE FROM market_data.provider_error_trail
         WHERE occurred_at < NOW() - ($1::bigint || ' seconds')::INTERVAL`,
      [seconds],
    );
    return result.rowCount ?? 0;
  }

  async listProviderErrorTrailPage(
    options: ListProviderErrorTrailOptions,
  ): Promise<ListProviderErrorTrailResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (options.providerId) {
      where.push(`e.provider_id = $${i++}`);
      params.push(options.providerId);
    }
    if (options.marketCode) {
      where.push(`COALESCE(e.context->>'marketCode', '') = $${i++}`);
      params.push(options.marketCode);
    }
    if (options.errorMessageLike) {
      where.push(`COALESCE(e.error_message, '') ILIKE $${i++}`);
      params.push(`%${options.errorMessageLike}%`);
    }
    if (options.excludeResolvedMappings && options.providerId && options.marketCode) {
      where.push(`
        NOT EXISTS (
          SELECT 1
            FROM market_data.provider_resolution_mappings prm
           WHERE prm.provider_id = e.provider_id
             AND prm.market_code = $${i++}
             AND prm.source_symbol = UPPER(TRIM(COALESCE(
               e.context->>'ticker',
               e.context->>'symbol',
               regexp_replace(COALESCE(e.error_message, ''), '^.*: ', '')
             )))
        )`);
      params.push(options.marketCode);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_error_trail e
         ${whereClause}`,
      params,
    );
    const rowsResult = await this.pool.query<ProviderErrorTrailRowSql>(
      `SELECT e.id, e.provider_id, e.occurred_at, e.error_class, e.error_message, e.context
         FROM market_data.provider_error_trail e
         ${whereClause}
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT $${i++}
         OFFSET $${i++}`,
      [...params, limit, offset],
    );

    return {
      items: rowsResult.rows.map(mapProviderErrorTrailRow),
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async upsertProviderIncident(input: UpsertProviderIncidentInput): Promise<ProviderIncidentRecord> {
    const result = await this.pool.query<ProviderIncidentRowSql>(
      `INSERT INTO market_data.provider_incidents
         (provider_id, market_code, incident_key, severity, title, summary, error_class, error_code,
          last_error_trail_id, linked_operation_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (provider_id, incident_key) DO UPDATE
       SET market_code = COALESCE(EXCLUDED.market_code, market_data.provider_incidents.market_code),
           status = 'open',
           severity = EXCLUDED.severity,
           title = EXCLUDED.title,
           summary = COALESCE(EXCLUDED.summary, market_data.provider_incidents.summary),
           error_class = EXCLUDED.error_class,
           error_code = COALESCE(EXCLUDED.error_code, market_data.provider_incidents.error_code),
           occurrence_count = market_data.provider_incidents.occurrence_count + 1,
           last_seen_at = NOW(),
           last_error_trail_id = COALESCE(EXCLUDED.last_error_trail_id, market_data.provider_incidents.last_error_trail_id),
           linked_operation_id = COALESCE(EXCLUDED.linked_operation_id, market_data.provider_incidents.linked_operation_id),
           metadata = COALESCE(market_data.provider_incidents.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
           acknowledged_at = NULL,
           acknowledged_by_user_id = NULL,
           resolved_at = NULL,
           resolved_by_user_id = NULL,
           ignored_at = NULL,
           ignored_by_user_id = NULL,
           updated_at = NOW()
       RETURNING id, provider_id, market_code, incident_key, status, severity, title, summary,
                 error_class, error_code, occurrence_count, first_seen_at, last_seen_at,
                 last_error_trail_id, linked_operation_id, metadata,
                 acknowledged_at, acknowledged_by_user_id, resolved_at, resolved_by_user_id,
                 ignored_at, ignored_by_user_id, created_at, updated_at`,
      [
        input.providerId,
        input.marketCode ?? null,
        input.incidentKey,
        input.severity ?? "warning",
        input.title,
        input.summary ?? null,
        input.errorClass,
        input.errorCode ?? null,
        input.lastErrorTrailId ?? null,
        input.linkedOperationId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapProviderIncidentRow(result.rows[0]!);
  }

  async listProviderIncidents(options: ListProviderIncidentsOptions): Promise<ListProviderIncidentsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (options.providerId) {
      where.push(`provider_id = $${i++}`);
      params.push(options.providerId);
    }
    if (options.marketCode) {
      where.push(`market_code = $${i++}`);
      params.push(options.marketCode);
    }
    if (options.status) {
      where.push(`status = $${i++}`);
      params.push(options.status);
    }
    if (options.search?.trim()) {
      where.push(`(title ILIKE $${i} OR COALESCE(summary, '') ILIKE $${i} OR COALESCE(error_code, '') ILIKE $${i} OR incident_key ILIKE $${i})`);
      params.push(`%${options.search.trim()}%`);
      i++;
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_incidents
         ${whereClause}`,
      params,
    );
    const rowsResult = await this.pool.query<ProviderIncidentRowSql>(
      `SELECT id, provider_id, market_code, incident_key, status, severity, title, summary,
              error_class, error_code, occurrence_count, first_seen_at, last_seen_at,
              last_error_trail_id, linked_operation_id, metadata,
              acknowledged_at, acknowledged_by_user_id, resolved_at, resolved_by_user_id,
              ignored_at, ignored_by_user_id, created_at, updated_at
         FROM market_data.provider_incidents
         ${whereClause}
         ORDER BY last_seen_at DESC
         LIMIT $${i++}
         OFFSET $${i++}`,
      [...params, limit, offset],
    );
    return {
      items: rowsResult.rows.map(mapProviderIncidentRow),
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async updateProviderIncidentStatus(input: UpdateProviderIncidentStatusInput): Promise<ProviderIncidentRecord> {
    const result = await this.pool.query<ProviderIncidentRowSql>(
      `UPDATE market_data.provider_incidents
          SET status = $3,
              acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN NOW() WHEN $3 = 'open' THEN NULL ELSE acknowledged_at END,
              acknowledged_by_user_id = CASE WHEN $3 = 'acknowledged' THEN $4 WHEN $3 = 'open' THEN NULL ELSE acknowledged_by_user_id END,
              resolved_at = CASE WHEN $3 = 'resolved' THEN NOW() WHEN $3 = 'open' THEN NULL ELSE resolved_at END,
              resolved_by_user_id = CASE WHEN $3 = 'resolved' THEN $4 WHEN $3 = 'open' THEN NULL ELSE resolved_by_user_id END,
              ignored_at = CASE WHEN $3 = 'ignored' THEN NOW() WHEN $3 = 'open' THEN NULL ELSE ignored_at END,
              ignored_by_user_id = CASE WHEN $3 = 'ignored' THEN $4 WHEN $3 = 'open' THEN NULL ELSE ignored_by_user_id END,
              updated_at = NOW()
        WHERE provider_id = $1
          AND id = $2
        RETURNING id, provider_id, market_code, incident_key, status, severity, title, summary,
                  error_class, error_code, occurrence_count, first_seen_at, last_seen_at,
                  last_error_trail_id, linked_operation_id, metadata,
                  acknowledged_at, acknowledged_by_user_id, resolved_at, resolved_by_user_id,
                  ignored_at, ignored_by_user_id, created_at, updated_at`,
      [input.providerId, input.incidentId, input.status, input.actorUserId],
    );
    if (!result.rows[0]) throw routeError(404, "provider_incident_not_found", "Provider incident not found");
    return mapProviderIncidentRow(result.rows[0]);
  }

  async upsertProviderUnresolvedItem(input: UpsertProviderUnresolvedItemInput): Promise<ProviderUnresolvedItemRecord> {
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const result = await this.pool.query<ProviderUnresolvedItemRowSql>(
      `INSERT INTO market_data.provider_unresolved_items
         (provider_id, market_code, error_code, source_symbol, provider_symbol, severity, last_error_trail_id, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider_id, market_code, error_code, source_symbol) DO UPDATE
       SET provider_symbol = COALESCE(EXCLUDED.provider_symbol, market_data.provider_unresolved_items.provider_symbol),
           state = 'active',
           severity = EXCLUDED.severity,
           occurrence_count = market_data.provider_unresolved_items.occurrence_count + 1,
           last_seen_at = NOW(),
           last_error_trail_id = COALESCE(EXCLUDED.last_error_trail_id, market_data.provider_unresolved_items.last_error_trail_id),
           evidence = COALESCE(market_data.provider_unresolved_items.evidence, '{}'::jsonb) || COALESCE(EXCLUDED.evidence, '{}'::jsonb),
           resolved_at = NULL,
           resolved_by_operation_id = NULL,
           updated_at = NOW()
       RETURNING provider_id, market_code, error_code, source_symbol, provider_symbol, state, severity,
                 occurrence_count, first_seen_at, last_seen_at, last_error_trail_id, evidence,
                 resolved_at, resolved_by_operation_id, updated_at`,
      [
        input.providerId,
        input.marketCode,
        input.errorCode,
        sourceSymbol,
        input.providerSymbol ?? sourceSymbol,
        input.severity ?? "warning",
        input.lastErrorTrailId ?? null,
        input.evidence ? JSON.stringify(input.evidence) : null,
      ],
    );
    return mapProviderUnresolvedItemRow(result.rows[0]!);
  }

  async listProviderUnresolvedItems(
    options: ListProviderUnresolvedItemsOptions,
  ): Promise<ListProviderUnresolvedItemsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (options.providerId) {
      where.push(`provider_id = $${i++}`);
      params.push(options.providerId);
    }
    if (options.marketCode) {
      where.push(`market_code = $${i++}`);
      params.push(options.marketCode);
    }
    if (options.state && options.state !== "all") {
      where.push(`state = $${i++}`);
      params.push(options.state);
    }
    if (options.errorCode) {
      where.push(`error_code = $${i++}`);
      params.push(options.errorCode);
    }
    if (options.search?.trim()) {
      where.push(`(source_symbol ILIKE $${i} OR COALESCE(provider_symbol, '') ILIKE $${i} OR error_code ILIKE $${i})`);
      params.push(`%${options.search.trim()}%`);
      i++;
    }
    const orderBy =
      options.sort === "updated_desc"
        ? "updated_at DESC"
        : options.sort === "source_symbol_asc"
          ? "source_symbol ASC"
          : options.sort === "occurrence_count_desc"
            ? "occurrence_count DESC, last_seen_at DESC"
            : "last_seen_at DESC";
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_unresolved_items
         ${whereClause}`,
      params,
    );
    const rowsResult = await this.pool.query<ProviderUnresolvedItemRowSql>(
      `SELECT provider_id, market_code, error_code, source_symbol, provider_symbol, state, severity,
              occurrence_count, first_seen_at, last_seen_at, last_error_trail_id, evidence,
              resolved_at, resolved_by_operation_id, updated_at
         FROM market_data.provider_unresolved_items
         ${whereClause}
         ORDER BY ${orderBy}
         LIMIT $${i++}
         OFFSET $${i++}`,
      [...params, limit, offset],
    );
    return {
      items: rowsResult.rows.map(mapProviderUnresolvedItemRow),
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async resolveProviderUnresolvedItems(input: ResolveProviderUnresolvedItemsInput): Promise<number> {
    const marketCodes = input.items.map((item) => item.marketCode).filter(Boolean);
    const errorCodes = input.items.map((item) => item.errorCode.trim()).filter(Boolean);
    const sourceSymbols = input.items.map((item) => item.sourceSymbol.trim().toUpperCase()).filter(Boolean);
    if (marketCodes.length === 0 || sourceSymbols.length === 0 || errorCodes.length === 0) return 0;
    const result = await this.pool.query(
      `UPDATE market_data.provider_unresolved_items
          SET state = 'resolved',
              resolved_at = NOW(),
              resolved_by_operation_id = $6,
              updated_at = NOW()
        WHERE provider_id = $1
          AND market_code = $2
          AND (market_code, error_code, source_symbol) IN (
            SELECT * FROM UNNEST($3::text[], $4::text[], $5::text[])
          )
          AND state = 'active'`,
      [input.providerId, input.marketCode, marketCodes, errorCodes, sourceSymbols, input.operationId ?? null],
    );
    return result.rowCount ?? 0;
  }

  async updateProviderUnresolvedItemState(
    input: UpdateProviderUnresolvedItemStateInput,
  ): Promise<ProviderUnresolvedItemRecord> {
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const now = new Date().toISOString();
    const stateChange = {
      state: input.state,
      reason: input.reason ?? null,
      actorUserId: input.actorUserId ?? null,
      changedAt: now,
    };
    const result = await this.pool.query<ProviderUnresolvedItemRowSql>(
      `UPDATE market_data.provider_unresolved_items
          SET state = $5,
              evidence = COALESCE(evidence, '{}'::jsonb) || $6::jsonb,
              resolved_at = CASE WHEN $5 = 'resolved' THEN $7::timestamptz ELSE NULL END,
              resolved_by_operation_id = CASE WHEN $5 = 'active' THEN NULL ELSE resolved_by_operation_id END,
              updated_at = NOW()
        WHERE provider_id = $1
          AND market_code = $2
          AND error_code = $3
          AND source_symbol = $4
        RETURNING provider_id, market_code, error_code, source_symbol, provider_symbol, state, severity,
                  occurrence_count, first_seen_at, last_seen_at, last_error_trail_id, evidence,
                  resolved_at, resolved_by_operation_id, updated_at`,
      [
        input.providerId,
        input.marketCode,
        input.errorCode,
        sourceSymbol,
        input.state,
        JSON.stringify({ stateChange }),
        now,
      ],
    );
    if (!result.rows[0]) throw routeError(404, "provider_unresolved_item_not_found", "provider unresolved item not found");
    return mapProviderUnresolvedItemRow(result.rows[0]);
  }

  async createProviderOperation(input: CreateProviderOperationInput): Promise<ProviderOperationRecord> {
    const id = input.id ?? randomUUID();
    const result = await this.pool.query<ProviderOperationRowSql>(
      `INSERT INTO market_data.provider_operations
         (id, provider_id, market_code, operation_type, phase, error_code, resolver_mode, scope_query,
          snapshot_hash, preview_token_hash, preview_expires_at, match_count, sample, metadata,
          legacy_batch_id, actor_user_id, started_at, completed_at, cancelled_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13::jsonb, $14::jsonb,
          $15, $16, $17, $18, $19)
       RETURNING id, provider_id, market_code, operation_type, phase, error_code, resolver_mode, scope_query,
                 snapshot_hash, preview_token_hash, preview_expires_at, match_count, sample, metadata,
                 legacy_batch_id, actor_user_id, started_at, completed_at, cancelled_at, created_at, updated_at`,
      [
        id,
        input.providerId,
        input.marketCode,
        input.operationType,
        input.phase,
        input.errorCode ?? null,
        input.resolverMode ?? null,
        input.scopeQuery ?? null,
        input.snapshotHash ?? null,
        input.previewTokenHash ?? null,
        input.previewExpiresAt ?? null,
        input.matchCount ?? null,
        input.sample ? JSON.stringify(input.sample) : null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.legacyBatchId ?? null,
        input.actorUserId ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.cancelledAt ?? null,
      ],
    );
    return mapProviderOperationRow(result.rows[0]!);
  }

  async updateProviderOperation(input: UpdateProviderOperationInput): Promise<ProviderOperationRecord> {
    const sets: string[] = [];
    const params: unknown[] = [input.id];
    let i = 2;
    if (input.phase !== undefined) {
      sets.push(`phase = $${i++}`);
      params.push(input.phase);
    }
    if (input.errorCode !== undefined) {
      sets.push(`error_code = $${i++}`);
      params.push(input.errorCode);
    }
    if (input.resolverMode !== undefined) {
      sets.push(`resolver_mode = $${i++}`);
      params.push(input.resolverMode);
    }
    if (input.scopeQuery !== undefined) {
      sets.push(`scope_query = $${i++}`);
      params.push(input.scopeQuery);
    }
    if (input.snapshotHash !== undefined) {
      sets.push(`snapshot_hash = $${i++}`);
      params.push(input.snapshotHash);
    }
    if (input.previewTokenHash !== undefined) {
      sets.push(`preview_token_hash = $${i++}`);
      params.push(input.previewTokenHash);
    }
    if (input.previewExpiresAt !== undefined) {
      sets.push(`preview_expires_at = $${i++}`);
      params.push(input.previewExpiresAt);
    }
    if (input.matchCount !== undefined) {
      sets.push(`match_count = $${i++}`);
      params.push(input.matchCount);
    }
    if (input.sample !== undefined) {
      sets.push(`sample = $${i++}::jsonb`);
      params.push(input.sample ? JSON.stringify(input.sample) : null);
    }
    if (input.metadata !== undefined) {
      sets.push(`metadata = $${i++}::jsonb`);
      params.push(input.metadata ? JSON.stringify(input.metadata) : null);
    }
    if (input.legacyBatchId !== undefined) {
      sets.push(`legacy_batch_id = $${i++}`);
      params.push(input.legacyBatchId);
    }
    if (input.actorUserId !== undefined) {
      sets.push(`actor_user_id = $${i++}`);
      params.push(input.actorUserId);
    }
    if (input.startedAt !== undefined) {
      sets.push(`started_at = $${i++}`);
      params.push(input.startedAt);
    }
    if (input.completedAt !== undefined) {
      sets.push(`completed_at = $${i++}`);
      params.push(input.completedAt);
    }
    if (input.cancelledAt !== undefined) {
      sets.push(`cancelled_at = $${i++}`);
      params.push(input.cancelledAt);
    }
    if (sets.length === 0) {
      const existing = await this.getProviderOperation(input.id);
      if (!existing) throw new Error(`provider_operation_not_found: ${input.id}`);
      return existing;
    }
    sets.push(`updated_at = NOW()`);
    const result = await this.pool.query<ProviderOperationRowSql>(
      `UPDATE market_data.provider_operations
          SET ${sets.join(", ")}
        WHERE id = $1
        RETURNING id, provider_id, market_code, operation_type, phase, error_code, resolver_mode, scope_query,
                  snapshot_hash, preview_token_hash, preview_expires_at, match_count, sample, metadata,
                  legacy_batch_id, actor_user_id, started_at, completed_at, cancelled_at, created_at, updated_at`,
      params,
    );
    if (!result.rows[0]) throw new Error(`provider_operation_not_found: ${input.id}`);
    return mapProviderOperationRow(result.rows[0]);
  }

  async getProviderOperation(id: string): Promise<ProviderOperationRecord | null> {
    const result = await this.pool.query<ProviderOperationRowSql>(
      `SELECT id, provider_id, market_code, operation_type, phase, error_code, resolver_mode, scope_query,
              snapshot_hash, preview_token_hash, preview_expires_at, match_count, sample, metadata,
              legacy_batch_id, actor_user_id, started_at, completed_at, cancelled_at, created_at, updated_at
         FROM market_data.provider_operations
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapProviderOperationRow(result.rows[0]) : null;
  }

  async listProviderOperations(
    options: ListProviderOperationsOptions,
  ): Promise<ListProviderOperationsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (options.providerId) {
      where.push(`provider_id = $${i++}`);
      params.push(options.providerId);
    }
    if (options.marketCode) {
      where.push(`market_code = $${i++}`);
      params.push(options.marketCode);
    }
    if (options.phases && options.phases.length > 0) {
      where.push(`phase = ANY($${i++}::text[])`);
      params.push(options.phases);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_operations
         ${whereClause}`,
      params,
    );
    const rowsResult = await this.pool.query<ProviderOperationRowSql>(
      `SELECT id, provider_id, market_code, operation_type, phase, error_code, resolver_mode, scope_query,
              snapshot_hash, preview_token_hash, preview_expires_at, match_count, sample, metadata,
              legacy_batch_id, actor_user_id, started_at, completed_at, cancelled_at, created_at, updated_at
         FROM market_data.provider_operations
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${i++}
         OFFSET $${i++}`,
      [...params, limit, offset],
    );
    const rows = rowsResult.rows.map(mapProviderOperationRow);
    if (options.includeOperationId && !rows.some((row) => row.id === options.includeOperationId)) {
      const selected = await this.getProviderOperation(options.includeOperationId);
      if (
        selected
        && (!options.providerId || selected.providerId === options.providerId)
        && (!options.marketCode || selected.marketCode === options.marketCode)
        && (!options.phases || options.phases.length === 0 || options.phases.includes(selected.phase))
      ) {
        rows.push(selected);
      }
    }
    return {
      items: rows,
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async hasActiveProviderExecution(providerId: string, marketCode: MarketCode): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
           FROM market_data.provider_operations
          WHERE provider_id = $1
            AND market_code = $2
            AND phase IN ('preparing_preview', 'preview', 'staged', 'queued', 'running', 'paused')
       ) AS exists`,
      [providerId, marketCode],
    );
    return result.rows[0]?.exists === true;
  }

  async createProviderOperationLog(input: CreateProviderOperationLogInput): Promise<ProviderOperationLogRecord> {
    const result = await this.pool.query<ProviderOperationLogRowSql>(
      `INSERT INTO market_data.provider_operation_logs
         (operation_id, phase, level, message, context)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, operation_id, phase, level, message, context, created_at`,
      [input.operationId, input.phase, input.level, input.message, input.context ? JSON.stringify(input.context) : null],
    );
    return mapProviderOperationLogRow(result.rows[0]!);
  }

  async listProviderOperationLogs(
    options: ListProviderOperationLogsOptions,
  ): Promise<ListProviderOperationLogsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_operation_logs
        WHERE operation_id = $1`,
      [options.operationId],
    );
    const rowsResult = await this.pool.query<ProviderOperationLogRowSql>(
      `SELECT id, operation_id, phase, level, message, context, created_at
         FROM market_data.provider_operation_logs
        WHERE operation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3`,
      [options.operationId, limit, offset],
    );
    return {
      items: rowsResult.rows.map(mapProviderOperationLogRow),
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async countProviderLogsForPurge(providerId: string): Promise<ProviderLogPurgeCounts> {
    const [errorTrailResult, operationLogResult] = await Promise.all([
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM market_data.provider_error_trail
          WHERE provider_id = $1`,
        [providerId],
      ),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM market_data.provider_operation_logs l
           JOIN market_data.provider_operations o ON o.id = l.operation_id
          WHERE o.provider_id = $1`,
        [providerId],
      ),
    ]);
    return {
      providerId,
      errorTrailCount: parseInt(errorTrailResult.rows[0]?.count ?? "0", 10),
      operationLogCount: parseInt(operationLogResult.rows[0]?.count ?? "0", 10),
    };
  }

  async purgeProviderLogs(providerId: string): Promise<ProviderLogPurgeCounts> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const errorTrailResult = await client.query(
        `DELETE FROM market_data.provider_error_trail
          WHERE provider_id = $1`,
        [providerId],
      );
      const operationLogResult = await client.query(
        `DELETE FROM market_data.provider_operation_logs l
          USING market_data.provider_operations o
         WHERE o.id = l.operation_id
           AND o.provider_id = $1`,
        [providerId],
      );
      await client.query("COMMIT");
      return {
        providerId,
        errorTrailCount: errorTrailResult.rowCount ?? 0,
        operationLogCount: operationLogResult.rowCount ?? 0,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async upsertProviderOperationOutcome(
    input: UpsertProviderOperationOutcomeInput,
  ): Promise<ProviderOperationOutcomeRecord> {
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const result = await this.pool.query<ProviderOperationOutcomeRowSql>(
      `INSERT INTO market_data.provider_operation_outcomes
         (operation_id, provider_id, market_code, source_symbol, provider_symbol, action, state,
          message, error_code, job_id, evidence, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
       ON CONFLICT (operation_id, action, source_symbol) DO UPDATE
       SET provider_symbol = COALESCE(EXCLUDED.provider_symbol, market_data.provider_operation_outcomes.provider_symbol),
           state = EXCLUDED.state,
           message = COALESCE(EXCLUDED.message, market_data.provider_operation_outcomes.message),
           error_code = COALESCE(EXCLUDED.error_code, market_data.provider_operation_outcomes.error_code),
           job_id = COALESCE(EXCLUDED.job_id, market_data.provider_operation_outcomes.job_id),
           evidence = COALESCE(market_data.provider_operation_outcomes.evidence, '{}'::jsonb) || COALESCE(EXCLUDED.evidence, '{}'::jsonb),
           started_at = COALESCE(EXCLUDED.started_at, market_data.provider_operation_outcomes.started_at),
           completed_at = COALESCE(EXCLUDED.completed_at, market_data.provider_operation_outcomes.completed_at),
           updated_at = NOW()
       RETURNING operation_id, provider_id, market_code, source_symbol, provider_symbol, action, state,
                 message, error_code, job_id, evidence, started_at, completed_at, created_at, updated_at`,
      [
        input.operationId,
        input.providerId,
        input.marketCode,
        sourceSymbol,
        input.providerSymbol ?? null,
        input.action,
        input.state,
        input.message ?? null,
        input.errorCode ?? null,
        input.jobId ?? null,
        input.evidence ? JSON.stringify(input.evidence) : null,
        input.startedAt ?? (input.state === "running" ? new Date().toISOString() : null),
        input.completedAt ?? (["succeeded", "failed", "skipped", "rate_limited", "cancelled"].includes(input.state) ? new Date().toISOString() : null),
      ],
    );
    return mapProviderOperationOutcomeRow(result.rows[0]!);
  }

  async listProviderOperationOutcomes(
    options: ListProviderOperationOutcomesOptions,
  ): Promise<ListProviderOperationOutcomesResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const params: unknown[] = [options.operationId];
    const where: string[] = ["operation_id = $1"];
    let i = 2;
    if (options.state) {
      where.push(`state = $${i++}`);
      params.push(options.state);
    }
    if (options.action) {
      where.push(`action = $${i++}`);
      params.push(options.action);
    }
    const whereClause = where.join(" AND ");
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_operation_outcomes
        WHERE ${whereClause}`,
      params,
    );
    const summaryResult = await this.pool.query<ProviderOperationOutcomeSummaryRowSql>(
      `SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE state IN ('succeeded', 'failed', 'skipped', 'rate_limited', 'cancelled'))::text AS processed,
          count(*) FILTER (WHERE state = 'pending')::text AS pending,
          count(*) FILTER (WHERE state = 'running')::text AS running,
          count(*) FILTER (WHERE state = 'succeeded')::text AS succeeded,
          count(*) FILTER (WHERE state = 'failed')::text AS failed,
          count(*) FILTER (WHERE state = 'skipped')::text AS skipped,
          count(*) FILTER (WHERE state = 'rate_limited')::text AS rate_limited,
          count(*) FILTER (WHERE state = 'cancelled')::text AS cancelled
         FROM market_data.provider_operation_outcomes
        WHERE operation_id = $1`,
      [options.operationId],
    );
    const rowsResult = await this.pool.query<ProviderOperationOutcomeRowSql>(
      `SELECT operation_id, provider_id, market_code, source_symbol, provider_symbol, action, state,
              message, error_code, job_id, evidence, started_at, completed_at, created_at, updated_at
         FROM market_data.provider_operation_outcomes
        WHERE ${whereClause}
        ORDER BY updated_at DESC
        LIMIT $${i++}
        OFFSET $${i++}`,
      [...params, limit, offset],
    );
    return {
      items: rowsResult.rows.map(mapProviderOperationOutcomeRow),
      summary: mapProviderOperationOutcomeSummary(summaryResult.rows[0]),
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async getProviderResolutionMapping(
    providerId: string,
    marketCode: MarketCode,
    sourceSymbol: string,
  ): Promise<ProviderResolutionMappingRecord | null> {
    const result = await this.pool.query<ProviderResolutionMappingRowSql>(
      `SELECT provider_id, market_code, source_symbol, resolved_symbol, resolver_mode, evidence,
              verified_at, verified_by_user_id, created_at, updated_at
         FROM market_data.provider_resolution_mappings
        WHERE provider_id = $1
          AND market_code = $2
          AND source_symbol = $3`,
      [providerId, marketCode, sourceSymbol.trim().toUpperCase()],
    );
    return result.rows[0] ? mapProviderResolutionMappingRow(result.rows[0]) : null;
  }

  async upsertProviderResolutionMapping(
    input: UpsertProviderResolutionMappingInput,
  ): Promise<ProviderResolutionMappingRecord> {
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const resolvedSymbol = input.resolvedSymbol.trim().toUpperCase();
    const verifiedAt = input.verifiedAt ?? new Date().toISOString();
    const result = await this.pool.query<ProviderResolutionMappingRowSql>(
      `INSERT INTO market_data.provider_resolution_mappings
         (provider_id, market_code, source_symbol, resolved_symbol, resolver_mode, evidence,
          verified_at, verified_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (provider_id, market_code, source_symbol) DO UPDATE SET
         resolved_symbol = EXCLUDED.resolved_symbol,
         resolver_mode = EXCLUDED.resolver_mode,
         evidence = EXCLUDED.evidence,
         verified_at = EXCLUDED.verified_at,
         verified_by_user_id = EXCLUDED.verified_by_user_id,
         updated_at = NOW()
       RETURNING provider_id, market_code, source_symbol, resolved_symbol, resolver_mode, evidence,
                 verified_at, verified_by_user_id, created_at, updated_at`,
      [
        input.providerId,
        input.marketCode,
        sourceSymbol,
        resolvedSymbol,
        input.resolverMode ?? null,
        input.evidence ? JSON.stringify(input.evidence) : null,
        verifiedAt,
        input.verifiedByUserId ?? null,
      ],
    );
    return mapProviderResolutionMappingRow(result.rows[0]!);
  }

  async deleteProviderResolutionMapping(
    input: DeleteProviderResolutionMappingInput,
  ): Promise<ProviderResolutionMappingRecord | null> {
    const result = await this.pool.query<ProviderResolutionMappingRowSql>(
      `DELETE FROM market_data.provider_resolution_mappings
        WHERE provider_id = $1
          AND market_code = $2
          AND source_symbol = $3
        RETURNING provider_id, market_code, source_symbol, resolved_symbol, resolver_mode, evidence,
                  verified_at, verified_by_user_id, created_at, updated_at`,
      [input.providerId, input.marketCode, input.sourceSymbol.trim().toUpperCase()],
    );
    return result.rows[0] ? mapProviderResolutionMappingRow(result.rows[0]) : null;
  }

  async listProviderResolutionMappings(
    options: ListProviderResolutionMappingsOptions,
  ): Promise<ListProviderResolutionMappingsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (options.providerId) {
      where.push(`provider_id = $${i++}`);
      params.push(options.providerId);
    }
    if (options.marketCode) {
      where.push(`market_code = $${i++}`);
      params.push(options.marketCode);
    }
    if (options.search?.trim()) {
      where.push(`(
        source_symbol ILIKE $${i}
        OR resolved_symbol ILIKE $${i}
        OR COALESCE(resolver_mode, '') ILIKE $${i}
        OR COALESCE(evidence::text, '') ILIKE $${i}
      )`);
      params.push(`%${options.search.trim()}%`);
      i++;
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_data.provider_resolution_mappings
         ${whereClause}`,
      params,
    );
    const rowsResult = await this.pool.query<ProviderResolutionMappingRowSql>(
      `SELECT provider_id, market_code, source_symbol, resolved_symbol, resolver_mode, evidence,
              verified_at, verified_by_user_id, created_at, updated_at
         FROM market_data.provider_resolution_mappings
         ${whereClause}
         ORDER BY verified_at DESC
         LIMIT $${i++}
         OFFSET $${i++}`,
      [...params, limit, offset],
    );
    return {
      items: rowsResult.rows.map(mapProviderResolutionMappingRow),
      total: parseInt(countResult.rows[0]?.count ?? "0", 10),
      page,
      limit,
    };
  }

  async listAdminUserIds(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM users
         WHERE role = 'admin'
           AND deactivated_at IS NULL
           AND deleted_at IS NULL`,
    );
    return result.rows.map((r) => r.id);
  }
}

interface ProviderHealthRowSql {
  provider_id: string;
  status: string;
  last_successful_run: string | null;
  last_failed_run: string | null;
  last_error_message: string | null;
  last_down_notification_at: string | null;
  last_manual_rerun_at: string | null;
  updated_at: string;
}

interface ProviderErrorTrailRowSql {
  id: string | number;
  provider_id: string;
  occurred_at: string;
  error_class: string;
  error_message: string | null;
  context: Record<string, unknown> | null;
}

interface ProviderUnresolvedItemRowSql {
  provider_id: string;
  market_code: string;
  error_code: string;
  source_symbol: string;
  provider_symbol: string | null;
  state: string;
  severity: string;
  occurrence_count: number | string;
  first_seen_at: string;
  last_seen_at: string;
  last_error_trail_id: string | number | null;
  evidence: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by_operation_id: string | null;
  updated_at: string;
}

interface ProviderIncidentRowSql {
  id: string;
  provider_id: string;
  market_code: string | null;
  incident_key: string;
  status: string;
  severity: string;
  title: string;
  summary: string | null;
  error_class: string;
  error_code: string | null;
  occurrence_count: number | string;
  first_seen_at: string;
  last_seen_at: string;
  last_error_trail_id: string | number | null;
  linked_operation_id: string | null;
  metadata: Record<string, unknown>;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  ignored_at: string | null;
  ignored_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderOperationRowSql {
  id: string;
  provider_id: string;
  market_code: string;
  operation_type: string;
  phase: string;
  error_code: string | null;
  resolver_mode: string | null;
  scope_query: string | null;
  snapshot_hash: string | null;
  preview_token_hash: string | null;
  preview_expires_at: string | null;
  match_count: number | string | null;
  sample: unknown[] | null;
  metadata: Record<string, unknown> | null;
  legacy_batch_id: string | null;
  actor_user_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderOperationLogRowSql {
  id: string | number;
  operation_id: string;
  phase: string;
  level: string;
  message: string;
  context: Record<string, unknown> | null;
  created_at: string;
}

interface ProviderOperationOutcomeRowSql {
  operation_id: string;
  provider_id: string;
  market_code: string;
  source_symbol: string;
  provider_symbol: string | null;
  action: string;
  state: string;
  message: string | null;
  error_code: string | null;
  job_id: string | null;
  evidence: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderOperationOutcomeSummaryRowSql {
  total: string | null;
  processed: string | null;
  pending: string | null;
  running: string | null;
  succeeded: string | null;
  failed: string | null;
  skipped: string | null;
  rate_limited: string | null;
  cancelled: string | null;
}

interface ProviderResolutionMappingRowSql {
  provider_id: string;
  market_code: string;
  source_symbol: string;
  resolved_symbol: string;
  resolver_mode: string | null;
  evidence: Record<string, unknown> | null;
  verified_at: string;
  verified_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapProviderHealthRow(row: ProviderHealthRowSql): ProviderHealthRow {
  return {
    providerId: row.provider_id,
    status: row.status as ProviderHealthStatus,
    lastSuccessfulRun: row.last_successful_run ? new Date(row.last_successful_run).toISOString() : null,
    lastFailedRun: row.last_failed_run ? new Date(row.last_failed_run).toISOString() : null,
    lastErrorMessage: row.last_error_message,
    lastDownNotificationAt: row.last_down_notification_at
      ? new Date(row.last_down_notification_at).toISOString()
      : null,
    lastManualRerunAt: row.last_manual_rerun_at
      ? new Date(row.last_manual_rerun_at).toISOString()
      : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapProviderErrorTrailRow(row: ProviderErrorTrailRowSql): ProviderErrorTrailRow {
  return {
    id: typeof row.id === "string" ? parseInt(row.id, 10) : row.id,
    providerId: row.provider_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    errorClass: row.error_class as ProviderErrorClass,
    errorMessage: row.error_message,
    context: row.context,
  };
}

function mapProviderUnresolvedItemRow(row: ProviderUnresolvedItemRowSql): ProviderUnresolvedItemRecord {
  return {
    providerId: row.provider_id,
    marketCode: row.market_code as MarketCode,
    errorCode: row.error_code,
    sourceSymbol: row.source_symbol,
    providerSymbol: row.provider_symbol,
    state: row.state as ProviderUnresolvedItemRecord["state"],
    severity: row.severity as ProviderUnresolvedItemRecord["severity"],
    occurrenceCount: Number(row.occurrence_count),
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    lastErrorTrailId: row.last_error_trail_id == null
      ? null
      : typeof row.last_error_trail_id === "string"
        ? parseInt(row.last_error_trail_id, 10)
        : row.last_error_trail_id,
    evidence: row.evidence,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    resolvedByOperationId: row.resolved_by_operation_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapProviderIncidentRow(row: ProviderIncidentRowSql): ProviderIncidentRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    marketCode: row.market_code as ProviderIncidentRecord["marketCode"],
    incidentKey: row.incident_key,
    status: row.status as ProviderIncidentRecord["status"],
    severity: row.severity as ProviderIncidentRecord["severity"],
    title: row.title,
    summary: row.summary,
    errorClass: row.error_class as ProviderErrorClass,
    errorCode: row.error_code,
    occurrenceCount: Number(row.occurrence_count),
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    lastErrorTrailId: row.last_error_trail_id == null
      ? null
      : typeof row.last_error_trail_id === "string"
        ? parseInt(row.last_error_trail_id, 10)
        : row.last_error_trail_id,
    linkedOperationId: row.linked_operation_id,
    metadata: row.metadata,
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
    acknowledgedByUserId: row.acknowledged_by_user_id,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    resolvedByUserId: row.resolved_by_user_id,
    ignoredAt: row.ignored_at ? new Date(row.ignored_at).toISOString() : null,
    ignoredByUserId: row.ignored_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapProviderOperationRow(row: ProviderOperationRowSql): ProviderOperationRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    marketCode: row.market_code as ProviderOperationRecord["marketCode"],
    operationType: row.operation_type,
    phase: row.phase as ProviderOperationPhase,
    errorCode: row.error_code,
    resolverMode: row.resolver_mode as ProviderOperationRecord["resolverMode"],
    scopeQuery: row.scope_query,
    snapshotHash: row.snapshot_hash,
    previewTokenHash: row.preview_token_hash,
    previewExpiresAt: row.preview_expires_at ? new Date(row.preview_expires_at).toISOString() : null,
    matchCount: row.match_count == null ? null : Number(row.match_count),
    sample: row.sample,
    metadata: row.metadata,
    legacyBatchId: row.legacy_batch_id,
    actorUserId: row.actor_user_id,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapProviderOperationLogRow(row: ProviderOperationLogRowSql): ProviderOperationLogRecord {
  return {
    id: typeof row.id === "string" ? parseInt(row.id, 10) : row.id,
    operationId: row.operation_id,
    phase: row.phase as ProviderOperationPhase,
    level: row.level as ProviderOperationLogLevel,
    message: row.message,
    context: row.context,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapProviderOperationOutcomeRow(row: ProviderOperationOutcomeRowSql): ProviderOperationOutcomeRecord {
  return {
    operationId: row.operation_id,
    providerId: row.provider_id,
    marketCode: row.market_code as ProviderOperationOutcomeRecord["marketCode"],
    sourceSymbol: row.source_symbol,
    providerSymbol: row.provider_symbol,
    action: row.action,
    state: row.state as ProviderOperationOutcomeRecord["state"],
    message: row.message,
    errorCode: row.error_code,
    jobId: row.job_id,
    evidence: row.evidence,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapProviderOperationOutcomeSummary(row?: ProviderOperationOutcomeSummaryRowSql): ListProviderOperationOutcomesResult["summary"] {
  const total = parseInt(row?.total ?? "0", 10);
  const processed = parseInt(row?.processed ?? "0", 10);
  return {
    total,
    processed,
    pending: parseInt(row?.pending ?? "0", 10),
    running: parseInt(row?.running ?? "0", 10),
    succeeded: parseInt(row?.succeeded ?? "0", 10),
    failed: parseInt(row?.failed ?? "0", 10),
    skipped: parseInt(row?.skipped ?? "0", 10),
    rateLimited: parseInt(row?.rate_limited ?? "0", 10),
    cancelled: parseInt(row?.cancelled ?? "0", 10),
    progressPercent: total > 0 ? Math.round((processed / total) * 100) : 0,
  };
}

function mapProviderResolutionMappingRow(row: ProviderResolutionMappingRowSql): ProviderResolutionMappingRecord {
  return {
    providerId: row.provider_id,
    marketCode: row.market_code as MarketCode,
    sourceSymbol: row.source_symbol,
    resolvedSymbol: row.resolved_symbol,
    resolverMode: row.resolver_mode as ProviderResolutionMappingRecord["resolverMode"],
    evidence: row.evidence,
    verifiedAt: new Date(row.verified_at).toISOString(),
    verifiedByUserId: row.verified_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// Exported for KZO-179 — POST /accounts uses this in the saveStore catch
// block as the TOCTOU safety net for the per-user account-name unique index
// (`ux_accounts_user_id_name`). Other routes that wrap saveStore in a
// try/catch may also import from here. Internal callers in postgres.ts
// continue to use the same identifier.
export function isUniqueViolation(error: unknown): error is Error & { code: string } {
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

  // KZO-183: profilesById carries the full profile so we can enforce the
  // account-ownership invariant (profile.accountId === account.id) rather
  // than only checking id existence.
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));
  if (profilesById.size === 0) {
    throw new Error("at least one fee profile is required");
  }

  const accountIds = new Set(store.accounts.map((account) => account.id));

  for (const account of store.accounts) {
    if (account.userId !== store.userId) {
      throw new Error(`account ${account.id} belongs to unexpected user`);
    }

    const profile = profilesById.get(account.feeProfileId);
    if (!profile) {
      throw new Error(`account ${account.id} references missing fee profile ${account.feeProfileId}`);
    }
    if (profile.accountId !== account.id) {
      throw new Error(
        `account ${account.id} references fee profile ${profile.id} owned by account ${profile.accountId}`,
      );
    }
  }

  for (const profile of store.feeProfiles) {
    if (!accountIds.has(profile.accountId)) {
      throw new Error(`fee profile ${profile.id} owned by unknown account ${profile.accountId}`);
    }
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
    const bindingProfile = profilesById.get(binding.feeProfileId);
    if (!bindingProfile) {
      throw new Error(`fee profile binding references unknown profile ${binding.feeProfileId}`);
    }
    if (bindingProfile.accountId !== binding.accountId) {
      throw new Error(
        `fee profile binding (${binding.accountId},${binding.ticker}) references profile ${bindingProfile.id} owned by account ${bindingProfile.accountId}`,
      );
    }
    if (!/^[A-Za-z0-9]{1,16}$/.test(binding.ticker)) {
      throw new Error(`fee profile binding has invalid ticker ${binding.ticker}`);
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
    // KZO-169: trade_events.market_code is NOT NULL (migration 012). Strip
    // the legacy `?? "TW"` provider-stamping fallback (G1).
    marketCode: String(row.market_code) as BookedTradeEvent["marketCode"],
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
    // KZO-169: marketCode is required on BookedTradeEvent.
    marketCode: trade.marketCode,
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
  // KZO-183: editable fee_profiles rows carry account_id directly.
  const base = buildFeeProfileFromRow(row, "id", "name", String(row.account_id));
  const taxRules = hydrateTaxRulesFromRows(taxRuleRows, base);
  const legacyTaxFields = projectLegacyFeeProfileTaxFields(taxRules);
  return {
    ...base,
    ...legacyTaxFields,
    taxRules,
  };
}

function hydrateTradeFeeSnapshot(row: Record<string, unknown>, taxRuleRows: Record<string, unknown>[]): FeeProfile {
  // KZO-183: snapshot rows do NOT carry account_id (profile_id_at_booking is
  // intentionally left dangling — see migration 042 header). The owning
  // account is the trade event's own account_id; this row already contains
  // trade_event.account_id from the JOIN in loadStore.
  const base = buildFeeProfileFromRow(
    row,
    "profile_id_at_booking",
    "profile_name_at_booking",
    String(row.account_id),
  );
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
  accountId: string,
): FeeProfile {
  return {
    id: String(row[idKey]),
    accountId,
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
  profile: FeeProfile,
): Promise<void> {
  // KZO-183: fee_profile_tax_rules.user_id was dropped in migration 042.
  // Tax rules cascade through fee_profiles via FK; ownership is implicit
  // through fee_profile_id → fee_profiles.account_id → accounts.user_id.
  const taxRules = materializeFeeProfileTaxRules(profile);
  await client.query(`DELETE FROM fee_profile_tax_rules WHERE fee_profile_id = $1`, [profile.id]);

  for (const rule of taxRules) {
    await client.query(
      `INSERT INTO fee_profile_tax_rules (
         id, fee_profile_id, market_code, trade_side, instrument_type, day_trade_scope,
         tax_component_code, calculation_method, rate_bps, effective_from, effective_to, sort_order
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12
       )`,
      [
        rule.id,
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
  profile: FeeProfile,
): Promise<void> {
  // KZO-183: user_id column dropped from fee_profile_tax_rules in migration
  // 042. Ownership is implicit through fee_profile_id → fee_profiles → accounts.
  const taxRules = materializeFeeProfileTaxRules(profile);

  for (const rule of taxRules) {
    await client.query(
      `INSERT INTO fee_profile_tax_rules (
         id, fee_profile_id, market_code, trade_side, instrument_type, day_trade_scope,
         tax_component_code, calculation_method, rate_bps, effective_from, effective_to, sort_order
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        rule.id,
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

function parseSnapshotContributorKeys(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

function rateOrInverse(directRateText: string | null, inverseRateText: string | null): number | null {
  if (directRateText !== null) return Number(directRateText);
  if (inverseRateText === null) return null;
  const inverseRate = Number(inverseRateText);
  return inverseRate === 0 ? null : 1 / inverseRate;
}
