"use client";

import type { InstrumentCatalogItemDto, MarketCode } from "@vakwen/shared-types";
import { ApiError, getJson } from "../../../lib/api";

/**
 * KZO-188 — typed transient error class for `/market-data/search` failures
 * the UI should render as "search temporarily unavailable" rather than a raw
 * error stack.
 *
 * Three backend codes collapse into this single user-facing signal:
 *   - 429 (per-IP rate-limit exhausted)
 *   - 503 `provider_rate_limited` (Yahoo's bounded budget exhausted, paired
 *     with `Retry-After`)
 *   - 503 `search_unavailable` (generic upstream provider failure, paired
 *     with `X-Search-Degraded: true`)
 *
 * Per `.claude/rules/service-error-pattern.md`: machine code lives at
 * `body.error`, not `body.code`. `ApiError.code` already reflects that.
 */
export class SearchUnavailableError extends Error {
  readonly status: number;
  readonly errorCode: string | undefined;

  constructor(status: number, errorCode: string | undefined, message?: string) {
    super(message ?? "search temporarily unavailable");
    this.name = "SearchUnavailableError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

interface InstrumentSearchResponse {
  instruments: InstrumentCatalogItemDto[];
}

/**
 * KZO-188 — calls `GET /market-data/search` and returns the candidate
 * instruments. The route accepts only TW/US/AU `marketCode`; the UI gates
 * the call to AU.
 *
 * Maps the route's three failure modes onto a single typed error so the
 * caller doesn't need to reason about HTTP nuance — see SearchUnavailableError.
 */
export async function searchInstruments(
  q: string,
  marketCode: MarketCode,
  signal?: AbortSignal,
): Promise<InstrumentCatalogItemDto[]> {
  const params = new URLSearchParams({ q, market_code: marketCode });
  const path = `/market-data/search?${params.toString()}`;

  try {
    const body = await getJson<InstrumentSearchResponse>(path, { signal });
    return body.instruments;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) {
        throw new SearchUnavailableError(err.status, err.code, err.message);
      }
      if (err.status === 503
        && (err.code === "provider_rate_limited" || err.code === "search_unavailable")) {
        throw new SearchUnavailableError(err.status, err.code, err.message);
      }
    }
    throw err;
  }
}
