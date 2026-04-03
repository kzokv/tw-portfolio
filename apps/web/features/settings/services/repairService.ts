import { getJson, postJson } from "../../../lib/api";
import type { InstrumentCatalogItemDto } from "@tw-portfolio/shared-types";

export interface RepairTargetRequest {
  tickers: string[];
  startDate?: string;
  endDate?: string;
  includeBars: boolean;
  includeDividends: boolean;
}

export interface RepairRejectedTicker {
  ticker: string;
  reason: string;
}

export interface RepairRequestResponse {
  queued: string[];
  rejected: RepairRejectedTicker[];
}

interface InstrumentSearchResponse {
  instruments: InstrumentCatalogItemDto[];
}

export async function requestRepair(input: RepairTargetRequest): Promise<RepairRequestResponse> {
  return postJson<RepairRequestResponse>("/backfill/repair", input);
}

// TODO: Replace with exact-match endpoint when available. Currently fetches
// all instruments matching the search prefix and filters client-side.
export async function fetchRepairInstrument(ticker: string): Promise<InstrumentCatalogItemDto | null> {
  const normalized = ticker.trim().toUpperCase();
  const query = new URLSearchParams({ search: normalized });
  const response = await getJson<InstrumentSearchResponse>(`/instruments?${query.toString()}`);
  return response.instruments.find((item) => item.ticker === normalized) ?? null;
}
