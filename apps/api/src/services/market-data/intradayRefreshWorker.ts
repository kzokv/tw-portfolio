import type { IntradayPriceOverlay, MarketCode } from "@vakwen/domain";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import type { YahooIntradayDiagnostic } from "./providers/yahooFinanceIntraday.js";
import { RateLimitedError } from "./types.js";

export const INTRADAY_REFRESH_QUEUE = "intraday-refresh";

export interface IntradayRefreshJobData {
  ticker: string;
  marketCode: MarketCode;
  requestedAt: string;
}

export interface IntradayRefreshRequestBudget {
  tryConsume(requests: number): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }>;
}

export interface IntradayRefreshWorkerRuntimeConfig {
  intradayEnabled: boolean;
  supportedMarkets: ReadonlyArray<MarketCode>;
}

export interface IntradayRefreshWorkerDeps {
  cache: { setLatest(overlay: IntradayPriceOverlay): Promise<void> };
  fetchOverlay(input: { ticker: string; marketCode: MarketCode; now: Date }): Promise<IntradayRefreshFetchResult>;
  requestBudget: IntradayRefreshRequestBudget;
  persistence?: Pick<Persistence, "createMarketCalendarActivityEvent">;
  resolveRuntimeConfig?: () => IntradayRefreshWorkerRuntimeConfig;
  log: {
    info: (payload: Record<string, unknown>, message: string) => void;
    warn: (payload: Record<string, unknown>, message: string) => void;
  };
}

export type IntradayRefreshFetchResult =
  | IntradayPriceOverlay
  | null
  | {
    overlay: IntradayPriceOverlay | null;
    diagnostic?: YahooIntradayDiagnostic;
  };

export interface IntradayRefreshWorkerConfig {
  concurrency: number;
  maxRequestBudgetPerJob: number;
  retryLimit: number;
  retryDelaySeconds: number;
  retryBackoff: boolean;
  expireInSeconds: number;
}

export function intradayRefreshSingletonKey(ticker: string, marketCode: MarketCode): string {
  return `${INTRADAY_REFRESH_QUEUE}:${marketCode}:${ticker}`;
}

export function buildIntradayRefreshQueueOptions(config: IntradayRefreshWorkerConfig) {
  return {
    policy: "stately",
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: config.retryBackoff,
    expireInSeconds: config.expireInSeconds,
  } as const;
}

export function createIntradayRefreshHandler(deps: IntradayRefreshWorkerDeps) {
  return async (jobs: ReadonlyArray<JobWithMetadata<IntradayRefreshJobData>>) => {
    for (const job of jobs) {
      const data = job.data;
      if (!data?.ticker || !data.marketCode) {
        throw new Error("intraday_refresh_job_invalid");
      }
      const runtimeConfig = resolveIntradayRuntimeConfig(deps);
      if (!runtimeConfig.intradayEnabled || !runtimeConfig.supportedMarkets.includes(data.marketCode)) {
        deps.log.info(
          {
            ticker: data.ticker,
            marketCode: data.marketCode,
            intradayEnabled: runtimeConfig.intradayEnabled,
          },
          "intraday_refresh_skipped_by_current_config",
        );
        continue;
      }
      const budget = await deps.requestBudget.tryConsume(1);
      if (!budget.allowed) {
        await emitIntradayActivity(deps, {
          marketCode: data.marketCode,
          ticker: data.ticker,
          jobId: job.id ?? null,
          result: "rate_limited",
          eventType: "intraday_refresh_rate_limited",
          title: "Intraday refresh rate limited",
          message: `${data.ticker} intraday refresh rate limited.`,
          detail: { retryAfterMs: budget.retryAfterMs },
        });
        deps.log.warn(
          {
            ticker: data.ticker,
            marketCode: data.marketCode,
            retryAfterMs: budget.retryAfterMs,
          },
          "intraday_refresh_budget_exhausted",
        );
        throw new RateLimitedError({ msUntilAvailable: budget.retryAfterMs });
      }

      deps.log.info(
        { ticker: data.ticker, marketCode: data.marketCode, jobId: job.id },
        "intraday_refresh_started",
      );
      await emitIntradayActivity(deps, {
        marketCode: data.marketCode,
        ticker: data.ticker,
        jobId: job.id ?? null,
        result: "success",
        eventType: "intraday_refresh_started",
        title: "Intraday refresh started",
        message: `${data.ticker} intraday refresh started.`,
      });
      try {
        const result = normalizeIntradayRefreshFetchResult(await deps.fetchOverlay({
          ticker: data.ticker,
          marketCode: data.marketCode,
          now: new Date(),
        }));
        const { overlay, diagnostic } = result;
        if (!overlay) {
          await emitIntradayActivity(deps, {
            marketCode: data.marketCode,
            ticker: data.ticker,
            jobId: job.id ?? null,
            providerSymbol: diagnostic?.resolvedProviderSymbol,
            result: "warning",
            eventType: "intraday_refresh_no_same_day_quote",
            title: "Intraday quote unavailable",
            message: `${data.ticker} intraday refresh found no same-day quote.`,
            detail: diagnostic ? { ...diagnostic } : undefined,
          });
          deps.log.warn(
            {
              ticker: data.ticker,
              marketCode: data.marketCode,
              jobId: job.id,
              resolvedProviderSymbol: diagnostic?.resolvedProviderSymbol,
              diagnosticSummary: diagnostic,
            },
            "intraday_refresh_no_same_day_quote",
          );
          continue;
        }
        await deps.cache.setLatest(overlay);
        await emitIntradayActivity(deps, {
          marketCode: data.marketCode,
          ticker: data.ticker,
          jobId: job.id ?? null,
          providerSymbol: overlay.providerSymbol ?? overlay.ticker,
          result: "success",
          eventType: "intraday_refresh_completed",
          title: "Intraday refresh completed",
          message: `${data.ticker} intraday refresh completed.`,
          detail: {
            asOfDate: overlay.asOfDate,
            asOfTimestamp: overlay.asOfTimestamp,
            observedAt: overlay.observedAt,
            source: overlay.source,
          },
        });
        deps.log.info(
          {
            ticker: data.ticker,
            marketCode: data.marketCode,
            jobId: job.id,
            asOfTimestamp: overlay.asOfTimestamp,
          },
          "intraday_refresh_completed",
        );
      } catch (error) {
        await emitIntradayActivity(deps, {
          marketCode: data.marketCode,
          ticker: data.ticker,
          jobId: job.id ?? null,
          result: "error",
          eventType: "intraday_refresh_failed",
          title: "Intraday refresh failed",
          message: `${data.ticker} intraday refresh failed.`,
          detail: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
    }
  };
}

function normalizeIntradayRefreshFetchResult(result: IntradayRefreshFetchResult): {
  overlay: IntradayPriceOverlay | null;
  diagnostic?: YahooIntradayDiagnostic;
} {
  if (result === null) return { overlay: null };
  if ("overlay" in result) return result;
  return { overlay: result };
}

function resolveIntradayRuntimeConfig(deps: IntradayRefreshWorkerDeps): IntradayRefreshWorkerRuntimeConfig {
  return deps.resolveRuntimeConfig?.() ?? {
    intradayEnabled: true,
    supportedMarkets: ["TW", "US", "AU", "KR"],
  };
}

export async function enqueueIntradayRefresh(
  boss: Pick<PgBoss, "send"> | null,
  data: IntradayRefreshJobData,
): Promise<string | null> {
  if (!boss) return null;
  return await boss.send(INTRADAY_REFRESH_QUEUE, data, {
    singletonKey: intradayRefreshSingletonKey(data.ticker, data.marketCode),
  });
}

async function emitIntradayActivity(
  deps: IntradayRefreshWorkerDeps,
  input: {
    marketCode: MarketCode;
    ticker: string;
    jobId: string | null;
    providerSymbol?: string;
    result: "success" | "warning" | "error" | "rate_limited";
    eventType: string;
    title: string;
    message: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.persistence?.createMarketCalendarActivityEvent) return;
  try {
    await deps.persistence.createMarketCalendarActivityEvent({
      marketCode: input.marketCode,
      category: "intraday_price",
      result: input.result,
      sourceKind: "yahoo_chart",
      sourceId: "yahoo-finance-chart",
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      ticker: input.ticker,
      providerSymbol: input.providerSymbol ?? null,
      jobId: input.jobId,
      dedupeKey: `intraday:${input.jobId}:${input.eventType}`,
      detail: input.detail,
    });
  } catch (error) {
    deps.log.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        ticker: input.ticker,
        marketCode: input.marketCode,
        eventType: input.eventType,
      },
      "intraday_refresh_activity_emit_failed",
    );
  }
}
