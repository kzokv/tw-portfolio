import type { FastifyBaseLogger } from "fastify";
import type { MarketCode } from "@vakwen/domain";
import type {
  PersistedTickerFundamentalsRecord,
  Persistence,
  RecordTickerFundamentalsRefreshFailureInput,
  SaveTickerFundamentalsSnapshotInput,
} from "../../persistence/types.js";
import type { FundamentalsRegistry } from "./types.js";

const SUCCESS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILURE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const inFlightRefreshes = new Map<string, Promise<void>>();

export function scheduleTickerFundamentalsRefresh(
  deps: {
    persistence: Pick<
      Persistence,
      "saveTickerFundamentalsSnapshot" | "recordTickerFundamentalsRefreshFailure"
    >;
    fundamentalsRegistry: FundamentalsRegistry;
    log: FastifyBaseLogger;
  },
  input: {
    ticker: string;
    marketCode: MarketCode;
    current: PersistedTickerFundamentalsRecord | null;
    now?: Date;
  },
): void {
  const now = input.now ?? new Date();
  if (!shouldRefresh(input.current, now)) {
    return;
  }

  const key = `${input.ticker}:${input.marketCode}`;
  if (inFlightRefreshes.has(key)) {
    return;
  }

  const refreshTask = runRefresh(deps, {
    ticker: input.ticker,
    marketCode: input.marketCode,
    now,
  }).catch((error) => {
    deps.log.error(
      {
        err: error,
        ticker: input.ticker,
        marketCode: input.marketCode,
      },
      "ticker_fundamentals_refresh_unhandled_failure",
    );
  }).finally(() => {
    inFlightRefreshes.delete(key);
  });

  inFlightRefreshes.set(key, refreshTask);
}

function shouldRefresh(current: PersistedTickerFundamentalsRecord | null, now: Date): boolean {
  if (!current) return true;
  if (!current.nextRefreshAt) return true;
  return current.nextRefreshAt <= now.toISOString();
}

async function runRefresh(
  deps: {
    persistence: Pick<
      Persistence,
      "saveTickerFundamentalsSnapshot" | "recordTickerFundamentalsRefreshFailure"
    >;
    fundamentalsRegistry: FundamentalsRegistry;
    log: FastifyBaseLogger;
  },
  input: {
    ticker: string;
    marketCode: MarketCode;
    now: Date;
  },
): Promise<void> {
  const provider = deps.fundamentalsRegistry.get(input.marketCode);
  if (!provider) {
    return;
  }

  const attemptedAt = input.now.toISOString();

  try {
    const fundamentals = await provider.fetchFundamentals({
      ticker: input.ticker,
      marketCode: input.marketCode,
    });

    const saveInput: SaveTickerFundamentalsSnapshotInput = {
      ticker: input.ticker,
      marketCode: input.marketCode,
      providerId: provider.providerId,
      fundamentals,
      refreshedAt: attemptedAt,
      nextRefreshAt: new Date(input.now.getTime() + SUCCESS_REFRESH_INTERVAL_MS).toISOString(),
    };

    await deps.persistence.saveTickerFundamentalsSnapshot(saveInput);
  } catch (error) {
    const failureInput: RecordTickerFundamentalsRefreshFailureInput = {
      ticker: input.ticker,
      marketCode: input.marketCode,
      providerId: provider.providerId,
      attemptedAt,
      nextRefreshAt: new Date(input.now.getTime() + FAILURE_REFRESH_INTERVAL_MS).toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    };

    await deps.persistence.recordTickerFundamentalsRefreshFailure(failureInput);
    deps.log.warn(
      {
        err: error,
        ticker: input.ticker,
        marketCode: input.marketCode,
        providerId: provider.providerId,
      },
      "ticker_fundamentals_refresh_failed",
    );
  }
}
