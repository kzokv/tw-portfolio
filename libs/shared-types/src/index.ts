import { z } from "zod";

// `events.ts` is a pure type-declaration module. Marking this re-export as
// `type *` lets Turbopack erase it at compile time, avoiding the
// "./events.js" resolution failure when a value consumer (e.g.
// `AdminSettingsClient.tsx`, `AppShell.tsx`) pulls this barrel into the
// client bundle. See `docs/004-notes/kzo-158/` for the incident context.
export type * from "./events.js";

// KZO-196 — GICS sector / industry-group taxonomy. Inlined into the barrel
// (rather than re-exported from `./gics.ts`) because:
//   * apps/web aliases `@vakwen/shared-types` directly to this source
//     file. Webpack/Turbopack does NOT perform `.js → .ts` extension
//     substitution on relative imports without an explicit `extensionAlias`
//     config, so `from "./gics.js"` cannot resolve at bundle time even though
//     it is the correct emit shape for the API's NodeNext path.
//   * Inlining preserves a single canonical export site and avoids forking
//     resolution between webpack (no extension) and tsc NodeNext (`.js`).
//   * `events.ts` (`export type *`) above is unaffected — type re-exports are
//     erased by the bundler so the `.js` suffix is harmless. `gics` carries
//     runtime values so the type-only escape hatch does not apply.

export interface GicsSector {
  /** Canonical English display name (e.g. `"Information Technology"`). */
  readonly sector: string;
  /** i18n key (snake_case); translations live in the web i18n dictionary. */
  readonly displayKey: string;
}

export interface GicsIndustryGroup {
  /** Canonical industry-group name (e.g. `"Software & Services"`). */
  readonly industryGroup: string;
  /** Parent sector name; matches one entry in `gicsSectors`. */
  readonly sector: string;
  /** i18n key for the industry-group display name. */
  readonly displayKey: string;
}

/**
 * The 11 GICS sectors in canonical S&P/MSCI ordering. Order is preserved on
 * the wire so the UI renders consistently across locales.
 */
export const gicsSectors: readonly GicsSector[] = [
  { sector: "Energy", displayKey: "gics_sector_energy" },
  { sector: "Materials", displayKey: "gics_sector_materials" },
  { sector: "Industrials", displayKey: "gics_sector_industrials" },
  { sector: "Consumer Discretionary", displayKey: "gics_sector_consumer_discretionary" },
  { sector: "Consumer Staples", displayKey: "gics_sector_consumer_staples" },
  { sector: "Health Care", displayKey: "gics_sector_health_care" },
  { sector: "Financials", displayKey: "gics_sector_financials" },
  { sector: "Information Technology", displayKey: "gics_sector_information_technology" },
  { sector: "Communication Services", displayKey: "gics_sector_communication_services" },
  { sector: "Utilities", displayKey: "gics_sector_utilities" },
  { sector: "Real Estate", displayKey: "gics_sector_real_estate" },
];

/**
 * The 25 GICS industry groups (post-2023 taxonomy), each tagged with its
 * parent sector. Display order mirrors the official S&P/MSCI ordering within
 * each sector. The ASX CSV's `GICS industry group` column is expected to
 * match one of these `industryGroup` strings verbatim (case-sensitive);
 * unknown values are preserved at the persistence layer and bucketized to
 * "Other" at render time.
 */
export const gicsIndustryGroups: readonly GicsIndustryGroup[] = [
  // Energy (1)
  { industryGroup: "Energy", sector: "Energy", displayKey: "gics_ig_energy" },
  // Materials (1)
  { industryGroup: "Materials", sector: "Materials", displayKey: "gics_ig_materials" },
  // Industrials (3)
  { industryGroup: "Capital Goods", sector: "Industrials", displayKey: "gics_ig_capital_goods" },
  { industryGroup: "Commercial & Professional Services", sector: "Industrials", displayKey: "gics_ig_commercial_professional_services" },
  { industryGroup: "Transportation", sector: "Industrials", displayKey: "gics_ig_transportation" },
  // Consumer Discretionary (4)
  { industryGroup: "Automobiles & Components", sector: "Consumer Discretionary", displayKey: "gics_ig_automobiles_components" },
  { industryGroup: "Consumer Durables & Apparel", sector: "Consumer Discretionary", displayKey: "gics_ig_consumer_durables_apparel" },
  { industryGroup: "Consumer Services", sector: "Consumer Discretionary", displayKey: "gics_ig_consumer_services" },
  { industryGroup: "Consumer Discretionary Distribution & Retail", sector: "Consumer Discretionary", displayKey: "gics_ig_consumer_discretionary_distribution_retail" },
  // Consumer Staples (3)
  { industryGroup: "Consumer Staples Distribution & Retail", sector: "Consumer Staples", displayKey: "gics_ig_consumer_staples_distribution_retail" },
  { industryGroup: "Food, Beverage & Tobacco", sector: "Consumer Staples", displayKey: "gics_ig_food_beverage_tobacco" },
  { industryGroup: "Household & Personal Products", sector: "Consumer Staples", displayKey: "gics_ig_household_personal_products" },
  // Health Care (2)
  { industryGroup: "Health Care Equipment & Services", sector: "Health Care", displayKey: "gics_ig_health_care_equipment_services" },
  { industryGroup: "Pharmaceuticals, Biotechnology & Life Sciences", sector: "Health Care", displayKey: "gics_ig_pharma_biotech_life_sciences" },
  // Financials (3)
  { industryGroup: "Banks", sector: "Financials", displayKey: "gics_ig_banks" },
  { industryGroup: "Financial Services", sector: "Financials", displayKey: "gics_ig_financial_services" },
  { industryGroup: "Insurance", sector: "Financials", displayKey: "gics_ig_insurance" },
  // Information Technology (3)
  { industryGroup: "Software & Services", sector: "Information Technology", displayKey: "gics_ig_software_services" },
  { industryGroup: "Technology Hardware & Equipment", sector: "Information Technology", displayKey: "gics_ig_technology_hardware_equipment" },
  { industryGroup: "Semiconductors & Semiconductor Equipment", sector: "Information Technology", displayKey: "gics_ig_semiconductors" },
  // Communication Services (2)
  { industryGroup: "Telecommunication Services", sector: "Communication Services", displayKey: "gics_ig_telecommunication_services" },
  { industryGroup: "Media & Entertainment", sector: "Communication Services", displayKey: "gics_ig_media_entertainment" },
  // Utilities (1)
  { industryGroup: "Utilities", sector: "Utilities", displayKey: "gics_ig_utilities" },
  // Real Estate (2)
  { industryGroup: "Equity Real Estate Investment Trusts (REITs)", sector: "Real Estate", displayKey: "gics_ig_equity_reits" },
  { industryGroup: "Real Estate Management & Development", sector: "Real Estate", displayKey: "gics_ig_real_estate_management_development" },
];

const _GICS_SECTOR_BY_INDUSTRY_GROUP: ReadonlyMap<string, string> = new Map(
  gicsIndustryGroups.map((g) => [g.industryGroup, g.sector] as const),
);

const _GICS_INDUSTRY_GROUPS_BY_SECTOR: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const g of gicsIndustryGroups) {
    const existing = map.get(g.sector);
    if (existing) {
      existing.push(g.industryGroup);
    } else {
      map.set(g.sector, [g.industryGroup]);
    }
  }
  return map;
})();

/**
 * Look up the parent sector for an industry-group string. Returns `null` when
 * the input is not in the canonical 25-group set. Case-sensitive.
 */
export function sectorForIndustryGroup(industryGroup: string): string | null {
  return _GICS_SECTOR_BY_INDUSTRY_GROUP.get(industryGroup) ?? null;
}

/**
 * Inverse lookup — returns the ordered list of industry-group names that fall
 * under a given sector. Returns an empty array for unknown sectors.
 */
export function industryGroupsForSector(sector: string): readonly string[] {
  return _GICS_INDUSTRY_GROUPS_BY_SECTOR.get(sector) ?? [];
}

const _TW_SECTOR_BY_CATEGORY: ReadonlyMap<string, string> = new Map([
  ["半導體業", "Information Technology"],
  ["電子工業", "Information Technology"],
  ["電子零組件業", "Information Technology"],
  ["光電業", "Information Technology"],
  ["電腦及週邊設備業", "Information Technology"],
  ["其他電子業", "Information Technology"],
  ["其他電子類", "Information Technology"],
  ["通信網路業", "Information Technology"],
  ["資訊服務業", "Information Technology"],
  ["電子通路業", "Information Technology"],
  ["數位雲端", "Information Technology"],
  ["數位雲端類", "Information Technology"],
  ["金融保險", "Financials"],
  ["金融保險業", "Financials"],
  ["生技醫療業", "Health Care"],
  ["化學生技醫療", "Health Care"],
  ["鋼鐵工業", "Materials"],
  ["塑膠工業", "Materials"],
  ["化學工業", "Materials"],
  ["食品工業", "Consumer Staples"],
  ["貿易百貨", "Consumer Discretionary"],
  ["觀光餐旅", "Consumer Discretionary"],
  ["觀光事業", "Consumer Discretionary"],
  ["汽車工業", "Consumer Discretionary"],
  ["運動休閒", "Consumer Discretionary"],
  ["電機機械", "Industrials"],
  ["綠能環保", "Industrials"],
  ["建材營造", "Industrials"],
  ["建材營造業", "Industrials"],
  ["航運業", "Industrials"],
]);

const _US_SECTOR_BY_CATEGORY: ReadonlyMap<string, string> = new Map([
  ["Computer Manufacturing", "Information Technology"],
  ["Computer Software: Prepackaged Software", "Information Technology"],
  ["EDPServices", "Information Technology"],
  ["Biotechnology: Pharmaceutical Preparations", "Health Care"],
  ["Biotechnology: Laboratory Analytical Instruments", "Health Care"],
  ["Medical/Dental Instruments", "Health Care"],
  ["Aluminum", "Materials"],
  ["Other Consumer Services", "Consumer Discretionary"],
  ["Blank Checks", "Financials"],
  ["Major Banks", "Financials"],
]);

export function normalizeInstrumentSector(input: {
  marketCode: string;
  instrumentType: string | null;
  industryCategoryRaw?: string | null;
  gicsIndustryGroup?: string | null;
}): string | null {
  if (input.marketCode === "AU") {
    return input.gicsIndustryGroup ? sectorForIndustryGroup(input.gicsIndustryGroup) : null;
  }

  if (input.instrumentType === "ETF" || input.instrumentType === "BOND_ETF") {
    return null;
  }

  const rawCategory = input.industryCategoryRaw?.trim();
  if (!rawCategory) {
    return null;
  }

  if (input.marketCode === "TW") {
    return _TW_SECTOR_BY_CATEGORY.get(rawCategory) ?? null;
  }

  if (input.marketCode === "US") {
    return _US_SECTOR_BY_CATEGORY.get(rawCategory) ?? null;
  }

  return null;
}

// KZO-159 (158A) — Re-export the range parser + bounds resolver from
// `@vakwen/domain` so consumers (frontend AdminSettingsClient, API
// routes) can import them alongside `dashboardPerformanceRangesSchema` from
// a single package.
export {
  parsePerformanceRange,
  resolveRangeBounds,
  isValidPerformanceRange,
  PERFORMANCE_RANGE_REGEX,
  PERFORMANCE_RANGE_MAX_MONTHS,
  PERFORMANCE_RANGE_MAX_YEARS,
  type ParsedRange,
} from "@vakwen/domain";

export type CostBasisMethod = "WEIGHTED_AVERAGE";
export type LocaleCode = "en" | "zh-TW";
export type InstrumentType = "STOCK" | "ETF" | "BOND_ETF";
export type CurrencyCode = string;
export type DividendSourceBucket =
  | "DIVIDEND_INCOME"
  | "INTEREST_INCOME"
  | "SECURITIES_GAIN_INCOME"
  | "REVENUE_EQUALIZATION"
  | "CAPITAL_EQUALIZATION"
  | "CAPITAL_RETURN"
  | "OTHER";
export type SourceCompositionStatus = "provided" | "unknown_pending_disclosure";

export interface DividendSourceLine {
  id: string;
  dividendLedgerEntryId: string;
  sourceBucket: DividendSourceBucket;
  amount: number;
  currencyCode: CurrencyCode;
  source: string;
  sourceReference?: string;
  note?: string;
  bookedAt?: string;
}

export interface UserSettings {
  userId: string;
  displayName?: string | null;
  locale: LocaleCode;
  costBasisMethod: CostBasisMethod;
  quotePollIntervalSeconds: number;
  /**
   * ui-enhancement (2026-05-14) — effective grace period (in days) for the
   * soft-delete → hard-purge account cron. Mirrors
   * `AppConfigDto.effectiveAccountHardPurgeDays` so the user-facing UI
   * (`Settings → Accounts → Recently deleted`) can render the correct
   * countdown when an admin overrides the env default via
   * `app_config.account_hard_purge_days`. Optional so older API responses
   * (pre-ui-enhancement) still decode; consumers default to
   * `Env.ACCOUNT_HARD_PURGE_DAYS` (30) when absent.
   */
  effectiveAccountHardPurgeDays?: number;
}

// KZO-183: account-scoped fee profiles. `accountId` replaces the previous
// `userId` field — every profile is owned by exactly one account. `taxRules?`
// stays internal to `libs/domain.FeeProfile` and is NOT promoted to the wire
// (decision D2 — wire shape stays shallow).
export interface FeeProfileDto {
  id: string;
  accountId: string;
  name: string;
  boardCommissionRate: number;
  commissionDiscountPercent: number;
  minimumCommissionAmount: number;
  commissionCurrency: CurrencyCode;
  commissionRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  taxRoundingMode: "FLOOR" | "ROUND" | "CEIL";
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
  commissionChargeMode: "CHARGED_UPFRONT" | "CHARGED_UPFRONT_REBATED_LATER";
}

export const ACCOUNT_DEFAULT_CURRENCIES = ["TWD", "USD", "AUD", "KRW"] as const;
export const MARKET_CODES = ["TW", "US", "AU", "KR"] as const;
export const MARKET_FILTER_CODES = [...MARKET_CODES, "ALL"] as const;
export const HOLDING_ALLOCATION_BASES = ["market_value", "cost_basis"] as const;

// KZO-167: per-account currency + account type metadata. Both are added
// here (not on a separate `Account` interface in apps/api/src/types/store.ts)
// because KZO-167 collapses the API-internal `Account` interface into this
// DTO. New value semantics are gated by D7 lockdown at the route layer.
export type AccountDefaultCurrency = (typeof ACCOUNT_DEFAULT_CURRENCIES)[number];
export type AccountType = "broker" | "bank" | "wallet";
export type HoldingAllocationBasis = (typeof HOLDING_ALLOCATION_BASES)[number];

export interface AccountDto {
  id: string;
  name: string;
  userId: string;
  feeProfileId: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
}

// KZO-183: closed-set market code derived from an account's defaultCurrency.
// Currency ↔ market is a 1:1 mapping (TWD↔TW, USD↔US, AUD↔AU, KRW↔KR). Both helpers
// throw on any unsupported input.
export type MarketCode = (typeof MARKET_CODES)[number];

export const MARKET_CURRENCY_PAIRS = {
  TWD: "TW",
  USD: "US",
  AUD: "AU",
  KRW: "KR",
} as const satisfies Record<AccountDefaultCurrency, MarketCode>;

export const REPORT_SCOPES = ["all", "TW", "US", "AU", "KR"] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export const REPORT_CURRENCY_MODES = ["auto", "specified"] as const;
export type ReportCurrencyMode = (typeof REPORT_CURRENCY_MODES)[number];

const MARKET_TO_CURRENCY = {
  TW: "TWD",
  US: "USD",
  AU: "AUD",
  KR: "KRW",
} as const satisfies Record<MarketCode, AccountDefaultCurrency>;

export function marketCodeFor(currency: string): MarketCode {
  if (currency in MARKET_CURRENCY_PAIRS) {
    return MARKET_CURRENCY_PAIRS[currency as AccountDefaultCurrency];
  }
  throw new Error(`unsupported_currency_for_market: ${currency}`);
}

export function currencyFor(market: string): AccountDefaultCurrency {
  if (market in MARKET_TO_CURRENCY) {
    return MARKET_TO_CURRENCY[market as MarketCode];
  }
  throw new Error(`unsupported_market_for_currency: ${market}`);
}

// KZO-183: `marketCode` removed — the market is now derived from
// `accounts.defaultCurrency` for the binding's account, not stored alongside
// the binding.
export interface FeeProfileBindingDto {
  accountId: string;
  ticker: string;
  feeProfileId: string;
}

export interface IntegrityIssueDto {
  code: string;
  message: string;
}

// KZO-180: `totalCostCurrency` removed — its prior value (`holdings[0]?.currency
// ?? "TWD"`) was broken-by-design for mixed-currency portfolios. Dashboard totals
// are now translated into the user's chosen reporting currency on the read path
// (see `apps/api/src/services/dashboardReportingCurrency.ts`); the response
// carries `reportingCurrency` + `fxStatus` so the UI can pick the label and
// surface degradation when an FX rate is missing.
export interface DashboardOverviewSummaryDto {
  asOf: string;
  accountCount: number;
  holdingCount: number;
  totalCostAmount: number;
  /** KZO-180: chosen reporting currency for all translated KPI numerics. */
  reportingCurrency: AccountDefaultCurrency;
  /**
   * KZO-180: rollup of FX availability across the contributing rows.
   *  - `complete` — every contributing row's FX resolved (or self-pair).
   *  - `partial`  — some contributing rows resolved, others did not.
   *  - `missing`  — every contributing row's FX failed.
   */
  fxStatus: "complete" | "partial" | "missing";
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
  openIssueCount: number;
}

export interface FxConversionRateDto {
  fromCurrency: AccountDefaultCurrency;
  toCurrency: AccountDefaultCurrency;
  rate: number;
  asOf: string | null;
}

export interface DashboardOverviewMarketValueDto {
  marketCode: MarketCode;
  value: number;
  reportingCurrency: AccountDefaultCurrency;
}

export interface DashboardOverviewHoldingDto {
  accountId: string;
  accountName?: string;
  ticker: string;
  instrumentName?: string | null;
  marketCode: MarketCode;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
  averageCostPerShare: number;
  currentUnitPrice: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  allocationPct: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  quoteStatus: "current" | "provisional" | "missing";
  nextDividendDate: string | null;
  lastDividendPostedDate: string | null;
  // KZO-177: server-classified freshness, null when current
  freshness: "current" | "stale_amber" | "stale_red";
  freshnessTooltip: string | null;
}

export interface DashboardOverviewHoldingChildDto {
  accountId: string;
  accountName?: string;
  ticker: string;
  instrumentName?: string | null;
  marketCode: MarketCode;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
  averageCostPerShare: number;
  currentUnitPrice: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  allocationPct: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  quoteStatus: "current" | "provisional" | "missing";
  nextDividendDate: string | null;
  lastDividendPostedDate: string | null;
  freshness: "current" | "stale_amber" | "stale_red";
  freshnessTooltip: string | null;
  reportingCurrency: AccountDefaultCurrency;
  reportingCurrentUnitPrice?: number | null;
  reportingCostBasisAmount: number | null;
  reportingMarketValueAmount: number | null;
  reportingUnrealizedPnlAmount: number | null;
  reportingDailyChangeAmount?: number | null;
  reportingAllocationPercent: number | null;
  fxStatus: "complete" | "partial" | "missing";
  allocationBasisUsed: HoldingAllocationBasis;
  allocationBasisFallbackReason: "missing_quote" | null;
}

export interface DashboardOverviewHoldingGroupDto {
  ticker: string;
  instrumentName?: string | null;
  marketCode: MarketCode;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
  averageCostPerShare: number;
  currentUnitPrice: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  allocationPct: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  quoteStatus: "current" | "provisional" | "missing";
  nextDividendDate: string | null;
  lastDividendPostedDate: string | null;
  freshness: "current" | "stale_amber" | "stale_red";
  freshnessTooltip: string | null;
  accountCount: number;
  reportingCurrency: AccountDefaultCurrency;
  reportingCurrentUnitPrice?: number | null;
  reportingCostBasisAmount: number | null;
  reportingMarketValueAmount: number | null;
  reportingUnrealizedPnlAmount: number | null;
  reportingDailyChangeAmount?: number | null;
  reportingAllocationPercent: number | null;
  fxStatus: "complete" | "partial" | "missing";
  allocationBasisUsed: HoldingAllocationBasis;
  allocationBasisFallbackReason: "missing_quote" | null;
  children: DashboardOverviewHoldingChildDto[];
}

export interface DashboardOverviewUpcomingDividendDto {
  accountId: string;
  accountName?: string;
  ticker: string;
  exDividendDate: string | null;
  paymentDate: string | null;
  expectedAmount: number | null;
  currency: CurrencyCode;
  status: "declared" | "expected" | "paying-soon";
}

export interface DashboardOverviewRecentDividendDto {
  accountId: string;
  accountName?: string;
  ticker: string;
  postedAt: string;
  netAmount: number;
  grossAmount: number | null;
  deductionAmount: number | null;
  currency: CurrencyCode;
  sourceSummary: string | null;
  status: "posted" | "unreconciled";
}

export interface InstrumentOptionDto {
  ticker: string;
  instrumentType: InstrumentType;
  // KZO-169: `market_code` is required at the database level after migration
  // 044's PK rewrite. Tighten the DTO from `string | null` to `string`.
  marketCode: string;
  isProvisional: boolean;
}

export interface DashboardOverviewDto {
  settings: UserSettings;
  summary: DashboardOverviewSummaryDto;
  fxRates?: FxConversionRateDto[];
  marketValues: DashboardOverviewMarketValueDto[];
  holdings: DashboardOverviewHoldingDto[];
  holdingGroups: DashboardOverviewHoldingGroupDto[];
  dividends: {
    upcoming: DashboardOverviewUpcomingDividendDto[];
    recent: DashboardOverviewRecentDividendDto[];
  };
  actions: {
    integrityIssue: IntegrityIssueDto | null;
    recomputeAvailable: boolean;
  };
  instruments: InstrumentOptionDto[];
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
}

export interface ShellPortfolioConfigDto {
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  integrityIssue: IntegrityIssueDto | null;
}

// KZO-159 (158A): `DashboardPerformanceRange` widened from the closed
// union `"1M" | "3M" | "YTD" | "1Y"` to `string` so that admin + user
// pref plumbing can extend the default list at runtime. Every consumer
// already validates via `parsePerformanceRange` (libs/domain) or the
// `dashboardPerformanceRangesSchema` below — the compile-time alias
// remains only for call-site clarity.
export type DashboardPerformanceRange = string;

/**
 * Hardcoded fallback timeframe list used when no admin override is set and
 * the user has no override either (see the 3-tier resolver in
 * `apps/api/src/services/userPreferences.ts`).
 */
export const DEFAULT_DASHBOARD_PERFORMANCE_RANGES = [
  "1M",
  "3M",
  "YTD",
  "1Y",
] as const;

/**
 * Shared zod validator for a list of dashboard performance ranges.
 *
 * Rules:
 *   - min length 1, max length 12
 *   - each element matches the case-sensitive grammar
 *     `^YTD$|^ALL$|^([1-9]\d*)(M|Y)$` with bounds `M ≤ 240`, `Y ≤ 50`
 *   - no duplicates (case-sensitive)
 *
 * Regex and bounds duplicate `libs/domain/src/performanceRange.ts` on
 * purpose — the grammar is design-locked (KZO-159 D9) and avoiding an
 * import cycle (shared-types ← → domain) is worth the 6 lines of dupe.
 */
const DASHBOARD_PERFORMANCE_RANGE_ELEMENT = /^YTD$|^ALL$|^([1-9]\d*)(M|Y)$/;
const MAX_MONTHS = 240;
const MAX_YEARS = 50;

function validateRangeElement(value: string): boolean {
  const match = DASHBOARD_PERFORMANCE_RANGE_ELEMENT.exec(value);
  if (!match) return false;
  if (value === "YTD" || value === "ALL") return true;
  const n = Number(match[1]);
  const unit = match[2];
  if (!Number.isInteger(n) || n <= 0) return false;
  if (unit === "M") return n <= MAX_MONTHS;
  return n <= MAX_YEARS;
}

export const dashboardPerformanceRangesSchema: z.ZodType<string[]> = z
  .array(z.string())
  .min(1, { message: "ranges_list_too_short" })
  .max(12, { message: "ranges_list_too_long" })
  .refine(
    (arr) => arr.every(validateRangeElement),
    { message: "ranges_list_invalid_element" },
  )
  .refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "ranges_list_duplicate" },
  );

export const holdingAllocationBasisSchema: z.ZodType<HoldingAllocationBasis> = z.enum(HOLDING_ALLOCATION_BASES);
export const DEFAULT_HOLDING_ALLOCATION_BASIS: HoldingAllocationBasis = "market_value";

export const DASHBOARD_HOLDING_FOCUS_PRESETS = [
  "largest",
  "worst-pnl",
  "best-pnl",
  "fx-exposure",
  "stale-quotes",
] as const;
export type DashboardHoldingFocusPreset = (typeof DASHBOARD_HOLDING_FOCUS_PRESETS)[number];

export const DEFAULT_DASHBOARD_HOLDING_FOCUS_PRESET_ORDER: DashboardHoldingFocusPreset[] = [
  ...DASHBOARD_HOLDING_FOCUS_PRESETS,
];

export interface DashboardHoldingFocusPreferenceDto {
  presetOrder: DashboardHoldingFocusPreset[];
  hiddenPresets: DashboardHoldingFocusPreset[];
  selectedPreset: DashboardHoldingFocusPreset;
}

export type HoldingsTableLayoutStyle = "dashboard" | "portfolio";

export interface HoldingsTableContextPreferenceDto {
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: Record<string, number>;
  layoutStyle?: HoldingsTableLayoutStyle;
}

export interface HoldingsTableSettingsPreferenceDto {
  version: 1;
  contexts: Record<string, HoldingsTableContextPreferenceDto>;
}

const dashboardHoldingFocusPresetSchema = z.enum(DASHBOARD_HOLDING_FOCUS_PRESETS);
const dashboardHoldingFocusPresetListSchema = z
  .array(dashboardHoldingFocusPresetSchema)
  .max(DASHBOARD_HOLDING_FOCUS_PRESETS.length)
  .refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "dashboard_holding_focus_duplicate_preset" },
  );
const dashboardHoldingFocusPresetOrderSchema = z
  .array(dashboardHoldingFocusPresetSchema)
  .min(1, { message: "dashboard_holding_focus_order_empty" })
  .max(DASHBOARD_HOLDING_FOCUS_PRESETS.length)
  .refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "dashboard_holding_focus_duplicate_preset" },
  );

export const dashboardHoldingFocusPreferenceSchema: z.ZodType<DashboardHoldingFocusPreferenceDto> = z
  .object({
    presetOrder: dashboardHoldingFocusPresetOrderSchema,
    hiddenPresets: dashboardHoldingFocusPresetListSchema,
    selectedPreset: dashboardHoldingFocusPresetSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const order = new Set(value.presetOrder);
    const hidden = new Set(value.hiddenPresets);
    if (!order.has(value.selectedPreset)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dashboard_holding_focus_selected_missing",
        path: ["selectedPreset"],
      });
    }
    if (hidden.has(value.selectedPreset)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dashboard_holding_focus_selected_hidden",
        path: ["selectedPreset"],
      });
    }
    for (const preset of hidden) {
      if (!order.has(preset)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "dashboard_holding_focus_hidden_missing",
          path: ["hiddenPresets"],
        });
      }
    }
  });

const holdingsTableColumnIdSchema = z.string().min(1).max(64);
const holdingsTableContextKeySchema = z.string().min(1).max(96);
const holdingsTableColumnListSchema = z
  .array(holdingsTableColumnIdSchema)
  .max(40)
  .refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "holdings_table_duplicate_column" },
  );

export const holdingsTableSettingsPreferenceSchema: z.ZodType<HoldingsTableSettingsPreferenceDto> = z
  .object({
    version: z.literal(1),
    contexts: z
      .record(
        holdingsTableContextKeySchema,
        z
          .object({
            columnOrder: holdingsTableColumnListSchema.optional(),
            hiddenColumns: holdingsTableColumnListSchema.optional(),
            columnWidths: z
              .record(
                holdingsTableColumnIdSchema,
                z.number().int().min(72).max(420),
              )
              .optional(),
            layoutStyle: z.enum(["dashboard", "portfolio"]).optional(),
          })
          .strict(),
      )
      .superRefine((value, ctx) => {
        if (Object.keys(value).length > 20) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "holdings_table_too_many_contexts",
          });
        }
      }),
  })
  .strict();

export const DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE: DashboardHoldingFocusPreferenceDto = {
  presetOrder: DEFAULT_DASHBOARD_HOLDING_FOCUS_PRESET_ORDER,
  hiddenPresets: [],
  selectedPreset: "largest",
};

// ─── Phase 2: theme accent + density ──────────────────────────────────────
// Per ui-reshape design §3.2 (presets) and decisions #14 (custom). Status
// colors (success/danger/warning) do NOT shift with accent — only --primary
// and --ring mutate. See apps/web/lib/theme.ts for the runtime CSS-var setter.

export const ACCENT_PRESETS = [
  "indigo",
  "violet",
  "blue",
  "cyan",
  "emerald",
  "amber",
  "rose",
  "slate",
] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export type ThemeAccent =
  | { kind: "preset"; preset: AccentPreset }
  | { kind: "custom"; h: number; s: number; l: number };

export const themeAccentSchema: z.ZodType<ThemeAccent> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(ACCENT_PRESETS) }),
  z.object({
    kind: z.literal("custom"),
    h: z.number().int().min(0).max(360),
    s: z.number().int().min(0).max(100),
    l: z.number().int().min(0).max(100),
  }),
]);

export const DENSITY_MODES = ["compact", "comfortable"] as const;
export type DensityMode = (typeof DENSITY_MODES)[number];
export const densityModeSchema: z.ZodType<DensityMode> = z.enum(DENSITY_MODES);

export const DEFAULT_THEME_ACCENT: ThemeAccent = { kind: "preset", preset: "indigo" };
export const DEFAULT_DENSITY: DensityMode = "compact";

// KZO-180: 5 numeric fields are now `number | null` (not `number`/optional)
// so that `fxAvailable === false` cleanly propagates a uniform "no value"
// shape to the wire. `fxAvailable` is the per-point flag the UI reads to
// decide whether to render numbers or a "missing FX" placeholder.
export interface DashboardPerformancePointDto {
  date: string;
  totalCostAmount: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  cumulativeRealizedPnlAmount: number | null;
  cumulativeDividendsAmount: number | null;
  totalReturnAmount?: number | null;
  totalReturnPercent?: number | null;
  /** KZO-180: false when at least one contributing row's FX did not resolve
   *  for this snapshot date. When false, the 5 numeric fields above are null. */
  fxAvailable: boolean;
}

export type DashboardPerformanceGapReason =
  | "missing_snapshot"
  | "stale_snapshot"
  | "missing_fx";

export interface DashboardPerformanceDiagnosticsDto {
  latestSnapshotDate: string | null;
  latestReliableValuationDate: string | null;
  expectedLatestValuationDate: string;
  staleSinceDate: string | null;
  knownGapReasons: DashboardPerformanceGapReason[];
}

export interface DashboardPerformanceDto {
  range: DashboardPerformanceRange;
  points: DashboardPerformancePointDto[];
  /** Inclusive start date resolved from `range`, used by clients to render the honest selected timeline. */
  rangeStartDate?: string;
  /** Inclusive end date resolved from `range`, normally the requested as-of date. */
  rangeEndDate?: string;
  /** KZO-180: chosen reporting currency for all translated point numerics. */
  reportingCurrency: AccountDefaultCurrency;
  /** KZO-180: rollup of `fxAvailable` across the points list. See
   *  `DashboardOverviewSummaryDto.fxStatus` for the value semantics. */
  fxStatus: "complete" | "partial" | "missing";
  /** Requested valuation date used by the server when building this series. */
  requestedAsOf?: string;
  /** Last date with a reliable server-calculated point in this series. */
  lastReliableDate?: string | null;
  /** Present when the requested valuation date extends beyond available market data. */
  marketDataStaleSince?: string | null;
  /** Structured snapshot-only diagnostics for Dashboard trend/return cards. */
  diagnostics?: DashboardPerformanceDiagnosticsDto;
}

export interface ReportQueryStateDto {
  scope: ReportScope;
  currencyMode: ReportCurrencyMode;
  currency: AccountDefaultCurrency | null;
  reportingCurrency: AccountDefaultCurrency;
  nativeCurrency: AccountDefaultCurrency | null;
  range: DashboardPerformanceRange | null;
  asOf: string;
}

export interface ReportFxStatusDto {
  status: "complete" | "partial" | "missing";
  reportingCurrency: AccountDefaultCurrency;
  nativeCurrencies: AccountDefaultCurrency[];
  missingRatePairs: Array<{
    from: AccountDefaultCurrency;
    to: AccountDefaultCurrency;
  }>;
}

export interface ReportDataHealthDto {
  holdingCount: number;
  missingQuoteCount: number;
  provisionalQuoteCount: number;
  missingFxCount: number;
  staleQuoteCount: number;
}

export interface ReportDiagnosticsDto {
  scope: ReportScope;
  reportingCurrency: AccountDefaultCurrency;
  requestedAsOf: string;
  lastValuationDate: string | null;
  marketDataStaleSince: string | null;
  latestSnapshotDate: string | null;
  latestReliableValuationDate: string | null;
  expectedLatestValuationDate: string;
  staleSinceDate: string | null;
  missingQuoteCount: number;
  provisionalQuoteCount: number;
  staleQuoteCount: number;
  missingFxCount: number;
  missingProviderSourceCount: number;
  knownGapReasons: Array<
    | "missing_snapshot"
    | "stale_snapshot"
    | "missing_quote"
    | "provisional_quote"
    | "stale_quote"
    | "missing_fx"
    | "missing_provider_source"
  >;
  markets: Array<{
    marketCode: MarketCode;
    expectedLatestValuationDate: string | null;
    latestSnapshotDate: string | null;
    missingProviderSourceCount: number;
    providerSources: string[];
    knownGapReasons: Array<
      | "missing_snapshot"
      | "stale_snapshot"
      | "missing_quote"
      | "provisional_quote"
      | "stale_quote"
      | "missing_fx"
      | "missing_provider_source"
    >;
  }>;
  rowCounts: {
    holdingsTotal: number;
    holdingsReturned: number;
    topMovers?: number;
    topHoldings?: number;
    marketBuckets?: number;
    accountBuckets?: number;
    suggestions?: number;
  };
}

export interface ReportSummaryTotalsDto {
  costBasisAmount: number;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  realizedPnlAmount: number;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  incomeAmount: number;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
}

export interface ReportHoldingRowDto {
  ticker: string;
  instrumentName?: string | null;
  marketCode: MarketCode;
  accountCount: number;
  accounts?: Array<{
    id: string;
    name: string;
  }>;
  quantity: number;
  nativeCurrency: CurrencyCode;
  nativeAverageCostPerShare: number;
  nativeCurrentUnitPrice: number | null;
  nativeCostBasisAmount: number;
  nativeMarketValueAmount: number | null;
  reportingCurrency: AccountDefaultCurrency;
  reportingAverageCostPerShare: number | null;
  reportingCurrentUnitPrice: number | null;
  reportingCostBasisAmount: number | null;
  reportingMarketValueAmount: number | null;
  reportingUnrealizedPnlAmount: number | null;
  reportingAllocationPercent: number | null;
  fxRateToReporting: number | null;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  quoteStatus: "current" | "provisional" | "missing";
  fxStatus: "complete" | "partial" | "missing";
  freshness: "current" | "stale_amber" | "stale_red";
}

export interface ReportHoldingRowsPageDto {
  total: number;
  limit: number;
  offset: number;
  rows: ReportHoldingRowDto[];
}

export interface DailyReviewSuggestionDto {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface DailyReviewReportDto {
  query: ReportQueryStateDto;
  summary: ReportSummaryTotalsDto;
  fxStatus: ReportFxStatusDto;
  fxRates?: FxConversionRateDto[];
  dataHealth: ReportDataHealthDto;
  diagnostics: ReportDiagnosticsDto;
  suggestions: DailyReviewSuggestionDto[];
  topMovers: ReportHoldingRowDto[];
  holdings: ReportHoldingRowsPageDto;
}

export interface AllocationBucketDto {
  key: string;
  label: string;
  reportingCurrency: AccountDefaultCurrency;
  amount: number | null;
  allocationPercent: number | null;
}

export interface PortfolioReportDto {
  query: ReportQueryStateDto;
  summary: ReportSummaryTotalsDto;
  fxStatus: ReportFxStatusDto;
  fxRates?: FxConversionRateDto[];
  dataHealth: ReportDataHealthDto;
  diagnostics: ReportDiagnosticsDto;
  performance: DashboardPerformanceDto;
  allocation: {
    byMarket: AllocationBucketDto[];
    byAccount: AllocationBucketDto[];
  };
  concentration: {
    topHoldings: ReportHoldingRowDto[];
  };
  income: {
    trailingDividendAmount: number;
    recentDividendCount: number;
  };
  holdings: ReportHoldingRowsPageDto;
}

export interface MarketReportDto {
  query: ReportQueryStateDto;
  summary: ReportSummaryTotalsDto;
  fxStatus: ReportFxStatusDto;
  fxRates?: FxConversionRateDto[];
  dataHealth: ReportDataHealthDto;
  diagnostics: ReportDiagnosticsDto;
  performance: DashboardPerformanceDto;
  marketSummary: AllocationBucketDto[];
  topHoldings: ReportHoldingRowDto[];
  detail: ReportHoldingRowsPageDto;
}

export interface TransactionHistoryItemDto {
  id: string;
  accountId: string;
  accountName: string;
  ticker: string;
  // KZO-169: trade events stamp market_code at booking time. Backfilled to
  // `'TW'` for legacy rows by migration 044's NOT NULL DEFAULT.
  marketCode: string;
  instrumentType: InstrumentType;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  commissionAmount: number;
  taxAmount: number;
  isDayTrade: boolean;
  realizedPnlAmount: number | null;
  realizedPnlCurrency: CurrencyCode | null;
  feeProfileId: string;
  feeProfileName: string;
  bookedAt: string | null;
  feesSource: "CALCULATED" | "MANUAL";
}

export interface TransactionAccountOptionDto {
  id: string;
  name: string;
  feeProfileName: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType?: AccountType;
}

export interface TransactionPrimaryDto {
  recentTransactions: TransactionHistoryItemDto[];
  accountOptions: TransactionAccountOptionDto[];
  portfolioConfig: ShellPortfolioConfigDto;
}

export interface TickerFundamentalsFieldDto<TValue> {
  value: TValue | null;
  source: string | null;
  asOf: string | null;
}

export interface TickerFundamentalsDto {
  marketCap: TickerFundamentalsFieldDto<number>;
  enterpriseValue: TickerFundamentalsFieldDto<number>;
  priceEarningsRatio: TickerFundamentalsFieldDto<number>;
  priceBookRatio: TickerFundamentalsFieldDto<number>;
  dividendYield: TickerFundamentalsFieldDto<number>;
  earningsPerShare: TickerFundamentalsFieldDto<number>;
  revenueTrailingTwelveMonths: TickerFundamentalsFieldDto<number>;
  netIncomeTrailingTwelveMonths: TickerFundamentalsFieldDto<number>;
}

export interface TickerFundamentalsRefreshDto {
  providerId: string | null;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
  lastAttemptedAt: string | null;
  lastError: string | null;
  status: "fresh" | "stale" | "missing";
}

export interface TickerDetailsQuoteDto {
  currentUnitPrice: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
  source: string | null;
  quoteStatus: "current" | "provisional" | "missing";
}

export interface TickerDetailsPositionDto {
  quantity: number;
  averageCostPerShare: number | null;
  costBasisAmount: number;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  realizedPnlAmount: number;
  currency: CurrencyCode;
  accountIds: string[];
  lastTradeDate: string | null;
}

export interface TickerDetailsChartPointDto {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

export const TICKER_CHART_RANGES = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL"] as const;
export type TickerChartRange = (typeof TICKER_CHART_RANGES)[number];
export type TickerChartSelection = TickerChartRange | "CUSTOM";

export interface TickerDetailsChartMetadataDto {
  requested: {
    range: TickerChartRange | null;
    startDate: string | null;
    endDate: string | null;
  };
  resolved: {
    range: TickerChartSelection;
    startDate: string | null;
    endDate: string | null;
  };
  available: {
    startDate: string | null;
    endDate: string | null;
  };
  truncated: {
    startDate: boolean;
    endDate: boolean;
  };
}

export interface TickerDetailsDto {
  identity: {
    ticker: string;
    marketCode: MarketCode;
    accountId: string | null;
    name: string | null;
    instrumentType: InstrumentType | null;
    priceCurrency: CurrencyCode;
    barsBackfillStatus: string | null;
  };
  quote: TickerDetailsQuoteDto;
  position: TickerDetailsPositionDto;
  chart: {
    range: TickerChartSelection;
    metadata: TickerDetailsChartMetadataDto;
    points: TickerDetailsChartPointDto[];
  };
  transactions: TransactionHistoryItemDto[];
  dividends: {
    upcoming: DashboardOverviewUpcomingDividendDto[];
    recent: DashboardOverviewRecentDividendDto[];
  };
  holdingGroup: DashboardOverviewHoldingGroupDto | null;
  accountBreakdown: DashboardOverviewHoldingChildDto[];
  fundamentals: TickerFundamentalsDto;
  fundamentalsRefresh: TickerFundamentalsRefreshDto;
}

export interface TickerPrimaryDto {
  identity: TickerDetailsDto["identity"];
  quote: TickerDetailsDto["quote"];
  position: TickerDetailsDto["position"];
  transactions: TickerDetailsDto["transactions"];
  dividends: TickerDetailsDto["dividends"];
  holdingGroup: TickerDetailsDto["holdingGroup"];
  accountBreakdown: TickerDetailsDto["accountBreakdown"];
}

export interface TickerEnrichmentDto {
  identity: TickerDetailsDto["identity"];
  chart: TickerDetailsDto["chart"];
  fundamentals: TickerDetailsDto["fundamentals"];
  fundamentalsRefresh: TickerDetailsDto["fundamentalsRefresh"];
}

export interface PreviewImpactResponse {
  affectedRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
    feePolicySnapshots: number;
    holdingSnapshots: number;
  };
  negativeLots: {
    wouldOccur: boolean;
    resultingQuantity: number;
    ticker: string;
  };
}

export interface DeleteTransactionResponse {
  accountId: string;
  ticker: string;
  deletedTradeEventId: string;
  deletedChildRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
  };
}

export interface PatchTransactionResponse {
  accountId: string;
  ticker: string;
  updatedTradeEventId: string;
  changedFields: string[];
}

export interface PatchFeeConfirmationResponse {
  requiresFeeConfirmation: true;
  tradeEventId: string;
}

export interface UserIdentity {
  userId: string;
  email: string | null;
  displayName: string | null;
  locale: LocaleCode;
  createdAt: string;
  updatedAt: string;
}

export interface UserExternalIdentity {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  providerEmail: string | null;
  providerDisplayName: string | null;
  providerPictureUrl: string | null;
  linkedAt: string;
  lastSeenAt: string;
}

export type UserRole = "admin" | "member" | "viewer";

export interface ImpersonationDto {
  active: boolean;
  targetUserId: string;
  targetEmail: string | null;
  expiresAt: string;
}

export interface ProfileDto {
  userId: string;
  email: string | null;
  displayName: string | null;
  providerPictureUrl: string | null;
  providerDisplayName: string | null;
  /**
   * ui-reshape Phase 3d (A7) — user-overridable display name. When non-null,
   * the user has explicitly chosen a name distinct from `displayName`
   * (which is provider-synced). UI renders `userDisplayName ?? displayName`.
   * Stored in `user_preferences.preferences.userProfile.displayName` JSONB —
   * no DB migration. `null` means "no override, use provider value".
   */
  userDisplayName: string | null;
  /**
   * ui-reshape Phase 3d (A7) — user-overridable picture URL. When non-null,
   * the user has explicitly chosen a picture URL distinct from
   * `providerPictureUrl` (which is provider-synced). UI renders
   * `userPictureUrl ?? providerPictureUrl`. Stored in
   * `user_preferences.preferences.userProfile.pictureUrl` JSONB — no DB
   * migration. Always HTTPS-only on write per
   * `.claude/rules/provider-url-sanitization.md`. `null` means "no override,
   * use provider value".
   */
  userPictureUrl: string | null;
  linkedAt: string | null;
  lastSeenAt: string | null;
  role: UserRole;
  impersonation: ImpersonationDto | null;
}

// ── Admin portal DTOs (KZO-144) ──────────────────────────────────────────────

export type AdminUserStatus = "active" | "disabled" | "deleted";

export interface AdminUserListItemDto {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  status: AdminUserStatus;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AdminUserListResponse {
  items: AdminUserListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export type InviteListStatus = "pending" | "used" | "expired" | "revoked";

export interface AdminInviteListItemDto {
  code: string;
  email: string;
  role: UserRole;
  status: InviteListStatus;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  issuedByEmail: string | null;
  issuedByDisplayName: string | null;
  createdAt: string;
}

export interface AdminInviteListResponse {
  items: AdminInviteListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminAuditLogEntryDto {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  targetDisplayName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminAuditLogResponse {
  items: AdminAuditLogEntryDto[];
  total: number;
  page: number;
  limit: number;
}

// ── Admin settings (KZO-142 / KZO-159 / KZO-189 / KZO-198) ─────────────────

/**
 * KZO-198 — Tier 1/2 numeric override bounds carried on the DTO so the admin
 * UI binds `min`/`max` HTML attributes without duplicating the source of
 * truth in `apps/api/src/services/appConfig/bounds.ts`.
 *
 * Keyed by camelCase field name. Includes pre-existing fields with bounds
 * (e.g. `repairCooldownMinutes`) so the same lookup works across the
 * sectioned form and the legacy repair-cooldown row.
 */
export type AppConfigBoundsDto = Record<string, { min: number; max: number }>;

export interface AppConfigDto {
  // ── KZO-133 / KZO-189 / KZO-159 — pre-existing override knobs ──────────
  repairCooldownMinutes: number | null;
  effectiveRepairCooldownMinutes: number;
  /** Admin override for the user-facing dashboard timeframe picker. `null` = use the hardcoded `DEFAULT_DASHBOARD_PERFORMANCE_RANGES`. */
  dashboardPerformanceRanges: string[] | null;
  /** Fully-resolved list after admin fallback — what the admin UI renders as the authoritative "current" list. */
  effectiveDashboardPerformanceRanges: string[];
  /** Admin override for AU metadata enrichment mode. `null` = use `Env.METADATA_ENRICHMENT_MODE`. */
  metadataEnrichmentMode: "unconditional" | "conditional" | null;
  /** Fully-resolved mode after env fallback. */
  effectiveMetadataEnrichmentMode: "unconditional" | "conditional";

  // ── KZO-198 Tier 1 — Rate limits (UI-editable) ─────────────────────────
  marketDataPriceWindowMs: number | null;
  effectiveMarketDataPriceWindowMs: number;
  marketDataPriceLimit: number | null;
  effectiveMarketDataPriceLimit: number;
  marketDataSearchWindowMs: number | null;
  effectiveMarketDataSearchWindowMs: number;
  marketDataSearchLimit: number | null;
  effectiveMarketDataSearchLimit: number;
  inviteStatusWindowMs: number | null;
  effectiveInviteStatusWindowMs: number;
  inviteStatusLimit: number | null;
  effectiveInviteStatusLimit: number;

  // ── KZO-198 Tier 1 — Provider health (UI-editable) ─────────────────────
  providerDownNotificationSuppressionMs: number | null;
  effectiveProviderDownNotificationSuppressionMs: number;
  providerErrorTrailRetentionDays: number | null;
  effectiveProviderErrorTrailRetentionDays: number;
  providerRerunCooldownMs: number | null;
  effectiveProviderRerunCooldownMs: number;
  // KZO-197 — yahoo-finance-au-specific rerun cooldown override.
  yahooAuRerunCooldownMs: number | null;
  effectiveYahooAuRerunCooldownMs: number;
  providerFixerDangerousMatchThreshold: number | null;
  effectiveProviderFixerDangerousMatchThreshold: number;
  providerFixerPreviewSampleLimit: number | null;
  effectiveProviderFixerPreviewSampleLimit: number;
  providerFixerUiPageSize: number | null;
  effectiveProviderFixerUiPageSize: number;
  providerFixerAutoPauseFailuresPerMinute: number | null;
  effectiveProviderFixerAutoPauseFailuresPerMinute: number;
  providerFixerPreviewTokenTtlMinutes: number | null;
  effectiveProviderFixerPreviewTokenTtlMinutes: number;
  providerOperationAutoRenewIntervalMinutes: number | null;
  effectiveProviderOperationAutoRenewIntervalMinutes: number;
  providerIncidentRecurrenceWindowMinutes: number | null;
  effectiveProviderIncidentRecurrenceWindowMinutes: number;
  providerHealthWarningUnresolvedThreshold: number | null;
  effectiveProviderHealthWarningUnresolvedThreshold: number;
  providerHealthCriticalUnresolvedThreshold: number | null;
  effectiveProviderHealthCriticalUnresolvedThreshold: number;
  providerOperationStaleHeartbeatMinutes: number | null;
  effectiveProviderOperationStaleHeartbeatMinutes: number;
  providerOperationSummaryRetentionDays: number | null;
  effectiveProviderOperationSummaryRetentionDays: number;
  providerOperationLogRetentionDays: number | null;
  effectiveProviderOperationLogRetentionDays: number;
  providerIncidentRetentionDays: number | null;
  effectiveProviderIncidentRetentionDays: number;
  providerResolvedItemRetentionDays: number | null;
  effectiveProviderResolvedItemRetentionDays: number;
  finmindProviderRateLimitPerHour: number | null;
  effectiveFinmindProviderRateLimitPerHour: number;
  twelveDataProviderRateLimitPerMinute: number | null;
  effectiveTwelveDataProviderRateLimitPerMinute: number;
  yahooAuProviderRateLimitPerMinute: number | null;
  effectiveYahooAuProviderRateLimitPerMinute: number;
  yahooKrProviderRateLimitPerMinute: number | null;
  effectiveYahooKrProviderRateLimitPerMinute: number;
  frankfurterProviderRateLimitPerMinute: number | null;
  effectiveFrankfurterProviderRateLimitPerMinute: number;
  asxGicsProviderRateLimitPerHour: number | null;
  effectiveAsxGicsProviderRateLimitPerHour: number;

  // ── KZO-198 Tier 1 — Backfill (UI-editable) ────────────────────────────
  backfillRetryLimit: number | null;
  effectiveBackfillRetryLimit: number;
  backfillRetryDelaySeconds: number | null;
  effectiveBackfillRetryDelaySeconds: number;
  backfillFinmind402RetryMs: number | null;
  effectiveBackfillFinmind402RetryMs: number;

  // ── KZO-195 Tier 2 — Absence-based delisting detection (UI-editable) ───
  catalogAbsenceThreshold: number | null;
  effectiveCatalogAbsenceThreshold: number;
  catalogAbsenceGuardPercent: number | null;
  effectiveCatalogAbsenceGuardPercent: number;
  catalogAbsenceGuardFloor: number | null;
  effectiveCatalogAbsenceGuardFloor: number;

  // ── KZO-199 Tier 1 — Sharing (UI-editable) ─────────────────────────────
  anonymousShareTokenCap: number | null;
  effectiveAnonymousShareTokenCap: number;
  anonymousShareRateLimitMax: number | null;
  effectiveAnonymousShareRateLimitMax: number;
  anonymousShareRateLimitWindowMs: number | null;
  effectiveAnonymousShareRateLimitWindowMs: number;

  // ── ui-enhancement Tier B — account lifecycle (UI-editable) ─────────────
  /** Grace period (days) between soft-delete and hard-purge cron. NULL = use Env.ACCOUNT_HARD_PURGE_DAYS. */
  accountHardPurgeDays: number | null;
  effectiveAccountHardPurgeDays: number;

  // KZO-198 Tier 2 fields (dailyRefreshLookbackDays, dailyRefreshPriority,
  // sse{Heartbeat,MaxConn,BufferTtl}) are intentionally NOT in this DTO.
  // They are DB+SQL only per scope-todo — operators override via direct SQL.
  // The persistence + cache layer still hold them so source-file resolvers
  // honor SQL-set overrides at runtime.

  // ── KZO-198 Tier 0 — Encrypted secrets (masked in UI) ──────────────────
  /** True when the encrypted FinMind token is set in `app_config`. The plaintext value is never sent to the client. */
  finmindApiTokenSet: boolean;
  /** True when the encrypted Twelve Data key is set in `app_config`. The plaintext value is never sent to the client. */
  twelveDataApiKeySet: boolean;

  // ── KZO-198 — Bounds (single source of truth for UI form constraints) ──
  bounds: AppConfigBoundsDto;
  secretLengthBounds: { min: number; max: number };

  updatedAt: string;
}

// ── Admin Provider Fixer (KZO-197 addendum) ───────────────────────────────

export type ProviderFixerOperationPhase =
  | "diagnose"
  | "preview"
  | "staged"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type ProviderFixerRiskLevel = "low" | "dangerous";

export type ProviderFixerOperationType =
  | "kr_resolver_binding"
  | "provider_rerun"
  | "legacy_batch_cancel"
  | "legacy_batch_pause"
  | "legacy_batch_resume";

export type ProviderFixerResolverMode = "quote_first" | "chart_probe_v1" | "catalog_hint";

export interface ProviderFixerGuardrailsDto {
  dangerousMatchThreshold: number;
  previewSampleLimit: number;
  uiPageSize: number;
  autoPauseFailuresPerMinute: number;
  previewTokenTtlMinutes: number;
}

export interface ProviderFixerEvidenceRowDto {
  ticker: string;
  marketCode: string;
  providerId: string;
  errorCode: string;
  providerSymbol: string | null;
  candidateSymbol: string | null;
  catalogExchange: string | null;
  catalogMicCode: string | null;
  resolverMode: ProviderFixerResolverMode | null;
  evidence: Record<string, unknown>;
  lastErrorMessage: string | null;
  lastOccurredAt: string | null;
  riskLevel: ProviderFixerRiskLevel;
}

export interface ProviderFixerOperationDto {
  id: string;
  providerId: string;
  marketCode: string | null;
  operationType: ProviderFixerOperationType;
  phase: ProviderFixerOperationPhase;
  riskLevel: ProviderFixerRiskLevel;
  resolverMode: ProviderFixerResolverMode | null;
  errorCode: string | null;
  scopeQuery: Record<string, unknown>;
  snapshotHash: string | null;
  matchCount: number;
  sampleCount: number;
  sampleRows: ProviderFixerEvidenceRowDto[];
  progress: Record<string, unknown>;
  activeBatchId: string | null;
  legacyBatchId: string | null;
  previewTokenExpiresAt: string | null;
  requestedByUserId: string | null;
  confirmedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  stagedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface ProviderFixerOperationLogDto {
  id: number;
  operationId: string | null;
  phase: ProviderFixerOperationPhase | null;
  action: string;
  level: "info" | "warning" | "error";
  actorUserId: string | null;
  providerId: string | null;
  marketCode: string | null;
  resolverMode: ProviderFixerResolverMode | null;
  errorCode: string | null;
  batchId: string | null;
  jobId: string | null;
  counts: Record<string, unknown>;
  message: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderFixerSummaryDto {
  unresolvedCount: number;
  criticalUnresolvedCount: number;
  activeOperationCount: number;
  queuedOperationCount: number;
  guardrails: ProviderFixerGuardrailsDto;
  effectiveProviderCaps: Array<{ providerId: string; cap: string; value: number | null }>;
  providers: Array<{
    providerId: string;
    marketCode: string | null;
    unresolvedCount: number;
    activeOperationCount: number;
    status: ProviderHealthStatusDto["status"];
  }>;
}

export interface ProviderFixerDiagnosticsResponse {
  items: ProviderFixerEvidenceRowDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderFixerPreviewResponse {
  previewToken: string;
  expiresAt: string;
  snapshotHash: string;
  matchCount: number;
  riskLevel: ProviderFixerRiskLevel;
  typedConfirmationRequired: boolean;
  sample: ProviderFixerEvidenceRowDto[];
}

export interface ProviderFixerOperationsResponse {
  items: ProviderFixerOperationDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderFixerLogsResponse {
  items: ProviderFixerOperationLogDto[];
  total: number;
  page: number;
  limit: number;
}

// ── AI connector + MCP draft types (KZO-210+) ──────────────────────────────

export type AiConnectorProvider = "chatgpt" | "self_hosted";
export type AiConnectorStatus = "pending" | "active" | "expired" | "revoked";
export type AiConnectorScope =
  | "portfolio:mcp_read"
  | "account:manage"
  | "transaction_draft:create"
  | "transaction_draft:edit"
  | "transaction_draft:archive"
  | "transaction_draft:delete"
  | "transaction:write";
export type ShareCapability = AiConnectorScope;
export type AiConnectorAccessKind =
  | "read"
  | "draft_create"
  | "draft_update"
  | "draft_archive"
  | "draft_delete"
  | "write";
export type AiConnectorAccessResult = "ok" | "denied" | "error";
export type AiConnectorToolGroup = "read" | "drafts" | "write";
export type AiConnectorToolAvailability = "available" | "unavailable";
export type AiTransactionDraftBatchStatus = "open" | "archived" | "deleted";
export type AiTransactionDraftSourceChannel = "mcp" | "web";
export type AiConnectorImportSourceType = "csv" | "image" | "pdf";
export type AiTransactionDraftRowState =
  | "needs_clarification"
  | "pending_validation"
  | "ready"
  | "invalid"
  | "duplicate_blocked"
  | "excluded"
  | "rejected"
  | "confirmed"
  | "unsupported";
export type AiTransactionDraftEventType =
  | "batch_created"
  | "preflight_run"
  | "row_updated"
  | "row_state_changed"
  | "rows_excluded"
  | "rows_reincluded"
  | "rows_rejected"
  | "rows_confirmed"
  | "batch_archived"
  | "batch_deleted";
export type McpDraftPostingOutcome = "posted" | "blocked" | "confirmation_required";

export interface AiConnectorConnectionDto {
  id: string;
  provider: AiConnectorProvider;
  displayName: string;
  status: AiConnectorStatus;
  scopes: AiConnectorScope[];
  toolToggles: Record<string, boolean>;
  expiresAt: string | null;
  expiryNotifiedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiConnectorPolicySettingsDto {
  enabled: boolean;
  maxActiveConnectionsPerUser: number;
  allowedProviders: Record<AiConnectorProvider, boolean>;
  groupToggles: Record<AiConnectorToolGroup, boolean>;
  inactivityExpiryDays: number;
  expirationWarningDays: number;
  freshAuthMaxAgeMs: number;
  maxConnectorLifetimeDays: number;
  oauthPublicIssuer: string | null;
  oauthRedirectUriAllowlist: string[];
  oauthTokenSecretSet: boolean;
  updatedAt: string;
}

export interface AiConnectorToolCatalogEntryDto {
  name: string;
  description: string;
  scope: AiConnectorScope;
  accessKind: AiConnectorAccessKind;
  group: AiConnectorToolGroup;
  enabledByPolicy: boolean;
  availability: AiConnectorToolAvailability;
  unavailableReason: string | null;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export interface AiConnectorSummaryDto {
  connections: AiConnectorConnectionDto[];
  policy: AiConnectorPolicySettingsDto;
  toolCatalog?: AiConnectorToolCatalogEntryDto[];
}

export interface McpOAuthConsentRequestDto {
  requestId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: AiConnectorScope[];
  csrfToken: string;
  expiresAt: string;
  policy: Pick<AiConnectorPolicySettingsDto, "maxConnectorLifetimeDays" | "groupToggles">;
}

export interface McpOAuthConsentDecisionDto {
  redirectUrl: string;
}

export interface AiConnectorImportFileProvenanceDto {
  fileId: string;
  sourceType: AiConnectorImportSourceType;
  displayName?: string | null;
  mediaType?: string | null;
  pageCount?: number | null;
  rowCount?: number | null;
  sha256Prefix?: string | null;
  snippet?: string | null;
}

export interface AiConnectorImportCandidateSourceDto {
  fileId?: string | null;
  page?: number | null;
  rowRef?: string | null;
  cellRefs?: string[];
  snippet?: string | null;
  confidence?: number | null;
}

export interface AiConnectorImportProvenanceDto {
  sourceType: AiConnectorImportSourceType;
  files: AiConnectorImportFileProvenanceDto[];
  extractor?: {
    provider?: string | null;
    model?: string | null;
    runId?: string | null;
  };
  warnings?: string[];
}

export interface McpPostTransactionDraftRowsInputDto {
  batchId: string;
  rowIds: string[];
  expectedBatchVersion: number;
  expectedRowVersions: Array<{
    rowId: string;
    expectedVersion: number;
  }>;
  idempotencyKey: string;
  typedConfirmation?: string;
}

export interface McpPostTransactionDraftRowsResultDto {
  outcome: McpDraftPostingOutcome;
  batchId: string;
  batchVersion: number;
  postedRowIds: string[];
  createdTransactionIds: string[];
  remainingUnresolvedRowIds: string[];
  confirmation: {
    selectedRowCount: number;
    totalRowsRequested: number;
    typedPhraseRequired: string | null;
    typedPhraseSatisfied: boolean;
    grossValueTwd: number;
  };
  deepLinkUrl: string;
  eventIds: string[];
  rowErrors: Array<{
    rowId: string;
    state: AiTransactionDraftRowState;
    issues: unknown[];
  }>;
}

export interface AiConnectorAccessLogDto {
  id: string;
  connectionId: string | null;
  portfolioContextUserId: string;
  shareId: string | null;
  toolName: string;
  accessKind: AiConnectorAccessKind;
  result: AiConnectorAccessResult;
  denialReason: string | null;
  createdAt: string;
}

export interface TransactionAiInboxBadgeDto {
  openBatchCount: number;
  actionRequiredRowCount: number;
  readyRowCount: number;
  latestBatchId: string | null;
}

export interface TransactionDraftBatchDto {
  id: string;
  ownerUserId: string;
  createdByUserId: string;
  connectorConnectionId: string | null;
  shareId: string | null;
  sourceChannel: AiTransactionDraftSourceChannel;
  status: AiTransactionDraftBatchStatus;
  version: number;
  sourceLabel: string | null;
  sourceFilename: string | null;
  note: string | null;
  rowCount: number;
  unsupportedCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface TransactionDraftRowDto {
  id: string;
  batchId: string;
  rowNumber: number;
  state: AiTransactionDraftRowState;
  version: number;
  accountId: string | null;
  accountName: string | null;
  accountNameInput: string | null;
  type: "BUY" | "SELL" | null;
  ticker: string | null;
  marketCode: MarketCode | null;
  quantity: number | null;
  unitPrice: number | null;
  priceCurrency: string | null;
  tradeDate: string | null;
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  isDayTrade: boolean | null;
  commissionAmount: number | null;
  taxAmount: number | null;
  feesSource: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
  note: string | null;
  sourceRowRef: string | null;
  sourceSnippet: string | null;
  preflightIssues: unknown[];
  warnings: unknown[];
  confirmedTradeEventId: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface TransactionDraftUnsupportedItemDto {
  id: string;
  batchId: string;
  rowNumber: number | null;
  category: string;
  reason: string;
  sourceSnippet: string | null;
  createdAt: string;
}

export interface TransactionDraftBatchDetailDto {
  batch: TransactionDraftBatchDto;
  rows: TransactionDraftRowDto[];
  unsupportedItems: TransactionDraftUnsupportedItemDto[];
}

export interface TransactionDraftPostingResultDto {
  batchId: string;
  batchVersion: number;
  postedRowIds: string[];
  createdTransactionIds: string[];
  remainingUnresolvedRowIds: string[];
  requiresTypedConfirmation: boolean;
  typedConfirmationPhrase: string | null;
  grossValueAmount: number | null;
  grossValueCurrency: string | null;
  deepLinkUrl: string | null;
  auditEventIds: string[];
}

export interface McpAccountLiveBalanceDto {
  currency: CurrencyCode;
  amount: number;
}

export interface McpAccountDisplayDto {
  id: string;
  name: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
  feeProfileId: string;
  feeProfileName: string | null;
  status: "active" | "deleted";
  deletedAt: string | null;
  liveBalance: McpAccountLiveBalanceDto[];
}

export interface ChatGptAccountManagerWidgetPermissionsDto {
  canCreate: boolean;
  canEdit: boolean;
  canSoftDelete: boolean;
  canRestore: boolean;
  manageScopeGranted: boolean;
  adminWritePolicyEnabled: boolean;
}

export interface ChatGptAccountManagerWidgetToolsDto {
  refresh: string | null;
  createAccount: string | null;
  updateAccount: string | null;
  softDeleteAccount: string | null;
  restoreAccount: string | null;
}

export interface ChatGptAccountManagerWidgetDto {
  title: string;
  subtitle: string;
  accounts: McpAccountDisplayDto[];
  deletedAccounts: McpAccountDisplayDto[];
  permissions: ChatGptAccountManagerWidgetPermissionsDto;
  suggestions: string[];
  tools: ChatGptAccountManagerWidgetToolsDto;
}

export interface McpTransactionDraftPostingPreviewRowDto {
  rowId: string;
  rowNumber: number;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  accountDefaultCurrency: AccountDefaultCurrency;
  ticker: string;
  marketCode: MarketCode;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  grossValueAmount: number;
  commissionAmount: number;
  taxAmount: number;
  calculatedCommissionAmount: number;
  calculatedTaxAmount: number;
  feesSource: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED";
  netCashImpactAmount: number;
  warnings: string[];
  suggestions: string[];
  sourceSnippet: string | null;
}

export interface McpTransactionDraftPostingPreviewGroupDto {
  accountId: string;
  accountName: string;
  currency: CurrencyCode;
  rowCount: number;
  totalGrossBuyAmount: number;
  totalGrossSellAmount: number;
  totalCommissionAmount: number;
  totalTaxAmount: number;
  netCashImpactAmount: number;
}

export interface McpTransactionDraftPostingPreviewDto {
  batchId: string;
  batchVersion: number;
  selectedRowIds: string[];
  rows: McpTransactionDraftPostingPreviewRowDto[];
  groups: McpTransactionDraftPostingPreviewGroupDto[];
  warnings: string[];
  suggestions: string[];
  typedPhraseRequired: string | null;
}

export interface ChatGptTransactionDraftWidgetAuditItemDto {
  tone: "info" | "success" | "warning";
  message: string;
}

export interface ChatGptTransactionDraftWidgetPermissionsDto {
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canPost: boolean;
  writeScopeGranted: boolean;
  requiresWriteReconsent: boolean;
  adminWritePolicyEnabled: boolean;
}

export interface ChatGptTransactionDraftWidgetProvenanceDto {
  sourceLabel: string | null;
  sourceFilename: string | null;
  sourceSummary: string;
  sourceChannelLabel: string;
  structuredCandidatesOnly: boolean;
  snippetCharacterCap: number;
  rowMappingCount: number | null;
}

export interface ChatGptTransactionDraftWidgetToolsDto {
  refresh: string | null;
  previewPosting: string | null;
  updateRow: string | null;
  excludeRows: string | null;
  reincludeRows: string | null;
  rejectRows: string | null;
  archiveBatch: string | null;
  deleteBatch: string | null;
  postRows: string | null;
}

export interface ChatGptTransactionDraftWidgetDto {
  mode: "import" | "review" | "post";
  title: string;
  subtitle: string;
  batch: TransactionDraftBatchDto;
  rows: TransactionDraftRowDto[];
  unsupportedItems: TransactionDraftUnsupportedItemDto[];
  accounts: McpAccountDisplayDto[];
  selectedRowIds: string[];
  grossValueText: string;
  deepLinkUrl: string | null;
  postingPreview: McpTransactionDraftPostingPreviewDto | null;
  suggestions: string[];
  provenance: ChatGptTransactionDraftWidgetProvenanceDto;
  permissions: ChatGptTransactionDraftWidgetPermissionsDto;
  auditPreview: ChatGptTransactionDraftWidgetAuditItemDto[];
  postingResult: TransactionDraftPostingResultDto | null;
  tools: ChatGptTransactionDraftWidgetToolsDto;
}

// ── Sharing types (KZO-145 / KZO-146) ──────────────────────────────────────

export interface ShareGrantDto {
  id: string;
  status: "active" | "revoked";
  ownerUserId: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  granteeUserId: string;
  granteeEmail: string | null;
  granteeDisplayName: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  capabilities: ShareCapability[];
}

export interface PendingShareInviteDto {
  code: string;
  status: "pending" | "expired" | "revoked";
  email: string;
  role: UserRole;
  shareOwnerUserId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  inviteUrl: string | null;
  capabilities: ShareCapability[];
}

export type OutboundShareHistoryItemDto = ShareGrantDto | PendingShareInviteDto;

export interface SharesListResponseDto {
  outbound: {
    active: ShareGrantDto[];
    pending: PendingShareInviteDto[];
    expired: PendingShareInviteDto[];
    revoked: OutboundShareHistoryItemDto[];
  };
  inbound: {
    active: ShareGrantDto[];
    revoked: ShareGrantDto[];
  };
}

export type CreateShareResponseDto =
  | {
      type: "resolved";
      share: ShareGrantDto;
    }
  | {
      type: "pending";
      invite: PendingShareInviteDto;
    };

// ── Anonymous share tokens (KZO-147) ───────────────────────────────────────

export type AnonymousShareTokenStatus = "active" | "expired" | "revoked";

export interface AnonymousShareTokenDto {
  id: string;
  token: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: AnonymousShareTokenStatus;
}

export interface PublicShareHoldingDto {
  ticker: string;
  instrumentName?: string | null;
  quantity: number;
  marketValueAmount: number | null;
  marketValueCurrency: CurrencyCode;
  allocationPercent: number | null;
  quoteStatus: "current" | "provisional" | "missing";
}

export interface PublicShareHoldingGroupDto {
  ticker: string;
  instrumentName?: string | null;
  marketCode: MarketCode;
  quantity: number;
  accountCount: number;
  marketValueAmount: number | null;
  marketValueCurrency: CurrencyCode;
  allocationPercent: number | null;
  quoteStatus: "current" | "provisional" | "missing";
}

export interface PublicShareTotalByCurrencyDto {
  currency: CurrencyCode;
  amount: number;
}

export interface PublicShareReturnByCurrencyDto {
  currency: CurrencyCode;
  returnPercent: number;
}

export interface PublicShareViewDto {
  ownerDisplayName: string;
  expiresAt: string;
  holdings: PublicShareHoldingDto[];
  holdingGroups: PublicShareHoldingGroupDto[];
  summary: {
    totalValueByCurrency: PublicShareTotalByCurrencyDto[];
    returnByCurrency: PublicShareReturnByCurrencyDto[];
  };
  dataHealth: {
    holdingCount: number;
    missingQuoteCount: number;
    provisionalQuoteCount: number;
  };
  quoteAsOf: string | null;
}

export interface QuoteSnapshotDto {
  ticker: string;
  close: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string;
  source: string;
  isProvisional: boolean;
}

export type MonitoredTickerSource = "manual" | "position";

export interface MonitoredTickerDto {
  ticker: string;
  // KZO-169: monitored ticker entries are now disambiguated by market — both
  // user-manual selections and position-derived rows carry the market code.
  marketCode: string;
  source: MonitoredTickerSource;
  name: string | null;
  instrumentType: InstrumentType | null;
  barsBackfillStatus: string | null;
  lastRepairAt: string | null;
  /** KZO-133: earliest ISO time the ticker can be repaired; null when no prior repair. */
  repairAvailableAt: string | null;
}

export interface InstrumentCatalogItemDto {
  ticker: string;
  name: string | null;
  instrumentType: InstrumentType | null;
  sector: string | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt: string | null;
  /** KZO-133: earliest ISO time the instrument can be repaired; null when no prior repair. */
  repairAvailableAt: string | null;
  /**
   * KZO-196 — GICS industry-group string sourced from the ASX
   * `ASXListedCompanies.csv` feed (AU only). `null` when the feed has not yet
   * synced the row (or for non-AU markets where the column is unpopulated).
   * The UI bucketizes unknown values to "Other" — never throws.
   */
  gicsIndustryGroup: string | null;
}

// ── Notification types (KZO-132) ────────────────────────────────────────────

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationDto {
  id: string;
  userId: string;
  severity: NotificationSeverity;
  source: string;
  sourceRef: string | null;
  title: string;
  body: string | null;
  detail: unknown;
  readAt: string | null;
  escalatedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationDto[];
  total: number;
  page: number;
  limit: number;
}

export interface UnreadCountResponse {
  count: number;
}

// ── Provider health (KZO-177) ───────────────────────────────────────────────

// KZO-197 — `'awaiting'` widening: route layer derives this state when the
// provider has neither a successful nor a failed run on record (fresh deploy).
// The DB enum / persistence row shape is UNCHANGED — `'awaiting'` is purely a
// route-side computed value rendered as a 4th status badge.
export type ProviderHealthStatus = "healthy" | "degraded" | "down" | "awaiting";
export type ProviderErrorClass = "rate_limit" | "http_4xx" | "http_5xx" | "network" | "parse" | "other";

export interface ProviderErrorTrailEntryDto {
  id: number;
  occurredAt: string;
  errorClass: ProviderErrorClass;
  errorMessage: string | null;
}

export interface ProviderHealthStatusDto {
  providerId: string;
  status: ProviderHealthStatus;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  errorCount24h: number;
  errorCount7d: number;
  rateLimitCount24h: number;
  lastErrorMessage: string | null;
  lastManualRerunAt: string | null;
  /**
   * KZO-197 — per-provider rerun cooldown (ms) sourced from the server-side
   * `getEffectiveProviderRerunCooldownMs(providerId)` resolver. The admin UI
   * uses this to render the live tooltip-cooldown label and to set the 429
   * countdown fallback. Always populated (never null).
   */
  rerunCooldownMs: number;
  updatedAt: string;
  recentErrors: ProviderErrorTrailEntryDto[];
}

export const PROVIDER_OPERATION_ACTIONS = [
  "sync_catalog",
  "backfill_catalog_rows",
  "refresh_fx_rates",
  "sync_asx_gics",
  "renew_evidence",
  "repair_mapping",
  "rerun_backfill",
  "reverify_mapping",
  "revert_mapping",
  "purge_logs",
  "normalize_errors",
  "mark_unsupported",
  "ignore_unresolved",
  "reopen_unresolved",
  "refresh_health",
] as const;

export type ProviderOperationAction = (typeof PROVIDER_OPERATION_ACTIONS)[number];
export type ProviderOperationGuardrailLevel = "none" | "checkbox" | "typed_preview";

export interface ProviderOperationActionCapabilityDto {
  action: ProviderOperationAction;
  supported: boolean;
  guardrail: ProviderOperationGuardrailLevel;
  reason: string | null;
}

export interface ProviderOperationCapabilityDto {
  providerId: string;
  supportsMappings: boolean;
  supportsRepair: boolean;
  supportsRenew: boolean;
  supportsRerun: boolean;
  supportsResolverModes: boolean;
  emptyMappingReason: string;
  actions: ProviderOperationActionCapabilityDto[];
}

export interface AdminProvidersResponse {
  providers: ProviderHealthStatusDto[];
  capabilities: ProviderOperationCapabilityDto[];
}

// ── Provider fixer dashboard (web-facing slice) ────────────────────────────

export type ProviderFixerDashboardOperationPhase =
  | "diagnose"
  | "preparing_preview"
  | "preview"
  | "staged"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type ProviderFixerDashboardSeverity = "ok" | "warning" | "critical";
export type ProviderFixerDashboardResolverStatus = "enabled" | "disabled" | "auto";
export type ProviderFixerDashboardConfirmationMode = "standard" | "typed";
export type ProviderOperationScopeType = "selected_items" | "filter";

export interface ProviderOperationScopeItemDto {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  sourceSymbol: string;
}

export interface ProviderOperationFilterScopeDto {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  state: "active";
  search: string | null;
}

export interface ProviderOperationFrozenScopeDto {
  type: ProviderOperationScopeType;
  filterFingerprint: string;
  matchCount: number;
  selectedItems: ProviderOperationScopeItemDto[];
  filter: ProviderOperationFilterScopeDto | null;
}

export interface ProviderFixerDashboardSummaryDto {
  criticalUnresolvedCount: number;
  affectedProviders: string[];
  activeOperationsCount: number;
  queuedOperationsCount: number;
  runningOperationsCount: number;
  guardrailsEnabled: boolean;
  effectiveRateCapPerMinute: number;
}

export interface ProviderFixerDashboardGuardrailSettingsDto {
  dangerousMatchThreshold: number;
  previewSampleLimit: number;
  uiPageSize: number;
  autoPauseFailureThresholdPerMinute: number;
  previewTokenTtlSeconds: number;
  healthWarningUnresolvedThreshold: number;
  healthCriticalUnresolvedThreshold: number;
}

export interface ProviderFixerDashboardDiagnosisRowDto {
  providerId: string;
  market: string;
  unresolvedCount: number;
  resolverStatus: ProviderFixerDashboardResolverStatus;
  severity: ProviderFixerDashboardSeverity;
  errorCode: string;
}

export interface ProviderFixerDashboardDiagnosticsDto {
  resolverMode: "quote_first" | "chart_probe_v1";
  providerId: string;
  errorCode: string;
  recommendation: string;
  rows: ProviderFixerDashboardDiagnosisRowDto[];
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
}

export interface ProviderFixerDashboardEvidenceSampleDto {
  symbol: string;
  providerSymbol: string;
  candidateSymbol: string | null;
  exchangeHint: string | null;
  verificationStatus: "verified" | "pending" | "rejected";
  note: string;
}

export interface ProviderFixerDashboardPreviewDto {
  scopeType: "row" | "selected_items" | "filter" | "legacy";
  scopeLabel: string;
  queryBacked: boolean;
  page: number;
  totalPages: number;
  token: string;
  tokenExpiresAt: string;
  snapshotHash: string;
  matchCount: number;
  sampleCount: number;
  confirmationMode: ProviderFixerDashboardConfirmationMode;
  confirmationText: string | null;
  acknowledgementLabel: string;
  scopeSummary: string;
  search: string | null;
  state: ProviderUnresolvedItemState | null;
  frozenScope: ProviderOperationFrozenScopeDto | null;
  evidenceSample: ProviderFixerDashboardEvidenceSampleDto[];
}

export interface ProviderFixerDashboardOperationDto {
  id: string;
  providerId: string;
  market: string | null;
  phase: ProviderFixerDashboardOperationPhase;
  matchCount: number;
  preview: ProviderFixerDashboardPreviewDto;
  canExecute: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canRetry: boolean;
  dangerous: boolean;
  progressPercent: number | null;
  autoPauseFailureCount: number | null;
  autoPauseFailureThresholdPerMinute: number | null;
  effectiveRateCapPerMinute: number | null;
}

export interface ProviderFixerDashboardLogEntryDto {
  id: string;
  occurredAt: string;
  phase: ProviderFixerDashboardOperationPhase;
  message: string;
  operationId: string | null;
}

export interface ProviderFixerDashboardSummaryResponse {
  summary: ProviderFixerDashboardSummaryDto;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
}

export interface ProviderFixerDashboardDiagnosticsResponse {
  diagnostics: ProviderFixerDashboardDiagnosticsDto;
}

export interface ProviderFixerDashboardOperationsResponse {
  stagedOperation: ProviderFixerDashboardOperationDto | null;
  selectedOperation?: ProviderFixerDashboardOperationDto | null;
  operations: ProviderFixerDashboardOperationDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderFixerDashboardLogsResponse {
  items: ProviderFixerDashboardLogEntryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderLogPurgePreviewDto {
  operationId: string;
  providerId: string;
  previewToken: string;
  tokenExpiresAt: string;
  confirmationText: string;
  errorTrailCount: number;
  operationLogCount: number;
  matchCount: number;
  canExecute: boolean;
  boundary: string;
}

export interface ProviderLogPurgePreviewResponse {
  preview: ProviderLogPurgePreviewDto;
}

export interface ProviderLogPurgeExecuteResponse {
  operationId: string;
  providerId: string;
  errorTrailDeleted: number;
  operationLogDeleted: number;
}

export type ProviderUnresolvedItemState = "active" | "resolved" | "unsupported" | "ignored";
export type ProviderUnresolvedListState = ProviderUnresolvedItemState | "all";

export interface ProviderUnresolvedItemDto {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  sourceSymbol: string;
  providerSymbol: string | null;
  state: ProviderUnresolvedItemState;
  severity: "ok" | "warning" | "critical";
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastErrorTrailId: number | null;
  evidence: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedByOperationId: string | null;
  updatedAt: string;
}

export interface ProviderUnresolvedItemsResponse {
  items: ProviderUnresolvedItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderUnresolvedItemUpdateResponse {
  item: ProviderUnresolvedItemDto;
}

export type ProviderIncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type ProviderIncidentSeverity = "info" | "warning" | "critical";

export interface ProviderIncidentDto {
  id: string;
  providerId: string;
  marketCode: MarketCode | null;
  incidentKey: string;
  status: ProviderIncidentStatus;
  severity: ProviderIncidentSeverity;
  title: string;
  summary: string | null;
  errorClass: ProviderErrorClass;
  errorCode: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastErrorTrailId: number | null;
  linkedOperationId: string | null;
  metadata: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  ignoredAt: string | null;
  ignoredByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderIncidentsResponse {
  items: ProviderIncidentDto[];
  total: number;
  page: number;
  limit: number;
}

export type ProviderOperationOutcomeState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rate_limited"
  | "cancelled";
export type ProviderOperationOutcomeListState = ProviderOperationOutcomeState | "all";

export interface ProviderOperationOutcomeDto {
  operationId: string;
  providerId: string;
  marketCode: AdminMarketCode;
  sourceSymbol: string;
  providerSymbol: string | null;
  action: string;
  state: ProviderOperationOutcomeState;
  message: string | null;
  errorCode: string | null;
  jobId: string | null;
  evidence: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface ProviderOperationOutcomeSummaryDto {
  total: number;
  processed: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rateLimited: number;
  cancelled: number;
  progressPercent: number;
}

export interface ProviderOperationOutcomesResponse {
  items: ProviderOperationOutcomeDto[];
  summary: ProviderOperationOutcomeSummaryDto;
  total: number;
  page: number;
  limit: number;
}

export interface ProviderResolutionMappingDto {
  providerId: string;
  marketCode: MarketCode;
  sourceSymbol: string;
  resolvedSymbol: string;
  resolverMode: "quote_first" | "chart_probe_v1" | null;
  evidence: Record<string, unknown> | null;
  verifiedAt: string;
  verifiedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderResolutionMappingsResponse {
  items: ProviderResolutionMappingDto[];
  total: number;
  page: number;
  limit: number;
}

export type ProviderActivityItemKind = "incident" | "operation" | "log" | "mapping" | "unresolved";

export interface ProviderActivityItemDto {
  id: string;
  providerId: string;
  kind: ProviderActivityItemKind;
  occurredAt: string;
  title: string;
  detail: string | null;
  refId: string | null;
}

export interface ProviderActivityResponse {
  items: ProviderActivityItemDto[];
  total: number;
  page: number;
  limit: number;
}

// ── Admin instruments / delisting management (KZO-195) ──────────────────────

export type AdminInstrumentStatus = "listed" | "delisted" | "excluded";
export type AdminInstrumentSupportState = "supported" | "retired_by_admin" | "unsupported_by_provider";

export interface AdminInstrumentDto {
  ticker: string;
  marketCode: MarketCode;
  name: string | null;
  instrumentType: InstrumentType;
  status: AdminInstrumentStatus;
  supportState: AdminInstrumentSupportState;
  /**
   * Reason captured when the row was stamped delisted. For absence-detected
   * rows this is `"absence_detected"`; provider-feed rows carry whatever
   * reason the upstream feed provided (or `null`).
   */
  statusReason: string | null;
  absenceStreak: number;
  lastSeenInCatalogAt: string | null;
  delistedAt: string | null;
  delistingDetectionExcluded: boolean;
}

export interface AdminInstrumentsThresholdsDto {
  catalogAbsenceThreshold: number;
  catalogAbsenceGuardPercent: number;
  catalogAbsenceGuardFloor: number;
}

export interface AdminInstrumentsResponse {
  items: AdminInstrumentDto[];
  total: number;
  page: number;
  limit: number;
  thresholds: AdminInstrumentsThresholdsDto;
}

// ── Admin market-data console ───────────────────────────────────────────────

export type AdminMarketCode = MarketCode | "FX";
export type AdminMarketWorkspaceTab =
  | "overview"
  | "instruments"
  | "backfill"
  | "mappings"
  | "purge"
  | "operations"
  | "logs"
  | "refresh-rates";
export type AdminMarketDataBackfillScope =
  | "user_owned_or_monitored"
  | "selected_catalog_rows"
  | "all_matching";
export type AdminMarketDataPurgeCategory =
  | "price_bars"
  | "dividends"
  | "backfill_jobs"
  | "provider_operation_outcomes"
  | "provider_error_trail"
  | "provider_resolution_mappings"
  | "asx_gics_enrichment"
  | "admin_state_reset";
export type AdminMarketDataConfirmationLevel = "none" | "checkbox" | "typed";

export interface AdminMarketDataProviderChipDto {
  providerId: string;
  label: string;
  role: string;
}

export interface AdminMarketDataTileDto {
  marketCode: AdminMarketCode;
  label: string;
  href: string;
  providers: AdminMarketDataProviderChipDto[];
  healthStatus: ProviderHealthStatus;
  unresolvedCount: number;
  pendingBackfillCount: number;
  failedBackfillCount: number;
  latestOperation: {
    id: string;
    providerId: string;
    action: ProviderOperationAction;
    phase: ProviderFixerDashboardOperationPhase;
    updatedAt: string;
  } | null;
  nextAction: string | null;
}

export interface AdminMarketDataLandingResponse {
  markets: AdminMarketDataTileDto[];
}

export interface AdminMarketDataOverviewResponse {
  marketCode: AdminMarketCode;
  label: string;
  tabs: AdminMarketWorkspaceTab[];
  providers: AdminMarketDataProviderChipDto[];
  healthStatus: ProviderHealthStatus;
  unresolvedCount: number;
  pendingBackfillCount: number;
  failedBackfillCount: number;
  latestOperation: AdminMarketDataTileDto["latestOperation"];
  guidance: string[];
}

export interface AdminMarketDataInstrumentDto extends AdminInstrumentDto {
  providerIds: string[];
  backfillStatus: "pending" | "backfilling" | "ready" | "failed" | "unknown";
}

export interface AdminMarketDataInstrumentsResponse extends AdminInstrumentsResponse {
  marketCode: MarketCode;
  filters: {
    status: Array<AdminInstrumentStatus | "all">;
    supportState: Array<AdminInstrumentSupportState | "all">;
    backfillStatus: Array<AdminMarketDataInstrumentDto["backfillStatus"] | "all">;
    instrumentType: Array<InstrumentType | "all">;
    sort: string[];
  };
  items: AdminMarketDataInstrumentDto[];
}

export interface AdminMarketDataActionDto {
  action: ProviderOperationAction;
  providerId: string;
  label: string;
  description: string;
  supported: boolean;
  disabledReason: string | null;
  guardrail: ProviderOperationGuardrailLevel;
  providerBudgetNotes: string[];
}

export interface AdminMarketDataActionsResponse {
  marketCode: AdminMarketCode;
  actions: AdminMarketDataActionDto[];
}

export interface AdminMarketDataActionExecuteRequest {
  action: ProviderOperationAction;
  providerId?: string;
  acknowledged?: boolean;
  resolverMode?: "quote_first" | "chart_probe_v1";
  resolverModeRiskAccepted?: boolean;
}

export interface AdminMarketDataActionExecuteResponse {
  operationId: string;
  marketCode: AdminMarketCode;
  providerId: string;
  action: ProviderOperationAction;
  status: "queued" | "completed";
  jobId: string | null;
  message: string;
}

export interface AdminMarketDataOperationsResponse {
  marketCode: AdminMarketCode;
  providers: AdminMarketDataProviderChipDto[];
  items: ProviderFixerDashboardOperationDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminMarketDataLogsResponse {
  marketCode: AdminMarketCode;
  providers: AdminMarketDataProviderChipDto[];
  items: ProviderFixerDashboardLogEntryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminMarketDataBackfillTargetDto {
  ticker: string;
  marketCode: MarketCode;
  name?: string | null;
  instrumentType?: InstrumentType | null;
  status?: AdminInstrumentStatus | null;
  supportState?: AdminInstrumentSupportState | null;
  backfillStatus?: AdminMarketDataInstrumentDto["backfillStatus"] | null;
  providerIds?: string[];
}

export interface AdminMarketDataBackfillPreviewRequest {
  scope: AdminMarketDataBackfillScope;
  providerId?: string;
  selectedCatalogRows?: AdminMarketDataBackfillTargetDto[];
  filters?: Record<string, string | number | boolean | null>;
  includeDemoUsers?: boolean;
}

export interface AdminMarketDataBackfillPreviewResponse {
  marketCode: MarketCode;
  providerId: string;
  scope: AdminMarketDataBackfillScope;
  operationId: string;
  previewToken: string;
  tokenExpiresAt: string;
  matchCount: number;
  affectedUserCount: number;
  affectedAccountCount: number;
  estimatedJobCount: number;
  estimatedStorageRows: number | null;
  providerBudgetNotes: string[];
  targets: AdminMarketDataBackfillTargetDto[];
  unsupportedRows: Array<AdminMarketDataBackfillTargetDto & { reason: string }>;
  confirmation: {
    level: AdminMarketDataConfirmationLevel;
    text: string | null;
    reason: string | null;
  };
}

export interface AdminMarketDataBackfillExecuteRequest {
  operationId: string;
  previewToken: string;
  acknowledged?: boolean;
  typedConfirmation?: string;
}

export interface AdminMarketDataBackfillExecuteResponse {
  operationId: string;
  marketCode: MarketCode;
  providerId: string;
  scope: AdminMarketDataBackfillScope;
  status: "queued" | "completed";
  matchCount: number;
  enqueuedJobCount: number;
  skippedExistingJobCount: number;
  batchId: string | null;
}

export interface AdminMarketDataPurgePreviewRequest {
  providerId?: string;
  categories: AdminMarketDataPurgeCategory[];
  targets?: AdminMarketDataBackfillTargetDto[];
  fullHistory?: boolean;
  startDate?: string;
  endDate?: string;
  enqueueBackfillAfterPurge?: boolean;
  filters?: Record<string, string | number | boolean | null>;
}

export interface AdminMarketDataPurgePreviewResponse {
  operationId: string;
  previewToken: string;
  tokenExpiresAt: string;
  marketCode: MarketCode;
  providerId: string;
  categories: AdminMarketDataPurgeCategory[];
  affectedInstrumentCount: number;
  affectedUserCount: number;
  affectedAccountCount: number;
  estimatedRows: number | null;
  unsupportedCategories: Array<{ category: AdminMarketDataPurgeCategory; reason: string }>;
  linkedRefill: {
    available: boolean;
    mode: "same_range" | "full_history" | null;
    warning: string | null;
  };
  confirmation: {
    level: AdminMarketDataConfirmationLevel;
    text: string | null;
    reason: string | null;
  };
}

export interface AdminMarketDataPurgeExecuteRequest {
  operationId: string;
  previewToken: string;
  typedConfirmation: string;
}

export interface AdminMarketDataPurgeExecuteResponse {
  operationId: string;
  marketCode: MarketCode;
  providerId: string;
  status: "completed";
  categories: AdminMarketDataPurgeCategory[];
  affectedInstrumentCount: number;
  deletedRows: number | null;
  linkedBackfillOperationId: string | null;
}

export interface AdminMarketDataSupportStateRequest {
  ticker: string;
  marketCode: MarketCode;
  supportState: AdminInstrumentSupportState;
}

export interface AdminMarketDataSupportStateResponse {
  instrument: AdminMarketDataInstrumentDto;
}

export type AdminMarketDataDelistingOverrideAction =
  | "exclude_from_delisting_detection"
  | "include_in_delisting_detection"
  | "clear_delisted_state";

export interface AdminMarketDataDelistingOverrideRequest {
  ticker: string;
  marketCode: MarketCode;
  action: AdminMarketDataDelistingOverrideAction;
}

export interface AdminMarketDataDelistingOverrideResponse {
  instrument: AdminMarketDataInstrumentDto;
}

// ── Dividend ledger aggregates (KZO-135) ────────────────────────────────────

export type CurrencyAmounts = Record<string, number>;
export type CurrencyExpectedReceived = Record<string, { expected: number; received: number }>;

export interface DividendLedgerAggregates {
  totalExpectedCashAmount: CurrencyAmounts;
  totalReceivedCashAmount: CurrencyAmounts;
  openCount: number;
  byMonth: Record<string, CurrencyExpectedReceived>;
  byTicker: Record<string, CurrencyExpectedReceived>;
}
