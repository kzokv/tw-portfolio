"use client";

import type { InstrumentCatalogItemDto, MonitoredSymbolDto } from "@tw-portfolio/shared-types";
import { getJson, putJson } from "../../../lib/api";

export interface MonitoredSymbolsResponse {
  symbols: MonitoredSymbolDto[];
}

export interface InstrumentsCatalogResponse {
  instruments: InstrumentCatalogItemDto[];
}

export interface SaveMonitoredSymbolsResponse {
  symbols: MonitoredSymbolDto[];
  newTickers: string[];
}

export async function fetchMonitoredSymbols(): Promise<MonitoredSymbolsResponse> {
  return getJson<MonitoredSymbolsResponse>("/monitored-symbols");
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

export async function saveMonitoredSymbols(tickers: string[]): Promise<SaveMonitoredSymbolsResponse> {
  return putJson<SaveMonitoredSymbolsResponse>("/monitored-symbols", { tickers });
}
