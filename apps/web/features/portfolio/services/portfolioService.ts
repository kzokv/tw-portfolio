import { getJson, postJson } from "../../../lib/api";
import type {
  InstrumentCatalogItemDto,
  MarketCode,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import type { TransactionInput } from "../../../components/portfolio/types";

// KZO-169: market_code query param accepted by GET /instruments. `null` /
// undefined / "ALL" all map to the server's default (no filter).
export type InstrumentCatalogMarketFilter = MarketCode | "ALL" | null | undefined;

export interface RecomputePreviewResponse {
  id: string;
  items: Array<{ tradeEventId: string }>;
}

export interface RecomputeConfirmResponse {
  status: string;
}

export interface TransactionInstrumentCatalogResponse {
  instruments: InstrumentCatalogItemDto[];
}

export interface MarketDataPriceResponse {
  close: number;
  date: string;
  source: string;
  match: "exact" | "previous";
  reason?: "weekend" | "no_bar";
}

export interface TransactionEstimateInput {
  ticker: string;
  // KZO-169: estimate route requires `marketCode` so the server can derive the
  // trade currency from the instrument (D3 / G2). Optional only for legacy
  // callers that have not yet been updated.
  marketCode?: MarketCode;
  quantity: number;
  unitPrice: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
  accountId: string;
}

export interface TransactionEstimateResponse {
  commissionAmount: number;
  taxAmount: number;
}

export async function submitTransaction(input: TransactionInput): Promise<void> {
  // KZO-169: marketCode is required by the server (D3). The form guards this
  // with a chip+ticker commit before enabling submit; if it ever reaches the
  // wire as null the API rejects with `currency_mismatch`/Zod validation.
  await postJson("/portfolio/transactions", {
    ...input,
    ticker: input.ticker.trim().toUpperCase(),
  }, {
    "idempotency-key": `web-${Date.now()}`,
  });
}

export async function fetchTransactionHistory(filters: {
  ticker?: string;
  accountId?: string;
  limit?: number;
}): Promise<TransactionHistoryItemDto[]> {
  const params = new URLSearchParams();

  if (filters.ticker?.trim()) {
    params.set("ticker", filters.ticker.trim().toUpperCase());
  }

  if (filters.accountId) {
    params.set("accountId", filters.accountId);
  }

  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }

  const query = params.toString();
  return getJson<TransactionHistoryItemDto[]>(query ? `/portfolio/transactions?${query}` : "/portfolio/transactions");
}

// KZO-169: when `marketCode` is provided (TW/US/AU), the server filters the
// catalog to that market. Pass `"ALL"` (or omit) for the cross-market view
// used by the chip's All mode.
export async function fetchTransactionInstrumentCatalog(
  marketCode?: InstrumentCatalogMarketFilter,
): Promise<TransactionInstrumentCatalogResponse> {
  const params = new URLSearchParams();
  if (marketCode && marketCode !== "ALL") {
    params.set("market_code", marketCode);
  } else if (marketCode === "ALL") {
    params.set("market_code", "ALL");
  }
  const qs = params.toString();
  return getJson<TransactionInstrumentCatalogResponse>(qs ? `/instruments?${qs}` : "/instruments");
}

// KZO-170 S8: `marketCode` is now a required argument. The API's
// `/market-data/price` route requires `market_code` as a query param —
// the legacy `resolveMarketCode(ticker)` heuristic that returned `'TW'`
// for every ticker was deleted. Callers pass the form's account-derived
// market (`draftTransaction.marketCode`).
export async function fetchMarketDataPrice(
  ticker: string,
  date: string,
  marketCode: MarketCode,
  signal?: AbortSignal,
): Promise<MarketDataPriceResponse> {
  const query = new URLSearchParams({
    ticker: ticker.trim().toUpperCase(),
    date,
    market_code: marketCode,
  });
  return getJson<MarketDataPriceResponse>(`/market-data/price?${query.toString()}`, { signal });
}

export async function estimateTransaction(
  input: TransactionEstimateInput,
  signal?: AbortSignal,
): Promise<TransactionEstimateResponse> {
  return postJson<TransactionEstimateResponse>(
    "/portfolio/transactions/estimate",
    {
      ...input,
      ticker: input.ticker.trim().toUpperCase(),
    },
    undefined,
    { signal },
  );
}

export async function previewRecompute(): Promise<RecomputePreviewResponse> {
  return postJson<RecomputePreviewResponse>("/portfolio/recompute/preview", {
    useFallbackBindings: true,
  });
}

export async function confirmRecompute(jobId: string): Promise<RecomputeConfirmResponse> {
  return postJson<RecomputeConfirmResponse>("/portfolio/recompute/confirm", { jobId });
}
