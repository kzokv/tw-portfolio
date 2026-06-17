import type { IntradayPriceOverlay, MarketCode } from "@vakwen/domain";
import type { Persistence } from "../../persistence/types.js";

export interface IntradayOverlayCache {
  getLatest(ticker: string, marketCode: MarketCode): Promise<IntradayPriceOverlay | null>;
  getLatestMany(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, IntradayPriceOverlay>>;
  setLatest(overlay: IntradayPriceOverlay): Promise<void>;
  deleteLatest(ticker: string, marketCode: MarketCode): Promise<void>;
}

interface CacheLogger {
  warn: (payload: Record<string, unknown>, message: string) => void;
}

export function createIntradayOverlayCache(
  persistence: Pick<
    Persistence,
    "getLatestIntradayOverlay" | "getLatestIntradayOverlays" | "setLatestIntradayOverlay" | "deleteLatestIntradayOverlay"
  >,
  log?: CacheLogger,
): IntradayOverlayCache {
  return {
    async getLatest(ticker, marketCode) {
      try {
        return await persistence.getLatestIntradayOverlay(ticker, marketCode);
      } catch (error) {
        log?.warn(
          { err: error instanceof Error ? error.message : String(error), ticker, marketCode },
          "intraday_overlay_cache_read_failed_falling_back_to_daily_bars",
        );
        return null;
      }
    },

    async getLatestMany(pairs) {
      try {
        return await persistence.getLatestIntradayOverlays(pairs);
      } catch (error) {
        log?.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            pairCount: pairs.length,
          },
          "intraday_overlay_cache_batch_read_failed_falling_back_to_daily_bars",
        );
        return new Map<string, IntradayPriceOverlay>();
      }
    },

    async setLatest(overlay) {
      try {
        await persistence.setLatestIntradayOverlay(overlay);
      } catch (error) {
        log?.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            ticker: overlay.ticker,
            marketCode: overlay.marketCode,
          },
          "intraday_overlay_cache_write_failed",
        );
      }
    },

    async deleteLatest(ticker, marketCode) {
      try {
        await persistence.deleteLatestIntradayOverlay(ticker, marketCode);
      } catch (error) {
        log?.warn(
          { err: error instanceof Error ? error.message : String(error), ticker, marketCode },
          "intraday_overlay_cache_delete_failed",
        );
      }
    },
  };
}
