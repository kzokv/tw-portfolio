import type { MarketCode } from "@vakwen/domain";
import type {
  ProviderErrorTrailRow,
  UpsertProviderIncidentInput,
  UpsertProviderUnresolvedItemInput,
} from "../../persistence/types.js";

export function inferProviderMarketCode(providerId: string, context: Record<string, unknown> | null): MarketCode {
  const contextMarket = typeof context?.marketCode === "string" ? context.marketCode.toUpperCase() : null;
  if (contextMarket === "TW" || contextMarket === "US" || contextMarket === "AU" || contextMarket === "KR") {
    return contextMarket;
  }
  if (providerId.endsWith("-tw")) return "TW";
  if (providerId.endsWith("-us")) return "US";
  if (providerId.endsWith("-au") || providerId === "asx-gics-csv") return "AU";
  return "KR";
}

export function inferProviderIncidentMarketCode(
  providerId: string,
  context: Record<string, unknown> | null,
): MarketCode | null {
  const contextMarket = typeof context?.marketCode === "string" ? context.marketCode.toUpperCase() : null;
  if (contextMarket === "TW" || contextMarket === "US" || contextMarket === "AU" || contextMarket === "KR") {
    return contextMarket;
  }
  if (providerId.endsWith("-tw")) return "TW";
  if (providerId.endsWith("-us")) return "US";
  if (providerId.endsWith("-kr")) return "KR";
  if (providerId.endsWith("-au") || providerId === "asx-gics-csv") return "AU";
  return null;
}

export function inferProviderErrorCode(errorClass: string, errorMessage: string | null): string {
  const message = errorMessage ?? "";
  if (message.includes("yahoo_finance_kr_symbol_unresolved")) return "yahoo_finance_kr_symbol_unresolved";
  if (message.includes("provider_symbol_unresolved")) return "provider_symbol_unresolved";
  return errorClass;
}

export function extractProviderUnresolvedSymbol(
  context: Record<string, unknown> | null,
  errorMessage: string | null,
): string | null {
  const raw =
    (typeof context?.ticker === "string" && context.ticker)
    || (typeof context?.symbol === "string" && context.symbol)
    || (typeof context?.providerSymbol === "string" && context.providerSymbol)
    || (errorMessage?.match(/:\s*([A-Z0-9][A-Z0-9.-]{1,20})\s*$/i)?.[1] ?? null);
  const symbol = raw?.trim().toUpperCase();
  return symbol && symbol.length > 0 ? symbol : null;
}

export function providerIncidentInputFromErrorTrail(row: ProviderErrorTrailRow): UpsertProviderIncidentInput {
  const marketCode = inferProviderIncidentMarketCode(row.providerId, row.context);
  const errorCode = inferProviderErrorCode(row.errorClass, row.errorMessage);
  const sourceSymbol = extractProviderUnresolvedSymbol(row.context, row.errorMessage);
  const incidentKey = [
    row.errorClass,
    errorCode,
    marketCode ?? "GLOBAL",
    sourceSymbol ?? "provider",
  ].join(":");
  return {
    providerId: row.providerId,
    marketCode,
    incidentKey,
    severity: row.errorClass === "rate_limit" ? "warning" : "critical",
    title: sourceSymbol
      ? `${row.providerId} unresolved ${sourceSymbol}`
      : `${row.providerId} ${errorCode.replace(/_/g, " ")}`,
    summary: row.errorMessage,
    errorClass: row.errorClass,
    errorCode,
    lastErrorTrailId: row.id,
    metadata: { context: row.context, sourceSymbol },
  };
}

export function providerUnresolvedItemInputFromErrorTrail(
  row: ProviderErrorTrailRow,
): UpsertProviderUnresolvedItemInput | null {
  if (row.errorClass === "rate_limit") return null;
  const sourceSymbol = extractProviderUnresolvedSymbol(row.context, row.errorMessage);
  if (!sourceSymbol) return null;
  return {
    providerId: row.providerId,
    marketCode: inferProviderMarketCode(row.providerId, row.context),
    errorCode: inferProviderErrorCode(row.errorClass, row.errorMessage),
    sourceSymbol,
    providerSymbol:
      typeof row.context?.providerSymbol === "string"
        ? row.context.providerSymbol.toUpperCase()
        : sourceSymbol,
    lastErrorTrailId: row.id,
    evidence: { context: row.context, errorMessage: row.errorMessage },
  };
}
