import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { registerSSERoute } from "./sseRoute.js";
import {
  buildAuthorizationUrl,
  decodeIdTokenPayload,
  exchangeCodeForTokens,
  extractReturnTo,
  generateState,
  isValidReturnTo,
  refreshAccessToken,
  signSessionCookie,
  verifySessionCookie,
  verifyState,
  type GoogleTokenResponse,
  type SessionIdentity,
} from "../auth/googleOAuth.js";
import { calculateBuyFees, calculateSellFees, type FeeProfile } from "@tw-portfolio/domain";
import type { DashboardPerformanceRange, IntegrityIssueDto, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import { Env } from "@tw-portfolio/config";
import type { QuoteSnapshot } from "@tw-portfolio/domain";
import { resolveQuoteSnapshots } from "../services/market-data/quoteSnapshotService.js";
import {
  listCorporateActions,
  listTradeEvents,
  syncAccountingPolicy,
} from "../services/accountingStore.js";
import { buildDashboardOverview, buildDashboardPerformance } from "../services/dashboard.js";
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
import { seedDemoTransactions } from "../services/demoData.js";
import { createStore } from "../services/store.js";
import { ensureInstrumentDefinition, isInstrumentQuoteable } from "../services/instrumentRegistry.js";
import { BACKFILL_QUEUE, type BackfillJobData } from "../services/market-data/backfillWorker.js";
import { routeError } from "../lib/routeError.js";
import type { Store, Transaction } from "../types/store.js";

const userScopedIdSchema = z
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

const transactionSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
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

const feeProfileDraftSchema = feeProfilePayloadSchema
  .extend({
    id: userScopedIdSchema.optional(),
    tempId: userScopedIdSchema.optional(),
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

const dividendLedgerQuerySchema = dividendDateRangeQuerySchema.extend({
  accountId: userScopedIdSchema.optional(),
});

const dividendReconciliationSchema = z.object({
  status: z.enum(["open", "matched", "explained", "resolved"]),
  note: z.string().trim().max(500).optional(),
});

function remainingCooldownMinutes(lastRepairAt: string, cooldownMinutes: number, nowMs: number): number {
  const repairedAtMs = new Date(lastRepairAt).getTime();
  if (Number.isNaN(repairedAtMs)) return 0;
  const cooldownUntilMs = repairedAtMs + cooldownMinutes * 60_000;
  if (nowMs >= cooldownUntilMs) return 0;
  return Math.ceil((cooldownUntilMs - nowMs) / 60_000);
}

function buildCookieAttrs(cookieName: string, isProduction: boolean, cookieDomain?: string): string {
  const secure = isProduction || cookieName.startsWith("__Host-");
  // __Host- prefix prohibits Domain attribute per RFC 6265bis; skip it for prefixed names.
  const domain = cookieDomain && !cookieName.startsWith("__Host-") ? `; Domain=${cookieDomain}` : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${domain}`;
}

function parseSessionCookie(cookieHeader: string | undefined, sessionSecret: string | undefined): SessionIdentity | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    if (part.slice(0, eqIdx).trim() === Env.SESSION_COOKIE_NAME) {
      const value = part.slice(eqIdx + 1).trim();
      if (!value) return null;
      if (!sessionSecret) return null;
      return verifySessionCookie(value, sessionSecret);
    }
  }
  return null;
}

export function resolveUserId(req: FastifyRequest, sessionSecret?: string): { userId: string; isDemo: boolean } {
  if (Env.AUTH_MODE === "oauth") {
    const identity = parseSessionCookie(req.headers.cookie, sessionSecret);
    if (identity) {
      req.__sessionType = identity.isDemo ? "demo" : "oauth";
      return { userId: userScopedIdSchema.parse(identity.userId), isDemo: identity.isDemo };
    }
    throw routeError(401, "auth_required", "authentication required");
  }

  // dev_bypass: also accept a valid session cookie when sessionSecret is available,
  // so integration tests that exercise the OAuth flow work without setting AUTH_MODE=oauth.
  if (sessionSecret) {
    const identity = parseSessionCookie(req.headers.cookie, sessionSecret);
    if (identity) {
      req.__sessionType = identity.isDemo ? "demo" : "oauth";
      return { userId: userScopedIdSchema.parse(identity.userId), isDemo: identity.isDemo };
    }
  }

  const bypassHeader = req.headers["x-user-id"];
  if (!bypassHeader || Array.isArray(bypassHeader)) {
    return { userId: "user-1", isDemo: false };
  }
  return { userId: userScopedIdSchema.parse(bypassHeader), isDemo: false };
}

async function loadUserStore(app: FastifyInstance, req: FastifyRequest) {
  const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  const store = await app.persistence.loadStore(userId);
  syncAccountingPolicy(store);
  return { userId, store };
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

  const userId = await app.persistence.resolveOrCreateUser("demo", demoId, {
    email,
    name: "Demo User",
  });

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

  const feeProfileIds = new Set(store.feeProfiles.map((profile) => profile.id));
  for (const account of store.accounts) {
    if (!account.feeProfileId || !feeProfileIds.has(account.feeProfileId)) {
      return {
        code: "missing_account_profile",
        message: `Account ${account.id} is missing a valid fee profile binding.`,
      };
    }
  }

  for (const binding of store.feeProfileBindings) {
    if (!feeProfileIds.has(binding.feeProfileId)) {
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
    marketCode: trade.marketCode ?? null,
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
  const feeProfileIds = new Set(store.feeProfiles.map((profile) => profile.id));

  for (const binding of bindings) {
    if (!accountIds.has(binding.accountId)) {
      throw routeError(400, "invalid_account", `Unknown account ${binding.accountId}`);
    }
    if (!feeProfileIds.has(binding.feeProfileId)) {
      throw routeError(400, "invalid_fee_profile", `Unknown fee profile ${binding.feeProfileId}`);
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

const demoRateBuckets = new Map<string, { count: number; windowStartedAt: number }>();

/** @internal — test-only helper to reset the demo rate limiter between test runs. */
export function _resetDemoRateBuckets(): void {
  demoRateBuckets.clear();
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/__e2e/reset", async (req) => {
    assertE2EResetEnabled();
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const store = createSeededStoreForUser(userId);
    await app.persistence.saveStore(store);
    return { status: "reset", userId };
  });

  app.post("/__e2e/seed-instruments", async (req) => {
    assertE2EResetEnabled();
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

      createTransaction(store, userId, {
        id: randomUUID(),
        accountId: body.accountId,
        ticker: body.ticker,
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

  app.post("/__e2e/oauth-session", async (req, reply) => {
    assertE2EOauthSessionEnabled();

    const body = z.object({ id_token: z.string().min(1).optional() }).nullable().parse(req.body ?? {});

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

    const userId = await app.persistence.resolveOrCreateUser("google", sub, { email, name, picture });

    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for session cookie signing");
    }
    const signedCookie = signSessionCookie(userId, sessionSecret);
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, (Env.NODE_ENV as string) === "production", Env.COOKIE_DOMAIN);
    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}`);
    return { status: "ok", sub, userId };
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

  app.get("/auth/logout", async (_req, reply) => {
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=; ${attrs}; Max-Age=0`);
    return reply.redirect(`${app.appBaseUrl}/login`, 302);
  });

  app.get("/auth/google/start", async (req, reply) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }
    const rawQuery = req.query as Record<string, string | undefined>;
    const returnTo = rawQuery.returnTo && isValidReturnTo(rawQuery.returnTo) ? rawQuery.returnTo : undefined;
    const state = generateState(app.oauthConfig.sessionSecret, returnTo);
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

    let userId: string;
    try {
      userId = await app.persistence.resolveOrCreateUser("google", claims.sub, {
        email: claims.email,
        name: claims.name,
        picture: claims.picture,
        emailVerified: claims.email_verified,
      });
    } catch {
      return errorRedirect("oauth_error");
    }

    const signedCookie = signSessionCookie(userId, app.oauthConfig.sessionSecret);
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);

    // Detect misconfigured Docker local: NODE_ENV=production sets the Secure
    // cookie flag, but HTTP transport means the browser silently drops it.
    if (Env.NODE_ENV === "production" && app.appBaseUrl?.startsWith("http://")) {
      return errorRedirect("insecure_transport");
    }

    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}`);
    const returnTo = extractReturnTo(query.state);
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
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return app.persistence.getProfile(userId);
  });

  app.patch("/profile", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z.object({ email: z.string().email().max(254) }).parse(req.body);
    return app.persistence.updateProfileEmail(userId, body.email);
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

    for (const draft of body.feeProfiles) {
      let targetId = draft.id;
      if (!targetId) {
        targetId = randomUUID();
      } else if (!existingProfilesById.has(targetId)) {
        throw routeError(404, "fee_profile_not_found", `Fee profile ${targetId} was not found.`);
      }

      if (draft.tempId) {
        if (tempIdToProfileId.has(draft.tempId)) {
          throw routeError(400, "duplicate_temp_id", `Duplicate tempId ${draft.tempId} was provided.`);
        }
        tempIdToProfileId.set(draft.tempId, targetId);
      }

      nextProfiles.push({
        id: targetId,
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

    const nextProfileIdSet = new Set(nextProfiles.map((profile) => profile.id));
    const resolveFeeProfileRef = (ref: string): string => {
      const resolved = tempIdToProfileId.get(ref) ?? ref;
      if (!nextProfileIdSet.has(resolved)) {
        throw routeError(400, "invalid_fee_profile", `Fee profile reference ${ref} is not valid.`);
      }
      return resolved;
    };

    const nextAccounts = draftStore.accounts.map((account) => ({ ...account }));
    for (const accountUpdate of body.accounts) {
      const account = nextAccounts.find((item) => item.id === accountUpdate.id);
      if (!account) {
        throw routeError(404, "account_not_found", `Account ${accountUpdate.id} was not found.`);
      }
      account.feeProfileId = resolveFeeProfileRef(accountUpdate.feeProfileRef);
    }

    const nextBindings = normalizeBindings(
      body.feeProfileBindings.map((binding) => ({
        accountId: binding.accountId,
        ticker: binding.ticker,
        feeProfileId: resolveFeeProfileRef(binding.feeProfileRef),
      })),
    );

    draftStore.settings = { ...draftStore.settings, ...body.settings };
    draftStore.feeProfiles = nextProfiles;
    draftStore.accounts = nextAccounts;
    ensureBindingsAreValid(draftStore, nextBindings);
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
    const { store } = await loadUserStore(app, req);
    return store.accounts;
  });

  app.patch("/accounts/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        feeProfileId: userScopedIdSchema,
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);

    const account = store.accounts.find((item) => item.id === params.id);
    if (!account) throw routeError(404, "account_not_found", `Account ${params.id} was not found.`);

    requireProfile(store, body.feeProfileId);

    account.feeProfileId = body.feeProfileId;
    if (body.name) account.name = body.name;
    await app.persistence.saveStore(store);
    return account;
  });

  app.get("/fee-profiles", async (req) => {
    const { store } = await loadUserStore(app, req);
    return store.feeProfiles;
  });

  app.post("/fee-profiles", async (req) => {
    const body = feeProfilePayloadSchema.parse(req.body);
    const profile: FeeProfile = {
      id: randomUUID(),
      ...body,
    };

    const { store } = await loadUserStore(app, req);
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

    if (store.feeProfiles.length <= 1) {
      throw routeError(400, "must_keep_one_profile", "At least one fee profile must remain.");
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

    const nextProfiles = store.feeProfiles.filter((profile) => profile.id !== params.id);
    if (nextProfiles.length === store.feeProfiles.length) {
      throw routeError(404, "fee_profile_not_found", `Fee profile ${params.id} was not found.`);
    }

    store.feeProfiles = nextProfiles;
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
    const ensured = ensureInstrumentDefinition(draftStore, body.ticker);

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
    scheduleReplayWithRetry(app.persistence, app.eventBus, userId, tx.accountId, tx.ticker);

    // KZO-126: First-trade backfill trigger
    if (app.boss && !isDemo) {
      const instrument = await app.persistence.getInstrument(body.ticker);
      // Skip if ticker not in catalog, or already ready
      if (instrument && instrument.barsBackfillStatus !== "ready") {
        await app.boss.send(
          BACKFILL_QUEUE,
          { ticker: body.ticker, userId, trigger: "first_trade" } satisfies BackfillJobData,
          { singletonKey: body.ticker, priority: 0 },
        );
      }
    }

    return tx;
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

    // Schedule async recompute
    scheduleReplayWithRetry(app.persistence, app.eventBus, userId, result.accountId, result.ticker);

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
              marketCode: trade.marketCode ?? "TW",
            });

        patch.commissionAmount = fees.commissionAmount;
        patch.taxAmount = fees.taxAmount;
        patch.feesSource = "CALCULATED";
      }
    }

    await app.persistence.updateTradeEvent(userId, tradeEventId, patch);

    // Schedule async recompute
    scheduleReplayWithRetry(app.persistence, app.eventBus, userId, trade.accountId, trade.ticker);

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
    const snapshotMap = await resolveQuoteSnapshots(symbols, app.persistence);
    const quotes = Object.values(snapshotMap).filter((s): s is QuoteSnapshot => s !== null);

    return buildDashboardOverview(store, {
      integrityIssue: getStoreIntegrityIssue(store),
      quotes,
    });
  });

  app.get("/dashboard/performance", async (req) => {
    const query = z.object({
      range: z.enum(["1M", "3M", "YTD", "1Y"]).default("1M"),
    }).parse(req.query);
    const { store } = await loadUserStore(app, req);
    const symbols = [...new Set(
      store.accounting.facts.tradeEvents
        .map((trade) => trade.ticker)
        .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
    )];
    const snapshotMap = await resolveQuoteSnapshots(symbols, app.persistence);
    const quotes = Object.values(snapshotMap).filter((s): s is QuoteSnapshot => s !== null);

    return buildDashboardPerformance(store, {
      range: query.range as DashboardPerformanceRange,
      quotes,
    });
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
    const ledgerEntries = await app.persistence.listDividendLedgerEntriesByPaymentDate(
      userId,
      query.accountId,
      query.fromPaymentDate,
      query.toPaymentDate,
      query.limit,
    );

    return {
      ledgerEntries: buildDividendLedgerEntryDetails(store, ledgerEntries),
    };
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

    const created = body.proposals.map((proposal, idx) =>
      createTransaction(draftStore, userId, {
        id: `${randomUUID()}-${idx}`,
        accountId: body.accountId,
        ticker: proposal.ticker,
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
    // per unique (accountId, ticker) affected by this batch.
    const touchedTickers = new Set(body.proposals.map((proposal) => proposal.ticker));
    for (const ticker of touchedTickers) {
      scheduleReplayWithRetry(app.persistence, app.eventBus, userId, body.accountId, ticker);
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
      })
      .parse(req.query);

    return { instruments: await app.persistence.listInstrumentsCatalog(query.search, query.type, userId) };
  });

  app.get("/monitored-tickers", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return { tickers: await app.persistence.getMonitoredSet(userId) };
  });

  app.put("/monitored-tickers", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z
      .object({
        tickers: z.array(tickerSchema).max(500),
      })
      .parse(req.body);

    const result = await app.persistence.replaceManualSelections(userId, body.tickers);

    // KZO-126: Enqueue backfill for genuinely new tickers (demo users skip FinMind)
    if (app.boss && !isDemo && result.newTickers.length > 0) {
      for (const ticker of result.newTickers) {
        await app.boss.send(
          BACKFILL_QUEUE,
          { ticker, userId, trigger: "user_selection" } satisfies BackfillJobData,
          { singletonKey: ticker, priority: 0 },
        );
      }
    }

    const monitored = await app.persistence.getMonitoredSet(userId);
    return { tickers: monitored, newTickers: result.newTickers };
  });

  // --- Backfill Retry (KZO-126) ---

  app.post("/backfill/retry", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z.object({ ticker: tickerSchema }).parse(req.body);

    if (isDemo) {
      throw routeError(403, "demo_restricted", "Backfill is not available for demo users");
    }
    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    const instrument = await app.persistence.getInstrument(body.ticker);
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
      { ticker: body.ticker, userId, trigger: "retry" } satisfies BackfillJobData,
      { singletonKey: body.ticker, priority: 0 },
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
    const queued: string[] = [];
    const rejected: Array<{ ticker: string; reason: string }> = [];

    for (const ticker of body.tickers) {
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
        const minutes = remainingCooldownMinutes(instrument.lastRepairAt, Env.REPAIR_COOLDOWN_MINUTES, nowMs);
        if (minutes > 0) {
          rejected.push({ ticker, reason: `cooldown_active:${minutes}` });
          continue;
        }
      }

      await app.boss.send(
        BACKFILL_QUEUE,
        {
          ticker,
          userId,
          trigger: "repair",
          startDate: body.startDate,
          endDate: body.endDate,
          includeBars: body.includeBars,
          includeDividends: body.includeDividends,
        } satisfies BackfillJobData,
        { singletonKey: ticker, priority: 5 },
      );
      queued.push(ticker);
    }

    return { queued, rejected };
  });

  // --- Notifications (KZO-132) ---

  app.get("/notifications", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
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
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const count = await app.persistence.getUnreadCount(userId);
    return { count };
  });

  app.patch("/notifications/:id/read", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.markNotificationRead(userId, id);
    return { status: "ok" };
  });

  app.patch("/notifications/read-all", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    await app.persistence.markAllRead(userId);
    return { status: "ok" };
  });

  app.delete("/notifications/:id", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.dismissNotification(userId, id);
    return { status: "ok" };
  });

  app.patch("/notifications/:id/escalate", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.markNotificationEscalated(userId, id);
    return { status: "ok" };
  });

  registerSSERoute(app, resolveUserId);
}
