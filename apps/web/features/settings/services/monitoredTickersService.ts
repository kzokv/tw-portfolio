"use client";

import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@tw-portfolio/shared-types";
import { getJson, postJson, putJson } from "../../../lib/api";

export interface MonitoredTickersResponse {
  // KZO-169 (D7a): MonitoredTickerDto.marketCode is now a required field;
  // the GET return shape reflects that automatically via the shared type.
  tickers: MonitoredTickerDto[];
}

export interface InstrumentsCatalogResponse {
  instruments: InstrumentCatalogItemDto[];
}

export interface SaveMonitoredTickersResponse {
  tickers: MonitoredTickerDto[];
  newTickers: string[];
}

// KZO-169 (D7a): the monitored-tickers PUT body shape changes from
// `{ tickers: string[] }` to `{ tickers: { ticker, marketCode }[] }`. The
// caller is responsible for stamping `marketCode` (typically from the
// matching catalog row's `InstrumentCatalogItemDto.marketCode`).
export interface MonitoredTickerSelection {
  ticker: string;
  marketCode: string;
}

export async function fetchMonitoredTickers(): Promise<MonitoredTickersResponse> {
  return getJson<MonitoredTickersResponse>("/monitored-tickers");
}

export async function fetchInstrumentsCatalog(
  search?: string,
  type?: string,
): Promise<InstrumentsCatalogResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (type) params.set("type", type);
  const qs = params.toString();
  return getJson<InstrumentsCatalogResponse>(`/instruments${qs ? `?${qs}` : ""}`);
}

export async function saveMonitoredTickers(
  tickers: MonitoredTickerSelection[],
): Promise<SaveMonitoredTickersResponse> {
  return putJson<SaveMonitoredTickersResponse>("/monitored-tickers", { tickers });
}

export interface RetryBackfillResponse {
  ticker: string;
  barsBackfillStatus: string;
}

export async function retryBackfill(ticker: string, marketCode?: string): Promise<RetryBackfillResponse> {
  return postJson<RetryBackfillResponse>("/backfill/retry", marketCode ? { ticker, marketCode } : { ticker });
}
