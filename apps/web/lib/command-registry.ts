import { ACCENT_PRESETS, type AccentPreset } from "@vakwen/shared-types";
import type { AppDictionary } from "./i18n/types";

/**
 * Phase 3e (§12 A2) — CommandPalette command registry.
 *
 * Three kinds of items render in the palette:
 *   - `route`   navigates via `next/navigation`'s `router.push`
 *   - `ticker`  navigates to `/tickers/{ticker}` (populated by the live
 *               search hook, not this static list)
 *   - `action`  dispatches a typed action id; the CommandPalette consumer
 *               maps each id to a concrete React effect (theme/accent change,
 *               opening AddTransactionDialog, opening RecomputeConfirmDialog)
 *
 * Each item carries a stable `id` (used as the React key + the
 * `command-palette-item-*` testid suffix) and a localized `label`.
 * `keywords` feed the underlying `cmdk` matcher so users can find an item
 * by route slug, accent preset key, etc.
 */

export type CommandPaletteActionId =
  | "theme.light"
  | "theme.system"
  | "theme.dark"
  | `accent.${AccentPreset}`
  | "transaction.add"
  | "recompute.all";

export interface RouteCommandItem {
  kind: "route";
  /** Testid suffix — `command-palette-item-route-{key}`. Stable + URL-safe. */
  key: string;
  label: string;
  href: string;
  /** Extra match tokens the cmdk fuzzy matcher considers. */
  keywords: string[];
}

export interface ActionCommandItem {
  kind: "action";
  /** Testid suffix — `command-palette-item-action-{key}`. Mirrors actionId
   *  with `.` → `-` so `recompute.all` → `recompute-all`. */
  key: string;
  actionId: CommandPaletteActionId;
  label: string;
  keywords: string[];
}

/**
 * Translate `recompute.all` → `recompute-all` so the action id flows
 * directly into the locked testid `command-palette-item-action-recompute-all`
 * without separate cross-referencing.
 */
export function actionTestKey(actionId: CommandPaletteActionId): string {
  return actionId.replace(/\./g, "-");
}

/** Routes registered in the palette. Mirrors the user-shell sidebar entries
 *  plus the four `/settings/{section}` deep-links. */
export function getRouteCommandItems(dict: AppDictionary): RouteCommandItem[] {
  const cp = dict.commandPalette;
  return [
    { kind: "route", key: "dashboard",          label: cp.routeDashboard,        href: "/dashboard",          keywords: ["dashboard", "home"] },
    { kind: "route", key: "analysis",           label: cp.routeAnalysis,         href: "/analysis",           keywords: ["analysis", "unrealized", "decomposition", "ranking"] },
    { kind: "route", key: "reports",            label: cp.routeReports,          href: "/reports",            keywords: ["reports", "analysis", "daily", "market"] },
    { kind: "route", key: "portfolio",          label: cp.routePortfolio,        href: "/portfolio",          keywords: ["portfolio", "holdings"] },
    { kind: "route", key: "transactions",       label: cp.routeTransactions,     href: "/transactions",       keywords: ["transactions", "trades"] },
    { kind: "route", key: "cash-ledger",        label: cp.routeCashLedger,       href: "/cash-ledger",        keywords: ["cash", "ledger"] },
    { kind: "route", key: "dividends",          label: cp.routeDividends,        href: "/dividends",          keywords: ["dividends", "income"] },
    { kind: "route", key: "sharing",            label: cp.routeSharing,          href: "/sharing",            keywords: ["sharing", "share"] },
    { kind: "route", key: "settings-profile",   label: cp.routeSettingsProfile,  href: "/settings/profile",   keywords: ["settings", "profile", "account"] },
    { kind: "route", key: "settings-general",   label: cp.routeSettingsGeneral,  href: "/settings/general",   keywords: ["settings", "general", "locale", "language", "cost", "basis", "quote"] },
    { kind: "route", key: "settings-accounts",  label: cp.routeSettingsAccounts, href: "/settings/accounts",  keywords: ["settings", "accounts"] },
    { kind: "route", key: "settings-display",   label: cp.routeSettingsDisplay,  href: "/settings/display",   keywords: ["settings", "display", "theme"] },
    { kind: "route", key: "settings-tickers",   label: cp.routeSettingsTickers,  href: "/settings/tickers",   keywords: ["settings", "tickers"] },
  ];
}

/** Actions registered in the palette (theme/accent/transaction/recompute).
 *  The `accent.{preset}` set carries 8 entries — one per preset in `ACCENT_PRESETS`. */
export function getActionCommandItems(dict: AppDictionary): ActionCommandItem[] {
  const cp = dict.commandPalette;
  const themeActions: ActionCommandItem[] = [
    { kind: "action", actionId: "theme.light",  key: actionTestKey("theme.light"),  label: cp.actionThemeLight,  keywords: ["theme", "light"] },
    { kind: "action", actionId: "theme.system", key: actionTestKey("theme.system"), label: cp.actionThemeSystem, keywords: ["theme", "system", "auto"] },
    { kind: "action", actionId: "theme.dark",   key: actionTestKey("theme.dark"),   label: cp.actionThemeDark,   keywords: ["theme", "dark"] },
  ];
  const accentActions: ActionCommandItem[] = ACCENT_PRESETS.map((preset) => ({
    kind: "action" as const,
    actionId: `accent.${preset}` satisfies CommandPaletteActionId,
    key: actionTestKey(`accent.${preset}`),
    label: cp.actionAccentPrefix.replace("{accent}", cp.accent[preset]),
    keywords: ["accent", preset, cp.accent[preset]],
  }));
  const otherActions: ActionCommandItem[] = [
    { kind: "action", actionId: "transaction.add", key: actionTestKey("transaction.add"), label: cp.actionAddTransaction, keywords: ["transaction", "add", "new"] },
    { kind: "action", actionId: "recompute.all",   key: actionTestKey("recompute.all"),   label: cp.actionRecomputeAll,   keywords: ["recompute", "rebuild", "history"] },
  ];
  return [...themeActions, ...accentActions, ...otherActions];
}
