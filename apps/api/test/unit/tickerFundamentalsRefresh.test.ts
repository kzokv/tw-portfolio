import { describe, expect, it, vi } from "vitest";
import { scheduleTickerFundamentalsRefresh } from "../../src/services/fundamentals/refresh.js";
import { createEmptyTickerFundamentals, type FundamentalsProvider } from "../../src/services/fundamentals/types.js";
import type { Persistence } from "../../src/persistence/types.js";

describe("scheduleTickerFundamentalsRefresh", () => {
  it("logs and clears terminal refresh failures when failure persistence also fails", async () => {
    const error = vi.fn();
    const provider: FundamentalsProvider = {
      providerId: "test-provider",
      fetchFundamentals: vi.fn(async () => {
        throw new Error("upstream failed");
      }),
    };
    const persistence = {
      saveTickerFundamentalsSnapshot: vi.fn(async () => createEmptyTickerFundamentals()),
      recordTickerFundamentalsRefreshFailure: vi.fn(async () => {
        throw new Error("failure write failed");
      }),
    } as unknown as Pick<
      Persistence,
      "saveTickerFundamentalsSnapshot" | "recordTickerFundamentalsRefreshFailure"
    >;

    scheduleTickerFundamentalsRefresh(
      {
        persistence,
        fundamentalsRegistry: new Map([["TW", provider]]),
        log: {
          warn: vi.fn(),
          error,
        } as never,
      },
      {
        ticker: "2330",
        marketCode: "TW",
        current: null,
      },
    );

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: "2330",
          marketCode: "TW",
        }),
        "ticker_fundamentals_refresh_unhandled_failure",
      );
    });
  });
});
