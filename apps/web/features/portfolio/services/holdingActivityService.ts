"use client";

import type { HoldingActivityDividendsDto, MarketCode } from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";

export type HoldingActivityPageSize = 10 | 25 | 50;

export interface HoldingActivityQuery {
  ticker: string;
  marketCode: MarketCode;
  accountId?: string;
  accountIds?: string[];
  positionActionsPage?: number;
  positionActionsLimit?: HoldingActivityPageSize;
  upcomingPage?: number;
  upcomingLimit?: HoldingActivityPageSize;
  postedPage?: number;
  postedLimit?: HoldingActivityPageSize;
  signal?: AbortSignal;
}

function buildHoldingActivityQuery(params: HoldingActivityQuery): string {
  const query = new URLSearchParams({
    marketCode: params.marketCode,
    positionActionsPage: String(params.positionActionsPage ?? 1),
    positionActionsLimit: String(params.positionActionsLimit ?? 10),
    upcomingPage: String(params.upcomingPage ?? 1),
    upcomingLimit: String(params.upcomingLimit ?? 50),
    postedPage: String(params.postedPage ?? 1),
    postedLimit: String(params.postedLimit ?? 10),
  });

  if (params.accountId) {
    query.set("accountId", params.accountId);
  }
  for (const accountId of params.accountIds ?? []) {
    query.append("accountIds", accountId);
  }

  return query.toString();
}

export async function fetchHoldingActivityDividends(params: HoldingActivityQuery): Promise<HoldingActivityDividendsDto> {
  return getJson<HoldingActivityDividendsDto>(
    `/portfolio/holdings/${encodeURIComponent(params.ticker)}/activity-dividends?${buildHoldingActivityQuery(params)}`,
    params.signal ? { signal: params.signal } : undefined,
  );
}
