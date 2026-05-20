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

// KZO-167: per-account currency + account type metadata. Both are added
// here (not on a separate `Account` interface in apps/api/src/types/store.ts)
// because KZO-167 collapses the API-internal `Account` interface into this
// DTO. New value semantics are gated by D7 lockdown at the route layer.
export type AccountDefaultCurrency = "TWD" | "USD" | "AUD";
export type AccountType = "broker" | "bank" | "wallet";

export interface AccountDto {
  id: string;
  name: string;
  userId: string;
  feeProfileId: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
}

// KZO-183: closed-set market code derived from an account's defaultCurrency.
// Currency ↔ market is a 1:1 mapping (TWD↔TW, USD↔US, AUD↔AU). Both helpers
// throw on any unsupported input.
export type MarketCode = "TW" | "US" | "AU";

export const MARKET_CURRENCY_PAIRS = {
  TWD: "TW",
  USD: "US",
  AUD: "AU",
} as const satisfies Record<AccountDefaultCurrency, MarketCode>;

const MARKET_TO_CURRENCY = {
  TW: "TWD",
  US: "USD",
  AU: "AUD",
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

export interface DashboardOverviewHoldingDto {
  accountId: string;
  ticker: string;
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

export interface DashboardOverviewUpcomingDividendDto {
  accountId: string;
  ticker: string;
  exDividendDate: string | null;
  paymentDate: string | null;
  expectedAmount: number | null;
  currency: CurrencyCode;
  status: "declared" | "expected" | "paying-soon";
}

export interface DashboardOverviewRecentDividendDto {
  accountId: string;
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
  holdings: DashboardOverviewHoldingDto[];
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

export interface DashboardPerformanceDto {
  range: DashboardPerformanceRange;
  points: DashboardPerformancePointDto[];
  /** KZO-180: chosen reporting currency for all translated point numerics. */
  reportingCurrency: AccountDefaultCurrency;
  /** KZO-180: rollup of `fxAvailable` across the points list. See
   *  `DashboardOverviewSummaryDto.fxStatus` for the value semantics. */
  fxStatus: "complete" | "partial" | "missing";
}

export interface TransactionHistoryItemDto {
  id: string;
  accountId: string;
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
    range: "1Y";
    points: TickerDetailsChartPointDto[];
  };
  transactions: TransactionHistoryItemDto[];
  dividends: {
    upcoming: DashboardOverviewUpcomingDividendDto[];
    recent: DashboardOverviewRecentDividendDto[];
  };
  fundamentals: TickerFundamentalsDto;
  fundamentalsRefresh: TickerFundamentalsRefreshDto;
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
  quantity: number;
  marketValueAmount: number;
  marketValueCurrency: CurrencyCode;
  allocationPercent: number;
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
  summary: {
    totalValueByCurrency: PublicShareTotalByCurrencyDto[];
    returnByCurrency: PublicShareReturnByCurrencyDto[];
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

export interface AdminProvidersResponse {
  providers: ProviderHealthStatusDto[];
}

// ── Admin instruments / delisting management (KZO-195) ──────────────────────

export type AdminInstrumentStatus = "listed" | "delisted" | "excluded";

export interface AdminInstrumentDto {
  ticker: string;
  marketCode: MarketCode;
  name: string | null;
  instrumentType: InstrumentType;
  status: AdminInstrumentStatus;
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
