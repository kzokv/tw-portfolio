import type { MarketCode } from "@vakwen/domain";
import { getPreviousRegularSessionTradingDate, getRegularSessionCloseRefreshDate, isRegularSessionMarketCode, type RegularSessionClock } from "./marketRegularSession.js";
import type { EodhdEodProvider } from "./providers/eodhdEod.js";

export type QuoteFallbackProviderId = "eodhd";
export type QuoteFallbackPriceType = "eod_close";
export type QuoteFallbackRefreshStatus = "success" | "warning" | "error" | "skipped" | "rate_limited";

export interface QuoteFallbackPolicy {
  id: string;
  marketCode: MarketCode;
  ticker: string;
  provider: QuoteFallbackProviderId;
  priceType: QuoteFallbackPriceType;
  providerSymbol: string;
  active: boolean;
}

export interface QuoteFallbackSnapshotWrite {
  policyId: string;
  marketCode: MarketCode;
  ticker: string;
  provider: QuoteFallbackProviderId;
  priceType: QuoteFallbackPriceType;
  providerSymbol: string;
  marketDate: string;
  close: number;
  previousClose: number | null;
  currency: string;
  currencySource: "provider" | "market_default";
  source: string;
  fetchedAt: string;
  providerPayloadHash?: string | null;
  providerMetadata?: Record<string, unknown>;
}

export interface QuoteFallbackRefreshPersistence {
  getLatestQuoteFallbackSnapshot(
    policyId: string,
  ): Promise<{ marketDate: string; close: number; previousClose: number | null } | null>;
  upsertQuoteFallbackSnapshot(input: QuoteFallbackSnapshotWrite): Promise<void>;
  updateQuoteFallbackPolicyRefreshStatus(input: {
    policyId: string;
    status: QuoteFallbackRefreshStatus;
    refreshedAt: string | null;
    error?: string | null;
    errorCode?: string | null;
  }): Promise<void>;
  createMarketDataActivityEvent?(input: {
    marketCode: MarketCode;
    category: "daily_close";
    result: QuoteFallbackRefreshStatus;
    sourceKind: "provider";
    sourceId: string;
    eventType: string;
    title: string;
    message: string;
    ticker: string;
    providerSymbol: string;
    dedupeKey: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export interface QuoteFallbackRefreshBudget {
  tryConsume(input: {
    budgetDate: string;
    calls: number;
  }): Promise<{ allowed: boolean; limit: number; used: number; remaining: number }>;
}

export interface QuoteFallbackRefreshItem {
  policyId: string;
  ticker: string;
  marketCode: MarketCode;
  providerSymbol: string;
  status: QuoteFallbackRefreshStatus;
  marketDate: string | null;
  message: string;
  budgetAfter: { limit: number; used: number; remaining: number } | null;
}

export interface QuoteFallbackRefreshResult {
  items: QuoteFallbackRefreshItem[];
  summary: Record<QuoteFallbackRefreshStatus, number>;
}

export interface RunQuoteFallbackRefreshInput {
  policies: ReadonlyArray<QuoteFallbackPolicy>;
  persistence: QuoteFallbackRefreshPersistence;
  provider: Pick<EodhdEodProvider, "fetchCloseSnapshot"> & {
    isConfigured?: () => boolean;
  };
  tradingCalendar: RegularSessionClock;
  budget: QuoteFallbackRefreshBudget;
  closeRefreshGraceMinutes: number;
  now?: Date;
  log?: {
    info: (payload: Record<string, unknown>, message: string) => void;
    warn: (payload: Record<string, unknown>, message: string) => void;
  };
}

export async function runQuoteFallbackRefresh(
  input: RunQuoteFallbackRefreshInput,
): Promise<QuoteFallbackRefreshResult> {
  const now = input.now ?? new Date();
  const items: QuoteFallbackRefreshItem[] = [];

  for (const policy of input.policies) {
    const item = await refreshPolicy(policy, input, now);
    items.push(item);
  }

  const summary: QuoteFallbackRefreshResult["summary"] = {
    success: 0,
    warning: 0,
    error: 0,
    skipped: 0,
    rate_limited: 0,
  };
  for (const item of items) {
    summary[item.status] += 1;
  }

  return { items, summary };
}

async function refreshPolicy(
  policy: QuoteFallbackPolicy,
  input: RunQuoteFallbackRefreshInput,
  now: Date,
): Promise<QuoteFallbackRefreshItem> {
  if (!policy.active) {
    return await finalizePolicyRefresh(policy, input, {
      status: "skipped",
      marketDate: null,
      message: "policy inactive",
      refreshedAt: null,
      errorCode: null,
      budgetAfter: null,
    });
  }
  if (policy.provider !== "eodhd" || policy.priceType !== "eod_close") {
    return await finalizePolicyRefresh(policy, input, {
      status: "skipped",
      marketDate: null,
      message: "unsupported fallback policy",
      refreshedAt: null,
      errorCode: "unsupported_policy",
      budgetAfter: null,
    });
  }
  if (!isRegularSessionMarketCode(policy.marketCode)) {
    return await finalizePolicyRefresh(policy, input, {
      status: "skipped",
      marketDate: null,
      message: "market does not support regular-session fallback refresh",
      refreshedAt: null,
      errorCode: "unsupported_market",
      budgetAfter: null,
    });
  }

  const closeDate = await getRegularSessionCloseRefreshDate(
    policy.marketCode,
    input.tradingCalendar,
    now,
    input.closeRefreshGraceMinutes,
  );
  if (!closeDate) {
    return await finalizePolicyRefresh(policy, input, {
      status: "skipped",
      marketDate: null,
      message: "no eligible settled close date",
      refreshedAt: null,
      errorCode: "no_close_date",
      budgetAfter: null,
    });
  }

  const latestSnapshot = await input.persistence.getLatestQuoteFallbackSnapshot(policy.id);
  if (latestSnapshot?.marketDate === closeDate) {
    return await finalizePolicyRefresh(policy, input, {
      status: "skipped",
      marketDate: closeDate,
      message: `snapshot already current for ${closeDate}`,
      refreshedAt: null,
      errorCode: null,
      budgetAfter: null,
      persistStatus: false,
    });
  }

  const previousCloseDate = await getPreviousRegularSessionTradingDate(
    policy.marketCode,
    input.tradingCalendar,
    closeDate,
  );

  try {
    if (input.provider.isConfigured && !input.provider.isConfigured()) {
      return await finalizePolicyRefresh(policy, input, {
        status: "error",
        marketDate: closeDate,
        message: "eodhd_api_key_missing",
        refreshedAt: null,
        errorCode: "provider_config_missing",
        budgetAfter: null,
      });
    }
  } catch (error) {
    return await finalizePolicyRefresh(policy, input, {
      status: "error",
      marketDate: closeDate,
      message: error instanceof Error ? error.message : String(error),
      refreshedAt: null,
      errorCode: "provider_config_missing",
      budgetAfter: null,
    });
  }

  const budgetDate = now.toISOString().slice(0, 10);
  const budget = await input.budget.tryConsume({ budgetDate, calls: 1 });
  if (!budget.allowed) {
    return await finalizePolicyRefresh(policy, input, {
      status: "rate_limited",
      marketDate: closeDate,
      message: `daily EODHD call budget exhausted for ${budgetDate}`,
      refreshedAt: null,
      errorCode: "budget_exhausted",
      budgetAfter: { limit: budget.limit, used: budget.used, remaining: budget.remaining },
    });
  }

  try {
    const snapshot = await input.provider.fetchCloseSnapshot({
      marketCode: policy.marketCode,
      providerSymbol: policy.providerSymbol,
      closeDate,
      previousCloseDate,
    });
    if (!snapshot) {
      return await finalizePolicyRefresh(policy, input, {
        status: "warning",
        marketDate: closeDate,
        message: `provider returned no close for ${closeDate}`,
        refreshedAt: null,
        errorCode: "missing_close",
        budgetAfter: { limit: budget.limit, used: budget.used, remaining: budget.remaining },
      });
    }

    await input.persistence.upsertQuoteFallbackSnapshot({
      policyId: policy.id,
      marketCode: policy.marketCode,
      ticker: policy.ticker,
      provider: policy.provider,
      priceType: policy.priceType,
      providerSymbol: policy.providerSymbol,
      marketDate: snapshot.closeDate,
      close: snapshot.latest.close,
      previousClose: snapshot.previous?.close ?? null,
      currency: snapshot.currency,
      currencySource: snapshot.currencySource,
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      providerPayloadHash: null,
      providerMetadata: snapshot.providerMetadata,
    });

    return await finalizePolicyRefresh(policy, input, {
      status: "success",
      marketDate: snapshot.closeDate,
      message: `stored fallback snapshot for ${snapshot.closeDate}`,
      refreshedAt: snapshot.fetchedAt,
      errorCode: null,
      budgetAfter: { limit: budget.limit, used: budget.used, remaining: budget.remaining },
    });
  } catch (error) {
    input.log?.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        policyId: policy.id,
        ticker: policy.ticker,
        marketCode: policy.marketCode,
        providerSymbol: policy.providerSymbol,
        closeDate,
      },
      "quote_fallback_refresh_failed",
    );
    return await finalizePolicyRefresh(policy, input, {
      status: "error",
      marketDate: closeDate,
      message: error instanceof Error ? error.message : String(error),
      refreshedAt: null,
      errorCode: "provider_error",
      budgetAfter: { limit: budget.limit, used: budget.used, remaining: budget.remaining },
    });
  }
}

async function finalizePolicyRefresh(
  policy: QuoteFallbackPolicy,
  input: RunQuoteFallbackRefreshInput,
  result: {
    status: QuoteFallbackRefreshStatus;
    marketDate: string | null;
    message: string;
    refreshedAt: string | null;
    errorCode: string | null;
    budgetAfter: { limit: number; used: number; remaining: number } | null;
    persistStatus?: boolean;
  },
): Promise<QuoteFallbackRefreshItem> {
  if (result.persistStatus !== false) {
    await input.persistence.updateQuoteFallbackPolicyRefreshStatus({
      policyId: policy.id,
      status: result.status,
      refreshedAt: result.refreshedAt,
      error: result.status === "success" || result.status === "skipped" ? null : result.message,
      errorCode: result.errorCode,
    });
  }

  if (input.persistence.createMarketDataActivityEvent) {
    const eventType = mapEventType(result.status);
    await input.persistence.createMarketDataActivityEvent({
      marketCode: policy.marketCode,
      category: "daily_close",
      result: result.status,
      sourceKind: "provider",
      sourceId: "quote-fallback-refresh",
      eventType,
      title: "Quote fallback refresh",
      message: `${policy.ticker} ${result.message}.`,
      ticker: policy.ticker,
      providerSymbol: policy.providerSymbol,
      dedupeKey: `quote-fallback:${policy.id}:${eventType}:${result.marketDate ?? "none"}`,
      detail: {
        policyId: policy.id,
        provider: policy.provider,
        priceType: policy.priceType,
        marketDate: result.marketDate,
        budgetAfter: result.budgetAfter,
      },
    });
  }

  return {
    policyId: policy.id,
    ticker: policy.ticker,
    marketCode: policy.marketCode,
    providerSymbol: policy.providerSymbol,
    status: result.status,
    marketDate: result.marketDate,
    message: result.message,
    budgetAfter: result.budgetAfter,
  };
}

function mapEventType(status: QuoteFallbackRefreshStatus): string {
  switch (status) {
    case "success":
      return "quote_fallback_refresh_completed";
    case "warning":
      return "quote_fallback_refresh_missing_close";
    case "rate_limited":
      return "quote_fallback_refresh_rate_limited";
    case "skipped":
      return "quote_fallback_refresh_skipped";
    case "error":
    default:
      return "quote_fallback_refresh_failed";
  }
}
