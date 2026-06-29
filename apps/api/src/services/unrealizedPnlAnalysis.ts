import type { FastifyInstance } from "fastify";
import { roundToDecimal, resolveRangeBounds } from "@vakwen/domain";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  UNREALIZED_PNL_GRANULARITIES,
  UNREALIZED_PNL_HOLDINGS_STATES,
  UNREALIZED_PNL_SELECTION_MODES,
  type AccountDefaultCurrency,
  type InstrumentType,
  type MarketCode,
  type UnrealizedPnlAnalysisDto,
  type UnrealizedPnlAnalysisQueryStateDto,
  type UnrealizedPnlGranularity,
  type UnrealizedPnlRankingRowDto,
  type UnrealizedPnlTickerRefDto,
  type UnrealizedPnlTradeMarkerDto,
  type UnrealizedPnlTradeMarkerKind,
} from "@vakwen/shared-types";
import { z } from "zod";
import { listTradeEvents } from "./accountingStore.js";
import { resolveReportingCurrency } from "./userPreferences.js";
import { routeError } from "../lib/routeError.js";

const DEFAULT_RANGE = "3M";
const DEFAULT_GRANULARITY: UnrealizedPnlGranularity = "weekly";
const DEFAULT_COMPARISON_LINE_COUNT = 5;
const MAX_COMPARISON_LINE_COUNT = 20;
const DEFAULT_RANKING_LIMIT = 100;
const MAX_RANKING_LIMIT = 500;
const MAX_FILTER_ITEMS = 200;
const MIN_ANALYSIS_DATE = "1900-01-01";

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z.string().refine(isIsoCalendarDate, {
  message: "Expected a valid ISO calendar date (YYYY-MM-DD)",
});

const tickerSchema = z.string().trim().min(1).max(32).transform((value) => value.toUpperCase());
const accountIdSchema = z.string().trim().min(1).max(200);
const marketCodeSchema = z.enum(MARKET_CODES);
const INSTRUMENT_TYPES = ["STOCK", "ETF", "BOND_ETF"] as const satisfies readonly InstrumentType[];
const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const granularitySchema = z.enum(UNREALIZED_PNL_GRANULARITIES);
const holdingsStateSchema = z.enum(UNREALIZED_PNL_HOLDINGS_STATES);
const selectionModeSchema = z.enum(UNREALIZED_PNL_SELECTION_MODES);
const reportingCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return value;
}, z.boolean().optional());

const tickerRefSchema = z.object({
  ticker: tickerSchema,
  marketCode: marketCodeSchema,
}).strict();

function parseTickerRef(value: string): UnrealizedPnlTickerRefDto {
  const [marketCode, ticker] = value.split(":");
  if (!marketCode || !ticker || !MARKET_CODES.includes(marketCode as MarketCode)) {
    throw new Error(`Invalid ticker ref ${value}`);
  }
  return {
    marketCode: marketCode as MarketCode,
    ticker: ticker.trim().toUpperCase(),
  };
}

function normalizeCsvList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const routeTickerRefsSchema = z.preprocess((value) => normalizeCsvList(value)?.map((item) => parseTickerRef(item)), z.array(tickerRefSchema).max(MAX_COMPARISON_LINE_COUNT).optional());

export const unrealizedPnlAnalysisRouteQuerySchema = z.object({
  granularity: granularitySchema.optional(),
  range: z.string().trim().min(1).max(20).optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  markets: z.preprocess(normalizeCsvList, z.array(marketCodeSchema).max(MARKET_CODES.length).optional()),
  accountIds: z.preprocess(normalizeCsvList, z.array(accountIdSchema).max(MAX_FILTER_ITEMS).optional()),
  tickers: z.preprocess(normalizeCsvList, z.array(tickerSchema).max(MAX_FILTER_ITEMS).optional()),
  instrumentTypes: z.preprocess(normalizeCsvList, z.array(instrumentTypeSchema).max(3).optional()),
  selectionMode: selectionModeSchema.optional(),
  selectedTickers: routeTickerRefsSchema,
  comparisonLineCount: z.coerce.number().int().min(1).max(MAX_COMPARISON_LINE_COUNT).optional(),
  rankingLimit: z.coerce.number().int().min(1).max(MAX_RANKING_LIMIT).optional(),
  holdingsState: holdingsStateSchema.optional(),
  reportingCurrency: reportingCurrencySchema.optional(),
  includeProvisional: booleanQuerySchema,
}).strict();

export const unrealizedPnlAnalysisMcpInputSchema = z.object({
  granularity: granularitySchema.optional(),
  range: z.string().trim().min(1).max(20).optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  markets: z.array(marketCodeSchema).max(MARKET_CODES.length).optional(),
  accountIds: z.array(accountIdSchema).max(MAX_FILTER_ITEMS).optional(),
  tickers: z.array(tickerSchema).max(MAX_FILTER_ITEMS).optional(),
  instrumentTypes: z.array(instrumentTypeSchema).max(3).optional(),
  selectionMode: selectionModeSchema.optional(),
  selectedTickers: z.array(tickerRefSchema).max(MAX_COMPARISON_LINE_COUNT).optional(),
  comparisonLineCount: z.number().int().min(1).max(MAX_COMPARISON_LINE_COUNT).optional(),
  rankingLimit: z.number().int().min(1).max(MAX_RANKING_LIMIT).optional(),
  holdingsState: holdingsStateSchema.optional(),
  reportingCurrency: reportingCurrencySchema.optional(),
  includeProvisional: z.boolean().optional(),
}).strict();

export type UnrealizedPnlAnalysisInput = z.infer<typeof unrealizedPnlAnalysisMcpInputSchema>;

type ResolvedInput = UnrealizedPnlAnalysisQueryStateDto;

interface BucketDescriptor {
  key: string;
  sortDate: string;
}

interface AggregatedPoint {
  date: string;
  unrealizedPnlAmount: number | null;
  marketValueAmount: number | null;
  costBasisAmount: number | null;
  quantity: number;
  fxAvailable: boolean;
  isProvisional: boolean;
  accountIds: string[];
}

interface TickerSeriesAggregate {
  ticker: string;
  marketCode: MarketCode;
  instrumentName: string | null;
  instrumentType: InstrumentType | null;
  accountIds: string[];
  accountNames: string[];
  points: AggregatedPoint[];
  latestQuantity: number;
  tradeMarkers: UnrealizedPnlTradeMarkerDto[];
}

function compareTickerRefs(left: UnrealizedPnlTickerRefDto, right: UnrealizedPnlTickerRefDto): number {
  return left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
}

function tickerKey(input: UnrealizedPnlTickerRefDto): string {
  return `${input.marketCode}:${input.ticker}`;
}

function tradeSortKey(
  left: { tradeDate: string; bookingSequence?: number; tradeTimestamp?: string; id: string },
  right: { tradeDate: string; bookingSequence?: number; tradeTimestamp?: string; id: string },
): number {
  return left.tradeDate.localeCompare(right.tradeDate)
    || (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0)
    || (left.tradeTimestamp ?? "").localeCompare(right.tradeTimestamp ?? "")
    || left.id.localeCompare(right.id);
}

function isoWeekKey(date: string): string {
  const utc = new Date(`${date}T00:00:00.000Z`);
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function bucketKeyForDate(date: string, granularity: UnrealizedPnlGranularity): string {
  switch (granularity) {
    case "daily":
      return date;
    case "weekly":
      return isoWeekKey(date);
    case "monthly":
      return date.slice(0, 7);
    case "yearly":
      return date.slice(0, 4);
  }
}

function assertAnalysisDateBounds(startDate: string, endDate: string, granularity: UnrealizedPnlGranularity): void {
  if (startDate > endDate) {
    throw routeError(400, "invalid_analysis_date_range", "fromDate must be less than or equal to toDate");
  }
  if (granularity === "yearly") return;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const maxEnd = new Date(start);
  maxEnd.setUTCFullYear(maxEnd.getUTCFullYear() + 5);
  if (end > maxEnd) {
    throw routeError(400, "invalid_analysis_range_bounds", "daily, weekly, and monthly analysis is limited to 5Y");
  }
}

function resolveInput(
  input: UnrealizedPnlAnalysisInput,
  defaultReportingCurrency: AccountDefaultCurrency,
  earliestTradeDate?: string,
): ResolvedInput {
  const asOf = input.toDate ?? new Date().toISOString().slice(0, 10);
  const granularity = input.granularity ?? DEFAULT_GRANULARITY;
  if (input.range === "ALL" && granularity !== "yearly") {
    throw routeError(400, "invalid_analysis_range", "ALL is only supported for yearly granularity");
  }

  let startDate: string;
  let endDate: string;
  let range: UnrealizedPnlAnalysisQueryStateDto["range"];
  if (input.fromDate || input.toDate) {
    startDate = input.fromDate ?? input.toDate ?? asOf;
    endDate = input.toDate ?? asOf;
    range = null;
  } else {
    const resolvedRange = input.range ?? DEFAULT_RANGE;
    range = resolvedRange as UnrealizedPnlAnalysisQueryStateDto["range"];
    const bounds = resolveRangeBounds(resolvedRange, asOf, resolvedRange === "ALL" ? earliestTradeDate : undefined);
    startDate = bounds.startDate;
    endDate = bounds.endDate;
  }

  assertAnalysisDateBounds(startDate, endDate, granularity);

  const selectedTickers = [...(input.selectedTickers ?? [])].sort(compareTickerRefs);
  return {
    granularity,
    range,
    fromDate: input.fromDate ?? null,
    toDate: input.toDate ?? null,
    startDate,
    endDate,
    markets: [...(input.markets ?? [])].sort(),
    accountIds: [...(input.accountIds ?? [])].sort(),
    tickers: [...(input.tickers ?? [])].sort(),
    instrumentTypes: [...(input.instrumentTypes ?? [])].sort() as InstrumentType[],
    selectionMode: input.selectionMode ?? "auto",
    selectedTickers,
    comparisonLineCount: input.comparisonLineCount ?? DEFAULT_COMPARISON_LINE_COUNT,
    rankingLimit: input.rankingLimit ?? DEFAULT_RANKING_LIMIT,
    holdingsState: input.holdingsState ?? "open_only",
    reportingCurrency: input.reportingCurrency ?? defaultReportingCurrency,
    includeProvisional: input.includeProvisional ?? false,
    asOf,
  };
}

function buildBucketDescriptors(
  rows: ReadonlyArray<{ snapshotDate: string }>,
  granularity: UnrealizedPnlGranularity,
): BucketDescriptor[] {
  const descriptors = new Map<string, string>();
  for (const row of rows) {
    const key = bucketKeyForDate(row.snapshotDate, granularity);
    const current = descriptors.get(key);
    if (!current || row.snapshotDate > current) {
      descriptors.set(key, row.snapshotDate);
    }
  }
  return [...descriptors.entries()]
    .map(([key, sortDate]) => ({ key, sortDate }))
    .sort((left, right) => left.sortDate.localeCompare(right.sortDate));
}

function aggregateBucketRows(
  rows: ReadonlyArray<{
    snapshotDate: string;
    accountId: string;
    marketCode: string;
    ticker?: string;
    costBasisAmount: number | null;
    marketValueAmount: number | null;
    unrealizedPnlAmount: number | null;
    quantity: number;
    fxAvailable: boolean;
    isProvisional: boolean;
  }>,
  descriptors: readonly BucketDescriptor[],
  granularity: UnrealizedPnlGranularity,
  contributorKeyForRow: (row: typeof rows[number], bucketKey: string) => string = (row, bucketKey) => `${row.accountId}\0${row.marketCode}\0${bucketKey}`,
): AggregatedPoint[] {
  const byContributorAndBucket = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const bucketKey = bucketKeyForDate(row.snapshotDate, granularity);
    const contributorKey = contributorKeyForRow(row, bucketKey);
    const current = byContributorAndBucket.get(contributorKey);
    if (!current || row.snapshotDate > current.snapshotDate) {
      byContributorAndBucket.set(contributorKey, row);
    }
  }

  const byBucket = new Map<string, Array<typeof rows[number]>>();
  for (const row of byContributorAndBucket.values()) {
    const bucketKey = bucketKeyForDate(row.snapshotDate, granularity);
    const bucketRows = byBucket.get(bucketKey) ?? [];
    bucketRows.push(row);
    byBucket.set(bucketKey, bucketRows);
  }

  return descriptors
    .filter((descriptor) => byBucket.has(descriptor.key))
    .map((descriptor) => {
      const bucketRows = byBucket.get(descriptor.key)!;
      const fxAvailable = bucketRows.every((row) => row.quantity === 0 || row.fxAvailable);
      const isProvisional = bucketRows.some((row) => row.isProvisional);
      const hasNullAmounts = bucketRows.some((row) =>
        row.quantity !== 0 && (
          row.costBasisAmount === null || row.marketValueAmount === null || row.unrealizedPnlAmount === null
        ),
      );
      const accountIds = [...new Set(bucketRows.map((row) => row.accountId))].sort();
      const quantity = roundToDecimal(bucketRows.reduce((sum, row) => sum + row.quantity, 0), 6);
      return {
        date: descriptor.sortDate,
        unrealizedPnlAmount: !fxAvailable || isProvisional || hasNullAmounts
          ? null
          : roundToDecimal(bucketRows.reduce((sum, row) => sum + (row.unrealizedPnlAmount ?? 0), 0), 2),
        marketValueAmount: !fxAvailable || isProvisional || hasNullAmounts
          ? null
          : roundToDecimal(bucketRows.reduce((sum, row) => sum + (row.marketValueAmount ?? 0), 0), 2),
        costBasisAmount: !fxAvailable || hasNullAmounts
          ? null
          : roundToDecimal(bucketRows.reduce((sum, row) => sum + (row.costBasisAmount ?? 0), 0), 2),
        quantity,
        fxAvailable,
        isProvisional,
        accountIds,
      };
    });
}

function padSoldOutSeries(
  series: AggregatedPoint[],
  descriptors: readonly BucketDescriptor[],
): AggregatedPoint[] {
  if (series.length === 0) return [];
  const lastPoint = series[series.length - 1]!;
  if (lastPoint.quantity > 0) return series;
  const existing = new Set(series.map((point) => point.date));
  const padded = [...series];
  for (const descriptor of descriptors) {
    if (descriptor.sortDate <= lastPoint.date || existing.has(descriptor.sortDate)) continue;
    padded.push({
      date: descriptor.sortDate,
      unrealizedPnlAmount: 0,
      marketValueAmount: 0,
      costBasisAmount: 0,
      quantity: 0,
      fxAvailable: true,
      isProvisional: false,
      accountIds: [...lastPoint.accountIds],
    });
  }
  return padded.sort((left, right) => left.date.localeCompare(right.date));
}

function pickSelectedTickers(
  rankings: readonly UnrealizedPnlRankingRowDto[],
  selectionMode: typeof UNREALIZED_PNL_SELECTION_MODES[number],
  selectedTickers: readonly UnrealizedPnlTickerRefDto[],
  comparisonLineCount: number,
): UnrealizedPnlTickerRefDto[] {
  if (selectionMode === "manual" && selectedTickers.length > 0) {
    return [...selectedTickers].slice(0, comparisonLineCount);
  }
  return rankings
    .slice(0, comparisonLineCount)
    .map((row) => ({ ticker: row.ticker, marketCode: row.marketCode }));
}

function periodChangeSortScore(value: number | null): number {
  return value === null ? -1 : Math.abs(value);
}

function buildDeepLink(query: ResolvedInput): string {
  const params = new URLSearchParams();
  if (query.granularity !== DEFAULT_GRANULARITY) params.set("granularity", query.granularity);
  if (query.range) {
    if (query.range !== DEFAULT_RANGE) params.set("range", query.range);
  } else {
    params.set("range", "CUSTOM");
  }
  if (query.fromDate) params.set("fromDate", query.fromDate);
  if (query.toDate) params.set("toDate", query.toDate);
  if (query.markets.length > 0) params.set("markets", query.markets.join(","));
  if (query.accountIds.length > 0) params.set("accountIds", query.accountIds.join(","));
  if (query.tickers.length > 0) params.set("tickers", query.tickers.join(","));
  if (query.instrumentTypes.length > 0) params.set("instrumentTypes", query.instrumentTypes.join(","));
  if (query.selectionMode !== "auto") params.set("selectionMode", query.selectionMode);
  if (query.selectedTickers.length > 0) {
    params.set("selectedTickers", query.selectedTickers.map((item) => `${item.marketCode}:${item.ticker}`).join(","));
  }
  if (query.comparisonLineCount !== DEFAULT_COMPARISON_LINE_COUNT) params.set("comparisonLineCount", String(query.comparisonLineCount));
  if (query.holdingsState !== "open_only") params.set("holdingsState", query.holdingsState);
  if (query.reportingCurrency !== "TWD") params.set("reportingCurrency", query.reportingCurrency);
  if (query.includeProvisional) params.set("includeProvisional", "true");
  const queryString = params.toString();
  return `/analysis/unrealized-pnl${queryString ? `?${queryString}` : ""}`;
}

function isTickerAllowed(
  ticker: UnrealizedPnlTickerRefDto,
  allowed: ReadonlySet<string>,
): boolean {
  return allowed.has(tickerKey(ticker));
}

function buildTradeMarkers(input: {
  trades: ReturnType<typeof listTradeEvents>;
  accountNamesById: ReadonlyMap<string, string>;
  allowedTickers: ReadonlySet<string>;
  startDate: string;
  endDate: string;
  }): UnrealizedPnlTradeMarkerDto[] {
  const filtered = input.trades
    .filter((trade) => isTickerAllowed({ ticker: trade.ticker, marketCode: trade.marketCode as MarketCode }, input.allowedTickers))
    .sort(tradeSortKey);

  const positions = new Map<string, number>();
  const perDateEvents = new Map<string, Array<{
    kind: Exclude<UnrealizedPnlTradeMarkerKind, "aggregate">;
    accountId: string;
    quantityDelta: number;
    quantityAfter: number;
  }>>();

  for (const trade of filtered) {
    const key = `${trade.marketCode}:${trade.ticker}`;
    const previous = positions.get(key) ?? 0;
    const delta = trade.type === "BUY" ? trade.quantity : -trade.quantity;
    const next = roundToDecimal(previous + delta, 6);
    positions.set(key, next);

    if (trade.tradeDate < input.startDate || trade.tradeDate > input.endDate) continue;
    const kind: Exclude<UnrealizedPnlTradeMarkerKind, "aggregate"> = trade.type === "BUY"
      ? "buy"
      : next <= 0
        ? "full_exit"
        : "partial_sell";
    const groupKey = `${trade.marketCode}:${trade.ticker}:${trade.tradeDate}`;
    const list = perDateEvents.get(groupKey) ?? [];
    list.push({
      kind,
      accountId: trade.accountId,
      quantityDelta: delta,
      quantityAfter: next,
    });
    perDateEvents.set(groupKey, list);
  }

  const markers: UnrealizedPnlTradeMarkerDto[] = [];
  for (const [groupKey, events] of perDateEvents.entries()) {
    const [marketCode, ticker, date] = groupKey.split(":");
    const accountIds = [...new Set(events.map((event) => event.accountId))].sort();
    const accountNames = accountIds.map((accountId) => input.accountNamesById.get(accountId) ?? accountId);
    if (events.length === 1) {
      markers.push({
        ticker,
        marketCode: marketCode as MarketCode,
        date,
        kind: events[0]!.kind,
        eventCount: 1,
        accountIds,
        accountNames,
        netQuantityDelta: events[0]!.quantityDelta,
        quantityAfter: events[0]!.quantityAfter,
      });
      continue;
    }
    markers.push({
      ticker,
      marketCode: marketCode as MarketCode,
      date,
      kind: "aggregate",
      eventCount: events.length,
      accountIds,
      accountNames,
      netQuantityDelta: roundToDecimal(events.reduce((sum, event) => sum + event.quantityDelta, 0), 6),
      quantityAfter: events[events.length - 1]!.quantityAfter,
      componentKinds: [...new Set(events.map((event) => event.kind))].sort(),
    });
  }

  return markers.sort((left, right) =>
    left.marketCode.localeCompare(right.marketCode)
    || left.ticker.localeCompare(right.ticker)
    || left.date.localeCompare(right.date),
  );
}

export async function buildUnrealizedPnlAnalysis(
  app: FastifyInstance,
  userId: string,
  rawInput: UnrealizedPnlAnalysisInput,
): Promise<UnrealizedPnlAnalysisDto> {
  const [store, prefs] = await Promise.all([
    app.persistence.loadStore(userId),
    app.persistence.getUserPreferences(userId),
  ]);
  const defaultReportingCurrency = resolveReportingCurrency(prefs);
  const activeAccounts = new Map(store.accounts.map((account) => [account.id, account] as const));
  const earliestTradeDate = [...listTradeEvents(store)]
    .sort(tradeSortKey)
    .map((trade) => trade.tradeDate)[0];
  const query = resolveInput(rawInput, defaultReportingCurrency, earliestTradeDate);

  const hasExplicitAccountFilter = query.accountIds.length > 0;
  const requestedAccountIds = hasExplicitAccountFilter
    ? query.accountIds.filter((accountId) => activeAccounts.has(accountId))
    : [...activeAccounts.keys()];
  const instrumentByKey = new Map<string, typeof store.instruments[number]>(
    store.instruments.map((instrument) => [`${instrument.marketCode}:${instrument.ticker}`, instrument] as const),
  );
  const instrumentNameByKey = new Map<string, string>();
  for (const instrument of store.marketData.instruments) {
    if (instrument.name) {
      instrumentNameByKey.set(`${instrument.marketCode}:${instrument.ticker}`, instrument.name);
    }
  }

  const snapshotRows = requestedAccountIds.length === 0
    ? []
    : await app.persistence.listUnrealizedPnlAnalysisSnapshots(userId, {
      accountIds: requestedAccountIds,
      markets: query.markets.length > 0 ? query.markets : undefined,
      tickers: query.tickers.length > 0 ? query.tickers : undefined,
      startDate: query.range === "ALL" ? MIN_ANALYSIS_DATE : query.startDate,
      endDate: query.endDate,
      includeProvisional: query.includeProvisional,
      reportingCurrency: query.reportingCurrency,
    });

  const filteredSnapshotRows = snapshotRows.filter((row) => {
    const instrument = instrumentByKey.get(`${row.marketCode}:${row.ticker}`);
    if (query.instrumentTypes.length > 0 && (!instrument?.type || !query.instrumentTypes.includes(instrument.type))) return false;
    if (query.range !== "ALL" && row.snapshotDate < query.startDate) return false;
    return true;
  });

  const descriptors = buildBucketDescriptors(filteredSnapshotRows, query.granularity);
  const latestSnapshotDate = filteredSnapshotRows[filteredSnapshotRows.length - 1]?.snapshotDate ?? null;
  const firstSnapshotDate = filteredSnapshotRows[0]?.snapshotDate ?? null;
  const accountNamesById = new Map(store.accounts.map((account) => [account.id, account.name] as const));

  const rowsByTicker = new Map<string, typeof filteredSnapshotRows>();
  for (const row of filteredSnapshotRows) {
    const key = `${row.marketCode}:${row.ticker}`;
    const bucket = rowsByTicker.get(key) ?? [];
    bucket.push(row);
    rowsByTicker.set(key, bucket);
  }

  const tickerSeriesAll: TickerSeriesAggregate[] = [...rowsByTicker.entries()].map(([key, rows]) => {
    const [marketCode, ticker] = key.split(":");
    const instrument = instrumentByKey.get(key);
    const series = aggregateBucketRows(
      rows.map((row) => ({
        ...row,
        marketCode: row.marketCode,
      })),
      descriptors,
      query.granularity,
    );
    const latestQuantity = series[series.length - 1]?.quantity ?? 0;
    const paddedSeries = query.holdingsState === "include_sold_out" ? padSoldOutSeries(series, descriptors) : series;
    const accountIds = [...new Set(rows.map((row) => row.accountId))].sort();
    return {
      ticker,
      marketCode: marketCode as MarketCode,
      instrumentName: instrumentNameByKey.get(key) ?? null,
      instrumentType: instrument?.type ?? null,
      accountIds,
      accountNames: accountIds.map((accountId) => accountNamesById.get(accountId) ?? accountId),
      points: paddedSeries,
      latestQuantity,
      tradeMarkers: [],
    };
  });

  const includedTickerSeries = tickerSeriesAll.filter((series) =>
    query.holdingsState === "include_sold_out" || series.latestQuantity > 0,
  );

  const rankings = includedTickerSeries
    .map((series): UnrealizedPnlRankingRowDto => {
      const startPoint = series.points[0] ?? null;
      const endPoint = series.points[series.points.length - 1] ?? null;
      const periodChangeAmount = startPoint?.unrealizedPnlAmount !== null && startPoint?.unrealizedPnlAmount !== undefined
        && endPoint?.unrealizedPnlAmount !== null && endPoint?.unrealizedPnlAmount !== undefined
        ? roundToDecimal((endPoint.unrealizedPnlAmount ?? 0) - (startPoint.unrealizedPnlAmount ?? 0), 2)
        : null;
      return {
        ticker: series.ticker,
        marketCode: series.marketCode,
        instrumentName: series.instrumentName,
        instrumentType: series.instrumentType,
        accountIds: series.accountIds,
        accountNames: series.accountNames,
        currentlyHeld: series.latestQuantity > 0,
        isSoldOut: series.latestQuantity <= 0,
        startUnrealizedPnlAmount: startPoint?.unrealizedPnlAmount ?? null,
        endUnrealizedPnlAmount: endPoint?.unrealizedPnlAmount ?? null,
        periodChangeAmount,
        latestMarketValueAmount: endPoint?.marketValueAmount ?? null,
        latestCostBasisAmount: endPoint?.costBasisAmount ?? null,
        latestQuantity: series.latestQuantity,
        tradeMarkerCount: 0,
      };
    })
    .sort((left, right) =>
      periodChangeSortScore(right.periodChangeAmount) - periodChangeSortScore(left.periodChangeAmount)
      || left.marketCode.localeCompare(right.marketCode)
      || left.ticker.localeCompare(right.ticker),
    )
    .slice(0, query.rankingLimit);

  const selectedTickers = pickSelectedTickers(rankings, query.selectionMode, query.selectedTickers, query.comparisonLineCount);
  const selectedTickerKeySet = new Set(selectedTickers.map((item) => tickerKey(item)));
  const rankingTickerKeySet = new Set(rankings.map((item) => `${item.marketCode}:${item.ticker}`));
  const markerTickerKeySet = new Set([...rankingTickerKeySet, ...selectedTickerKeySet]);
  const filteredTrades = listTradeEvents(store).filter((trade) => requestedAccountIds.includes(trade.accountId)).filter((trade) => {
      if (query.markets.length > 0 && !query.markets.includes(trade.marketCode as MarketCode)) return false;
      if (query.tickers.length > 0 && !query.tickers.includes(trade.ticker.toUpperCase())) return false;
      const instrument = instrumentByKey.get(`${trade.marketCode}:${trade.ticker}`);
      if (query.instrumentTypes.length > 0 && (!instrument?.type || !query.instrumentTypes.includes(instrument.type))) return false;
      return true;
    });
  const rankingTradeMarkers = buildTradeMarkers({
    trades: filteredTrades,
    accountNamesById,
    allowedTickers: markerTickerKeySet,
    startDate: query.startDate,
    endDate: query.endDate,
  });
  const tradeMarkers = rankingTradeMarkers.filter((marker) => selectedTickerKeySet.has(`${marker.marketCode}:${marker.ticker}`));

  const rankingTradeMarkerCount = new Map<string, number>();
  for (const marker of rankingTradeMarkers) {
    const key = `${marker.marketCode}:${marker.ticker}`;
    rankingTradeMarkerCount.set(key, (rankingTradeMarkerCount.get(key) ?? 0) + 1);
  }
  for (const ranking of rankings) {
    ranking.tradeMarkerCount = rankingTradeMarkerCount.get(`${ranking.marketCode}:${ranking.ticker}`) ?? 0;
  }

  const seriesByKey = new Map<string, TickerSeriesAggregate>(
    includedTickerSeries.map((series) => [`${series.marketCode}:${series.ticker}`, series] as const),
  );
  const returnedSeriesKeys = [
    ...rankings.map((item) => `${item.marketCode}:${item.ticker}`),
    ...selectedTickers.map((item) => `${item.marketCode}:${item.ticker}`),
  ];
  const returnedTickerSeries = [...new Set(returnedSeriesKeys)]
    .map((key) => seriesByKey.get(key))
    .filter((series): series is TickerSeriesAggregate => series !== undefined)
    .flatMap((series) => series.points.map((point) => {
      return {
        date: point.date,
        unrealizedPnlAmount: point.unrealizedPnlAmount,
        marketValueAmount: point.marketValueAmount,
        costBasisAmount: point.costBasisAmount,
        quantity: point.quantity,
        fxAvailable: point.fxAvailable,
        isProvisional: point.isProvisional,
        ticker: series.ticker,
        marketCode: series.marketCode,
        instrumentName: series.instrumentName,
        instrumentType: series.instrumentType,
        accountIds: series.accountIds,
        accountNames: series.accountNames,
        isSelected: selectedTickerKeySet.has(`${series.marketCode}:${series.ticker}`),
        isSoldOut: series.latestQuantity <= 0,
      };
    }));

  const includedTickerKeySet = new Set(includedTickerSeries.map((series) => `${series.marketCode}:${series.ticker}`));
  const portfolioSnapshotRows = filteredSnapshotRows.filter((row) => includedTickerKeySet.has(`${row.marketCode}:${row.ticker}`));

  const portfolioSeries = aggregateBucketRows(
    portfolioSnapshotRows.map((row) => ({
      ...row,
      marketCode: row.marketCode,
    })),
    descriptors,
    query.granularity,
    (row, bucketKey) => `${row.accountId}\0${row.marketCode}\0${row.ticker ?? ""}\0${bucketKey}`,
  ).map((point) => ({
    date: point.date,
    unrealizedPnlAmount: point.unrealizedPnlAmount,
    marketValueAmount: point.marketValueAmount,
    costBasisAmount: point.costBasisAmount,
    quantity: point.quantity,
    fxAvailable: point.fxAvailable,
    isProvisional: point.isProvisional,
  }));

  const summaryStartPoint = portfolioSeries[0] ?? null;
  const summaryEndPoint = portfolioSeries[portfolioSeries.length - 1] ?? null;
  const summaryPeriodChangeAmount = summaryStartPoint?.unrealizedPnlAmount !== null && summaryStartPoint?.unrealizedPnlAmount !== undefined
    && summaryEndPoint?.unrealizedPnlAmount !== null && summaryEndPoint?.unrealizedPnlAmount !== undefined
    ? roundToDecimal((summaryEndPoint.unrealizedPnlAmount ?? 0) - (summaryStartPoint.unrealizedPnlAmount ?? 0), 2)
    : null;

  return {
    query,
    summary: {
      reportingCurrency: query.reportingCurrency,
      startDate: summaryStartPoint?.date ?? null,
      endDate: summaryEndPoint?.date ?? null,
      startUnrealizedPnlAmount: summaryStartPoint?.unrealizedPnlAmount ?? null,
      endUnrealizedPnlAmount: summaryEndPoint?.unrealizedPnlAmount ?? null,
      periodChangeAmount: summaryPeriodChangeAmount,
      currentOpenTickerCount: tickerSeriesAll.filter((series) => series.latestQuantity > 0).length,
      includedTickerCount: includedTickerSeries.length,
    },
    portfolioSeries,
    tickerSeries: returnedTickerSeries,
    rankings,
    selectedTickers,
    tradeMarkers,
    dataHealth: {
      snapshotRowCount: filteredSnapshotRows.length,
      provisionalRowCount: filteredSnapshotRows.filter((row) => row.isProvisional).length,
      missingFxRowCount: filteredSnapshotRows.filter((row) => !row.fxAvailable).length,
      nullUnrealizedRowCount: filteredSnapshotRows.filter((row) => row.unrealizedPnlAmount === null).length,
      excludedSoldOutTickerCount: tickerSeriesAll.length - includedTickerSeries.length,
    },
    diagnostics: {
      latestSnapshotDate,
      firstSnapshotDate,
      bucketCount: descriptors.length,
      returnedTickerSeriesCount: new Set(returnedTickerSeries.map((point) => `${point.marketCode}:${point.ticker}`)).size,
      availableTickerSeriesCount: includedTickerSeries.length,
    },
    deepLink: buildDeepLink(query),
  };
}
