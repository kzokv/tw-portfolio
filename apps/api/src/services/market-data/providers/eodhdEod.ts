import type { MarketCode } from "@vakwen/domain";
import { currencyFor, type AccountDefaultCurrency } from "@vakwen/shared-types";

interface EodhdHistoricalRow {
  date?: string;
  open?: number | string | null;
  high?: number | string | null;
  low?: number | string | null;
  close?: number | string | null;
  adjusted_close?: number | string | null;
  volume?: number | string | null;
}

export interface EodhdEodPriceRow {
  marketDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjustedClose: number | null;
  volume: number | null;
}

export interface EodhdCloseSnapshot {
  marketCode: MarketCode;
  providerSymbol: string;
  closeDate: string;
  previousCloseDate: string | null;
  currency: AccountDefaultCurrency;
  currencySource: "provider" | "market_default";
  latest: EodhdEodPriceRow;
  previous: EodhdEodPriceRow | null;
  fetchedAt: string;
  source: "eodhd-eod";
  providerMetadata: {
    request: {
      from: string;
      to: string;
    };
    rowCount: number;
  };
}

export interface EodhdEodProviderConfig {
  apiToken: () => string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class EodhdEodProvider {
  readonly providerId = "eodhd";
  private readonly apiToken: () => string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EodhdEodProviderConfig) {
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl ?? "https://eodhd.com/api";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken()?.trim());
  }

  async fetchCloseSnapshot(input: {
    marketCode: MarketCode;
    providerSymbol: string;
    closeDate: string;
    previousCloseDate?: string | null;
  }): Promise<EodhdCloseSnapshot | null> {
    const from = input.previousCloseDate ?? input.closeDate;
    const to = input.closeDate;
    const rows = await this.fetchHistoricalRange(input.providerSymbol, from, to);
    const latest = rows.find((row) => row.marketDate === input.closeDate);
    if (!latest) return null;

    const previous = input.previousCloseDate
      ? rows.find((row) => row.marketDate === input.previousCloseDate) ?? null
      : null;
    const fetchedAt = new Date().toISOString();

    return {
      marketCode: input.marketCode,
      providerSymbol: input.providerSymbol,
      closeDate: input.closeDate,
      previousCloseDate: input.previousCloseDate ?? null,
      currency: currencyFor(input.marketCode),
      currencySource: "market_default",
      latest,
      previous,
      fetchedAt,
      source: "eodhd-eod",
      providerMetadata: {
        request: { from, to },
        rowCount: rows.length,
      },
    };
  }

  async fetchHistoricalRange(
    providerSymbol: string,
    fromDate: string,
    toDate: string,
  ): Promise<EodhdEodPriceRow[]> {
    const apiToken = this.apiToken();
    if (!apiToken) {
      throw new Error("eodhd_api_key_missing");
    }

    const params = new URLSearchParams({
      api_token: apiToken,
      fmt: "json",
      period: "d",
      order: "a",
      from: fromDate,
      to: toDate,
    });
    const url = `${this.baseUrl}/eod/${encodeURIComponent(providerSymbol)}?${params.toString()}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`eodhd_eod_http_${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(
        `eodhd_eod_invalid_json:${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!Array.isArray(body)) {
      throw new Error("eodhd_eod_unexpected_payload");
    }

    return body
      .map((row) => this.mapHistoricalRow(row))
      .filter((row): row is EodhdEodPriceRow => row !== null)
      .sort((left, right) => left.marketDate.localeCompare(right.marketDate));
  }

  private mapHistoricalRow(input: unknown): EodhdEodPriceRow | null {
    if (!input || typeof input !== "object") return null;
    const row = input as EodhdHistoricalRow;
    if (typeof row.date !== "string") return null;
    const close = toFiniteNumber(row.close);
    if (close === null) return null;

    return {
      marketDate: row.date,
      open: toFiniteNumber(row.open),
      high: toFiniteNumber(row.high),
      low: toFiniteNumber(row.low),
      close,
      adjustedClose: toFiniteNumber(row.adjusted_close),
      volume: toFiniteNumber(row.volume),
    };
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
