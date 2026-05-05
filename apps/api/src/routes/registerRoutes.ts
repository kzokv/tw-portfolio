import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { registerSSERoute } from "./sseRoute.js";
import { adminRoutes } from "./adminRoutes.js";
import {
  buildAuthorizationUrl,
  decodeIdTokenPayload,
  exchangeCodeForTokens,
  extractInviteCode,
  extractReturnTo,
  generateState,
  IMPERSONATION_COOKIE_NAME,
  isValidReturnTo,
  refreshAccessToken,
  signImpersonationCookie,
  signSessionCookie,
  verifyImpersonationCookie,
  verifySessionCookie,
  verifyState,
  type GoogleTokenResponse,
  type ImpersonationCookieIdentity,
  type SessionIdentity,
} from "../auth/googleOAuth.js";
import { calculateBuyFees, calculateSellFees, classifyInstrument, roundToDecimal, type FeeProfile } from "@tw-portfolio/domain";
import type { DashboardPerformanceRange, IntegrityIssueDto, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import { dashboardPerformanceRangesSchema, currencyFor, marketCodeFor } from "@tw-portfolio/shared-types";
import { resolveEffectiveRanges, resolveReportingCurrency } from "../services/userPreferences.js";
import {
  translateOverviewSummary,
  translatePerformancePoints,
} from "../services/dashboardReportingCurrency.js";
import type { ImpersonationDto } from "@tw-portfolio/shared-types";
import { Env } from "@tw-portfolio/config";
import type { QuoteSnapshot } from "@tw-portfolio/domain";
import { resolveQuoteSnapshots } from "../services/market-data/quoteSnapshotService.js";
import {
  listCorporateActions,
  listDividendDeductionEntries,
  listDividendLedgerEntries,
  listTradeEvents,
  syncAccountingPolicy,
} from "../services/accountingStore.js";
import { buildDashboardOverview } from "../services/dashboard.js";
import {
  buildDividendEventListItems,
  buildDividendLedgerEntryDetails,
  createDividendEvent,
  postDividend,
  preparePostedCashDividendUpdate,
} from "../services/dividends.js";
import { applyCorporateAction, createTransaction, listHoldings } from "../services/portfolio.js";
import { confirmRecompute, previewRecompute } from "../services/recompute.js";
import { scheduleReplayWithRetry } from "../services/replayPositionHistory.js";
import { generateHoldingSnapshots } from "../services/snapshotGeneration.js";
import { generateCurrencyWalletSnapshots } from "../services/currencyWalletSnapshotGeneration.js";
import {
  createFxTransfer,
  estimateFxTransfer,
  reverseFxTransfer,
  updateFxTransfer,
  type CashBalanceChange,
  type CreateFxTransferResult,
  type ReverseFxTransferResult,
  type UpdateFxTransferResult,
} from "../services/fxTransferService.js";
import { MissingFxRateError } from "../services/currencyWalletAccounting.js";
import { seedDemoTransactions } from "../services/demoData.js";
import { createDefaultFeeProfile, createStore, setStoreInstruments } from "../services/store.js";
import { isUniqueViolation } from "../persistence/postgres.js";
import { ensureInstrumentDefinition, isInstrumentQuoteable, upsertInstrumentDefinitions } from "../services/instrumentRegistry.js";
import { BACKFILL_QUEUE, type BackfillJobData } from "../services/market-data/backfillWorker.js";
import { deriveRepairAvailableAt, getEffectiveRepairCooldownMinutes, remainingCooldownMinutes } from "../services/market-data/repairCooldown.js";
import { RateLimitedError } from "../services/market-data/types.js";
import { upsertDailyBars } from "../services/market-data/upserts.js";
import { routeError } from "../lib/routeError.js";
import {
  requireAdminRole,
  requireShareGrantorRole,
  requireWriteableContext,
  requireWriterRole,
} from "../lib/routeGuards.js";
import type { Store, Transaction } from "../types/store.js";
import type {
  AnonymousShareTokenRecord,
  PendingShareInviteRecord,
  ShareGrantRecord,
  UserRole,
} from "../persistence/types.js";
import {
  ANONYMOUS_SHARE_TOKEN_REGEX,
  generateAnonymousShareToken,
} from "../lib/anonymousShareToken.js";
import { assertInviteStatusRateLimit, registerInviteStatusEviction } from "../lib/inviteStatusRateLimit.js";
import { _resetAnonymousShareRateBuckets, assertAnonymousShareRateLimit, deleteAnonymousShareRateBucket, registerAnonymousShareEviction } from "../lib/anonymousShareRateLimit.js";
import { assertMarketDataPriceRateLimit, registerMarketDataPriceEviction } from "../lib/marketDataPriceRateLimit.js";
import { _resetMarketDataSearchBuckets, assertMarketDataSearchRateLimit, registerMarketDataSearchEviction } from "../lib/marketDataSearchRateLimit.js";
import { buildPublicShareView } from "../services/publicShareView.js";
import type { AccountDto, AnonymousShareTokenDto, AnonymousShareTokenStatus } from "@tw-portfolio/shared-types";
import type { DailyBar, InstrumentType, MarketCode } from "@tw-portfolio/domain";

export const userScopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/);

const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);

// KZO-169: closed-set MarketCode chip ("ALL" not allowed at the route layer —
// transactions must commit to a specific market).
const marketCodeSchema = z.enum(["TW", "US", "AU"]);

const transactionSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  // KZO-169: required body field — every trade pins to (ticker, marketCode).
  // Backfilled to "TW" for legacy fixtures via Slice 12 (G4) audit; new client
  // code path always supplies it (form chip default derived from accounts).
  marketCode: marketCodeSchema,
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive().multipleOf(0.01),
  priceCurrency: currencyCodeSchema.default("TWD"),
  tradeDate: isoDateSchema,
  tradeTimestamp: isoDateTimeSchema.optional(),
  bookingSequence: z.number().int().positive().optional(),
  commissionAmount: z.number().int().nonnegative().optional(),
  taxAmount: z.number().int().nonnegative().optional(),
  type: z.enum(["BUY", "SELL"]),
  isDayTrade: z.boolean().default(false),
});

const feeProfilePayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  boardCommissionRate: z.number().nonnegative(),
  commissionDiscountPercent: z.number().min(0).max(100),
  minimumCommissionAmount: z.number().int().nonnegative(),
  commissionCurrency: currencyCodeSchema.default("TWD"),
  commissionRoundingMode: z.enum(["FLOOR", "ROUND", "CEIL"]),
  taxRoundingMode: z.enum(["FLOOR", "ROUND", "CEIL"]),
  stockSellTaxRateBps: z.number().int().nonnegative(),
  stockDayTradeTaxRateBps: z.number().int().nonnegative(),
  etfSellTaxRateBps: z.number().int().nonnegative(),
  bondEtfSellTaxRateBps: z.number().int().nonnegative(),
  commissionChargeMode: z.enum(["CHARGED_UPFRONT", "CHARGED_UPFRONT_REBATED_LATER"]),
});

// KZO-183: drafts now carry the owning `accountId` discriminator. The
// settings bulk-save validates that every draft.accountId resolves to one of
// the accounts in the body, AND that every account.feeProfileRef resolves
// to a profile owned by that same account.
const feeProfileDraftSchema = feeProfilePayloadSchema
  .extend({
    id: userScopedIdSchema.optional(),
    tempId: userScopedIdSchema.optional(),
    accountId: userScopedIdSchema,
  })
  .refine((value) => Boolean(value.id || value.tempId), {
    message: "id or tempId is required for each fee profile draft",
  });

const feeBindingSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  feeProfileId: userScopedIdSchema,
});

const corporateActionSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  actionType: z.enum(["DIVIDEND", "SPLIT", "REVERSE_SPLIT"]),
  numerator: z.number().int().positive().default(1),
  denominator: z.number().int().positive().default(1),
  actionDate: isoDateSchema,
});

const dividendDeductionSchema = z.object({
  deductionType: z.enum([
    "NHI_SUPPLEMENTAL_PREMIUM",
    "WITHHOLDING_TAX",
    "BROKER_FEE",
    "BANK_FEE",
    "TRANSFER_FEE",
    "CASH_IN_LIEU_ADJUSTMENT",
    "ROUNDING_ADJUSTMENT",
    "OTHER",
  ]),
  amount: z.number().int().positive(),
  currencyCode: currencyCodeSchema.default("TWD"),
  withheldAtSource: z.boolean().default(true),
  source: userScopedIdSchema.default("dividend_posting"),
  sourceReference: userScopedIdSchema.optional(),
  note: z.string().trim().min(1).max(200).optional(),
});

const dividendSourceLineSchema = z.object({
  id: userScopedIdSchema.optional(),
  sourceBucket: z.enum([
    "DIVIDEND_INCOME",
    "INTEREST_INCOME",
    "SECURITIES_GAIN_INCOME",
    "REVENUE_EQUALIZATION",
    "CAPITAL_EQUALIZATION",
    "CAPITAL_RETURN",
    "OTHER",
  ]),
  amount: z.number().positive(),
  currencyCode: z.literal("TWD").default("TWD"),
  source: userScopedIdSchema.default("dividend_posting"),
  sourceReference: userScopedIdSchema.optional(),
  note: z.string().trim().min(1).max(200).optional(),
});

const dividendPostingSchema = z
  .object({
    accountId: userScopedIdSchema,
    dividendEventId: userScopedIdSchema,
    receivedCashAmount: z.number().int().nonnegative().default(0),
    receivedStockQuantity: z.number().int().nonnegative().default(0),
    deductions: z.array(dividendDeductionSchema).max(20).default([]),
    sourceLines: z.array(dividendSourceLineSchema).max(20).default([]),
    sourceCompositionStatus: z.enum(["provided", "unknown_pending_disclosure"]).default("unknown_pending_disclosure"),
    dividendLedgerEntryId: userScopedIdSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dividendLedgerEntryId && value.expectedVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedVersion"],
        message: "expectedVersion is required when dividendLedgerEntryId is present",
      });
    }
    if (!value.dividendLedgerEntryId && value.expectedVersion !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedVersion"],
        message: "expectedVersion is only allowed when editing an existing dividend posting",
      });
    }
  });

const dividendDateRangeQuerySchema = z.object({
  fromPaymentDate: isoDateSchema.optional(),
  toPaymentDate: isoDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(500),
});

// Standalone schema (NOT extending dividendDateRangeQuerySchema) because
// the default limit changes 500 → 50 for paginated dividend ledger listing.
const dividendLedgerQuerySchema = z.object({
  fromPaymentDate: isoDateSchema.optional(),
  toPaymentDate: isoDateSchema.optional(),
  accountId: userScopedIdSchema.optional(),
  reconciliationStatus: z.enum(["open", "matched", "explained", "resolved"]).optional(),
  postingStatus: z.enum(["expected", "posted", "adjusted"]).optional(),
  ticker: tickerSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
  sortBy: z
    .enum([
      "paymentDate",
      "ticker",
      "account",
      "expectedCashAmount",
      "receivedCashAmount",
      "reconciliationStatus",
    ])
    .default("paymentDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const dividendReconciliationSchema = z.object({
  status: z.enum(["open", "matched", "explained", "resolved"]),
  note: z.string().trim().max(500).optional(),
});

const cashLedgerEntryTypes = [
  "TRADE_SETTLEMENT_IN",
  "TRADE_SETTLEMENT_OUT",
  "DIVIDEND_RECEIPT",
  "DIVIDEND_DEDUCTION",
  "MANUAL_ADJUSTMENT",
  "FX_TRANSFER_OUT",
  "FX_TRANSFER_IN",
  "REVERSAL",
] as const;

const cashLedgerQuerySchema = z.object({
  fromEntryDate: isoDateSchema.optional(),
  toEntryDate: isoDateSchema.optional(),
  accountId: userScopedIdSchema.optional(),
  entryType: z.union([
    z.enum(cashLedgerEntryTypes),
    z.array(z.enum(cashLedgerEntryTypes)),
  ]).optional().transform(v => v ? (Array.isArray(v) ? v : [v]) : undefined),
  limit: z.coerce.number().int().positive().max(500).default(50),
  page: z.coerce.number().int().min(1).default(1),
  sortBy: z.enum(["entryDate", "entryType", "amount", "currency", "accountId"]).default("entryDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const fxTransferSchema = z.object({
  fromAccountId: userScopedIdSchema,
  toAccountId: userScopedIdSchema,
  fromAmount: z.number().positive(),
  toAmount: z.number().positive(),
  effectiveRate: z.number().positive(),
  entryDate: isoDateSchema,
  notes: z.string().trim().max(500).optional(),
});

const fxTransferUpdateSchema = z
  .object({
    fromAmount: z.number().positive().optional(),
    toAmount: z.number().positive().optional(),
    effectiveRate: z.number().positive().optional(),
    entryDate: isoDateSchema.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const economicCount = [value.fromAmount, value.toAmount, value.effectiveRate]
      .filter((field) => field !== undefined).length;
    if (economicCount > 0 && economicCount < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveRate"],
        message: "fromAmount, toAmount, and effectiveRate must be provided together",
      });
    }
    if (
      value.fromAmount === undefined &&
      value.toAmount === undefined &&
      value.effectiveRate === undefined &&
      value.entryDate === undefined &&
      value.notes === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one field required",
      });
    }
  });

const fxTransferParamsSchema = z.object({ id: z.string().uuid() });
const fxTransferReverseSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

function buildCookieAttrs(cookieName: string, isProduction: boolean, cookieDomain?: string): string {
  const secure = isProduction || cookieName.startsWith("__Host-");
  // __Host- prefix prohibits Domain attribute per RFC 6265bis; skip it for prefixed names.
  const domain = cookieDomain && !cookieName.startsWith("__Host-") ? `; Domain=${cookieDomain}` : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${domain}`;
}

function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    if (part.slice(0, eqIdx).trim() === cookieName) {
      const value = part.slice(eqIdx + 1).trim();
      return value || null;
    }
  }
  return null;
}

export function sessionClearCookieString(): string {
  const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  return `${Env.SESSION_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
}

export function impersonationClearCookieString(): string {
  const attrs = buildCookieAttrs(IMPERSONATION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  return `${IMPERSONATION_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
}

export function impersonationSetCookieString(cookieValue: string, ttlMinutes: number): string {
  const attrs = buildCookieAttrs(IMPERSONATION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  const maxAgeSeconds = ttlMinutes * 60 + 5 * 60;
  return `${IMPERSONATION_COOKIE_NAME}=${cookieValue}; ${attrs}; Max-Age=${maxAgeSeconds}`;
}

const VALID_USER_ROLES = ["admin", "member", "viewer"] as const;
export const userRoleSchema = z.enum(VALID_USER_ROLES);
const PUBLIC_ROUTE_KEYS = new Set([
  "GET /health/live",
  "GET /health/ready",
  "GET /auth/logout",
  "GET /auth/google/start",
  "GET /auth/google/callback",
  "POST /auth/token/refresh",
  "POST /auth/demo/start",
  "POST /__e2e/oauth-session",
  "POST /__e2e/demo-session",
  "POST /__e2e/impersonation-session",
  "POST /__e2e/reset-demo-rate-buckets",
  "POST /__e2e/reset-market-data-search-rate-limit",
  "POST /__e2e/reset-app-config",
  "POST /__e2e/seed-anonymous-share-token",
  "POST /__e2e/anon-share-rate-reset",
  "POST /__e2e/anon-share-deactivate-owner",
  "GET /invites/:code/status",
  "GET /share/:token",
]);
const WRITER_ROLE_ROUTE_KEYS = new Set([
  "PATCH /settings",
  "PUT /settings/full",
  "PUT /settings/fee-config",
  "PATCH /profile",
  "POST /accounts",
  "PATCH /accounts/:id",
  "POST /fx-transfers",
  "PATCH /fx-transfers/:id",
  "POST /fx-transfers/:id/reverse",
  "POST /fee-profiles",
  "PATCH /fee-profiles/:id",
  "DELETE /fee-profiles/:id",
  "PUT /fee-profile-bindings",
  "POST /portfolio/transactions",
  "DELETE /portfolio/transactions/:tradeEventId",
  "PATCH /portfolio/transactions/:tradeEventId",
  "POST /portfolio/dividends/postings",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
  "POST /corporate-actions",
  "POST /portfolio/snapshots/generate",
  "POST /portfolio/recompute/preview",
  "POST /portfolio/recompute/confirm",
  "POST /ai/transactions/confirm",
  "PUT /monitored-tickers",
  "POST /backfill/retry",
  "POST /backfill/repair",
  "PATCH /notifications/:id/read",
  "PATCH /notifications/read-all",
  "DELETE /notifications/:id",
  "PATCH /notifications/:id/escalate",
]);

/**
 * Routes that mutate the portfolio backing store. When the viewer is in a
 * shared-context session (`isSharedContext=true`) these MUST 403 so the
 * grantee cannot write through to the owner's portfolio.
 *
 * Subset of `WRITER_ROLE_ROUTE_KEYS`. Identity-surface writes
 * (`PATCH /profile`, notification CUD) are intentionally excluded: they act
 * on the session user's own record regardless of viewing context.
 */
const WRITE_CONTEXT_GUARD_ROUTE_KEYS = new Set([
  "PATCH /settings",
  "PUT /settings/full",
  "PUT /settings/fee-config",
  "POST /accounts",
  "PATCH /accounts/:id",
  "POST /fx-transfers",
  "PATCH /fx-transfers/:id",
  "POST /fx-transfers/:id/reverse",
  "POST /fee-profiles",
  "PATCH /fee-profiles/:id",
  "DELETE /fee-profiles/:id",
  "PUT /fee-profile-bindings",
  "POST /portfolio/transactions",
  "DELETE /portfolio/transactions/:tradeEventId",
  "PATCH /portfolio/transactions/:tradeEventId",
  "POST /portfolio/dividends/postings",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
  "POST /corporate-actions",
  "POST /portfolio/snapshots/generate",
  "POST /portfolio/recompute/preview",
  "POST /portfolio/recompute/confirm",
  "POST /ai/transactions/confirm",
  "PUT /monitored-tickers",
  "POST /backfill/retry",
  "POST /backfill/repair",
]);
const ADMIN_ROUTE_KEYS = new Set([
  "POST /invites",
  "DELETE /invites/:code",
  "GET /admin/users",
  "PATCH /admin/users/:id/role",
  "POST /admin/users/:id/disable",
  "POST /admin/users/:id/enable",
  "DELETE /admin/users/:id",
  "DELETE /admin/users/:id/purge",
  "POST /admin/users/:id/impersonate",
  "DELETE /admin/impersonation",
  "GET /admin/invites",
  "GET /admin/audit-log",
  "GET /admin/settings",
  "PATCH /admin/settings",
  // KZO-164: FX rate ingestion admin surface.
  // POST /admin/fx-rates/refresh has a route-local demo-before-admin guard.
  "GET /admin/fx-rates/freshness",
]);
const IMPERSONATION_WRITE_ALLOWLIST = new Set([
  "POST /admin/users/:id/impersonate",
  "DELETE /admin/impersonation",
]);
const IMPERSONATION_BLOCKED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type ResolvedRequestIdentity = {
  sessionUserId: string;
  contextUserId: string;
  role: UserRole;
  sessionVersion: number;
  isDemo: boolean;
  isImpersonating: boolean;
  isSharedContext: boolean;
  email?: string | null;
  impersonation: ImpersonationDto | null;
  userId: string;
};

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function buildShareInviteUrl(app: FastifyInstance, code: string): string {
  return `${app.appBaseUrl}/invite/${code}`;
}

async function materializePendingSharesPostLogin(
  app: FastifyInstance,
  req: FastifyRequest,
  userId: string,
  email: string,
) {
  try {
    const materializedShares = await app.persistence.materializePendingSharesForEmail({
      userId,
      email,
      auditInput: {
        actorUserId: null,
        ipAddress: req.ip,
      },
    });
    for (const share of materializedShares) {
      await app.eventBus.publishEvent(userId, "sharing_notification", { shareId: share.id });
    }
  } catch (error) {
    req.log.warn({ err: error, userId }, "share materialization failed post-login");
  }
}

function toShareGrantDto(record: ShareGrantRecord) {
  return {
    id: record.id,
    status: record.revokedAt ? "revoked" as const : "active" as const,
    ownerUserId: record.ownerUserId,
    ownerEmail: record.ownerEmail,
    ownerDisplayName: record.ownerDisplayName,
    granteeUserId: record.granteeUserId,
    granteeEmail: record.granteeEmail,
    granteeDisplayName: record.granteeDisplayName,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    revokedByUserId: record.revokedByUserId,
  };
}

function toPendingShareInviteDto(
  app: FastifyInstance,
  record: PendingShareInviteRecord,
  status: "pending" | "expired" | "revoked",
) {
  return {
    code: record.code,
    status,
    email: record.email,
    role: record.role,
    shareOwnerUserId: record.shareOwnerUserId,
    ownerEmail: record.ownerEmail,
    ownerDisplayName: record.ownerDisplayName,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    usedAt: record.usedAt,
    inviteUrl: buildShareInviteUrl(app, record.code),
  };
}

function isShareGrantRecord(value: ShareGrantRecord | PendingShareInviteRecord): value is ShareGrantRecord {
  return "granteeUserId" in value;
}

function deriveAnonymousShareTokenStatus(
  record: AnonymousShareTokenRecord,
  now: number = Date.now(),
): AnonymousShareTokenStatus {
  if (record.revokedAt) return "revoked";
  if (Date.parse(record.expiresAt) <= now) return "expired";
  return "active";
}

function toAnonymousShareTokenDto(
  app: FastifyInstance,
  record: AnonymousShareTokenRecord,
  now: number = Date.now(),
): AnonymousShareTokenDto {
  return {
    id: record.id,
    token: record.token,
    url: `${app.appBaseUrl}/share/${record.token}`,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    status: deriveAnonymousShareTokenStatus(record, now),
  };
}

function routeKey(method: string, routeUrl: string): string {
  return `${method.toUpperCase()} ${routeUrl}`;
}

function authRequired(): never {
  throw routeError(401, "auth_required", "authentication required");
}

function markSessionCleanup(req: FastifyRequest): void {
  req.__clearSessionCookie = true;
  req.__clearImpersonationCookie = true;
}

function markImpersonationCleanup(req: FastifyRequest): void {
  req.__clearImpersonationCookie = true;
}

async function appendImpersonationEndAudit(
  app: FastifyInstance,
  req: FastifyRequest,
  input: {
    actorUserId: string;
    targetUserId?: string | null;
    targetEmail?: string | null;
    reason: string;
  },
): Promise<void> {
  await app.persistence.appendAuditLog({
    actorUserId: input.actorUserId,
    action: "impersonation_end",
    targetUserId: input.targetUserId ?? null,
    ipAddress: req.ip,
    metadata: {
      reason: input.reason,
      ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
      ...(input.targetEmail !== undefined ? { targetEmail: input.targetEmail } : {}),
    },
  });
}

async function resolveImpersonationState(
  app: FastifyInstance,
  req: FastifyRequest,
  sessionUserId: string,
): Promise<{ active: false } | { active: true; impersonation: ImpersonationDto }> {
  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  const cookieValue = parseCookieValue(req.headers.cookie, IMPERSONATION_COOKIE_NAME);
  if (!cookieValue) {
    return { active: false };
  }
  if (!sessionSecret) {
    markImpersonationCleanup(req);
    return { active: false };
  }

  const parsed = verifyImpersonationCookie(cookieValue, sessionSecret);
  if (!parsed) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, { actorUserId: sessionUserId, reason: "invalid_hmac" });
    return { active: false };
  }

  return validateResolvedImpersonationState(app, req, sessionUserId, parsed);
}

async function validateResolvedImpersonationState(
  app: FastifyInstance,
  req: FastifyRequest,
  sessionUserId: string,
  parsed: ImpersonationCookieIdentity,
): Promise<{ active: false } | { active: true; impersonation: ImpersonationDto }> {
  if (parsed.adminId !== sessionUserId) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, {
      actorUserId: sessionUserId,
      targetUserId: parsed.targetUserId,
      reason: "session_mismatch",
    });
    return { active: false };
  }

  if (parsed.expiresAtMs <= Date.now()) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, {
      actorUserId: sessionUserId,
      targetUserId: parsed.targetUserId,
      reason: "expired",
    });
    return { active: false };
  }

  const targetUser = await app.persistence.getAuthUserById(parsed.targetUserId);
  if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, {
      actorUserId: sessionUserId,
      targetUserId: parsed.targetUserId,
      targetEmail: targetUser?.email ?? null,
      reason: "target_invalid",
    });
    return { active: false };
  }

  return {
    active: true,
    impersonation: {
      active: true,
      targetUserId: targetUser.userId,
      targetEmail: targetUser.email ?? null,
      expiresAt: new Date(parsed.expiresAtMs).toISOString(),
    },
  };
}

export function parseSessionCookie(cookieHeader: string | undefined, sessionSecret: string | undefined): SessionIdentity | null {
  const value = parseCookieValue(cookieHeader, Env.SESSION_COOKIE_NAME);
  if (!value || !sessionSecret) return null;
  return verifySessionCookie(value, sessionSecret);
}

export function isPublicRoute(method: string, routeUrl: string): boolean {
  return PUBLIC_ROUTE_KEYS.has(routeKey(method, routeUrl));
}

export {
  CONTEXT_COOKIE_NAME,
  CONTEXT_FALLBACK_HEADER,
  CONTEXT_HEADER_NAME,
  contextClearCookieString,
  shouldStampContextFallback,
} from "./contextFallback.js";

import {
  CONTEXT_HEADER_NAME,
  contextClearCookieString,
  markContextFallback,
} from "./contextFallback.js";

async function resolveContextOverride(
  app: FastifyInstance,
  req: FastifyRequest,
  sessionUserId: string,
): Promise<{ contextUserId: string; isSharedContext: boolean }> {
  const raw = req.headers[CONTEXT_HEADER_NAME];
  if (!raw || Array.isArray(raw)) {
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  const parsed = userScopedIdSchema.safeParse(raw);
  if (!parsed.success) {
    markContextFallback(req);
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  const headerUserId = parsed.data;
  if (headerUserId === sessionUserId) {
    markContextFallback(req);
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  const active = await app.persistence.validateActiveShare(headerUserId, sessionUserId);
  if (!active) {
    markContextFallback(req);
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  return { contextUserId: headerUserId, isSharedContext: true };
}

function resolveDevBypassFallback(req: FastifyRequest): ResolvedRequestIdentity {
  const rawUserId = req.headers["x-user-id"];
  const rawRole = req.headers["x-user-role"];
  const sessionUserId = userScopedIdSchema.parse(
    !rawUserId || Array.isArray(rawUserId) ? "user-1" : rawUserId,
  );
  const role = rawRole && !Array.isArray(rawRole) ? userRoleSchema.parse(rawRole) : "admin";
  return {
    sessionUserId,
    contextUserId: sessionUserId,
    role,
    sessionVersion: 1,
    isDemo: false,
    isImpersonating: false,
    isSharedContext: false,
    email: null,
    impersonation: null,
    userId: sessionUserId,
  };
}

export function resolveUserId(req: FastifyRequest, _sessionSecret?: string): ResolvedRequestIdentity {
  if (req.authContext) {
    return {
      ...req.authContext,
      userId: req.authContext.contextUserId,
    };
  }

  if (Env.AUTH_MODE === "dev_bypass") {
    return resolveDevBypassFallback(req);
  }

  authRequired();
}

/**
 * Return the session-owner user id (never the shared-context viewer target).
 * Use this for identity/cross-user endpoints (`/profile`, `/notifications/*`,
 * `/shares`, `/sse`, `/admin/*`, invites, audit-log) that must always act on
 * the authenticated session — not on whichever portfolio the user is viewing.
 */
export function requireSessionUserId(req: FastifyRequest): string {
  if (req.authContext) {
    return req.authContext.sessionUserId;
  }
  if (Env.AUTH_MODE === "dev_bypass") {
    return resolveDevBypassFallback(req).sessionUserId;
  }
  authRequired();
}

async function loadUserStoreForUserId(app: FastifyInstance, userId: string) {
  const store = await app.persistence.loadStore(userId);
  syncAccountingPolicy(store);
  return { userId, store };
}

async function loadUserStore(app: FastifyInstance, req: FastifyRequest) {
  const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  return loadUserStoreForUserId(app, contextUserId);
}

async function resolveCookieBackedAuthContext(
  app: FastifyInstance,
  req: FastifyRequest,
  identity: SessionIdentity,
): Promise<void> {
  const authUser = await app.persistence.getAuthUserById(userScopedIdSchema.parse(identity.userId));
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
    markSessionCleanup(req);
    authRequired();
  }
  if (!identity.isDemo && identity.sessionVersion !== authUser.sessionVersion) {
    markSessionCleanup(req);
    authRequired();
  }
  req.__sessionType = identity.isDemo ? "demo" : "oauth";
  const hadImpersonationCookie = Boolean(parseCookieValue(req.headers.cookie, IMPERSONATION_COOKIE_NAME));
  const impersonation = await resolveImpersonationState(app, req, authUser.userId);
  if (impersonation.active) {
    req.authContext = {
      sessionUserId: authUser.userId,
      contextUserId: impersonation.impersonation.targetUserId,
      role: authUser.role,
      sessionVersion: authUser.sessionVersion,
      isDemo: identity.isDemo,
      isImpersonating: true,
      isSharedContext: false,
      email: authUser.email,
      impersonation: impersonation.impersonation,
    };
    return;
  }
  if (hadImpersonationCookie) {
    req.authContext = {
      sessionUserId: authUser.userId,
      contextUserId: authUser.userId,
      role: authUser.role,
      sessionVersion: authUser.sessionVersion,
      isDemo: identity.isDemo,
      isImpersonating: false,
      isSharedContext: false,
      email: authUser.email,
      impersonation: null,
    };
    return;
  }

  const { contextUserId, isSharedContext } = await resolveContextOverride(app, req, authUser.userId);
  req.authContext = {
    sessionUserId: authUser.userId,
    contextUserId,
    role: authUser.role,
    sessionVersion: authUser.sessionVersion,
    isDemo: identity.isDemo,
    isImpersonating: false,
    isSharedContext,
    email: authUser.email,
    impersonation: null,
  };
}

export async function hydrateAuthContext(app: FastifyInstance, req: FastifyRequest): Promise<void> {
  if (req.authContext) return;

  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  const hasSessionCookie = Boolean(parseCookieValue(req.headers.cookie, Env.SESSION_COOKIE_NAME));
  const cookieIdentity = parseSessionCookie(req.headers.cookie, sessionSecret);
  if (cookieIdentity) {
    await resolveCookieBackedAuthContext(app, req, cookieIdentity);
    return;
  }
  if (hasSessionCookie) {
    markSessionCleanup(req);
  }

  if (Env.AUTH_MODE === "oauth") {
    authRequired();
  }

  const rawUserId = req.headers["x-user-id"];
  const rawRole = req.headers["x-user-role"];
  const sessionUserId = userScopedIdSchema.parse(
    !rawUserId || Array.isArray(rawUserId) ? "user-1" : rawUserId,
  );
  const overrideRole = rawRole && !Array.isArray(rawRole) ? userRoleSchema.parse(rawRole) : undefined;
  const authUser = await app.persistence.getAuthUserById(sessionUserId);
  const hadImpersonationCookie = Boolean(parseCookieValue(req.headers.cookie, IMPERSONATION_COOKIE_NAME));
  const impersonation = await resolveImpersonationState(app, req, sessionUserId);
  if (impersonation.active) {
    req.authContext = {
      sessionUserId,
      contextUserId: impersonation.impersonation.targetUserId,
      role: authUser && !authUser.deactivatedAt && !authUser.deletedAt ? (overrideRole ?? authUser.role) : (overrideRole ?? "admin"),
      sessionVersion: authUser?.sessionVersion ?? 1,
      isDemo: false,
      isImpersonating: true,
      isSharedContext: false,
      email: authUser?.email ?? null,
      impersonation: impersonation.impersonation,
    };
    return;
  }
  if (hadImpersonationCookie) {
    req.authContext = {
      sessionUserId,
      contextUserId: sessionUserId,
      role: authUser && !authUser.deactivatedAt && !authUser.deletedAt ? (overrideRole ?? authUser.role) : (overrideRole ?? "admin"),
      sessionVersion: authUser?.sessionVersion ?? 1,
      isDemo: false,
      isImpersonating: false,
      isSharedContext: false,
      email: authUser?.email ?? null,
      impersonation: null,
    };
    return;
  }

  const { contextUserId, isSharedContext } = await resolveContextOverride(app, req, sessionUserId);

  req.authContext = {
    sessionUserId,
    contextUserId,
    role: authUser && !authUser.deactivatedAt && !authUser.deletedAt ? (overrideRole ?? authUser.role) : (overrideRole ?? "admin"),
    sessionVersion: authUser?.sessionVersion ?? 1,
    isDemo: false,
    isImpersonating: false,
    isSharedContext,
    email: authUser?.email ?? null,
    impersonation: null,
  };
}

export async function enforceRouteRole(req: FastifyRequest): Promise<void> {
  const routeUrl = req.routeOptions.url;
  if (!routeUrl) return;
  const key = routeKey(req.method, routeUrl);
  if (
    req.authContext?.isImpersonating
    && IMPERSONATION_BLOCKED_METHODS.has(req.method.toUpperCase())
    && !IMPERSONATION_WRITE_ALLOWLIST.has(key)
  ) {
    await req.server.persistence.appendAuditLog({
      actorUserId: req.authContext.sessionUserId,
      action: "impersonation_blocked_write",
      targetUserId: req.authContext.impersonation?.targetUserId ?? null,
      ipAddress: req.ip,
      metadata: {
        targetUserId: req.authContext.impersonation?.targetUserId ?? null,
        method: req.method.toUpperCase(),
        path: req.url.split("?")[0] ?? req.url,
      },
    });
    throw routeError(403, "impersonation_write_blocked", "Writes are disabled while impersonating.");
  }
  if (ADMIN_ROUTE_KEYS.has(key)) {
    requireAdminRole(req);
    return;
  }
  if (WRITER_ROLE_ROUTE_KEYS.has(key)) {
    requireWriterRole(req);
  }
  if (WRITE_CONTEXT_GUARD_ROUTE_KEYS.has(key)) {
    requireWriteableContext(req);
  }
}

/** Guard for `/__e2e/reset` — allowed in development and test with dev_bypass + memory, blocked in production. */
function assertE2EResetEnabled(): void {
  if ((Env.NODE_ENV !== "development" && Env.NODE_ENV !== "test") || Env.AUTH_MODE !== "dev_bypass" || Env.PERSISTENCE_BACKEND !== "memory") {
    throw routeError(404, "not_found", "not found");
  }
}

/** Guard for `/__e2e/oauth-session` — allowed in development and test, blocked in production. */
/** Guard for test-only seed endpoints — allowed in dev/test with memory backend, any auth mode. */
function assertE2ESeedEnabled(): void {
  if ((Env.NODE_ENV !== "development" && Env.NODE_ENV !== "test") || Env.PERSISTENCE_BACKEND !== "memory") {
    throw routeError(404, "not_found", "not found");
  }
}

export function assertE2EOauthSessionEnabled(nodeEnv: string = Env.NODE_ENV): void {
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw routeError(404, "not_found", "not found");
  }
}

/**
 * Creates a demo user session: resolves user, marks as demo, seeds transactions,
 * signs cookie, and sets the Set-Cookie header on the reply.
 *
 * Shared between POST /auth/demo/start (production, rate-limited) and
 * POST /__e2e/demo-session (test-only, bypasses rate limiter).
 */
async function createDemoSession(
  app: FastifyInstance,
  reply: FastifyReply,
): Promise<{ userId: string; expiresAt: string }> {
  const demoId = randomUUID();
  const email = `demo-${demoId}@demo.local`;
  const ttlSeconds = Env.DEMO_SESSION_TTL_SECONDS;

  const { userId } = await app.persistence.resolveOrCreateUser(
    "demo",
    demoId,
    {
      email,
      name: "Demo User",
    },
    { role: "member" },
  );

  await app.persistence.markDemoUser(userId, ttlSeconds);
  await seedDemoTransactions(app.persistence, userId);

  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required");
  }

  const signedCookie = signSessionCookie(userId, sessionSecret, true);
  const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}; Max-Age=${ttlSeconds}`);

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { userId, expiresAt };
}

function createSeededStoreForUser(userId: string): Store {
  const store = createStore();
  store.userId = userId;
  store.settings.userId = userId;
  store.accounts = store.accounts.map((account) => ({ ...account, userId }));
  syncAccountingPolicy(store);
  return store;
}

function getStoreIntegrityIssue(store: Store): IntegrityIssueDto | null {
  if (store.feeProfiles.length === 0) {
    return {
      code: "missing_fee_profiles",
      message: "No fee profile exists. Create one in settings before trading.",
    };
  }

  // KZO-183: per-account scope check — `account.feeProfileId` must reference
  // a profile whose `accountId` equals `account.id`. The same ownership check
  // applies to per-symbol bindings.
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));
  for (const account of store.accounts) {
    const profile = account.feeProfileId ? profilesById.get(account.feeProfileId) : undefined;
    if (!profile) {
      return {
        code: "missing_account_profile",
        message: `Account ${account.id} is missing a valid fee profile binding.`,
      };
    }
    if (profile.accountId !== account.id) {
      return {
        code: "missing_account_profile",
        message: `Account ${account.id} references fee profile ${profile.id} owned by another account.`,
      };
    }
  }

  for (const binding of store.feeProfileBindings) {
    const profile = profilesById.get(binding.feeProfileId);
    if (!profile) {
      return {
        code: "invalid_fee_profile_binding",
        message: `Fee profile override for ${binding.accountId}/${binding.ticker} references missing profile ${binding.feeProfileId}.`,
      };
    }

    const account = store.accounts.find((item) => item.id === binding.accountId);
    if (!account) {
      return {
        code: "invalid_fee_profile_binding",
        message: `Fee profile override references missing account ${binding.accountId}.`,
      };
    }
    if (profile.accountId !== binding.accountId) {
      return {
        code: "invalid_fee_profile_binding",
        message: `Fee profile override for ${binding.accountId}/${binding.ticker} references profile ${profile.id} owned by another account.`,
      };
    }
  }

  return null;
}

function assertStoreIntegrity(store: Store): void {
  const issue = getStoreIntegrityIssue(store);
  if (!issue) return;
  throw routeError(409, issue.code, issue.message);
}

function normalizeBindings(rawBindings: Array<z.infer<typeof feeBindingSchema>>) {
  const deduped = new Map<string, z.infer<typeof feeBindingSchema>>();
  for (const binding of rawBindings) {
    const normalized = {
      accountId: binding.accountId,
      ticker: binding.ticker,
      feeProfileId: binding.feeProfileId,
    };
    deduped.set(`${normalized.accountId}:${normalized.ticker}`, normalized);
  }

  return [...deduped.values()];
}

function mapTransactionHistoryItem(trade: Transaction): TransactionHistoryItemDto {
  return {
    id: trade.id,
    accountId: trade.accountId,
    ticker: trade.ticker,
    marketCode: trade.marketCode,
    instrumentType: trade.instrumentType,
    type: trade.type,
    quantity: trade.quantity,
    unitPrice: trade.unitPrice,
    priceCurrency: trade.priceCurrency,
    tradeDate: trade.tradeDate,
    tradeTimestamp: trade.tradeTimestamp ?? null,
    bookingSequence: trade.bookingSequence ?? null,
    commissionAmount: trade.commissionAmount,
    taxAmount: trade.taxAmount,
    isDayTrade: trade.isDayTrade,
    realizedPnlAmount: trade.realizedPnlAmount ?? null,
    realizedPnlCurrency: trade.realizedPnlCurrency ?? null,
    feeProfileId: trade.feeSnapshot.id,
    feeProfileName: trade.feeSnapshot.name,
    bookedAt: trade.bookedAt ?? null,
    feesSource: trade.feesSource ?? "CALCULATED",
  };
}

function compareTransactionsForHistory(left: Transaction, right: Transaction): number {
  return (
    right.tradeDate.localeCompare(left.tradeDate)
    || (right.bookingSequence ?? 0) - (left.bookingSequence ?? 0)
    || (right.tradeTimestamp ?? "").localeCompare(left.tradeTimestamp ?? "")
    || (right.bookedAt ?? "").localeCompare(left.bookedAt ?? "")
    || right.id.localeCompare(left.id)
  );
}

function ensureBindingsAreValid(store: Store, bindings: Array<z.infer<typeof feeBindingSchema>>): void {
  const accountIds = new Set(store.accounts.map((account) => account.id));
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));

  for (const binding of bindings) {
    if (!accountIds.has(binding.accountId)) {
      throw routeError(400, "invalid_account", `Unknown account ${binding.accountId}`);
    }
    const profile = profilesById.get(binding.feeProfileId);
    if (!profile) {
      throw routeError(400, "invalid_fee_profile", `Unknown fee profile ${binding.feeProfileId}`);
    }
    // KZO-183: per-account scope check. Override must point at a profile
    // owned by the binding's account.
    if (profile.accountId !== binding.accountId) {
      throw routeError(
        400,
        "invalid_fee_profile",
        `Fee profile ${binding.feeProfileId} is not owned by account ${binding.accountId}`,
      );
    }
  }
}

function requireProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) {
    throw routeError(404, "fee_profile_not_found", `Fee profile ${profileId} was not found.`);
  }
  return profile;
}

function requireAccount(store: Store, accountId: string) {
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw routeError(404, "account_not_found", `Account ${accountId} was not found.`);
  }
  return account;
}

function buildLiveBalancesByAccount(
  store: Store,
): Map<string, Array<{ currency: string; amount: number }>> {
  const reversedIds = new Set<string>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (entry.reversalOfCashLedgerEntryId) {
      reversedIds.add(entry.reversalOfCashLedgerEntryId);
    }
  }

  const balances = new Map<string, Map<string, number>>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (entry.reversalOfCashLedgerEntryId) continue;
    if (reversedIds.has(entry.id)) continue;
    const currencyMap = balances.get(entry.accountId) ?? new Map<string, number>();
    currencyMap.set(entry.currency, (currencyMap.get(entry.currency) ?? 0) + entry.amount);
    balances.set(entry.accountId, currencyMap);
  }

  const result = new Map<string, Array<{ currency: string; amount: number }>>();
  for (const [accountId, currencyMap] of balances.entries()) {
    result.set(
      accountId,
      [...currencyMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => ({ currency, amount: roundToDecimal(amount, 2) })),
    );
  }
  return result;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBeforeIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function isWeekendIsoDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function findMostRecentBar(bars: DailyBar[], requestedDate: string): DailyBar | null {
  const eligible = bars.filter((bar) => bar.barDate <= requestedDate);
  return eligible.at(-1) ?? null;
}

function buildPriceLookupResponse(bar: DailyBar, requestedDate: string) {
  if (bar.barDate === requestedDate) {
    return {
      close: bar.close,
      date: bar.barDate,
      source: bar.source,
      match: "exact" as const,
    };
  }

  return {
    close: bar.close,
    date: bar.barDate,
    source: bar.source,
    match: "previous" as const,
    reason: isWeekendIsoDate(requestedDate) ? "weekend" as const : "no_bar" as const,
  };
}

// Provider-fallback responses always carry match: "previous" — even when the
// returned bar's date matches the requested date — so the client treats every
// FinMind hit as "we filled a gap" rather than "the DB had it." This is the
// scope-locked behavior from KZO-160 §F2 step 4 (refined scope-todo).
function buildFetchedPriceLookupResponse(bar: DailyBar, requestedDate: string) {
  return {
    close: bar.close,
    date: bar.barDate,
    source: bar.source,
    match: "previous" as const,
    reason: isWeekendIsoDate(requestedDate) ? "weekend" as const : "no_bar" as const,
  };
}

async function opportunisticUpsertDailyBars(
  persistence: FastifyInstance["persistence"],
  bars: DailyBar[],
  marketCode: MarketCode,
): Promise<void> {
  if (bars.length === 0) return;

  if ("getPool" in persistence && typeof persistence.getPool === "function") {
    await upsertDailyBars(
      persistence.getPool(),
      bars.map((bar) => ({
        ticker: bar.ticker,
        marketCode,
        barDate: bar.barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        // KZO-163 D7: propagate DailyBar.source → RawDailyBar.sourceId so the
        // upsert preserves provider attribution. Without this the SQL fell back
        // to 'finmind' for every row, masking future multi-provider sources.
        sourceId: bar.source,
      })),
    );
    return;
  }

  if ("_seedDailyBars" in persistence && typeof persistence._seedDailyBars === "function") {
    persistence._seedDailyBars(bars);
  }
}

type FxTransferMutationResult =
  | CreateFxTransferResult
  | UpdateFxTransferResult
  | ReverseFxTransferResult;
type CashLedgerStoreEntry = Store["accounting"]["facts"]["cashLedgerEntries"][number];

// KZO-168 D11: emit a dedicated `currency_wallet_recomputed` event after FX
// transfer mutations. Reusing the trade-event `recompute_complete` shape would
// feed `undefined` into transaction-mutation consumers that read
// `event.accountId` / `event.ticker`, so the payload-shape contract is
// intentionally distinct.
async function publishFxTransferRecompute(
  app: FastifyInstance,
  userId: string,
  cashBalanceChanges: CashBalanceChange[],
): Promise<void> {
  await generateCurrencyWalletSnapshots(userId, app.persistence);
  await app.eventBus.publishEvent(userId, "currency_wallet_recomputed", {
    cashBalanceChanges,
  });
}

function stripFxTransferSideEffects<T extends FxTransferMutationResult>(
  result: T,
): Omit<T, "cashBalanceChanges"> {
  // Drop the side-effect channel before returning to the HTTP layer; the
  // route already published the SSE event with the same payload, so the
  // synchronous response only carries identifiers.
  const response: Record<string, unknown> = { ...result };
  delete response.cashBalanceChanges;
  return response as Omit<T, "cashBalanceChanges">;
}

function rethrowFxTransferError(error: unknown): never {
  if (error instanceof MissingFxRateError) {
    throw routeError(400, "fx_rate_unavailable", error.message);
  }
  throw error;
}

function resolveTransactionFeeProfile(
  store: Store,
  accountId: string,
  ticker: string,
): FeeProfile {
  // KZO-183: bindings no longer carry marketCode — resolution by (accountId, ticker)
  // only. Market enforcement is handled separately via the trade booking guard.
  const override = store.feeProfileBindings.find(
    (binding) => binding.accountId === accountId && binding.ticker === ticker,
  );

  if (override) {
    return requireProfile(store, override.feeProfileId);
  }

  const account = requireAccount(store, accountId);
  return requireProfile(store, account.feeProfileId);
}

const demoRateBuckets = new Map<string, { count: number; windowStartedAt: number }>();

/** @internal — test-only helper to reset the demo rate limiter between test runs. */
export function _resetDemoRateBuckets(): void {
  demoRateBuckets.clear();
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  registerInviteStatusEviction(app);
  registerAnonymousShareEviction(app);
  registerMarketDataPriceEviction(app);
  registerMarketDataSearchEviction(app);

  app.post("/__e2e/reset", async (req) => {
    assertE2EResetEnabled();
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const store = createSeededStoreForUser(identity.userId);
    await app.persistence.saveStore(store);

    // Ensure user identity exists for server-side getProfile()
    await app.persistence.ensureDefaultPortfolioData(identity.userId);

    // Set role to match the resolved identity (default: admin in dev_bypass)
    const role = identity.role ?? "admin";
    const user = await app.persistence.getAuthUserById(identity.userId);
    if (user && user.role !== role) {
      await app.persistence.changeUserRole(identity.userId, role, { actorUserId: "system" });
    }

    return { status: "reset", userId: identity.userId };
  });

  app.post("/__e2e/seed-instruments", async (req) => {
    // KZO-169 (Fix-P1): seed-class endpoints must use the seed guard so that
    // API HTTP tests (suite 8 — AUTH_MODE=oauth) can call them. The reset
    // guard requires AUTH_MODE=dev_bypass and would block oauth-mode HTTP
    // suites. Per `.claude/rules/e2e-seed-vs-reset-guards.md`.
    assertE2ESeedEnabled();
    const body = z
      .object({
        instruments: z.array(
          z.object({
            ticker: z.string(),
            name: z.string().nullable(),
            instrumentType: z.string().nullable(),
            marketCode: z.string(),
            barsBackfillStatus: z.string(),
            lastRepairAt: z.string().nullable().optional(),
            delistedAt: z.string().optional(),
          }),
        ),
      })
      .parse(req.body);

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const mem = app.persistence as import("../persistence/memory.js").MemoryPersistence;
    mem._replaceInstruments(body.instruments, userId);
    return { status: "seeded", count: body.instruments.length };
  });

  app.post("/__e2e/seed-notification", async (req) => {
    assertE2ESeedEnabled();
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z
      .object({
        severity: z.enum(["info", "warning", "error"]),
        source: z.string().default("daily_refresh"),
        title: z.string(),
        body: z.string().optional(),
        detail: z.unknown().optional(),
      })
      .parse(req.body);

    const id = await app.persistence.createNotification({
      userId,
      severity: body.severity,
      source: body.source,
      title: body.title,
      body: body.body,
      detail: body.detail,
    });
    return { status: "seeded", id };
  });

  // KZO-159 (158A): test-only helper that lets E2E/integration suites drop
  // a fully-formed preferences row onto the active user (or a specific user
  // when provided). Uses `_setUserPreferences` which bypasses the merge
  // semantics and replaces the entire preferences object. Gated behind the
  // seed guard (NODE_ENV + PERSISTENCE_BACKEND=memory) per KZO-132 pattern.
  app.post("/__e2e/seed-user-preferences", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        userId: userScopedIdSchema.optional(),
        preferences: z.record(z.string(), z.unknown()),
      })
      .parse(req.body);
    const targetUserId = body.userId
      ?? resolveUserId(req, app.oauthConfig?.sessionSecret).userId;
    await app.persistence._setUserPreferences(targetUserId, body.preferences);
    return { status: "seeded", userId: targetUserId };
  });

  app.post("/__e2e/seed-daily-bars", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        bars: z.array(
          z.object({
            ticker: z.string(),
            barDate: z.string(),
            open: z.number(),
            high: z.number(),
            low: z.number(),
            close: z.number(),
            volume: z.number(),
            source: z.string().default("e2e-seed"),
            ingestedAt: z.string().default(new Date().toISOString()),
          }),
        ),
      })
      .parse(req.body);

    const { MemoryPersistence } = await import("../persistence/memory.js");
    if (!(app.persistence instanceof MemoryPersistence)) {
      throw routeError(400, "memory_only", "seed-daily-bars is only available with memory persistence");
    }
    app.persistence._seedDailyBars(body.bars);
    return { status: "seeded", count: body.bars.length };
  });

  // KZO-164: test-only seed for FX rates. Used by HTTP/AAA + integration suites
  // to populate `getFxRateFreshness()` and the freshness route without spinning
  // up the worker / Frankfurter mock.
  app.post("/__e2e/seed-fx-rates", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        rates: z.array(
          z.object({
            date: isoDateSchema,
            baseCurrency: z.string().regex(/^[A-Z]{3}$/),
            quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
            rate: z.number().positive(),
            source: z.string().default("frankfurter"),
          }),
        ),
      })
      .parse(req.body);

    const inserted = await app.persistence.upsertFxRates(body.rates);
    return { inserted };
  });

  // KZO-164: test-only reset for FX rates. Per-test isolation for HTTP/AAA
  // freshness specs that share a single in-memory persistence across the
  // serial worker. Uses `assertE2ESeedEnabled()` (NODE_ENV + memory backend)
  // so it works under AUTH_MODE=oauth like the seed endpoint.
  app.post("/__e2e/reset-fx-rates", async () => {
    assertE2ESeedEnabled();
    const mem = app.persistence as import("../persistence/memory.js").MemoryPersistence;
    mem._resetFxRates();
    return { status: "reset" };
  });

  app.post("/__e2e/seed-dividend-event", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        accountId: userScopedIdSchema.default("acc-1"),
        ticker: tickerSchema.default("2330"),
        eventType: z.enum(["CASH", "STOCK", "CASH_AND_STOCK"]).default("CASH"),
        exDividendDate: isoDateSchema,
        paymentDate: isoDateSchema.nullable().optional(),
        cashDividendPerShare: z.number().nonnegative().default(0),
        cashDividendCurrency: currencyCodeSchema.default("TWD"),
        stockDividendPerShare: z.number().nonnegative().default(0),
        source: z.string().default("e2e_seed_dividend_event"),
        eligibleQuantity: z.number().int().nonnegative().default(1000),
        tradeDate: isoDateSchema.optional(),
      })
      .parse(req.body);

    const { userId, store } = await loadUserStore(app, req);
    const account = requireAccount(store, body.accountId);
    if (account.userId !== userId) {
      throw routeError(403, "account_forbidden", `Account ${account.id} does not belong to the authenticated user`);
    }

    if (body.eligibleQuantity > 0) {
      const tradeDate = body.tradeDate ?? new Date(Date.parse(`${body.exDividendDate}T00:00:00.000Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const marketCode = marketCodeFor(account.defaultCurrency);
      ensureInstrumentDefinition(store, body.ticker, marketCode);

      createTransaction(store, userId, {
        id: randomUUID(),
        accountId: body.accountId,
        ticker: body.ticker,
        marketCode,
        quantity: body.eligibleQuantity,
        unitPrice: 100,
        priceCurrency: body.cashDividendCurrency,
        tradeDate,
        type: "BUY",
        isDayTrade: false,
      });
    }

    const dividendEvent = createDividendEvent(store, {
      id: randomUUID(),
      ticker: body.ticker,
      eventType: body.eventType,
      exDividendDate: body.exDividendDate,
      paymentDate: body.paymentDate ?? null,
      cashDividendPerShare: body.cashDividendPerShare,
      cashDividendCurrency: body.cashDividendCurrency,
      stockDividendPerShare: body.stockDividendPerShare,
      source: body.source,
    });

    await app.persistence.saveStore(store);
    return {
      status: "seeded",
      accountId: body.accountId,
      eligibleQuantity: body.eligibleQuantity,
      dividendEvent,
    };
  });

  app.post("/__e2e/reset-demo-rate-buckets", async () => {
    assertE2EOauthSessionEnabled();
    _resetDemoRateBuckets();
    return { status: "reset" };
  });

  // KZO-172: per-IP search rate-limit bucket reset for HTTP-suite isolation.
  // Uses the seed guard (NOT reset guard) because the HTTP suite runs in oauth
  // mode — `assertE2EResetEnabled()` requires `AUTH_MODE=dev_bypass` and would
  // 404 the endpoint in suite 8. Per `.claude/rules/e2e-seed-vs-reset-guards.md`.
  app.post("/__e2e/reset-market-data-search-rate-limit", async () => {
    assertE2ESeedEnabled();
    _resetMarketDataSearchBuckets();
    return { ok: true };
  });

  // KZO-142: reset the repair cooldown override so each E2E settings spec
  // starts from a clean "env default" state.
  app.post("/__e2e/reset-app-config", async () => {
    assertE2EResetEnabled();
    await app.persistence.setRepairCooldownMinutes(null);
    return { ok: true };
  });

  // KZO-147: seed an anonymous share token row directly (bypasses the normal
  // create path) so E2E tests can exercise revoked/expired edge cases.
  app.post("/__e2e/seed-anonymous-share-token", async (req) => {
    assertE2ESeedEnabled();
    const body = z.object({
      userId: userScopedIdSchema.optional(),
      ownerUserId: userScopedIdSchema.optional(),
      token: z.string().regex(ANONYMOUS_SHARE_TOKEN_REGEX).optional(),
      expiresAt: isoDateTimeSchema.optional(),
      expiresInDays: z.number().int().min(1).max(365).optional(),
      expiredAt: isoDateTimeSchema.optional(),
      revokedAt: isoDateTimeSchema.nullable().optional(),
    }).parse(req.body);
    const ownerUserId = body.ownerUserId ?? body.userId;
    if (!ownerUserId) {
      throw routeError(400, "validation_error", "ownerUserId is required");
    }

    const token = body.token ?? generateAnonymousShareToken();
    const expiresAt = body.expiredAt
      ?? body.expiresAt
      ?? new Date(Date.now() + (body.expiresInDays ?? 7) * 24 * 60 * 60 * 1000).toISOString();
    const ttlDays = body.expiresInDays
      ?? Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / (24 * 60 * 60 * 1000)));

    const created = await app.persistence.createAnonymousShareToken({
      ownerUserId,
      token,
      expiresAt,
      ttlDays,
      auditInput: { actorUserId: null, ipAddress: req.ip },
    });

    if (created.status !== "ok") {
      throw routeError(409, "seed_failed", `seed failed: ${created.status}`);
    }

    let record = created.record;
    if (body.revokedAt !== undefined && body.revokedAt !== null) {
      const revoked = await app.persistence.revokeAnonymousShareToken({
        id: record.id,
        ownerUserId,
        auditInput: { actorUserId: null, ipAddress: req.ip },
      });
      if (revoked.status === "revoked") {
        record = revoked.record;
      }
    }

    return toAnonymousShareTokenDto(app, record);
  });

  app.post("/__e2e/anon-share-rate-reset", async (req) => {
    assertE2ESeedEnabled();
    const body = z.object({ ip: z.string().trim().min(1).optional() }).parse(req.body ?? {});
    if (body.ip) {
      deleteAnonymousShareRateBucket(body.ip);
    } else {
      _resetAnonymousShareRateBuckets();
    }
    return { status: "reset" };
  });

  app.post("/__e2e/anon-share-deactivate-owner", async (req) => {
    assertE2ESeedEnabled();
    const body = z.object({ userId: userScopedIdSchema }).parse(req.body);
    await app.persistence.disableUser(body.userId, {
      actorUserId: null,
      ipAddress: req.ip,
      metadata: { reason: "anon_share_test_owner_deactivate" },
    });
    return { status: "deactivated", userId: body.userId };
  });

  app.post("/__e2e/oauth-session", async (req, reply) => {
    assertE2EOauthSessionEnabled();

    const body = z.object({ id_token: z.string().min(1).optional() }).nullable().parse(req.body ?? {});
    const query = z.object({
      role: userRoleSchema.default("admin"),
      sessionVersion: z.coerce.number().int().positive().default(1),
    }).parse(req.query);

    let sub: string;
    let email: string;
    let name: string | undefined;
    let picture: string | undefined;

    if (body?.id_token) {
      const claims = decodeIdTokenPayload(body.id_token);
      sub = claims.sub;
      email = claims.email ?? `${claims.sub}@e2e.local`;
      name = claims.name;
      picture = claims.picture;
    } else {
      sub = "e2e-ci-google-sub-001";
      email = "e2e-ci@e2e.local";
      name = "E2E CI User";
    }

    const normalizedEmail = normalizeEmailAddress(email);
    const authUser = await app.persistence.resolveOrCreateUser(
      "google",
      sub,
      { email: normalizedEmail, name, picture },
      { role: query.role, sessionVersion: query.sessionVersion },
    );

    await materializePendingSharesPostLogin(app, req, authUser.userId, normalizedEmail);

    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for session cookie signing");
    }
    const signedCookie = signSessionCookie(authUser.userId, sessionSecret, authUser.sessionVersion);
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, (Env.NODE_ENV as string) === "production", Env.COOKIE_DOMAIN);
    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}`);
    return {
      status: "ok",
      sub,
      userId: authUser.userId,
      role: query.role,
      sessionVersion: authUser.sessionVersion,
    };
  });

  /**
   * E2E-only: create a demo session without going through the rate limiter.
   *
   * Tests that verify data visibility (e.g. demo-ticker-history-aaa.spec.ts) need
   * a demo session but don't test sign-in UI mechanics. auth-demo.spec.ts
   * exhausts the 5/60s demoRateBuckets limit, so subsequent specs would get 429.
   * This endpoint bypasses that coupling entirely.
   *
   * The global mutationBuckets (120/60s in app.ts) is NOT bypassed — current
   * E2E volume (~8 calls) is well within the 120 limit.
   */
  app.post("/__e2e/demo-session", async (_req, reply) => {
    assertE2EOauthSessionEnabled();
    const { userId, expiresAt } = await createDemoSession(app, reply);
    return { status: "ok", userId, expiresAt, sessionType: "demo" };
  });

  app.post("/__e2e/impersonation-session", async (req, reply) => {
    assertE2ESeedEnabled();
    const body = z.object({
      adminUserId: userScopedIdSchema,
      targetUserId: userScopedIdSchema,
      ttlMinutes: z.coerce.number().int().positive().optional(),
    }).parse(req.body);

    const [adminUser, targetUser] = await Promise.all([
      app.persistence.getAuthUserById(body.adminUserId),
      app.persistence.getAuthUserById(body.targetUserId),
    ]);
    if (!adminUser || adminUser.role !== "admin" || adminUser.deactivatedAt || adminUser.deletedAt) {
      throw routeError(404, "admin_not_found", "Admin user not found");
    }
    if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
      throw routeError(404, "user_not_found", "User not found");
    }
    if (body.adminUserId === body.targetUserId) {
      throw routeError(400, "cannot_impersonate_self", "Cannot impersonate yourself");
    }

    const ttlMinutes = body.ttlMinutes ?? Env.ADMIN_IMPERSONATION_TTL_MINUTES;
    const expiresAtMs = Date.now() + ttlMinutes * 60_000;
    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for impersonation cookie signing");
    }

    const signedCookie = signImpersonationCookie(body.adminUserId, body.targetUserId, expiresAtMs, sessionSecret);
    reply.header("set-cookie", impersonationSetCookieString(signedCookie, ttlMinutes));
    return {
      status: "ok",
      expiresAt: new Date(expiresAtMs).toISOString(),
      targetEmail: targetUser.email ?? null,
    };
  });

  app.post("/auth/demo/start", async (req, reply) => {
    if (Env.DEMO_MODE_ENABLED !== "true") {
      throw routeError(404, "not_found", "not found");
    }

    // Per-IP rate limit: 5 requests per minute
    const demoRateKey = `${req.ip}:POST:/auth/demo/start`;
    const now = Date.now();
    const windowMs = 60_000;
    const demoLimit = 5;
    const existing = demoRateBuckets.get(demoRateKey);

    if (existing && now - existing.windowStartedAt < windowMs && existing.count >= demoLimit) {
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }

    if (!existing || now - existing.windowStartedAt >= windowMs) {
      demoRateBuckets.set(demoRateKey, { count: 1, windowStartedAt: now });
    } else {
      existing.count += 1;
    }

    const { userId, expiresAt } = await createDemoSession(app, reply);
    return { userId, expiresAt, sessionType: "demo" };
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    const dependencies = await app.persistence.readiness();
    return {
      status: dependencies.postgres && dependencies.redis ? "ready" : "degraded",
      dependencies,
    };
  });

  app.get("/auth/logout", async (req, reply) => {
    // Two Set-Cookie headers: the signed session cookie and the unsigned
    // context-switcher cookie. Both must clear on logout regardless of which
    // path triggered it (UI click, direct navigation, server-initiated force-logout).
    reply.header("set-cookie", [
      sessionClearCookieString(),
      impersonationClearCookieString(),
      contextClearCookieString(),
    ]);
    const rawQuery = req.query as Record<string, string | undefined>;
    const returnTo = rawQuery.returnTo && isValidReturnTo(rawQuery.returnTo) ? rawQuery.returnTo : undefined;
    const destination = returnTo ? `${app.appBaseUrl}${returnTo}` : `${app.appBaseUrl}/login`;
    return reply.redirect(destination, 302);
  });

  app.get("/invites/:code/status", async (req) => {
    assertInviteStatusRateLimit(req.ip);
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);
    return { status: await app.persistence.getInviteStatus(params.code) };
  });

  app.post("/invites", async (req, reply) => {
    const body = z.object({
      email: z.string().trim().email().transform((value) => value.toLowerCase()),
      role: userRoleSchema,
      expiresAt: z.string().datetime({ offset: true }).optional(),
    }).parse(req.body);

    const existingUser = await app.persistence.getAuthUserByEmail(body.email);
    if (existingUser) {
      throw routeError(409, "invite_email_registered", "A user with that email already exists");
    }

    const invite = await app.persistence.createInvite({
      email: body.email,
      role: body.role,
      expiresAt: body.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: req.authContext?.sessionUserId ?? null,
    });

    await app.persistence.appendAuditLog({
      actorUserId: req.authContext?.sessionUserId ?? null,
      action: "admin_invite_issued",
      metadata: { targetEmail: body.email, inviteCode: invite.code, role: body.role },
      ipAddress: req.ip,
    });

    reply.code(201);
    return {
      code: invite.code,
      url: `${app.appBaseUrl}/invite/${invite.code}`,
    };
  });

  app.delete("/invites/:code", async (req, reply) => {
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);

    // Look up invite email for audit metadata before revoking
    const invite = await app.persistence.getInviteRecord(params.code);
    await app.persistence.revokeInvite(params.code);

    let shareOwnerEmail: string | null = null;
    let shareOwnerDisplayName: string | null = null;
    if (invite?.shareOwnerUserId) {
      const shareOwner = await app.persistence.getAuthUserById(invite.shareOwnerUserId);
      shareOwnerEmail = shareOwner?.email ?? null;
      shareOwnerDisplayName = shareOwner?.displayName ?? null;
    }

    await app.persistence.appendAuditLog({
      actorUserId: req.authContext?.sessionUserId ?? null,
      action: "admin_invite_revoked",
      metadata: {
        inviteCode: params.code,
        targetEmail: invite?.email ?? null,
        ...(invite?.shareOwnerUserId
          ? {
            shareCoupled: true,
            shareOwnerEmail,
            shareOwnerDisplayName,
          }
          : {}),
      },
      ipAddress: req.ip,
    });

    reply.code(204);
    return null;
  });

  app.get("/auth/google/start", async (req, reply) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }
    const rawQuery = req.query as Record<string, string | undefined>;
    const returnTo = rawQuery.returnTo && isValidReturnTo(rawQuery.returnTo) ? rawQuery.returnTo : undefined;
    const inviteCode = rawQuery.invite_code?.trim().toUpperCase() || undefined;
    const state = generateState(app.oauthConfig.sessionSecret, returnTo, inviteCode);
    const url = buildAuthorizationUrl(app.oauthConfig, state);
    return reply.redirect(url, 302);
  });

  app.get("/auth/google/callback", async (req, reply) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }

    const errorRedirect = (reason: string) =>
      reply.redirect(`${app.appBaseUrl}/auth/error?reason=${encodeURIComponent(reason)}`, 302);

    const rawQuery = req.query as Record<string, string | undefined>;

    if (rawQuery.error) return errorRedirect("oauth_error");

    let query: { code: string; state: string };
    try {
      query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(rawQuery);
    } catch {
      return errorRedirect("invalid_state");
    }

    if (!verifyState(query.state, app.oauthConfig.sessionSecret)) {
      return errorRedirect("invalid_state");
    }

    let tokens: GoogleTokenResponse;
    try {
      tokens = await exchangeCodeForTokens(app.oauthConfig, query.code);
    } catch (err) {
      const code = (err as { code?: string }).code;
      return errorRedirect(code === "oauth_client_error" ? "oauth_error" : "server_error");
    }

    const claims = decodeIdTokenPayload(tokens.id_token);
    if (!claims.email || claims.email_verified === false) {
      return errorRedirect("oauth_error");
    }

    const normalizedEmail = normalizeEmailAddress(claims.email);
    const initialAdminEmail = Env.INITIAL_ADMIN_EMAIL ? normalizeEmailAddress(Env.INITIAL_ADMIN_EMAIL) : null;
    const inviteCode = extractInviteCode(query.state)?.toUpperCase() ?? null;
    const returnTo = extractReturnTo(query.state);

    const existingUser = await app.persistence.getAuthUserByEmail(normalizedEmail);
    if (existingUser?.deactivatedAt || existingUser?.deletedAt) {
      return errorRedirect("account_disabled");
    }

    let authUser: Awaited<ReturnType<typeof app.persistence.resolveOrCreateUser>>;
    try {
      if (initialAdminEmail && normalizedEmail === initialAdminEmail) {
        authUser = await app.persistence.resolveOrCreateUser("google", claims.sub, {
          email: normalizedEmail,
          name: claims.name,
          picture: claims.picture,
          emailVerified: claims.email_verified,
        }, { role: "admin" });
        if (!existingUser || existingUser.role !== "admin") {
          await app.persistence.appendAuditLog({
            action: "admin_promote_first_signin",
            targetUserId: authUser.userId,
            metadata: { email: normalizedEmail, targetEmail: normalizedEmail },
          });
        }
      } else if (existingUser) {
        authUser = await app.persistence.resolveOrCreateUser("google", claims.sub, {
          email: normalizedEmail,
          name: claims.name,
          picture: claims.picture,
          emailVerified: claims.email_verified,
        });
      } else {
        if (!inviteCode) {
          return errorRedirect("invite_required");
        }
        // Validate invite (read-only) before creating user — if user creation
        // fails, the invite stays unused and the user can retry.
        const invite = await app.persistence.getInviteRecord(inviteCode);
        if (!invite) return errorRedirect("invalid_code");
        if (invite.revokedAt) return errorRedirect("revoked");
        if (invite.usedAt) return errorRedirect("already_used");
        if (new Date(invite.expiresAt).getTime() <= Date.now()) return errorRedirect("expired_code");
        if (invite.email.toLowerCase() !== normalizedEmail) return errorRedirect("email_mismatch");

        authUser = await app.persistence.resolveOrCreateUser("google", claims.sub, {
          email: normalizedEmail,
          name: claims.name,
          picture: claims.picture,
          emailVerified: claims.email_verified,
        }, { role: invite.role });

        // Consume after user creation succeeds — atomic UPDATE handles races
        // where another request consumed between validate and consume.
        const consumeResult = await app.persistence.consumeInvite(inviteCode, normalizedEmail);
        if (consumeResult.status !== "consumed") {
          // Race: invite was consumed between validate and consume.
          // User already exists (created above), so they can log in on next attempt.
        }
      }

    } catch {
      return errorRedirect("oauth_error");
    }

    await materializePendingSharesPostLogin(app, req, authUser.userId, normalizedEmail);

    const signedCookie = signSessionCookie(authUser.userId, app.oauthConfig.sessionSecret, authUser.sessionVersion);
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);

    // Detect misconfigured Docker local: NODE_ENV=production sets the Secure
    // cookie flag, but HTTP transport means the browser silently drops it.
    if (Env.NODE_ENV === "production" && app.appBaseUrl?.startsWith("http://")) {
      return errorRedirect("insecure_transport");
    }

    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}`);
    const destination = returnTo ? `${app.appBaseUrl}${returnTo}` : `${app.appBaseUrl}/dashboard`;
    return reply.redirect(destination, 302);
  });

  app.post("/auth/token/refresh", async (req) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }

    const body = z.object({
      refreshToken: z.string().min(1),
    }).parse(req.body);

    const result = await refreshAccessToken(app.oauthConfig, body.refreshToken);
    return {
      accessToken: result.access_token,
      expiresIn: result.expires_in,
    };
  });

  app.get("/settings", async (req) => {
    const { store } = await loadUserStore(app, req);
    return store.settings;
  });

  app.patch("/settings", async (req) => {
    const body = z
      .object({
        locale: z.enum(["en", "zh-TW"]).optional(),
        costBasisMethod: z.literal("WEIGHTED_AVERAGE").optional(),
        quotePollIntervalSeconds: z.number().int().positive().max(86_400).optional(),
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);
    store.settings = { ...store.settings, ...body };
    await app.persistence.saveStore(store);
    return store.settings;
  });

  app.get("/profile", async (req) => {
    const userId = requireSessionUserId(req);
    const profile = await app.persistence.getProfile(userId);
    return {
      ...profile,
      impersonation: req.authContext?.impersonation ?? null,
    };
  });

  app.patch("/profile", async (req) => {
    const userId = requireSessionUserId(req);
    const body = z.object({ email: z.string().email().max(254) }).parse(req.body);
    return app.persistence.updateProfileEmail(userId, body.email);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // User preferences (KZO-159 / 158A) — per-session identity. Keys other than
  // `dashboardPerformanceRanges` are accepted as opaque values (forward-compat
  // for 158C/158B). Null deletes a key. PATCH body is capped at 8 KiB to cap
  // JSONB bloat; anything larger rejects with `payload_too_large`.
  // ─────────────────────────────────────────────────────────────────────────

  const USER_PREFERENCES_MAX_BYTES = 8192;

  // Strict per-key validation: every known top-level key gets an explicit
  // schema here. Unknown keys are rejected (`.strict()`). When 158B/158C add
  // a new preference, extend this schema.
  //
  // KZO-161 (158C) adds `cardOrder` — JSONB sub-object keyed by page slug. The
  // canonical JSONB key is camelCase (`cardOrder`), matching the existing
  // `dashboardPerformanceRanges`. Null at the top level clears the entire
  // `cardOrder` sub-object; null at any sub-key clears just that page's
  // saved order while preserving the others (KZO-162).
  const cardOrderSlugListSchema = z.union([
    z.array(z.string().min(1).max(64)).max(50),
    z.null(),
  ]);
  const cardOrderSchema = z
    .object({
      dashboard: cardOrderSlugListSchema.optional(),
      transactions: cardOrderSlugListSchema.optional(),
      portfolio: cardOrderSlugListSchema.optional(),
    })
    .strict();
  const userPreferencePatchSchema = z
    .object({
      dashboardPerformanceRanges: z
        .union([dashboardPerformanceRangesSchema, z.null()])
        .optional(),
      cardOrder: z
        .union([cardOrderSchema, z.null()])
        .optional(),
      // KZO-180: user-level reporting currency. Stored as a JSONB key (no
      // migration); enum mirrors `AccountDefaultCurrency` from
      // `@tw-portfolio/shared-types` (TWD/USD/AUD). `null` clears the key
      // and the resolver falls back to the `'TWD'` default.
      reportingCurrency: z
        .union([z.enum(["TWD", "USD", "AUD"]), z.null()])
        .optional(),
    })
    .strict();

  app.get("/user-preferences", async (req) => {
    const userId = requireSessionUserId(req);
    const preferences = await app.persistence.getUserPreferences(userId);
    return { preferences };
  });

  app.patch("/user-preferences", {
    bodyLimit: USER_PREFERENCES_MAX_BYTES,
  }, async (req) => {
    const userId = requireSessionUserId(req);
    // Enforce the byte budget explicitly here even though Fastify's bodyLimit
    // rejects at parse time — serializing the parsed body again gives a tight
    // upper bound and a predictable error shape for clients (Fastify's own
    // rejection surfaces as a 413 from the runtime, not a `routeError`).
    const rawBytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
    if (rawBytes > USER_PREFERENCES_MAX_BYTES) {
      throw routeError(
        413,
        "payload_too_large",
        `Request body exceeds ${USER_PREFERENCES_MAX_BYTES} bytes`,
      );
    }
    const parsed = userPreferencePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const code = issue?.message === "ranges_list_too_short"
        || issue?.message === "ranges_list_too_long"
        || issue?.message === "ranges_list_invalid_element"
        || issue?.message === "ranges_list_duplicate"
        ? "invalid_range_list"
        : "invalid_preference";
      throw routeError(400, code, issue?.message ?? "Invalid preference patch");
    }

    // Convert `undefined` → skip, `null` → delete. Pass only defined keys.
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    const preferences = await app.persistence.setUserPreferencePatch(userId, patch);
    return { preferences };
  });

  app.get("/user-preferences/effective-ranges", async (req) => {
    const userId = requireSessionUserId(req);
    const result = await resolveEffectiveRanges(app.persistence, userId);
    return result;
  });

  app.get("/shares", async (req) => {
    const userId = requireSessionUserId(req);
    const [outbound, inbound] = await Promise.all([
      app.persistence.listSharesForOwner(userId),
      app.persistence.listInboundSharesForGrantee(userId),
    ]);

    return {
      outbound: {
        active: outbound.active.map((record) => toShareGrantDto(record)),
        pending: outbound.pending.map((record) => toPendingShareInviteDto(app, record, "pending")),
        expired: outbound.expired.map((record) => toPendingShareInviteDto(app, record, "expired")),
        revoked: outbound.revoked.map((record) =>
          isShareGrantRecord(record)
            ? toShareGrantDto(record)
            : toPendingShareInviteDto(app, record, "revoked")),
      },
      inbound: {
        active: inbound.active.map((record) => toShareGrantDto(record)),
        revoked: inbound.revoked.map((record) => toShareGrantDto(record)),
      },
    };
  });

  app.post("/shares", async (req, reply) => {
    requireShareGrantorRole(req);
    const sessionUserId = requireSessionUserId(req);
    const body = z.object({
      email: z.string().trim().email().transform((value) => value.toLowerCase()),
    }).parse(req.body);

    const owner = await app.persistence.getAuthUserById(sessionUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }
    if (owner.email && normalizeEmailAddress(owner.email) === body.email) {
      throw routeError(400, "cannot_share_with_self", "cannot share with self");
    }

    const existingUser = await app.persistence.getAuthUserByEmail(body.email);
    if (existingUser && !existingUser.deletedAt && !existingUser.deactivatedAt) {
      const share = await app.persistence.createShareGrant({
        ownerUserId: sessionUserId,
        granteeUserId: existingUser.userId,
        auditInput: {
          actorUserId: sessionUserId,
          ipAddress: req.ip,
        },
      });
      await app.eventBus.publishEvent(share.granteeUserId, "sharing_notification", { shareId: share.id });
      reply.code(201);
      return {
        type: "resolved" as const,
        share: toShareGrantDto(share),
      };
    }

    const invite = await app.persistence.createShareCoupledInvite({
      ownerUserId: sessionUserId,
      email: body.email,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: sessionUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "admin_invite_issued",
      metadata: {
        targetEmail: body.email,
        inviteCode: invite.code,
        role: invite.role,
        shareCoupled: true,
        shareOwnerEmail: owner.email,
        shareOwnerDisplayName: owner.displayName,
      },
      ipAddress: req.ip,
    });

    reply.code(201);
    return {
      type: "pending" as const,
      invite: toPendingShareInviteDto(app, invite, "pending"),
    };
  });

  app.delete("/shares/pending/:code", async (req, reply) => {
    requireShareGrantorRole(req);
    const sessionUserId = requireSessionUserId(req);
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);

    await app.persistence.revokePendingShareInvite(params.code, sessionUserId, {
      actorUserId: sessionUserId,
      ipAddress: req.ip,
    });

    reply.code(204);
    return null;
  });

  app.delete("/shares/:id", async (req, reply) => {
    requireShareGrantorRole(req);
    const sessionUserId = requireSessionUserId(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);

    const outcome = await app.persistence.revokeShareGrant(params.id, sessionUserId, {
      actorUserId: sessionUserId,
      ipAddress: req.ip,
    });
    if (outcome) {
      await app.eventBus.publishEvent(outcome.granteeUserId, "sharing_notification", { shareId: params.id });
    }

    reply.code(204);
    return null;
  });

  // ── Anonymous share tokens (KZO-147) ──────────────────────────────────────
  // POST /share-tokens — create a fresh token. Capped at 20 active per owner.
  // Plaintext 22-char base62 tokens: the API returns the token exactly once
  // here (and again on GET /share-tokens list until revoked/expired).
  app.post("/share-tokens", async (req, reply) => {
    requireShareGrantorRole(req);
    requireWriteableContext(req);
    const sessionUserId = requireSessionUserId(req);
    const body = z.object({
      expiresInDays: z.number().int().min(1).max(365),
    }).parse(req.body);

    const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    // 3-retry loop on 23505 UNIQUE violation (rare; base62^22 keyspace).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = generateAnonymousShareToken();
      const result = await app.persistence.createAnonymousShareToken({
        ownerUserId: sessionUserId,
        token,
        expiresAt,
        ttlDays: body.expiresInDays,
        auditInput: {
          actorUserId: sessionUserId,
          ipAddress: req.ip,
        },
      });
      if (result.status === "ok") {
        reply.code(201);
        return toAnonymousShareTokenDto(app, result.record);
      }
      if (result.status === "cap_exceeded") {
        throw routeError(
          429,
          "anonymous_token_cap_exceeded",
          "anonymous share token cap (20 active) reached",
        );
      }
      // collision — retry
    }
    throw routeError(500, "token_collision_retry_exhausted", "token collision retry exhausted");
  });

  // GET /share-tokens — list the session user's own tokens (created within
  // the 30-day retention window). Status is derived server-side.
  app.get("/share-tokens", async (req) => {
    const sessionUserId = requireSessionUserId(req);
    const records = await app.persistence.listAnonymousShareTokensForOwner(sessionUserId);
    const now = Date.now();
    return {
      tokens: records.map((record) => toAnonymousShareTokenDto(app, record, now)),
    };
  });

  // DELETE /share-tokens/:id — revoke an active token, or 204 no-op if
  // already revoked/expired. Wrong-owner returns 404 — no existence leak.
  app.delete("/share-tokens/:id", async (req, reply) => {
    requireShareGrantorRole(req);
    requireWriteableContext(req);
    const sessionUserId = requireSessionUserId(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);

    const result = await app.persistence.revokeAnonymousShareToken({
      id: params.id,
      ownerUserId: sessionUserId,
      auditInput: {
        actorUserId: sessionUserId,
        ipAddress: req.ip,
      },
    });

    if (result.status === "not_found") {
      throw routeError(404, "token_not_found", "token not found");
    }

    reply.code(204);
    return null;
  });

  // GET /share/:token — public read-only view. No auth. Rate-limited per-IP
  // BEFORE the DB lookup so brute-forcers cannot burn persistence throughput.
  // Every failure after the rate check returns the same opaque 404.
  app.get("/share/:token", async (req, reply) => {
    // Step 1 — rate limit first (even invalid tokens count).
    try {
      assertAnonymousShareRateLimit(req.ip);
    } catch (error) {
      if ((error as { statusCode?: number; code?: string }).statusCode === 429) {
        reply.header(
          "retry-after",
          String(Math.ceil(Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS / 1000)),
        );
      }
      throw error;
    }

    // Step 2 — cheap regex pre-check (malformed strings never hit the DB).
    const rawToken = (req.params as { token?: unknown }).token;
    if (typeof rawToken !== "string" || !ANONYMOUS_SHARE_TOKEN_REGEX.test(rawToken)) {
      throw routeError(404, "token_not_found", "token not found");
    }

    // Step 3 — find an active (not revoked, not expired) token row.
    const record = await app.persistence.findActiveAnonymousShareTokenByToken(rawToken);
    if (!record) {
      throw routeError(404, "token_not_found", "token not found");
    }

    // Step 4 — owner must be active (not soft-deleted, not deactivated).
    const owner = await app.persistence.getAuthUserById(record.ownerUserId);
    if (!owner || owner.deletedAt || owner.deactivatedAt) {
      throw routeError(404, "token_not_found", "token not found");
    }

    // Step 5 — load the owner's store and resolve quote snapshots.
    const { store } = await loadUserStoreForUserId(app, record.ownerUserId);
    const tickers = [
      ...new Set(
        store.accounting.projections.holdings
          .filter((holding) => holding.quantity > 0)
          .map((holding) => holding.ticker),
      ),
    ];
    const quotes = await resolveQuoteSnapshots(tickers, app.persistence);

    // Owner display name fallback chain.
    const ownerDisplayName = owner.displayName
      ?? (owner.email ? owner.email.split("@")[0]! : "Portfolio owner");

    const view = buildPublicShareView(store, quotes, ownerDisplayName, record.expiresAt);

    // Step 6 — response headers. Never cache and never expose the token/id.
    reply.header("cache-control", "private, no-store, max-age=0");
    return view;
  });

  app.put("/settings/full", async (req) => {
    const body = z
      .object({
        settings: z.object({
          locale: z.enum(["en", "zh-TW"]),
          costBasisMethod: z.literal("WEIGHTED_AVERAGE"),
          quotePollIntervalSeconds: z.number().int().positive().max(86_400),
        }),
        feeProfiles: z.array(feeProfileDraftSchema).max(100),
        accounts: z
          .array(
            z.object({
              id: userScopedIdSchema,
              feeProfileRef: userScopedIdSchema,
            }),
          )
          .max(200),
        feeProfileBindings: z
          .array(
            z.object({
              accountId: userScopedIdSchema,
              ticker: tickerSchema,
              feeProfileRef: userScopedIdSchema,
            }),
          )
          .max(500),
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);
    const draftStore = structuredClone(store);
    const existingProfilesById = new Map(draftStore.feeProfiles.map((profile) => [profile.id, profile]));
    const tempIdToProfileId = new Map<string, string>();
    const nextProfiles: FeeProfile[] = [];

    // KZO-183 D7 validation order — step 1: every fee_profile draft.accountId
    // must resolve to one of body.accounts. Reject early so the user sees a
    // specific 400 before the rest of the validation chain runs.
    const bodyAccountIds = new Set(body.accounts.map((a) => a.id));
    for (const draft of body.feeProfiles) {
      if (!bodyAccountIds.has(draft.accountId)) {
        throw routeError(
          400,
          "invalid_account",
          `Fee profile draft references account ${draft.accountId} which is not in the request body.`,
        );
      }
    }

    for (const draft of body.feeProfiles) {
      let targetId = draft.id;
      if (!targetId) {
        targetId = randomUUID();
      } else {
        const existingProfile = existingProfilesById.get(targetId);
        if (!existingProfile) {
          throw routeError(404, "fee_profile_not_found", `Fee profile ${targetId} was not found.`);
        }
        if (existingProfile.accountId !== draft.accountId) {
          throw routeError(
            400,
            "invalid_fee_profile",
            `Fee profile ${targetId} cannot be reassigned from account ${existingProfile.accountId} to account ${draft.accountId}.`,
          );
        }
      }

      if (draft.tempId) {
        if (tempIdToProfileId.has(draft.tempId)) {
          throw routeError(400, "duplicate_temp_id", `Duplicate tempId ${draft.tempId} was provided.`);
        }
        tempIdToProfileId.set(draft.tempId, targetId);
      }

      nextProfiles.push({
        id: targetId,
        accountId: draft.accountId,
        name: draft.name,
        boardCommissionRate: draft.boardCommissionRate,
        commissionDiscountPercent: draft.commissionDiscountPercent,
        minimumCommissionAmount: draft.minimumCommissionAmount,
        commissionCurrency: draft.commissionCurrency,
        commissionRoundingMode: draft.commissionRoundingMode,
        taxRoundingMode: draft.taxRoundingMode,
        stockSellTaxRateBps: draft.stockSellTaxRateBps,
        stockDayTradeTaxRateBps: draft.stockDayTradeTaxRateBps,
        etfSellTaxRateBps: draft.etfSellTaxRateBps,
        bondEtfSellTaxRateBps: draft.bondEtfSellTaxRateBps,
        commissionChargeMode: draft.commissionChargeMode,
      });
    }

    if (nextProfiles.length === 0) {
      throw routeError(400, "missing_fee_profiles", "At least one fee profile is required.");
    }

    const uniqueProfileIds = new Set(nextProfiles.map((profile) => profile.id));
    if (uniqueProfileIds.size !== nextProfiles.length) {
      throw routeError(400, "duplicate_fee_profile_id", "Duplicate fee profile IDs are not allowed.");
    }

    const profilesById = new Map(nextProfiles.map((profile) => [profile.id, profile]));
    const resolveFeeProfileRef = (ref: string): string => {
      const resolved = tempIdToProfileId.get(ref) ?? ref;
      if (!profilesById.has(resolved)) {
        throw routeError(400, "invalid_fee_profile", `Fee profile reference ${ref} is not valid.`);
      }
      return resolved;
    };

    const nextAccounts = draftStore.accounts.map((account) => ({ ...account }));
    // KZO-183 D7 validation order — step 2: each account.feeProfileRef must
    // resolve to a profile whose accountId === account.id.
    for (const accountUpdate of body.accounts) {
      const account = nextAccounts.find((item) => item.id === accountUpdate.id);
      if (!account) {
        throw routeError(404, "account_not_found", `Account ${accountUpdate.id} was not found.`);
      }
      const resolvedId = resolveFeeProfileRef(accountUpdate.feeProfileRef);
      const resolvedProfile = profilesById.get(resolvedId)!;
      if (resolvedProfile.accountId !== account.id) {
        throw routeError(
          400,
          "invalid_fee_profile",
          `Fee profile ${resolvedId} is not owned by account ${account.id}.`,
        );
      }
      account.feeProfileId = resolvedId;
    }

    // KZO-183 D7 validation order — step 3: binding.accountId must reference
    // a known account, then binding.feeProfileRef must resolve to a profile
    // whose accountId === binding.accountId.
    const knownAccountIds = new Set(nextAccounts.map((account) => account.id));
    const resolvedBindings = body.feeProfileBindings.map((binding) => {
      if (!knownAccountIds.has(binding.accountId)) {
        throw routeError(400, "invalid_account", `Unknown account ${binding.accountId}`);
      }
      const resolvedId = resolveFeeProfileRef(binding.feeProfileRef);
      const resolvedProfile = profilesById.get(resolvedId)!;
      if (resolvedProfile.accountId !== binding.accountId) {
        throw routeError(
          400,
          "invalid_fee_profile",
          `Fee profile ${resolvedId} is not owned by account ${binding.accountId} for binding ${binding.ticker}.`,
        );
      }
      return {
        accountId: binding.accountId,
        ticker: binding.ticker,
        feeProfileId: resolvedId,
      };
    });

    const nextBindings = normalizeBindings(resolvedBindings);

    draftStore.settings = { ...draftStore.settings, ...body.settings };
    draftStore.feeProfiles = nextProfiles;
    draftStore.accounts = nextAccounts;
    // KZO-183: step 3 above already validates each binding's accountId and
    // composite-FK ownership; ensureBindingsAreValid would re-check the same
    // shape and is the validation surface for the other two endpoints
    // (PUT /settings/fee-config + PUT /fee-profile-bindings) which don't run
    // the bulk-save step 3.
    draftStore.feeProfileBindings = nextBindings;

    assertStoreIntegrity(draftStore);
    await app.persistence.saveStore(draftStore);

    return {
      settings: draftStore.settings,
      accounts: draftStore.accounts,
      feeProfiles: draftStore.feeProfiles,
      feeProfileBindings: draftStore.feeProfileBindings,
    };
  });

  app.get("/settings/fee-config", async (req) => {
    const { store } = await loadUserStore(app, req);
    return {
      accounts: store.accounts,
      feeProfiles: store.feeProfiles,
      feeProfileBindings: store.feeProfileBindings,
      integrityIssue: getStoreIntegrityIssue(store),
    };
  });

  app.put("/settings/fee-config", async (req) => {
    const body = z
      .object({
        accounts: z
          .array(
            z.object({
              id: userScopedIdSchema,
              feeProfileId: userScopedIdSchema,
            }),
          )
          .max(200),
        feeProfileBindings: z.array(feeBindingSchema).max(500),
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);
    const draftStore = structuredClone(store);
    const feeProfileIds = new Set(draftStore.feeProfiles.map((profile) => profile.id));

    for (const update of body.accounts) {
      const account = draftStore.accounts.find((item) => item.id === update.id);
      if (!account) {
        throw routeError(404, "account_not_found", `Account ${update.id} was not found.`);
      }
      if (!feeProfileIds.has(update.feeProfileId)) {
        throw routeError(400, "invalid_fee_profile", `Fee profile ${update.feeProfileId} was not found.`);
      }
      const profile = draftStore.feeProfiles.find((item) => item.id === update.feeProfileId);
      if (profile?.accountId !== account.id) {
        throw routeError(
          400,
          "invalid_fee_profile",
          `Fee profile ${update.feeProfileId} is not owned by account ${account.id}.`,
        );
      }
      account.feeProfileId = update.feeProfileId;
    }

    const normalizedBindings = normalizeBindings(body.feeProfileBindings);
    ensureBindingsAreValid(draftStore, normalizedBindings);
    draftStore.feeProfileBindings = normalizedBindings;

    assertStoreIntegrity(draftStore);
    await app.persistence.saveStore(draftStore);

    return {
      accounts: draftStore.accounts,
      feeProfileBindings: draftStore.feeProfileBindings,
    };
  });

  app.get("/accounts", async (req) => {
    const query = z.object({
      includeBalances: z.coerce.boolean().default(false),
    }).parse(req.query);
    const { store } = await loadUserStore(app, req);
    if (query.includeBalances) {
      const balancesByAccount = buildLiveBalancesByAccount(store);
      return store.accounts.map((account) => ({
        ...account,
        liveBalance: balancesByAccount.get(account.id) ?? [],
      }));
    }
    return store.accounts;
  });

  // KZO-179 / KZO-183 — multi-account creation with auto-seeded default
  // fee profile. Per KZO-183 scope item 18 + decision D4:
  //   - Body NO LONGER accepts `feeProfileId`. Fee profiles are now
  //     account-scoped, so the only safe creation path is to seed a fresh
  //     default profile owned by the new account.
  //   - The auto-seeded profile uses `randomUUID()` (NOT a deterministic id).
  //     Both rows are pushed in the same saveStore call so the composite-FK
  //     ownership invariant holds at write time.
  //   - Name uniqueness via explicit 409 pre-check (KZO-179 D3) + TOCTOU
  //     safety net via `isUniqueViolation` after saveStore.
  //   - Bare AccountDto response — flat (no envelope), mirrors POST /fee-profiles.
  app.post("/accounts", async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        // Enum values match migration 040's CHECK constraints.
        defaultCurrency: z.enum(["TWD", "USD", "AUD"]),
        accountType: z.enum(["broker", "bank", "wallet"]),
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);

    // Pre-check (clean 409 UX before TOCTOU safety net). The unique index
    // ux_accounts_user_id_name is the actual enforcement; this just delivers
    // a cleaner error before saveStore runs.
    if (store.accounts.some((account) => account.name === body.name)) {
      throw routeError(409, "account_name_in_use", "An account with that name already exists.");
    }

    // Auto-seed a default fee profile owned by the new account.
    const newAccountId = randomUUID();
    const seededProfile = createDefaultFeeProfile(newAccountId, body.defaultCurrency);

    const account: AccountDto = {
      id: newAccountId,
      userId: store.userId,
      name: body.name,
      feeProfileId: seededProfile.id,
      defaultCurrency: body.defaultCurrency,
      accountType: body.accountType,
    };
    store.feeProfiles.push(seededProfile);
    store.accounts.push(account);

    try {
      await app.persistence.saveStore(store);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw routeError(409, "account_name_in_use", "An account with that name already exists.");
      }
      throw error;
    }

    return account;
  });

  app.patch("/accounts/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        feeProfileId: userScopedIdSchema.optional(),
        // KZO-167: per-account default currency + account type metadata.
        // Enum values match the migration 040 CHECK constraint.
        defaultCurrency: z.enum(["TWD", "USD", "AUD"]).optional(),
        accountType: z.enum(["broker", "bank", "wallet"]).optional(),
      })
      .refine(
        (value) =>
          value.name !== undefined ||
          value.feeProfileId !== undefined ||
          value.defaultCurrency !== undefined ||
          value.accountType !== undefined,
        { message: "at least one field required" },
      )
      .parse(req.body);

    const { store } = await loadUserStore(app, req);

    const account = store.accounts.find((item) => item.id === params.id);
    if (!account) throw routeError(404, "account_not_found", `Account ${params.id} was not found.`);

    if (body.feeProfileId !== undefined) {
      const profile = requireProfile(store, body.feeProfileId);
      if (profile.accountId !== account.id) {
        throw routeError(
          400,
          "invalid_fee_profile",
          `Fee profile ${body.feeProfileId} is not owned by account ${account.id}.`,
        );
      }
      account.feeProfileId = body.feeProfileId;
    }
    if (body.name) account.name = body.name;

    // KZO-167 D7 — defaultCurrency lockdown. Once an account has any cash
    // ledger entry OR any trade event, mutating defaultCurrency would
    // invalidate the existing entries against the (now-stricter) currency
    // guard in cashLedgerService.ts. Reject with 409 currency_change_blocked
    // and steer the operator toward "open a new account" instead.
    if (body.defaultCurrency !== undefined && body.defaultCurrency !== account.defaultCurrency) {
      const hasCashEntries = store.accounting.facts.cashLedgerEntries.some(
        (entry) => entry.accountId === account.id,
      );
      const hasTradeEvents = store.accounting.facts.tradeEvents.some(
        (event) => event.accountId === account.id,
      );
      if (hasCashEntries || hasTradeEvents) {
        throw routeError(
          409,
          "currency_change_blocked",
          "Cannot change default currency: account has existing cash entries or trade events. Open a new account or contact support.",
        );
      }
      account.defaultCurrency = body.defaultCurrency;
    }
    if (body.accountType !== undefined) {
      // KZO-167 D4 — accountType is metadata-only in this ticket. No
      // behavioral gating; downstream tickets (KZO-168 / KZO-170 / KZO-171)
      // will introduce semantics for bank/wallet types.
      account.accountType = body.accountType;
    }
    await app.persistence.saveStore(store);
    return account;
  });

  app.post("/fx-transfers/estimate", async (req) => {
    const body = fxTransferSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      return await estimateFxTransfer(app.persistence, userId, body);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.post("/fx-transfers", async (req) => {
    const body = fxTransferSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      const result = await createFxTransfer(app.persistence, userId, body);
      await publishFxTransferRecompute(app, userId, result.cashBalanceChanges);
      return stripFxTransferSideEffects(result);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.patch("/fx-transfers/:id", async (req) => {
    const params = fxTransferParamsSchema.parse(req.params);
    const body = fxTransferUpdateSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      const result = await updateFxTransfer(app.persistence, userId, params.id, body);
      await publishFxTransferRecompute(app, userId, result.cashBalanceChanges);
      return stripFxTransferSideEffects(result);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.post("/fx-transfers/:id/reverse", async (req) => {
    const params = fxTransferParamsSchema.parse(req.params);
    const body = fxTransferReverseSchema.parse(req.body ?? {});
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      const result = await reverseFxTransfer(app.persistence, userId, params.id, body);
      await publishFxTransferRecompute(app, userId, result.cashBalanceChanges);
      return stripFxTransferSideEffects(result);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.get("/fee-profiles", async (req) => {
    const query = z
      .object({
        account_id: userScopedIdSchema.optional(),
      })
      .parse(req.query);
    const { store } = await loadUserStore(app, req);
    if (!query.account_id) {
      return store.feeProfiles;
    }
    if (!store.accounts.some((account) => account.id === query.account_id)) {
      throw routeError(404, "account_not_found", `Account ${query.account_id} was not found.`);
    }
    return store.feeProfiles.filter((profile) => profile.accountId === query.account_id);
  });

  app.post("/fee-profiles", async (req) => {
    // KZO-183: fee profiles are now account-scoped — `accountId` is required.
    const body = feeProfilePayloadSchema
      .extend({ accountId: userScopedIdSchema })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);

    if (!store.accounts.some((account) => account.id === body.accountId)) {
      throw routeError(404, "account_not_found", `Account ${body.accountId} was not found.`);
    }

    const { accountId, ...rest } = body;
    const profile: FeeProfile = {
      id: randomUUID(),
      accountId,
      ...rest,
    };

    store.feeProfiles.push(profile);
    await app.persistence.saveStore(store);
    return profile;
  });

  app.patch("/fee-profiles/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = feeProfilePayloadSchema.parse(req.body);

    const { store } = await loadUserStore(app, req);
    const profile = requireProfile(store, params.id);

    Object.assign(profile, body);
    await app.persistence.saveStore(store);
    return profile;
  });

  app.delete("/fee-profiles/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const { store } = await loadUserStore(app, req);

    const target = store.feeProfiles.find((profile) => profile.id === params.id);
    if (!target) {
      throw routeError(404, "fee_profile_not_found", `Fee profile ${params.id} was not found.`);
    }

    // KZO-183: must_keep_one_profile is now per-account. Each account must
    // retain at least one profile so the composite-FK ownership invariant
    // holds.
    const profilesForAccount = store.feeProfiles.filter((profile) => profile.accountId === target.accountId);
    if (profilesForAccount.length <= 1) {
      throw routeError(400, "must_keep_one_profile", "Each account must keep at least one fee profile.");
    }

    const isDefaultInUse = store.accounts.some((account) => account.feeProfileId === params.id);
    const isOverrideInUse = store.feeProfileBindings.some((binding) => binding.feeProfileId === params.id);
    const isTransactionInUse = listTradeEvents(store).some((tx) => tx.feeSnapshot.id === params.id);
    if (isDefaultInUse || isOverrideInUse || isTransactionInUse) {
      throw routeError(
        409,
        "fee_profile_in_use",
        "Fee profile is still used by accounts, bindings, or historical transactions.",
      );
    }

    store.feeProfiles = store.feeProfiles.filter((profile) => profile.id !== params.id);
    await app.persistence.saveStore(store);
    return { deletedId: params.id };
  });

  app.get("/fee-profile-bindings", async (req) => {
    const { store } = await loadUserStore(app, req);
    return store.feeProfileBindings;
  });

  app.put("/fee-profile-bindings", async (req) => {
    const body = z.object({ bindings: z.array(feeBindingSchema).max(500) }).parse(req.body);
    const { store } = await loadUserStore(app, req);

    const normalizedBindings = normalizeBindings(body.bindings);
    ensureBindingsAreValid(store, normalizedBindings);

    store.feeProfileBindings = normalizedBindings;
    assertStoreIntegrity(store);
    await app.persistence.saveStore(store);
    return store.feeProfileBindings;
  });

  app.get("/market-data/price", async (req, reply) => {
    // Authenticate-only: this route has no per-user state. The resolveUserId
    // call throws on missing/invalid auth in oauth mode, then we discard the id.
    resolveUserId(req, app.oauthConfig?.sessionSecret);
    assertMarketDataPriceRateLimit(req.ip);

    // KZO-170 S7: clients now pin `marketCode` explicitly. The previous `resolveMarketCode(ticker)`
    // heuristic returned `'TW'` for every ticker — fine when the codebase only knew TW, but
    // structurally wrong now that US/AU markets exist. Web callers (`fetchMarketDataPrice`)
    // pass `marketCode` from the form's account-derived market.
    const query = z.object({
      ticker: tickerSchema,
      date: isoDateSchema,
      market_code: z.enum(["TW", "US", "AU"]),
    }).parse(req.query);

    if (query.date > todayIsoDate()) {
      throw routeError(400, "invalid_date", "date must not be in the future");
    }

    const lookbackStartDate = daysBeforeIsoDate(query.date, 7);
    const storedBars = await app.persistence.getDailyBarsForTicker(query.ticker, lookbackStartDate, query.date);
    const storedMatch = findMostRecentBar(storedBars, query.date);
    if (storedMatch) {
      return buildPriceLookupResponse(storedMatch, query.date);
    }

    // KZO-163: route through the per-market provider registry. The provider's internal rate
    // limiter throws RateLimitedError when the shared FinMind budget is exhausted; surface
    // that as 503 + Retry-After so clients can back off intelligently. Distinct from the
    // per-IP 429 emitted by `assertMarketDataPriceRateLimit` above. (N8 behavioral delta.)
    const market = query.market_code;
    const provider = app.marketDataRegistry.marketData.get(market);
    if (!provider) {
      throw routeError(404, "price_not_found", "price not found");
    }

    let fetchedBars: DailyBar[];
    try {
      const rawBars = await provider.fetchBars(query.ticker, lookbackStartDate, query.date);
      fetchedBars = rawBars
        .filter((bar) => bar.barDate >= lookbackStartDate && bar.barDate <= query.date)
        .sort((left, right) => left.barDate.localeCompare(right.barDate))
        .map((bar) => ({
          ...bar,
          // KZO-163 D7: forward provider's sourceId so KZO-164/170 providers report correctly.
          // Today every TW bar has sourceId='finmind'; the fallback preserves that behavior.
          source: bar.sourceId ?? "finmind",
          ingestedAt: new Date().toISOString(),
        }));
    } catch (err) {
      if (err instanceof RateLimitedError) {
        reply.header("Retry-After", String(err.retryAfterSeconds));
        throw routeError(503, "provider_rate_limited", "market data provider rate limit exceeded");
      }
      throw routeError(404, "price_not_found", "price not found");
    }

    const fetchedMatch = findMostRecentBar(fetchedBars, query.date);
    if (!fetchedMatch) {
      throw routeError(404, "price_not_found", "price not found");
    }

    await opportunisticUpsertDailyBars(app.persistence, fetchedBars, market);
    return buildFetchedPriceLookupResponse(fetchedMatch, query.date);
  });

  /**
   * KZO-172 — bounded autocomplete for instrument lookup. AU is the primary consumer
   * (Yahoo's per-query `search()` over the ASX universe); TW/US implement
   * `searchInstruments` as no-ops (their UI uses the persisted catalog dump). KZO-188
   * wires a web-side fallback that calls this endpoint when the catalog returns no
   * matches.
   *
   * Two distinct rate-limit gates per `.claude/rules/service-error-pattern.md`:
   *   - Per-IP 429 (`assertMarketDataSearchRateLimit`) — client identity throttle.
   *   - Per-provider 503 + Retry-After — Yahoo's bounded budget exhausted.
   *
   * Generic upstream failures (e.g. Yahoo HTML breakage per spike issue #967) collapse
   * to 503 + `X-Search-Degraded: true` so the web UI can render a "search temporarily
   * unavailable" affordance without leaking provider internals.
   */
  app.get("/market-data/search", async (req, reply) => {
    resolveUserId(req, app.oauthConfig?.sessionSecret);
    assertMarketDataSearchRateLimit(req.ip);

    const query = z.object({
      // Tight allow-list — alphanumerics + a small set of common name punctuation
      // (`.`, `&`, `'`, `()`, `-`, space). Rejects path-traversal / SQL-meta /
      // NUL / non-ASCII to keep abuse off Yahoo's upstream search.
      q: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9 .&'()-]+$/),
      market_code: z.enum(["TW", "US", "AU"]),
    }).parse(req.query);

    const provider = app.marketDataRegistry.catalog.get(query.market_code);
    if (!provider) {
      throw routeError(404, "market_not_supported", "market not supported");
    }

    let raws: Awaited<ReturnType<typeof provider.searchInstruments>>;
    try {
      raws = await provider.searchInstruments(query.q);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        reply.header("Retry-After", String(err.retryAfterSeconds));
        throw routeError(503, "provider_rate_limited", "market data search rate limit exceeded");
      }
      app.log.warn({ err, q: query.q, market: query.market_code }, "search_provider_error");
      reply.header("X-Search-Degraded", "true");
      throw routeError(503, "search_unavailable", "search temporarily unavailable");
    }

    return {
      instruments: raws.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        instrumentType: classifyInstrument(r.industryCategory, r.ticker, query.market_code),
        marketCode: query.market_code,
        // Search results are upstream candidates, not yet persisted catalog rows.
        // The DTO requires these fields; null/"pending" are the truthful defaults
        // (the actual catalog row, if any, is reachable via `/instruments/catalog`).
        barsBackfillStatus: "pending" as const,
        lastRepairAt: null,
        repairAvailableAt: null,
      })),
    };
  });

  app.post("/portfolio/transactions", async (req) => {
    const body = transactionSchema.parse(req.body);

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      throw routeError(400, "idempotency_key_required", "idempotency-key header required");
    }

    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const store = await app.persistence.loadStore(userId);
    const draftStore = structuredClone(store);
    assertStoreIntegrity(draftStore);

    // KZO-169: server-side currency_mismatch guard. Trade currency derives
    // from `currencyFor(body.marketCode)`; reject when the chosen account's
    // defaultCurrency disagrees. This is the safety net for stale-state
    // clients and bulk-import paths that miss the chip filter.
    const account = draftStore.accounts.find((a) => a.id === body.accountId);
    if (!account) {
      throw routeError(404, "account_not_found", "Account not found");
    }
    const tradeCurrency = currencyFor(body.marketCode);
    if (account.defaultCurrency !== tradeCurrency) {
      throw routeError(
        400,
        "currency_mismatch",
        `Trade currency ${tradeCurrency} does not match account currency ${account.defaultCurrency}`,
      );
    }

    // KZO-183: hydrate the persisted instrument catalog into draftStore so the
    // market guard sees the canonical marketCode rather than the provisional
    // default of "TW" produced by ensureInstrumentDefinition. KZO-169: the
    // lookup is now scoped by (ticker, marketCode) per migration 044's PK.
    const persistedInstrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
    if (persistedInstrument) {
      setStoreInstruments(
        draftStore,
        upsertInstrumentDefinitions(draftStore.instruments, [{
          ticker: persistedInstrument.ticker,
          type: persistedInstrument.instrumentType ?? null,
          marketCode: persistedInstrument.marketCode,
          isProvisional: persistedInstrument.isProvisional,
          lastSyncedAt: null,
        }]),
      );
    }
    const ensured = ensureInstrumentDefinition(draftStore, body.ticker, body.marketCode);

    if (ensured.instrument.type === null) {
      throw routeError(400, "unclassified_instrument", "Cannot create trades for unclassified instruments");
    }

    const tx = createTransaction(draftStore, userId, {
      ...body,
      id: randomUUID(),
    });

    const claimed = await app.persistence.claimIdempotencyKey(userId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }

    try {
      if (ensured.created) {
        await app.persistence.upsertInstruments(userId, [ensured.instrument]);
      }
      await app.persistence.savePostedTrade(userId, draftStore.accounting, tx.id);
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(userId, idempotencyKey);
      throw error;
    }

    // KZO-37 Invariant 5: a new trade may make a historical dividend
    // retroactively eligible. Fire the replay (which includes dividend
    // ledger recompute) after savePostedTrade commits. Fire-and-forget —
    // POST remains 200 and the client refetches on SSE.
    scheduleReplayWithRetry(app.persistence, app.eventBus, userId, tx.accountId, tx.ticker, {
      snapshotFromDate: tx.tradeDate,
    });

    // KZO-126: First-trade backfill trigger
    if (app.boss && !isDemo) {
      // KZO-169: lookup by composite (ticker, marketCode); singletonKey is
      // composite so BHP/AU and BHP/US don't compete for the same slot.
      const instrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
      // Skip if ticker not in catalog, or already ready
      if (instrument && instrument.barsBackfillStatus !== "ready") {
        await app.boss.send(
          BACKFILL_QUEUE,
          {
            ticker: body.ticker,
            marketCode: body.marketCode,
            userId,
            trigger: "first_trade",
          } satisfies BackfillJobData,
          { singletonKey: `${body.ticker}:${body.marketCode}`, priority: 0 },
        );
      }
    }

    return tx;
  });

  app.post("/portfolio/transactions/estimate", async (req) => {
    const body = z.object({
      ticker: tickerSchema,
      // KZO-169 (G2): estimate body now requires marketCode so the trade
      // currency derives from the instrument's market_code via currencyFor().
      // Replaces the previous fee-profile-currency derivation.
      marketCode: marketCodeSchema,
      quantity: z.number().int().positive(),
      unitPrice: z.number().positive().multipleOf(0.01),
      type: z.enum(["BUY", "SELL"]),
      isDayTrade: z.boolean().default(false),
      accountId: userScopedIdSchema,
    }).parse(req.body);

    const { store } = await loadUserStore(app, req);
    const account = store.accounts.find((item) => item.id === body.accountId);
    if (!account) {
      throw routeError(404, "account_not_found", "Account not found");
    }

    // KZO-169: resolve instrument by composite (ticker, marketCode); fall
    // back to a STOCK assumption when the catalog row is absent (the form
    // can request an estimate before the instrument is committed).
    const instrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
    const marketCode = body.marketCode;
    const instrumentType: InstrumentType = instrument?.instrumentType ?? "STOCK";
    const profile = resolveTransactionFeeProfile(store, account.id, body.ticker);
    // KZO-169 (D3): trade currency derives from instrument.market_code via
    // `currencyFor()`. The previous `profile.commissionCurrency ?? "TWD"`
    // was a provider-stamping audit (G1) target.
    const tradeCurrency = currencyFor(marketCode);
    const tradeValueAmount = roundToDecimal(body.quantity * body.unitPrice, 2);

    const fees = body.type === "BUY"
      ? calculateBuyFees(profile, tradeValueAmount, tradeCurrency)
      : calculateSellFees(profile, {
          tradeValueAmount,
          tradeCurrency,
          instrumentType,
          isDayTrade: body.isDayTrade,
          marketCode,
        });

    return {
      commissionAmount: fees.commissionAmount,
      taxAmount: fees.taxAmount,
    };
  });

  // --- Transaction Mutation Routes (KZO-114) ---

  const patchTransactionSchema = z.object({
    date: isoDateSchema.optional(),
    quantity: z.number().int().positive().optional(),
    price: z.number().positive().multipleOf(0.01).optional(),
    side: z.enum(["BUY", "SELL"]).optional(),
    confirmFeeRecalculation: z.boolean().optional(),
    keepManualFees: z.boolean().optional(),
  }).refine(
    (data) => data.date || data.quantity || data.price || data.side,
    { message: "At least one field must be provided" },
  );

  app.delete("/portfolio/transactions/:tradeEventId", async (req, reply) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    // Verify ownership and get accountId/ticker
    const trade = await app.persistence.getTradeEvent(userId, tradeEventId);
    if (!trade) throw routeError(404, "trade_event_not_found", "Trade event not found");

    req.log.info({
      msg: "trade_event_delete",
      tradeEventId,
      accountId: trade.accountId,
      ticker: trade.ticker,
      type: trade.type,
      quantity: trade.quantity,
    });

    const result = await app.persistence.deleteTradeEvent(userId, tradeEventId);

    // Schedule async recompute — snapshots from the deleted trade's date
    // onward may change, nothing before that can.
    scheduleReplayWithRetry(app.persistence, app.eventBus, userId, result.accountId, result.ticker, {
      snapshotFromDate: trade.tradeDate,
    });

    reply.code(202);
    return {
      accountId: result.accountId,
      ticker: result.ticker,
      deletedTradeEventId: tradeEventId,
      deletedChildRows: result.deletedChildRows,
    };
  });

  app.patch("/portfolio/transactions/:tradeEventId", async (req, reply) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const body = patchTransactionSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const trade = await app.persistence.getTradeEvent(userId, tradeEventId);
    if (!trade) throw routeError(404, "trade_event_not_found", "Trade event not found");

    // Build patch
    const patch: import("../persistence/types.js").TradeEventPatch = {};
    const changedFields: string[] = [];

    if (body.date !== undefined && body.date !== trade.tradeDate) {
      patch.date = body.date;
      changedFields.push("date");
    }
    if (body.quantity !== undefined && body.quantity !== trade.quantity) {
      patch.quantity = body.quantity;
      changedFields.push("quantity");
    }
    if (body.price !== undefined && body.price !== trade.unitPrice) {
      patch.price = body.price;
      changedFields.push("price");
    }
    if (body.side !== undefined && body.side !== trade.type) {
      patch.side = body.side;
      changedFields.push("side");
    }

    if (changedFields.length === 0) {
      throw routeError(400, "no_changes", "No fields changed");
    }

    // Fee recalculation check
    const feeFieldsChanged = changedFields.includes("quantity") || changedFields.includes("price");
    if (feeFieldsChanged) {
      const feesSource = trade.feesSource ?? "CALCULATED";

      if (feesSource === "MANUAL" && !body.confirmFeeRecalculation && !body.keepManualFees) {
        return reply.code(200).send({ requiresFeeConfirmation: true, tradeEventId });
      }

      if (feesSource === "MANUAL" && body.keepManualFees) {
        // Keep existing fees — no recalculation
      } else {
        // Recalculate fees from bound fee profile
        const newQuantity = body.quantity ?? trade.quantity;
        const newPrice = body.price ?? trade.unitPrice;
        const tradeValue = newQuantity * newPrice;
        const newSide = body.side ?? trade.type;

        const fees = newSide === "BUY"
          ? calculateBuyFees(trade.feeSnapshot, tradeValue, trade.priceCurrency)
          : calculateSellFees(trade.feeSnapshot, {
              tradeValueAmount: tradeValue,
              tradeCurrency: trade.priceCurrency,
              instrumentType: trade.instrumentType,
              isDayTrade: trade.isDayTrade,
              marketCode: trade.marketCode,
            });

        patch.commissionAmount = fees.commissionAmount;
        patch.taxAmount = fees.taxAmount;
        patch.feesSource = "CALCULATED";
      }
    }

    await app.persistence.updateTradeEvent(userId, tradeEventId, patch);

    // Schedule async recompute — use min(oldTradeDate, newTradeDate) so a
    // patch that moves the trade earlier regenerates the earlier window too.
    const effectiveFromDate = patch.date && patch.date < trade.tradeDate ? patch.date : trade.tradeDate;
    scheduleReplayWithRetry(app.persistence, app.eventBus, userId, trade.accountId, trade.ticker, {
      snapshotFromDate: effectiveFromDate,
    });

    reply.code(202);
    return {
      accountId: trade.accountId,
      ticker: trade.ticker,
      updatedTradeEventId: tradeEventId,
      changedFields,
    };
  });

  app.get("/portfolio/transactions/:tradeEventId/preview-impact", async (req) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const query = z.object({
      action: z.enum(["delete", "patch"]),
      quantity: z.coerce.number().int().positive().optional(),
      price: z.coerce.number().int().positive().optional(),
      side: z.enum(["BUY", "SELL"]).optional(),
      date: isoDateSchema.optional(),
    }).parse(req.query);

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const trade = await app.persistence.getTradeEvent(userId, tradeEventId);
    if (!trade) throw routeError(404, "trade_event_not_found", "Trade event not found");

    // Count affected rows
    const store = await app.persistence.loadStore(userId);
    const cashEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) => e.relatedTradeEventId === tradeEventId,
    ).length;
    const lotAllocs = store.accounting.projections.lotAllocations.filter(
      (a) => a.tradeEventId === tradeEventId,
    ).length;
    // For a patch that moves the trade earlier, the affected snapshot window
    // extends back to the new date — use min(old, new) for an accurate count.
    const effectiveSnapshotFromDate = query.action === "patch" && query.date && query.date < trade.tradeDate
      ? query.date
      : trade.tradeDate;
    const holdingSnapshots = await app.persistence.countHoldingSnapshotsAfterDate(
      userId, trade.accountId, trade.ticker, effectiveSnapshotFromDate,
    );

    // Check for negative lots
    let negativeLots = { wouldOccur: false, resultingQuantity: 0, ticker: trade.ticker };

    if (query.action === "delete" || query.side || query.quantity) {
      const accountTrades = store.accounting.facts.tradeEvents
        .filter((t) => t.accountId === trade.accountId && t.ticker === trade.ticker)
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));

      let simulatedQty = 0;
      let wouldGoNegative = false;

      for (const t of accountTrades) {
        if (query.action === "delete" && t.id === tradeEventId) continue;

        const qty = t.id === tradeEventId ? (query.quantity ?? t.quantity) : t.quantity;
        const side = t.id === tradeEventId ? (query.side ?? t.type) : t.type;

        if (side === "BUY") {
          simulatedQty += qty;
        } else {
          simulatedQty -= qty;
          if (simulatedQty < 0) wouldGoNegative = true;
        }
      }

      negativeLots = {
        wouldOccur: wouldGoNegative,
        resultingQuantity: simulatedQty,
        ticker: trade.ticker,
      };
    }

    return {
      affectedRows: {
        cashLedgerEntries: cashEntries,
        lotAllocations: lotAllocs,
        feePolicySnapshots: 1,
        holdingSnapshots,
      },
      negativeLots,
    };
  });

  app.get("/portfolio/transactions", async (req) => {
    const query = z.object({
      ticker: tickerSchema.optional(),
      accountId: userScopedIdSchema.optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(req.query);
    const { store } = await loadUserStore(app, req);
    const items = listTradeEvents(store)
      .filter((trade) => (query.ticker ? trade.ticker === query.ticker : true))
      .filter((trade) => (query.accountId ? trade.accountId === query.accountId : true))
      .sort(compareTransactionsForHistory)
      .map(mapTransactionHistoryItem);
    return query.limit ? items.slice(0, query.limit) : items;
  });

  app.get("/portfolio/holdings", async (req) => {
    const { store, userId } = await loadUserStore(app, req);
    assertStoreIntegrity(store);
    return listHoldings(store, userId);
  });

  app.get("/dashboard/overview", async (req) => {
    const { store, userId } = await loadUserStore(app, req);
    const holdings = listHoldings(store, userId);
    const symbols = [...new Set(
      holdings
        .map((holding) => holding.ticker)
        .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
    )];
    // KZO-180 review L1: prefs read parallelized with the quote-snapshot fetch
    // (both are I/O against the same persistence backend; neither depends on
    // the other). Saves one round-trip on the hot dashboard path.
    const [snapshotMap, prefs] = await Promise.all([
      resolveQuoteSnapshots(symbols, app.persistence),
      app.persistence.getUserPreferences(userId),
    ]);
    const quotes = Object.values(snapshotMap).filter((s): s is QuoteSnapshot => s !== null);

    // KZO-180: build the native overview, then translate the summary KPIs into
    // the user's reporting currency. Per-holding rows on `holdings[]` and
    // per-event rows on `dividends.*` stay native (D3) — the UI uses each
    // holding's own currency for those labels.
    const overview = buildDashboardOverview(store, {
      integrityIssue: getStoreIntegrityIssue(store),
      quotes,
    });
    const reportingCurrency = resolveReportingCurrency(prefs);
    const translatedSummary = await translateOverviewSummary(
      overview.summary,
      overview.holdings,
      overview.dividends,
      reportingCurrency,
      overview.summary.asOf,
      app.persistence,
    );
    return { ...overview, summary: translatedSummary };
  });

  app.get("/dashboard/performance", async (req) => {
    // KZO-159 (158A): validate `range` against the per-user effective list
    // (user pref → admin → hardcoded default). Requests with a `range` value
    // that's not in the effective list are rejected with 400.
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    // KZO-180 review M2: read prefs once, thread into resolveEffectiveRanges
    // so the resolver doesn't issue a duplicate row read for the same user.
    const prefs = await app.persistence.getUserPreferences(userId);
    const { ranges } = await resolveEffectiveRanges(app.persistence, userId, prefs);
    const reportingCurrency = resolveReportingCurrency(prefs);
    const rangeEnumValues = ranges as [string, ...string[]];
    const query = z.object({
      range: z.enum(rangeEnumValues).default(rangeEnumValues[0]),
    }).parse(req.query);
    const { store } = await loadUserStore(app, req);
    const symbols = [...new Set(
      store.accounting.facts.tradeEvents
        .map((trade) => trade.ticker)
        .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
    )];
    const snapshotMap = await resolveQuoteSnapshots(symbols, app.persistence);
    const quotes = Object.values(snapshotMap).filter((s): s is QuoteSnapshot => s !== null);

    // KZO-180: replaces `buildDashboardPerformance` with the FX-aware aggregator.
    // The aggregator reads `daily_holding_snapshots` first (FX-aware via the
    // persistence method's LATERAL JOIN with D8 self-pair guard), then falls
    // back to a synthetic FX-aware path when no snapshots exist.
    const asOf = quotes[0]?.asOf ?? new Date().toISOString();
    return translatePerformancePoints(
      userId,
      query.range as DashboardPerformanceRange,
      asOf,
      reportingCurrency,
      app.persistence,
      store,
      quotes,
    );
  });

  app.get("/dividend-events", async (req) => {
    const query = dividendDateRangeQuerySchema.parse(req.query);
    const { userId, store } = await loadUserStore(app, req);
    const dividendEvents = await app.persistence.listDividendEventsByPaymentDate(
      userId,
      query.fromPaymentDate,
      query.toPaymentDate,
      query.limit,
    );

    return {
      dividendEvents: buildDividendEventListItems(store, dividendEvents),
    };
  });

  app.get("/portfolio/dividends/ledger", async (req) => {
    const query = dividendLedgerQuerySchema.parse(req.query);
    const { userId, store } = await loadUserStore(app, req);
    const result = await app.persistence.listDividendLedgerEntries(userId, {
      accountId: query.accountId,
      fromPaymentDate: query.fromPaymentDate,
      toPaymentDate: query.toPaymentDate,
      reconciliationStatus: query.reconciliationStatus,
      postingStatus: query.postingStatus,
      ticker: query.ticker,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return {
      ledgerEntries: buildDividendLedgerEntryDetails(store, result.ledgerEntries, { preserveOrder: true }),
      total: result.total,
      aggregates: result.aggregates,
    };
  });

  app.get("/portfolio/dividends/ledger/years", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return app.persistence.listDividendLedgerYears(userId);
  });

  app.get("/portfolio/cash-ledger", async (req) => {
    const query = cashLedgerQuerySchema.parse(req.query);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const result = await app.persistence.listCashLedgerEntries(userId, {
      fromEntryDate: query.fromEntryDate,
      toEntryDate: query.toEntryDate,
      accountId: query.accountId,
      entryType: query.entryType,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    // Load store for enrichment maps (O(1) lookups)
    const { store } = await loadUserStore(app, req);
    const tradeMap = new Map(listTradeEvents(store).map(t => [t.id, t]));
    const dividendLedgerMap = new Map(listDividendLedgerEntries(store).map(d => [d.id, d]));
    const dividendEventMap = new Map(store.marketData.dividendEvents.map(e => [e.id, e]));
    const accountsById = new Map(store.accounts.map((account) => [account.id, account]));
    const fxOriginalLegsByTransferId = new Map<string, { out?: CashLedgerStoreEntry; in?: CashLedgerStoreEntry }>();
    const reversedFxTransferIds = new Set<string>();
    for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
      if (!cashEntry.fxTransferId) continue;
      if (cashEntry.reversalOfCashLedgerEntryId) {
        reversedFxTransferIds.add(cashEntry.fxTransferId);
        continue;
      }
      const bucket = fxOriginalLegsByTransferId.get(cashEntry.fxTransferId) ?? {};
      if (cashEntry.entryType === "FX_TRANSFER_OUT") bucket.out = cashEntry;
      if (cashEntry.entryType === "FX_TRANSFER_IN") bucket.in = cashEntry;
      fxOriginalLegsByTransferId.set(cashEntry.fxTransferId, bucket);
    }

    // Build deduction total map: sum actual DividendDeductionEntry amounts per ledger entry
    const deductionTotals = new Map<string, number>();
    for (const d of listDividendDeductionEntries(store)) {
      deductionTotals.set(d.dividendLedgerEntryId, (deductionTotals.get(d.dividendLedgerEntryId) ?? 0) + d.amount);
    }

    // Enrich paginated entries
    const enriched = result.entries.map(entry => {
      let ticker: string | null = null;
      let side: "BUY" | "SELL" | null = null;
      let tradeDetail: {
        quantity: number;
        unitPrice: number;
        commissionAmount: number;
        taxAmount: number;
      } | undefined;
      let dividendDetail: {
        expectedCashAmount: number;
        receivedCashAmount: number;
        deductionTotal: number;
      } | undefined;
      let fxTransferDetail: {
        pairedAccountId: string;
        pairedAccountName: string;
        pairedAmount: number;
        pairedCurrency: string;
        effectiveRate: number;
      } | undefined;
      let fxTransferReversed: boolean | undefined;

      if (entry.relatedTradeEventId) {
        const trade = tradeMap.get(entry.relatedTradeEventId);
        if (trade) {
          ticker = trade.ticker;
          side = trade.type;
          tradeDetail = {
            quantity: trade.quantity,
            unitPrice: trade.unitPrice,
            commissionAmount: trade.commissionAmount,
            taxAmount: trade.taxAmount,
          };
        }
      }

      if (entry.relatedDividendLedgerEntryId) {
        const dle = dividendLedgerMap.get(entry.relatedDividendLedgerEntryId);
        if (dle) {
          const event = dividendEventMap.get(dle.dividendEventId);
          ticker = event?.ticker ?? null;
          dividendDetail = {
            expectedCashAmount: dle.expectedCashAmount,
            receivedCashAmount: dle.receivedCashAmount,
            deductionTotal: roundToDecimal(deductionTotals.get(dle.id) ?? 0, 2),
          };
        }
      }

      if (entry.fxTransferId) {
        fxTransferReversed = reversedFxTransferIds.has(entry.fxTransferId);
        const pair = fxOriginalLegsByTransferId.get(entry.fxTransferId);
        if (pair?.out && pair.in && (entry.entryType === "FX_TRANSFER_OUT" || entry.entryType === "FX_TRANSFER_IN")) {
          const paired = entry.entryType === "FX_TRANSFER_OUT" ? pair.in : pair.out;
          const pairedAccount = accountsById.get(paired.accountId);
          fxTransferDetail = {
            pairedAccountId: paired.accountId,
            pairedAccountName: pairedAccount?.name ?? paired.accountId,
            pairedAmount: Math.abs(paired.amount),
            pairedCurrency: paired.currency,
            effectiveRate: roundToDecimal(pair.in.amount / Math.abs(pair.out.amount), 8),
          };
        }
      }

      return { ...entry, ticker, side, tradeDetail, dividendDetail, fxTransferDetail, fxTransferReversed };
    });

    // Round summary amounts
    const summary = result.summary.map(s => ({
      ...s,
      amount: roundToDecimal(s.amount, 2),
    }));

    return { entries: enriched, summary, total: result.total };
  });

  app.post("/portfolio/dividends/postings", async (req) => {
    const body = dividendPostingSchema.parse(req.body);
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      throw routeError(400, "idempotency_key_required", "idempotency-key header required");
    }

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const store = await app.persistence.loadStore(userId);
    const draftStore = structuredClone(store);
    assertStoreIntegrity(draftStore);
    requireAccount(draftStore, body.accountId);

    const claimed = await app.persistence.claimIdempotencyKey(userId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }

    try {
      if (body.dividendLedgerEntryId) {
        const prepared = preparePostedCashDividendUpdate(draftStore, userId, {
          accountId: body.accountId,
          dividendEventId: body.dividendEventId,
          dividendLedgerEntryId: body.dividendLedgerEntryId,
          expectedVersion: body.expectedVersion!,
          receivedCashAmount: body.receivedCashAmount,
          deductions: body.deductions.map((entry) => ({
            id: randomUUID(),
            deductionType: entry.deductionType,
            amount: entry.amount,
            currencyCode: entry.currencyCode,
            withheldAtSource: entry.withheldAtSource,
            source: entry.source,
            sourceReference: entry.sourceReference,
            note: entry.note,
          })),
          sourceLines: body.sourceLines.map((entry) => ({
            id: entry.id ?? randomUUID(),
            sourceBucket: entry.sourceBucket,
            amount: entry.amount,
            currencyCode: entry.currencyCode,
            source: entry.source,
            sourceReference: entry.sourceReference,
            note: entry.note,
          })),
          sourceCompositionStatus: body.sourceCompositionStatus,
        });

        await app.persistence.updatePostedCashDividend(userId, prepared.persistenceInput);
        await app.eventBus.publishEvent(userId, "dividend_updated", {
          dividendLedgerEntryId: prepared.response.dividendLedgerEntry.id,
          dividendEventId: prepared.response.dividendEvent.id,
          accountId: prepared.response.dividendLedgerEntry.accountId,
          version: prepared.response.dividendLedgerEntry.version,
        });
        return prepared.response;
      }

      const result = postDividend(draftStore, userId, {
        id: randomUUID(),
        accountId: body.accountId,
        dividendEventId: body.dividendEventId,
        receivedCashAmount: body.receivedCashAmount,
        receivedStockQuantity: body.receivedStockQuantity,
        deductions: body.deductions.map((entry) => ({
          id: randomUUID(),
          deductionType: entry.deductionType,
          amount: entry.amount,
          currencyCode: entry.currencyCode,
          withheldAtSource: entry.withheldAtSource,
          source: entry.source,
          sourceReference: entry.sourceReference,
          note: entry.note,
        })),
        sourceLines: body.sourceLines.map((entry) => ({
          id: entry.id ?? randomUUID(),
          sourceBucket: entry.sourceBucket,
          amount: entry.amount,
          currencyCode: entry.currencyCode,
          source: entry.source,
          sourceReference: entry.sourceReference,
          note: entry.note,
        })),
        sourceCompositionStatus: body.sourceCompositionStatus,
      });

      await app.persistence.savePostedDividend(
        userId,
        draftStore.accounting,
        draftStore.marketData,
        result.dividendLedgerEntry.id,
      );
      await app.eventBus.publishEvent(userId, "dividend_posted", {
        dividendLedgerEntryId: result.dividendLedgerEntry.id,
        dividendEventId: result.dividendEvent.id,
        accountId: result.dividendLedgerEntry.accountId,
        version: result.dividendLedgerEntry.version,
      });
      return result;
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(userId, idempotencyKey);
      throw error;
    }
  });

  app.patch("/portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation", async (req) => {
    const params = z.object({ dividendLedgerEntryId: userScopedIdSchema }).parse(req.params);
    const body = dividendReconciliationSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const ownedEntry = await app.persistence.findDividendLedgerEntryById(userId, params.dividendLedgerEntryId);
    if (!ownedEntry) {
      throw routeError(403, "forbidden", "Dividend ledger entry does not belong to the authenticated user");
    }

    await app.persistence.updateDividendReconciliationStatus(
      userId,
      params.dividendLedgerEntryId,
      body.status,
      body.note?.trim() || undefined,
    );

    // Direct primary-key lookup — safe regardless of how many historical
    // rows the account has accumulated. Replaces a former scan-and-filter
    // over a 500-entry page which could falsely 404 on large accounts.
    const detailedEntry = await app.persistence.getDividendLedgerEntryWithDetails(
      userId,
      params.dividendLedgerEntryId,
    );
    if (!detailedEntry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    const store = await app.persistence.loadStore(userId);
    const ledgerEntry = buildDividendLedgerEntryDetails(store, [detailedEntry])[0];
    if (!ledgerEntry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    await app.eventBus.publishEvent(userId, "dividend_reconciliation_changed", {
      dividendLedgerEntryId: ledgerEntry.id,
      dividendEventId: ledgerEntry.dividendEventId,
      accountId: ledgerEntry.accountId,
      reconciliationStatus: ledgerEntry.reconciliationStatus,
      version: ledgerEntry.version,
    });

    return { ledgerEntry };
  });

  app.get("/corporate-actions", async (req) => {
    const { store } = await loadUserStore(app, req);
    return listCorporateActions(store);
  });

  app.post("/corporate-actions", async (req) => {
    const body = corporateActionSchema.parse(req.body);
    const { store } = await loadUserStore(app, req);
    assertStoreIntegrity(store);
    requireAccount(store, body.accountId);

    const action = applyCorporateAction(store, {
      id: randomUUID(),
      ...body,
    });

    await app.persistence.saveAccountingStore(store.userId, store.accounting);
    return action;
  });

  app.post("/portfolio/snapshots/generate", async (req, reply) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const generationRunId = randomUUID();

    reply.code(202).send({ generationRunId });

    setImmediate(async () => {
      try {
        const result = await generateHoldingSnapshots(userId, app.persistence, { generationRunId });

        // KZO-185: producer stamps marketCode from the walker's result. Composite
        // singletonKey `${ticker}:${marketCode}` so BHP/AU + BHP/US don't share
        // a slot when both surface in the same regen.
        if (app.boss && result.tickersNeedingBackfill.length > 0) {
          for (const { ticker, marketCode } of result.tickersNeedingBackfill) {
            try {
              await app.boss.send(
                BACKFILL_QUEUE,
                {
                  ticker,
                  marketCode: marketCode as BackfillJobData["marketCode"],
                  trigger: "first_trade",
                  includeBars: true,
                } satisfies BackfillJobData,
                { singletonKey: `${ticker}:${marketCode}` },
              );
            } catch {
              // Backfill queue unavailable — provisional data remains
            }
          }
        }

        await app.eventBus.publishEvent(userId, "snapshots_generated", {
          status: "ok",
          totalRows: result.totalRows,
          provisionalRows: result.provisionalRows,
          dateRange: result.dateRange ?? null,
          generationRunId: result.generationRunId,
        });

        // KZO-165: run the wallet aggregator AFTER the holding snapshots succeed.
        // Wrap in its own try/catch so a wallet failure does not mask a successful
        // holding-snapshot generation. Emit a distinct SSE event so the client can
        // render the wallet-stub failure separately if KZO-176's dashboard reads it.
        try {
          await generateCurrencyWalletSnapshots(userId, app.persistence);
        } catch (walletError) {
          const walletMessage = walletError instanceof Error ? walletError.message : String(walletError);
          console.error("[snapshot-generate:wallet] Failed:", walletMessage);
          try {
            await app.eventBus.publishEvent(userId, "wallet_generation_failed", {
              error: walletMessage,
            });
          } catch { /* swallow — best effort */ }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[snapshot-generate] Failed:", message);
        // Surface the failure with a distinct status so the client can render
        // an error state instead of "0 snapshots generated" success text.
        try {
          await app.eventBus.publishEvent(userId, "snapshots_generated", {
            status: "error",
            totalRows: 0,
            provisionalRows: 0,
            dateRange: null,
            generationRunId,
            error: message,
          });
        } catch { /* swallow — best effort */ }
      }
    });

    return reply;
  });

  app.post("/portfolio/recompute/preview", async (req) => {
    const body = z
      .object({
        profileId: userScopedIdSchema.optional(),
        accountId: userScopedIdSchema.optional(),
        useFallbackBindings: z.boolean().default(true),
        forceProfileOnly: z.boolean().default(false),
      })
      .parse(req.body);

    if (body.forceProfileOnly && !body.profileId) {
      throw routeError(400, "profile_required", "profileId is required when forceProfileOnly is enabled.");
    }

    const { userId, store } = await loadUserStore(app, req);
    assertStoreIntegrity(store);

    if (body.accountId) {
      const account = store.accounts.find((item) => item.id === body.accountId);
      if (!account) throw routeError(404, "account_not_found", `Account ${body.accountId} was not found.`);
    }

    if (body.profileId) {
      requireProfile(store, body.profileId);
    }

    const job = previewRecompute(store, {
      userId,
      profileId: body.profileId,
      accountId: body.accountId,
      useFallbackBindings: body.forceProfileOnly ? false : body.useFallbackBindings,
    });

    await app.persistence.saveStore(store);
    return job;
  });

  app.post("/portfolio/recompute/confirm", async (req) => {
    const body = z.object({ jobId: userScopedIdSchema }).parse(req.body);
    const { userId, store } = await loadUserStore(app, req);

    const job = confirmRecompute(store, userId, body.jobId);
    await app.persistence.saveStore(store);

    // Recompute History rewrites every trade's fee snapshot via saveStore,
    // which leaves daily_holding_snapshots stale. Trigger a full regeneration
    // asynchronously so the caller doesn't block on the walker. Mirrors the
    // pattern in POST /portfolio/snapshots/generate.
    const snapshotRunId = randomUUID();
    setImmediate(async () => {
      try {
        const result = await generateHoldingSnapshots(userId, app.persistence, {
          generationRunId: snapshotRunId,
        });
        // KZO-185: producer stamps marketCode + composite singletonKey
        // (parity with snapshots/generate at line 3899 above and the
        // daily-refresh cron in dailyRefreshEnqueue.ts).
        if (app.boss && result.tickersNeedingBackfill.length > 0) {
          for (const { ticker, marketCode } of result.tickersNeedingBackfill) {
            try {
              await app.boss.send(
                BACKFILL_QUEUE,
                {
                  ticker,
                  marketCode: marketCode as BackfillJobData["marketCode"],
                  trigger: "first_trade",
                  includeBars: true,
                } satisfies BackfillJobData,
                { singletonKey: `${ticker}:${marketCode}` },
              );
            } catch {
              // Backfill queue unavailable — provisional data remains.
            }
          }
        }
        await app.eventBus.publishEvent(userId, "snapshots_generated", {
          status: "ok",
          totalRows: result.totalRows,
          provisionalRows: result.provisionalRows,
          dateRange: result.dateRange ?? null,
          generationRunId: result.generationRunId,
        });

        // KZO-165: wallet aggregator runs sequentially after holding snapshots.
        // Isolated try/catch — a wallet failure must not mask a successful
        // holding-snapshot generation.
        try {
          await generateCurrencyWalletSnapshots(userId, app.persistence);
        } catch (walletError) {
          const walletMessage = walletError instanceof Error ? walletError.message : String(walletError);
          console.error("[recompute-confirm:wallet] Failed:", walletMessage);
          try {
            await app.eventBus.publishEvent(userId, "wallet_generation_failed", {
              error: walletMessage,
            });
          } catch { /* swallow — best effort */ }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[recompute-confirm:snapshots] Failed:", message);
        try {
          await app.eventBus.publishEvent(userId, "snapshots_generated", {
            status: "error",
            totalRows: 0,
            provisionalRows: 0,
            dateRange: null,
            generationRunId: snapshotRunId,
            error: message,
          });
        } catch { /* swallow — best effort */ }
      }
    });

    return job;
  });

  app.get("/quotes", async (req) => {
    resolveUserId(req, app.oauthConfig?.sessionSecret);
    const query = z.object({ tickers: z.string().max(200) }).parse(req.query);
    const tickers = query.tickers
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((symbol) => tickerSchema.parse(symbol));

    if (tickers.length === 0) {
      throw routeError(400, "tickers_required", "At least one ticker is required.");
    }
    if (tickers.length > 20) {
      throw routeError(400, "too_many_symbols", "No more than 20 symbols are allowed per request.");
    }

    return resolveQuoteSnapshots(tickers, app.persistence);
  });

  app.post("/ai/transactions/parse", async (req) => {
    const body = z.object({ text: z.string().min(1).max(5_000) }).parse(req.body);
    const proposals = body.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line, idx) => {
        const [type = "BUY", symbol = "2330", qty = "1", price = "100", tradeDate = "2026-01-01"] = line.split(/\s+/);

        const proposalType = z.enum(["BUY", "SELL"]).parse(type.toUpperCase());
        return {
          id: `proposal-${idx + 1}`,
          type: proposalType,
          ticker: tickerSchema.parse(symbol),
          quantity: z.coerce.number().int().positive().parse(qty),
          unitPrice: z.coerce.number().positive().multipleOf(0.01).parse(price),
          priceCurrency: "TWD",
          tradeDate: isoDateSchema.parse(tradeDate),
        };
      });

    return { proposals };
  });

  app.post("/ai/transactions/confirm", async (req) => {
    const body = z
      .object({
        accountId: userScopedIdSchema,
        proposals: z
          .array(
            z.object({
              type: z.enum(["BUY", "SELL"]),
              ticker: tickerSchema,
              quantity: z.number().int().positive(),
              unitPrice: z.number().positive().multipleOf(0.01),
              priceCurrency: currencyCodeSchema.default("TWD"),
              tradeDate: isoDateSchema,
              isDayTrade: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(req.body);

    const { store, userId } = await loadUserStore(app, req);
    const draftStore = structuredClone(store);
    assertStoreIntegrity(draftStore);
    const account = requireAccount(draftStore, body.accountId);
    const marketCode = marketCodeFor(account.defaultCurrency);

    const created = body.proposals.map((proposal, idx) =>
      createTransaction(draftStore, userId, {
        id: `${randomUUID()}-${idx}`,
        accountId: body.accountId,
        ticker: proposal.ticker,
        marketCode,
        quantity: proposal.quantity,
        unitPrice: proposal.unitPrice,
        priceCurrency: proposal.priceCurrency,
        tradeDate: proposal.tradeDate,
        type: proposal.type,
        isDayTrade: proposal.isDayTrade ?? false,
      }),
    );

    await app.persistence.saveAccountingStore(userId, draftStore.accounting);

    // KZO-37 Invariant 5: each new trade may retroactively change the
    // eligibility of existing dividend ledger entries. Schedule a replay
    // per unique (accountId, ticker) affected by this batch, scoped to the
    // earliest trade date for that ticker so snapshot recompute stays narrow.
    const earliestByTicker = new Map<string, string>();
    for (const proposal of body.proposals) {
      const prev = earliestByTicker.get(proposal.ticker);
      if (!prev || proposal.tradeDate < prev) earliestByTicker.set(proposal.ticker, proposal.tradeDate);
    }
    for (const [ticker, fromDate] of earliestByTicker) {
      scheduleReplayWithRetry(app.persistence, app.eventBus, userId, body.accountId, ticker, {
        snapshotFromDate: fromDate,
      });
    }

    return { created };
  });

  // --- Monitored Symbols ---

  app.get("/instruments", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const query = z
      .object({
        search: z.string().trim().min(1).max(100).optional(),
        type: z.enum(["STOCK", "ETF", "BOND_ETF"]).optional(),
        // KZO-169: optional `market_code` filter; "ALL" disables filtering.
        // Default ALL preserves back-compat with existing consumers.
        market_code: z.enum(["TW", "US", "AU", "ALL"]).default("ALL").optional(),
      })
      .parse(req.query);

    const cooldown = await getEffectiveRepairCooldownMinutes(app.persistence);
    // KZO-169: pass `market_code` through to persistence; treat ALL/undefined
    // as "no filter".
    const marketFilter = query.market_code && query.market_code !== "ALL" ? query.market_code : undefined;
    const rows = await app.persistence.listInstrumentsCatalog(query.search, query.type, marketFilter, userId);
    return { instruments: rows.map((r) => ({ ...r, repairAvailableAt: deriveRepairAvailableAt(r.lastRepairAt, cooldown) })) };
  });

  app.get("/monitored-tickers", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const cooldown = await getEffectiveRepairCooldownMinutes(app.persistence);
    const rows = await app.persistence.getMonitoredSet(userId);
    return { tickers: rows.map((r) => ({ ...r, repairAvailableAt: deriveRepairAvailableAt(r.lastRepairAt, cooldown) })) };
  });

  app.put("/monitored-tickers", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    // KZO-169 (D7a): body shape change from `[ticker]` → `[{ticker, marketCode}]`.
    const body = z
      .object({
        tickers: z
          .array(z.object({ ticker: tickerSchema, marketCode: marketCodeSchema }))
          .max(500),
      })
      .parse(req.body);

    const result = await app.persistence.replaceManualSelections(userId, body.tickers);

    // KZO-126 / KZO-169: enqueue backfill for genuinely new tickers (demo users
    // skip FinMind). Singleton key is now `${ticker}:${marketCode}` (G3) so
    // BHP/AU and BHP/US don't compete for the same singleton slot.
    if (app.boss && !isDemo && result.newTickers.length > 0) {
      for (const sel of body.tickers) {
        if (!result.newTickers.includes(sel.ticker)) continue;
        await app.boss.send(
          BACKFILL_QUEUE,
          {
            ticker: sel.ticker,
            marketCode: sel.marketCode,
            userId,
            trigger: "user_selection",
          } satisfies BackfillJobData,
          { singletonKey: `${sel.ticker}:${sel.marketCode}`, priority: 0 },
        );
      }
    }

    const cooldown = await getEffectiveRepairCooldownMinutes(app.persistence);
    const monitored = await app.persistence.getMonitoredSet(userId);
    const decorated = monitored.map((r) => ({
      ...r,
      repairAvailableAt: deriveRepairAvailableAt(r.lastRepairAt, cooldown),
    }));
    return { tickers: decorated, newTickers: result.newTickers };
  });

  // --- Backfill Retry (KZO-126) ---

  app.post("/backfill/retry", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z.object({ ticker: tickerSchema, marketCode: marketCodeSchema.optional() }).parse(req.body);

    if (isDemo) {
      throw routeError(403, "demo_restricted", "Backfill is not available for demo users");
    }
    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    // KZO-169: legacy retry route accepts ticker only; market is resolved via
    // the persisted instrument (TW priority on ticker-only lookup). The
    // resolved marketCode is stamped on the enqueued job + singleton key so
    // the worker doesn't have to re-derive.
    const instrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
    if (!instrument) {
      throw routeError(404, "instrument_not_found", "Instrument not found in catalog");
    }
    if (instrument.barsBackfillStatus !== "failed") {
      throw routeError(400, "not_failed", "Backfill can only be retried for failed instruments");
    }

    // Reset status to pending before enqueuing
    await app.persistence.updateBackfillStatus(body.ticker, "pending");

    await app.boss.send(
      BACKFILL_QUEUE,
      {
        ticker: body.ticker,
        marketCode: instrument.marketCode as import("@tw-portfolio/domain").MarketCode,
        userId,
        trigger: "retry",
      } satisfies BackfillJobData,
      { singletonKey: `${body.ticker}:${instrument.marketCode}`, priority: 0 },
    );

    return { ticker: body.ticker, barsBackfillStatus: "pending" };
  });

  // --- Backfill Repair (KZO-86) ---

  app.post("/backfill/repair", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z
      .object({
        tickers: z.array(tickerSchema).min(1).max(20),
        startDate: isoDateSchema.optional(),
        endDate: isoDateSchema.optional(),
        includeBars: z.boolean().default(true),
        includeDividends: z.boolean().default(true),
      })
      .superRefine((value, ctx) => {
        if (!value.includeBars && !value.includeDividends) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "includeBars and includeDividends cannot both be false",
            path: ["includeBars"],
          });
        }
        if (value.startDate && value.endDate && value.startDate > value.endDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "startDate must be before or equal to endDate",
            path: ["startDate"],
          });
        }
      })
      .parse(req.body);

    if (isDemo) {
      throw routeError(403, "demo_restricted", "Repair is not available for demo users");
    }
    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    const nowMs = Date.now();
    const effectiveCooldown = await getEffectiveRepairCooldownMinutes(app.persistence);
    const queued: string[] = [];
    const rejected: Array<{ ticker: string; reason: string }> = [];

    for (const ticker of body.tickers) {
      // KZO-169: same as retry — resolve market from persisted instrument.
      const instrument = await app.persistence.getInstrument(ticker);
      if (!instrument) {
        rejected.push({ ticker, reason: "instrument_not_found" });
        continue;
      }

      if (instrument.barsBackfillStatus === "pending" || instrument.barsBackfillStatus === "backfilling") {
        rejected.push({ ticker, reason: `status_${instrument.barsBackfillStatus}` });
        continue;
      }

      if (instrument.lastRepairAt) {
        const minutes = remainingCooldownMinutes(instrument.lastRepairAt, effectiveCooldown, nowMs);
        if (minutes > 0) {
          rejected.push({ ticker, reason: `cooldown_active:${minutes}` });
          continue;
        }
      }

      await app.boss.send(
        BACKFILL_QUEUE,
        {
          ticker,
          marketCode: instrument.marketCode as import("@tw-portfolio/domain").MarketCode,
          userId,
          trigger: "repair",
          startDate: body.startDate,
          endDate: body.endDate,
          includeBars: body.includeBars,
          includeDividends: body.includeDividends,
        } satisfies BackfillJobData,
        { singletonKey: `${ticker}:${instrument.marketCode}`, priority: 5 },
      );
      queued.push(ticker);
    }

    return { queued, rejected };
  });

  // --- Notifications (KZO-132) ---

  app.get("/notifications", async (req) => {
    const userId = requireSessionUserId(req);
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
      })
      .parse(req.query);
    const { notifications, total } = await app.persistence.getNotificationsForUser(userId, query);
    return { notifications, total, page: query.page, limit: query.limit };
  });

  app.get("/notifications/unread-count", async (req) => {
    const userId = requireSessionUserId(req);
    const count = await app.persistence.getUnreadCount(userId);
    return { count };
  });

  app.patch("/notifications/:id/read", async (req) => {
    const userId = requireSessionUserId(req);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.markNotificationRead(userId, id);
    return { status: "ok" };
  });

  app.patch("/notifications/read-all", async (req) => {
    const userId = requireSessionUserId(req);
    await app.persistence.markAllRead(userId);
    return { status: "ok" };
  });

  app.delete("/notifications/:id", async (req) => {
    const userId = requireSessionUserId(req);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.dismissNotification(userId, id);
    return { status: "ok" };
  });

  app.patch("/notifications/:id/escalate", async (req) => {
    const userId = requireSessionUserId(req);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.markNotificationEscalated(userId, id);
    return { status: "ok" };
  });

  // ── Admin portal routes (KZO-144 / KZO-142) ───────────────────────────────
  await app.register(adminRoutes, { prefix: "/admin" });

  registerSSERoute(app, requireSessionUserId);
}

// assertNotLastAdmin moved to persistence layer (assertNotLastAdminTx) for atomic check+mutation
