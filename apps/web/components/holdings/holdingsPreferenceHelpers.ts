"use client";

import type {
  HoldingsSelectionPreferenceDto,
  HoldingsSortDirection,
  HoldingsSortField,
  HoldingsSortMode,
  HoldingsTableContextPreferenceDto,
  HoldingsTableSettingsPreferenceDto,
} from "@vakwen/shared-types";
import {
  holdingsSelectionPreferenceSchema,
  holdingsTableSettingsPreferenceSchema,
} from "@vakwen/shared-types";
import { getJson, patchJson } from "../../lib/api";

export const LEGACY_SHARED_HOLDINGS_CONTEXT_KEY = "holdings.shared";
export const PORTFOLIO_HOLDINGS_CONTEXT_KEY = "portfolio.holdings";
export const DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY = "dashboard.topHoldings";
export const REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY = "reports.dailyReview.topMovers";
export const REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY = "reports.dailyReview.holdings";
export const REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY = "reports.portfolio.holdings";
export const REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY = "reports.market.topHoldings";
export const REPORTS_MARKET_DETAIL_CONTEXT_KEY = "reports.market.detail";

const MIGRATED_HOLDINGS_CONTEXT_KEYS = [
  PORTFOLIO_HOLDINGS_CONTEXT_KEY,
  DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY,
  REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY,
  REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY,
  REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY,
  REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY,
  REPORTS_MARKET_DETAIL_CONTEXT_KEY,
] as const;

interface UserPreferencesResponse {
  preferences?: {
    holdingsSelection?: unknown;
    holdingsTableSettings?: unknown;
  };
}

interface PortfolioPrimaryHoldingsUniverseResponse {
  holdingGroups?: Array<{
    marketCode?: unknown;
    ticker?: unknown;
  }>;
}

export function buildHoldingsTickerId(marketCode: string, ticker: string): string {
  return `${marketCode}:${ticker.toUpperCase()}`;
}

export function defaultHoldingsSelectionPreference(): HoldingsSelectionPreferenceDto {
  return { version: 1, mode: "all" };
}

export function noneHoldingsSelectionPreference(): HoldingsSelectionPreferenceDto {
  return { version: 1, mode: "none" };
}

export function normalizeHoldingsSelectionPreference(value: unknown): HoldingsSelectionPreferenceDto {
  const parsed = holdingsSelectionPreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultHoldingsSelectionPreference();
}

export function resolveHoldingsTableSettingsPreference(value: unknown): {
  contexts: Record<string, HoldingsTableContextPreferenceDto>;
  migrated: boolean;
  preference: HoldingsTableSettingsPreferenceDto;
} {
  const parsed = holdingsTableSettingsPreferenceSchema.safeParse(value);
  const rawContexts = readRawHoldingsContexts(value);
  const parsedContexts = parsed.success ? parsed.data.contexts : rawContexts;
  const legacyContext = parsedContexts[LEGACY_SHARED_HOLDINGS_CONTEXT_KEY];
  const contexts: Record<string, HoldingsTableContextPreferenceDto> = { ...parsedContexts };
  let migrated = false;
  if (legacyContext) {
    for (const contextKey of MIGRATED_HOLDINGS_CONTEXT_KEYS) {
      if (contexts[contextKey]) continue;
      contexts[contextKey] = { ...legacyContext };
      migrated = true;
    }
  }
  for (const [contextKey, context] of Object.entries(contexts)) {
    const normalized = normalizeLegacyHoldingsContext(contextKey, context);
    contexts[contextKey] = normalized.context;
    migrated = migrated || normalized.migrated;
  }
  return {
    contexts,
    migrated,
    preference: { version: 1, contexts },
  };
}

export interface RuntimeHoldingsSortPreference {
  sortDirection?: HoldingsSortDirection;
  sortField?: HoldingsSortField;
  sortMode: HoldingsSortMode;
}

export function normalizeHoldingsSortPreference({
  defaultSort,
  rawContext,
  supportedFields,
}: {
  defaultSort: RuntimeHoldingsSortPreference;
  rawContext: Record<string, unknown> | undefined;
  supportedFields: readonly string[];
}): RuntimeHoldingsSortPreference {
  if (rawContext?.sortMode === "custom") return { sortMode: "custom" };
  if (
    rawContext?.sortMode === "field"
    && typeof rawContext.sortField === "string"
    && supportedFields.includes(rawContext.sortField)
    && (rawContext.sortDirection === "asc" || rawContext.sortDirection === "desc")
  ) {
    return {
      sortDirection: rawContext.sortDirection,
      sortField: rawContext.sortField as HoldingsSortField,
      sortMode: "field",
    };
  }
  return { ...defaultSort };
}

export function resolveHoldingsTableContextPreference(
  contexts: Record<string, HoldingsTableContextPreferenceDto>,
  contextKey: string,
): HoldingsTableContextPreferenceDto | undefined {
  const directContext = contexts[contextKey];
  if (directContext) return directContext;
  if (!MIGRATED_HOLDINGS_CONTEXT_KEYS.includes(contextKey as (typeof MIGRATED_HOLDINGS_CONTEXT_KEYS)[number])) {
    return undefined;
  }
  return contexts[LEGACY_SHARED_HOLDINGS_CONTEXT_KEY];
}

export async function fetchHoldingsPreferences(): Promise<{
  holdingsSelection: HoldingsSelectionPreferenceDto;
  holdingsTableSettings: HoldingsTableSettingsPreferenceDto;
  migratedHoldingsTableSettings: boolean;
}> {
  const response = await getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" });
  const holdingsSelection = normalizeHoldingsSelectionPreference(response?.preferences?.holdingsSelection);
  const resolvedHoldingsTableSettings = resolveHoldingsTableSettingsPreference(response?.preferences?.holdingsTableSettings);
  return {
    holdingsSelection,
    holdingsTableSettings: resolvedHoldingsTableSettings.preference,
    migratedHoldingsTableSettings: resolvedHoldingsTableSettings.migrated,
  };
}

export async function fetchHoldingsSelectionUniverseTickerIds(): Promise<string[]> {
  const response = await getJson<PortfolioPrimaryHoldingsUniverseResponse>("/portfolio/primary");
  return [...new Set((response.holdingGroups ?? []).flatMap((holding) => (
    typeof holding.marketCode === "string" && typeof holding.ticker === "string"
      ? [buildHoldingsTickerId(holding.marketCode, holding.ticker)]
      : []
  )))].sort((left, right) => left.localeCompare(right));
}

export async function persistHoldingsSelectionPreference(
  selection: HoldingsSelectionPreferenceDto,
): Promise<void> {
  await patchJson(
    "/user-preferences",
    { holdingsSelection: selection },
    { contextScope: "session", keepalive: true },
  );
}

export async function persistHoldingsTableContexts(
  dirtyContexts: Record<string, HoldingsTableContextPreferenceDto>,
  baseContexts?: Record<string, HoldingsTableContextPreferenceDto>,
): Promise<HoldingsTableSettingsPreferenceDto> {
  const sanitizedDirtyContexts = sanitizeHoldingsTableContextPatches(dirtyContexts);
  const nextContexts = {
    ...(baseContexts ?? (await fetchHoldingsPreferences()).holdingsTableSettings.contexts),
    ...sanitizedDirtyContexts,
  };
  const preference: HoldingsTableSettingsPreferenceDto = {
    version: 1,
    contexts: nextContexts,
  };
  await patchJson(
    "/user-preferences",
    { holdingsTableSettings: { version: 1, contexts: sanitizedDirtyContexts } },
    { contextScope: "session" },
  );
  return preference;
}

const HOLDINGS_TABLE_CONTEXT_PATCH_KEYS = [
  "columnOrder",
  "hiddenColumns",
  "columnWidths",
  "layoutStyle",
  "mobileSummaryCount",
  "rowOrder",
  "selectedMarketCodes",
  "selectedAccountIds",
  "topHoldingsLimit",
  "tickerAllocationChartMode",
  "tickerAllocationTopN",
  "sortMode",
  "sortField",
  "sortDirection",
] as const;

/**
 * Builds the strict API PATCH shape while leaving opaque server-owned keys in
 * the hydrated local context. The persistence layer deep-merges each context,
 * so omitted keys remain stored without being forwarded through a strict route.
 */
export function sanitizeHoldingsTableContextPatches(
  contexts: Record<string, HoldingsTableContextPreferenceDto>,
): Record<string, HoldingsTableContextPreferenceDto> {
  const candidates = Object.fromEntries(Object.entries(contexts).map(([contextKey, context]) => {
    const raw = context as Record<string, unknown>;
    const candidate = Object.fromEntries(HOLDINGS_TABLE_CONTEXT_PATCH_KEYS.flatMap((key) => (
      raw[key] === undefined ? [] : [[key, raw[key]]]
    ))) as HoldingsTableContextPreferenceDto;
    return [contextKey, candidate];
  }));
  const parsed = holdingsTableSettingsPreferenceSchema.parse({ version: 1, contexts: candidates });
  return parsed.contexts;
}

const LEGACY_COLUMN_ALIASES: Readonly<Record<string, string>> = {
  action: "actions",
  avgCost: "averageCost",
  daily: "dailyChange",
  health: "dataHealth",
  lastDividend: "lastDividendDate",
  nextDividend: "nextDividendDate",
  pnl: "unrealizedPnl",
  unrealized: "unrealizedPnl",
  weight: "allocation",
};

function readRawHoldingsContexts(value: unknown): Record<string, HoldingsTableContextPreferenceDto> {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.contexts)) return {};
  return Object.fromEntries(
    Object.entries(value.contexts)
      .filter((entry): entry is [string, Record<string, unknown>] => entry[0].length > 0 && isRecord(entry[1]))
      .map(([contextKey, context]) => [contextKey, { ...context } as HoldingsTableContextPreferenceDto]),
  );
}

function normalizeLegacyHoldingsContext(
  contextKey: string,
  source: HoldingsTableContextPreferenceDto,
): { context: HoldingsTableContextPreferenceDto; migrated: boolean } {
  const normalizedColumns = normalizeLegacyHoldingsColumns(contextKey, source);
  const context = normalizedColumns.context;
  let migrated = normalizedColumns.migrated;
  if (
    context.sortMode === undefined
    && context.sortField === undefined
    && context.sortDirection === undefined
    && Array.isArray(context.rowOrder)
    && context.rowOrder.length > 0
  ) {
    context.sortMode = "custom";
    migrated = true;
  }
  return { context, migrated };
}

export function canonicalizeHoldingsTableContextColumns(
  contextKey: string,
  source: HoldingsTableContextPreferenceDto,
): HoldingsTableContextPreferenceDto {
  return normalizeLegacyHoldingsColumns(contextKey, source).context;
}

function normalizeLegacyHoldingsColumns(
  contextKey: string,
  source: HoldingsTableContextPreferenceDto,
): { context: HoldingsTableContextPreferenceDto; migrated: boolean } {
  const raw = source as HoldingsTableContextPreferenceDto & Record<string, unknown>;
  let migrated = false;
  const mapColumn = (column: string): string[] => {
    if (column === "position") {
      migrated = true;
      if (contextKey === DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY) return ["quantity", "accounts", "allocation"];
      return ["quantity", "accounts"];
    }
    const alias = LEGACY_COLUMN_ALIASES[column];
    if (!alias) return [column];
    migrated = true;
    return [alias];
  };
  const normalizeColumns = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    return uniqueStrings(value.flatMap((column) => typeof column === "string" ? mapColumn(column) : []));
  };
  const columnOrder = normalizeColumns(raw.columnOrder);
  const hiddenColumns = normalizeColumns(raw.hiddenColumns);
  const columnWidths = isRecord(raw.columnWidths) ? { ...raw.columnWidths } : undefined;
  if (columnWidths) {
    for (const [legacy, canonical] of Object.entries(LEGACY_COLUMN_ALIASES)) {
      if (!(legacy in columnWidths)) continue;
      if (!(canonical in columnWidths)) columnWidths[canonical] = columnWidths[legacy];
      delete columnWidths[legacy];
      migrated = true;
    }
    if ("position" in columnWidths) {
      delete columnWidths.position;
      migrated = true;
    }
  }
  const context = {
    ...raw,
    ...(columnOrder ? { columnOrder } : {}),
    ...(hiddenColumns ? { hiddenColumns } : {}),
    ...(columnWidths ? { columnWidths } : {}),
  } as HoldingsTableContextPreferenceDto;
  return { context, migrated };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
