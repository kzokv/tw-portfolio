import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { FeeProfile } from "@tw-portfolio/domain";
import { env } from "../config/env.js";
import { getQuotesWithFallback } from "../providers/marketData.js";
import { listCorporateActions, listTradeEvents, syncAccountingPolicy } from "../services/accountingStore.js";
import { applyCorporateAction, createTransaction, listHoldings } from "../services/portfolio.js";
import { confirmRecompute, previewRecompute } from "../services/recompute.js";
import type { Store } from "../types/store.js";

const userScopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/);

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(16)
  .regex(/^[A-Z0-9]+$/);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const transactionSchema = z.object({
  accountId: userScopedIdSchema,
  symbol: symbolSchema,
  quantity: z.number().int().positive(),
  priceNtd: z.number().int().positive(),
  tradeDate: isoDateSchema,
  type: z.enum(["BUY", "SELL"]),
  isDayTrade: z.boolean().default(false),
});

const feeProfilePayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  commissionRateBps: z.number().int().nonnegative(),
  commissionDiscountBps: z.number().int().positive(),
  minCommissionNtd: z.number().int().nonnegative(),
  commissionRoundingMode: z.enum(["FLOOR", "ROUND", "CEIL"]),
  taxRoundingMode: z.enum(["FLOOR", "ROUND", "CEIL"]),
  stockSellTaxRateBps: z.number().int().nonnegative(),
  stockDayTradeTaxRateBps: z.number().int().nonnegative(),
  etfSellTaxRateBps: z.number().int().nonnegative(),
  bondEtfSellTaxRateBps: z.number().int().nonnegative(),
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
  symbol: symbolSchema,
  feeProfileId: userScopedIdSchema,
});

const corporateActionSchema = z.object({
  accountId: userScopedIdSchema,
  symbol: symbolSchema,
  actionType: z.enum(["DIVIDEND", "SPLIT", "REVERSE_SPLIT"]),
  numerator: z.number().int().positive().default(1),
  denominator: z.number().int().positive().default(1),
  actionDate: isoDateSchema,
});

type RouteError = Error & { statusCode: number; code: string };

function routeError(statusCode: number, code: string, message: string): RouteError {
  const error = new Error(message) as RouteError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function resolveUserId(req: FastifyRequest): string {
  if (env.AUTH_MODE === "oauth") {
    const authenticatedHeader = req.headers["x-authenticated-user-id"];
    if (!authenticatedHeader || Array.isArray(authenticatedHeader)) {
      throw routeError(401, "auth_required", "authentication required");
    }

    return userScopedIdSchema.parse(authenticatedHeader);
  }

  const bypassHeader = req.headers["x-user-id"];
  if (!bypassHeader || Array.isArray(bypassHeader)) {
    return "user-1";
  }

  return userScopedIdSchema.parse(bypassHeader);
}

async function loadUserStore(app: FastifyInstance, req: FastifyRequest) {
  const userId = resolveUserId(req);
  const store = await app.persistence.loadStore(userId);
  syncAccountingPolicy(store);
  return { userId, store };
}

function getStoreIntegrityIssue(store: Store): { code: string; message: string } | null {
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
        message: `Fee profile override for ${binding.accountId}/${binding.symbol} references missing profile ${binding.feeProfileId}.`,
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
      symbol: binding.symbol,
      feeProfileId: binding.feeProfileId,
    };
    deduped.set(`${normalized.accountId}:${normalized.symbol}`, normalized);
  }

  return [...deduped.values()];
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

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    const dependencies = await app.persistence.readiness();
    return {
      status: dependencies.postgres && dependencies.redis ? "ready" : "degraded",
      dependencies,
    };
  });

  app.get("/auth/google/start", async () => ({ status: "todo", message: "Google OAuth start endpoint placeholder" }));
  app.get("/auth/google/callback", async () => ({ status: "todo", message: "Google OAuth callback endpoint placeholder" }));

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
              symbol: symbolSchema,
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
        commissionRateBps: draft.commissionRateBps,
        commissionDiscountBps: draft.commissionDiscountBps,
        minCommissionNtd: draft.minCommissionNtd,
        commissionRoundingMode: draft.commissionRoundingMode,
        taxRoundingMode: draft.taxRoundingMode,
        stockSellTaxRateBps: draft.stockSellTaxRateBps,
        stockDayTradeTaxRateBps: draft.stockDayTradeTaxRateBps,
        etfSellTaxRateBps: draft.etfSellTaxRateBps,
        bondEtfSellTaxRateBps: draft.bondEtfSellTaxRateBps,
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
        symbol: binding.symbol,
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

    const userId = resolveUserId(req);
    const store = await app.persistence.loadStore(userId);
    const draftStore = structuredClone(store);
    assertStoreIntegrity(draftStore);

    const tx = createTransaction(draftStore, userId, {
      ...body,
      id: randomUUID(),
    });

    const claimed = await app.persistence.claimIdempotencyKey(userId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }

    try {
      await app.persistence.saveStore(draftStore);
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(userId, idempotencyKey);
      throw error;
    }

    return tx;
  });

  app.get("/portfolio/transactions", async (req) => {
    const { store } = await loadUserStore(app, req);
    return listTradeEvents(store);
  });

  app.get("/portfolio/holdings", async (req) => {
    const { store, userId } = await loadUserStore(app, req);
    assertStoreIntegrity(store);
    return listHoldings(store, userId);
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

    await app.persistence.saveStore(store);
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

  app.get("/quotes/latest", async (req) => {
    const query = z.object({ symbols: z.string().max(200) }).parse(req.query);
    const symbols = query.symbols
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((symbol) => symbolSchema.parse(symbol));

    if (symbols.length === 0) {
      throw routeError(400, "symbols_required", "At least one symbol is required.");
    }
    if (symbols.length > 20) {
      throw routeError(400, "too_many_symbols", "No more than 20 symbols are allowed per request.");
    }

    const cached = await app.persistence.getCachedQuotes(symbols);
    const missing = symbols.filter((symbol) => !cached[symbol]);

    let fetched = [] as Awaited<ReturnType<typeof getQuotesWithFallback>>;
    if (missing.length > 0) {
      fetched = await getQuotesWithFallback(missing);
      await app.persistence.cacheQuotes(fetched);
    }

    const fetchedMap = Object.fromEntries(fetched.map((quote) => [quote.symbol, quote]));
    return symbols.map((symbol) => cached[symbol] ?? fetchedMap[symbol]).filter(Boolean);
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
          symbol: symbolSchema.parse(symbol),
          quantity: z.coerce.number().int().positive().parse(qty),
          priceNtd: z.coerce.number().int().positive().parse(price),
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
              symbol: symbolSchema,
              quantity: z.number().int().positive(),
              priceNtd: z.number().int().positive(),
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
        symbol: proposal.symbol,
        quantity: proposal.quantity,
        priceNtd: proposal.priceNtd,
        tradeDate: proposal.tradeDate,
        type: proposal.type,
        isDayTrade: proposal.isDayTrade ?? false,
      }),
    );

    await app.persistence.saveStore(draftStore);
    return { created };
  });
}
