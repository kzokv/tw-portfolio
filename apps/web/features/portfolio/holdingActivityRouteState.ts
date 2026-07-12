import type { HoldingActivityPageSize } from "./services/holdingActivityService";

export interface HoldingActivityScope {
  ticker: string;
  marketCode: string;
  accountId?: string;
}

export interface HoldingActivityRouteState extends HoldingActivityScope {
  positionActionsPage: number;
  positionActionsLimit: HoldingActivityPageSize;
  postedPage: number;
  postedLimit: HoldingActivityPageSize;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT: HoldingActivityPageSize = 10;

function normalizePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE;
}

function normalizeLimit(value: string | null): HoldingActivityPageSize {
  if (value === "25") return 25;
  if (value === "50") return 50;
  return 10;
}

function scopeMatches(searchParams: URLSearchParams, scope: HoldingActivityScope): boolean {
  return searchParams.get("holdingActivityTicker") === scope.ticker
    && searchParams.get("holdingActivityMarketCode") === scope.marketCode
    && (searchParams.get("holdingActivityAccountId") ?? "") === (scope.accountId ?? "");
}

export function parseHoldingActivityRouteState(
  searchParams: URLSearchParams,
  scope: HoldingActivityScope,
): HoldingActivityRouteState {
  const positionActionsLimit = normalizeLimit(searchParams.get("holdingActivityPositionActionsLimit"));
  const postedLimit = normalizeLimit(searchParams.get("holdingActivityPostedLimit"));
  const matches = scopeMatches(searchParams, scope);

  return {
    ...scope,
    positionActionsPage: matches ? normalizePage(searchParams.get("holdingActivityPositionActionsPage")) : DEFAULT_PAGE,
    positionActionsLimit: matches ? positionActionsLimit : DEFAULT_LIMIT,
    postedPage: matches ? normalizePage(searchParams.get("holdingActivityPostedPage")) : DEFAULT_PAGE,
    postedLimit: matches ? postedLimit : DEFAULT_LIMIT,
  };
}

export function mergeHoldingActivityRouteStateIntoSearchParams(
  searchParams: URLSearchParams,
  state: HoldingActivityRouteState,
): URLSearchParams {
  const next = new URLSearchParams(searchParams.toString());
  next.set("holdingActivityTicker", state.ticker);
  next.set("holdingActivityMarketCode", state.marketCode);
  if (state.accountId) next.set("holdingActivityAccountId", state.accountId);
  else next.delete("holdingActivityAccountId");
  next.set("holdingActivityPositionActionsPage", String(state.positionActionsPage));
  next.set("holdingActivityPositionActionsLimit", String(state.positionActionsLimit));
  next.set("holdingActivityPostedPage", String(state.postedPage));
  next.set("holdingActivityPostedLimit", String(state.postedLimit));
  return next;
}
