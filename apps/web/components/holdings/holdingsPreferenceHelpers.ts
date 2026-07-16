"use client";

import type {
  HoldingsSelectionPreferenceDto,
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

export function buildHoldingsTickerId(marketCode: string, ticker: string): string {
  return `${marketCode}:${ticker.toUpperCase()}`;
}

export function defaultHoldingsSelectionPreference(): HoldingsSelectionPreferenceDto {
  return { version: 1, mode: "all" };
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
  const parsedContexts = parsed.success ? parsed.data.contexts : {};
  const legacyContext = parsedContexts[LEGACY_SHARED_HOLDINGS_CONTEXT_KEY];
  const contexts = { ...parsedContexts };
  let migrated = false;
  if (legacyContext) {
    for (const contextKey of MIGRATED_HOLDINGS_CONTEXT_KEYS) {
      if (contexts[contextKey]) continue;
      contexts[contextKey] = { ...legacyContext };
      migrated = true;
    }
  }
  return {
    contexts,
    migrated,
    preference: { version: 1, contexts },
  };
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
  if (resolvedHoldingsTableSettings.migrated) {
    try {
      await patchJson(
        "/user-preferences",
        { holdingsTableSettings: resolvedHoldingsTableSettings.preference },
        { contextScope: "session" },
      );
    } catch {
      // Keep using the migrated in-memory view; a later hydration retries persistence.
    }
  }
  return {
    holdingsSelection,
    holdingsTableSettings: resolvedHoldingsTableSettings.preference,
    migratedHoldingsTableSettings: resolvedHoldingsTableSettings.migrated,
  };
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
  const nextContexts = {
    ...(baseContexts ?? (await fetchHoldingsPreferences()).holdingsTableSettings.contexts),
    ...dirtyContexts,
  };
  const preference: HoldingsTableSettingsPreferenceDto = {
    version: 1,
    contexts: nextContexts,
  };
  await patchJson(
    "/user-preferences",
    { holdingsTableSettings: { version: 1, contexts: dirtyContexts } },
    { contextScope: "session" },
  );
  return preference;
}
