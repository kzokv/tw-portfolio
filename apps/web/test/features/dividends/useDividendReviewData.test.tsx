import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DividendReviewEnrichmentDto,
  DividendReviewPrimaryDto,
  DividendReviewPrimaryQueryDto,
} from "@vakwen/shared-types";
import { useDividendReviewData } from "../../../features/dividends/hooks/useDividendReviewData";
import {
  buildDividendReviewEnrichmentCacheKey,
  buildDividendReviewPrimaryCacheKey,
} from "../../../features/dividends/dividendReviewCache";
import { writeRouteDtoCache } from "../../../lib/routeDtoCache";

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendReviewPrimary: vi.fn(),
  fetchDividendReviewEnrichment: vi.fn(),
}));

import {
  fetchDividendReviewEnrichment,
  fetchDividendReviewPrimary,
} from "../../../features/dividends/services/dividendService";

const scope = "session:user-a:context:self";
const query: DividendReviewPrimaryQueryDto = {
  fromPaymentDate: "2026-01-01",
  toPaymentDate: "2026-12-31",
  sortBy: "paymentDate",
  sortOrder: "desc",
  page: 1,
  limit: 10,
};
const primary = (id: string): DividendReviewPrimaryDto => ({
  eligibleTickers: [{ ticker: id, name: id }],
  reviewRows: [{
    rowKind: "expected", id, version: 0, accountId: "acc-1", dividendEventId: "event-1",
    ticker: id, tickerName: id, marketCode: "TW", instrumentType: "STOCK", eventType: "CASH",
    exDividendDate: "2026-06-01", paymentDate: "2026-07-01", cashCurrency: "TWD",
    eligibleQuantity: 1, expectedCashAmount: 1, receivedCashAmount: 0,
    expectedStockQuantity: 0, receivedStockQuantity: 0, postingStatus: "expected",
    cashReconciliationStatus: "open", stockReconciliationStatus: null,
    reconciliationStatus: "open", sourceCompositionStatus: "unknown_pending_disclosure",
  }],
  total: 1,
  years: [2026],
  accounts: [{ id: "acc-1", name: "Main" }],
});
const enrichment: DividendReviewEnrichmentDto = {
  aggregates: { totalExpectedCashAmount: {}, totalReceivedCashAmount: {}, openCount: 0, byMonth: {}, byTicker: {} },
  nhiRollup: { bucketAggregates: [], nhiSubjectTotal: 0, projectedPremium: 0, pendingCount: 0, hasEtfEntries: false },
  sourceComposition: { providedCount: 0, pendingCount: 0 },
};

let result: ReturnType<typeof useDividendReviewData>;
const onQueryRollback = vi.fn();
const onQueryRetry = vi.fn();

function Harness({ initialPrimary = primary("seed") }: { initialPrimary?: DividendReviewPrimaryDto | null }) {
  result = useDividendReviewData({
    cacheScope: scope,
    initialPrimary,
    initialQuery: query,
    onQueryRollback,
    onQueryRetry,
  });
  return null;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useDividendReviewData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.mocked(fetchDividendReviewEnrichment).mockResolvedValue(enrichment);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("uses a fresh exact cache without fetching primary", async () => {
    writeRouteDtoCache(buildDividendReviewPrimaryCacheKey(scope, query), primary("cached"));
    act(() => root.render(<Harness initialPrimary={null} />));
    await act(async () => {});

    expect(result.primary?.reviewRows[0]?.id).toBe("cached");
    expect(result.isPrimaryPending).toBe(false);
    expect(fetchDividendReviewPrimary).not.toHaveBeenCalled();
  });

  it("commits accounts and years from a successful client primary after an SSR-null start", async () => {
    const clientPrimary = { ...primary("client"), years: [2024], accounts: [{ id: "client-acc", name: "Client" }] };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(clientPrimary);

    act(() => root.render(<Harness initialPrimary={null} />));
    await act(async () => {});

    expect(result.committedPrimary?.accounts).toEqual(clientPrimary.accounts);
    expect(result.committedPrimary?.years).toEqual([2024]);
  });

  it("discards prior-context metadata until the replacement context primary commits", async () => {
    const ownerPrimary = { ...primary("owner"), years: [2023], accounts: [{ id: "owner-acc", name: "Owner" }] };
    let resolveOwner!: (value: DividendReviewPrimaryDto) => void;
    vi.mocked(fetchDividendReviewPrimary).mockReturnValue(new Promise((resolve) => { resolveOwner = resolve; }));
    act(() => root.render(<Harness />));
    await act(async () => {});

    await act(async () => {
      void result.invalidateAndRefresh({ resetPage: true, discardCommitted: true });
    });
    expect(result.committedPrimary).toBeNull();

    await act(async () => { resolveOwner(ownerPrimary); });
    expect(result.committedPrimary?.accounts).toEqual(ownerPrimary.accounts);
    expect(result.committedPrimary?.years).toEqual([2023]);
  });

  it("renders stale exact rows while visibly revalidating", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    writeRouteDtoCache(buildDividendReviewPrimaryCacheKey(scope, query), primary("stale"), { ttlMs: 100, staleTtlMs: 1_000 });
    vi.setSystemTime(new Date("2026-07-01T00:00:00.200Z"));
    vi.mocked(fetchDividendReviewPrimary).mockReturnValue(new Promise(() => {}));

    act(() => root.render(<Harness initialPrimary={null} />));
    await act(async () => {});

    expect(result.primary?.reviewRows[0]?.id).toBe("stale");
    expect(result.isPrimaryRefreshing).toBe(true);
  });

  it("keeps stale exact rows committed when their background revalidation fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    writeRouteDtoCache(buildDividendReviewPrimaryCacheKey(scope, query), primary("stale"), { ttlMs: 100, staleTtlMs: 1_000 });
    vi.setSystemTime(new Date("2026-07-01T00:00:00.200Z"));
    vi.mocked(fetchDividendReviewPrimary).mockRejectedValue(new Error("revalidation failed"));

    act(() => root.render(<Harness initialPrimary={null} />));
    await act(async () => {});

    expect(result.primary?.reviewRows[0]?.id).toBe("stale");
    expect(result.committedQuery).toEqual(query);
    expect(result.primaryError).toContain("revalidation failed");
  });

  it("keeps primary rows usable when enrichment fails locally", async () => {
    vi.mocked(fetchDividendReviewEnrichment).mockRejectedValue(new Error("enrichment unavailable"));
    act(() => root.render(<Harness />));
    await act(async () => {});

    expect(result.primary?.reviewRows[0]?.id).toBe("seed");
    expect(result.enrichment).toBeNull();
    expect(result.enrichmentError).toContain("enrichment unavailable");
    expect(result.isPrimaryPending).toBe(false);
  });

  it("retains stale enrichment after revalidation fails and replaces it after retry succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    const staleEnrichment: DividendReviewEnrichmentDto = {
      ...enrichment,
      aggregates: { ...enrichment.aggregates, openCount: 7 },
    };
    const refreshedEnrichment: DividendReviewEnrichmentDto = {
      ...enrichment,
      aggregates: { ...enrichment.aggregates, openCount: 3 },
    };
    writeRouteDtoCache(
      buildDividendReviewEnrichmentCacheKey(scope, query),
      staleEnrichment,
      { ttlMs: 100, staleTtlMs: 1_000 },
    );
    vi.setSystemTime(new Date("2026-07-01T00:00:00.200Z"));
    vi.mocked(fetchDividendReviewEnrichment)
      .mockRejectedValueOnce(new Error("enrichment revalidation failed"))
      .mockResolvedValueOnce(refreshedEnrichment);

    act(() => root.render(<Harness />));
    await act(async () => {});

    expect(result.enrichment?.aggregates.openCount).toBe(7);
    expect(result.enrichmentError).toContain("enrichment revalidation failed");
    expect(result.isEnrichmentPending).toBe(false);
    expect(result.primary?.reviewRows[0]?.id).toBe("seed");

    await act(async () => { await result.retryEnrichment(); });

    expect(result.enrichment?.aggregates.openCount).toBe(3);
    expect(result.enrichmentError).toBe("");
    expect(fetchDividendReviewEnrichment).toHaveBeenCalledTimes(2);
  });

  it("aborts a superseded primary and commits only the final requested identity", async () => {
    const signals: AbortSignal[] = [];
    let resolveFinal!: (value: DividendReviewPrimaryDto) => void;
    vi.mocked(fetchDividendReviewPrimary)
      .mockImplementationOnce((_query, options) => {
        signals.push(options!.signal!);
        return new Promise(() => {});
      })
      .mockImplementationOnce((_query, options) => {
        signals.push(options!.signal!);
        return new Promise((resolve) => { resolveFinal = resolve; });
      });
    act(() => root.render(<Harness />));
    await act(async () => {});

    const tickerQuery = { ...query, sortBy: "ticker" as const, sortOrder: "asc" as const };
    const varianceQuery = { ...query, sortBy: "varianceAmount" as const, sortOrder: "asc" as const };
    await act(async () => { void result.request(tickerQuery); });
    await act(async () => { void result.request(varianceQuery); });
    expect(signals[0]?.aborted).toBe(true);
    expect(result.primary).toBeNull();

    await act(async () => { resolveFinal(primary("final")); });
    expect(result.primary?.reviewRows[0]?.id).toBe("final");
    expect(result.committedQuery.sortBy).toBe("varianceAmount");
  });

  it("does not abort or restart enrichment when only sort or page changes", async () => {
    let enrichmentSignal: AbortSignal | undefined;
    vi.mocked(fetchDividendReviewEnrichment).mockImplementation((_filters, options) => {
      enrichmentSignal = options?.signal;
      return new Promise(() => {});
    });
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(primary("sorted"));
    act(() => root.render(<Harness />));
    await act(async () => {});

    await act(async () => {
      await result.request({ ...query, sortBy: "ticker", sortOrder: "asc", page: 2 });
    });

    expect(fetchDividendReviewEnrichment).toHaveBeenCalledTimes(1);
    expect(enrichmentSignal?.aborted).toBe(false);
  });

  it("rolls back rows/query after failure and retries the failed attempted identity", async () => {
    const attempted = { ...query, page: 2 };
    vi.mocked(fetchDividendReviewPrimary)
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce(primary("retried"));
    act(() => root.render(<Harness />));
    await act(async () => {});

    await act(async () => { await result.request(attempted); });
    expect(result.primary?.reviewRows[0]?.id).toBe("seed");
    expect(result.requestedQuery).toEqual(query);
    expect(result.primaryError).toContain("primary unavailable");
    expect(onQueryRollback).toHaveBeenCalledWith(query);

    await act(async () => { await result.retryPrimary(); });
    expect(onQueryRetry).toHaveBeenCalledWith(attempted);
    expect(result.primary?.reviewRows[0]?.id).toBe("retried");
    expect(result.committedQuery).toEqual(attempted);
  });
});
