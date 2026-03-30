"use client";

import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@tw-portfolio/shared-types";
import { getJson, putJson } from "../../../lib/api";

export interface MonitoredTickersResponse {
  tickers: MonitoredTickerDto[];
}

export interface InstrumentsCatalogResponse {
  instruments: InstrumentCatalogItemDto[];
}

export interface SaveMonitoredTickersResponse {
  tickers: MonitoredTickerDto[];
  newTickers: string[];
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

export async function saveMonitoredTickers(tickers: string[]): Promise<SaveMonitoredTickersResponse> {
  return putJson<SaveMonitoredTickersResponse>("/monitored-tickers", { tickers });
}
