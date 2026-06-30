"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import type { LocaleCode } from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/shadcn/card";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/shadcn/popover";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { getDictionary } from "../../lib/i18n";
import { getJson, patchJson } from "../../lib/api";
import { getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useUnrealizedPnlData } from "../../features/analysis/hooks/useUnrealizedPnlData";
import {
  ANALYSIS_DEFAULT_STATE,
  ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY,
  EMPTY_ANALYSIS_EXPLICIT_PREFERENCE_KEYS,
  applyAnalysisPresentationDefaults,
  extractAnalysisPresentationDefaults,
  parseAnalysisPresentationDefaultsFromPreferences,
  unrealizedPnlRouteStateToSearchParams,
  updateAnalysisSelection,
} from "../../features/analysis/unrealizedPnlRouteState";
import type { UnrealizedPnlAnalysisExplicitPreferenceKeys } from "../../features/analysis/unrealizedPnlRouteState";
import type {
  AnalysisFilterOption,
  AnalysisGranularity,
  AnalysisHoldingsState,
  AnalysisInstrumentType,
  AnalysisMarketCode,
  AnalysisRangeOption,
  AnalysisSelectionMode,
  UnrealizedPnlAnalysisDto,
  UnrealizedPnlAnalysisRouteState,
  UnrealizedPnlSeries,
  UnrealizedPnlTickerCompositionRow,
  UnrealizedPnlTickerSelectionRow,
} from "../../features/analysis/unrealizedPnlTypes";

interface UnrealizedPnlAnalysisClientProps {
  explicitPreferenceKeys?: UnrealizedPnlAnalysisExplicitPreferenceKeys;
  initialData: UnrealizedPnlAnalysisDto | null;
  initialState: UnrealizedPnlAnalysisRouteState;
  locale?: LocaleCode;
}

interface UserPreferencesResponse {
  preferences?: Record<string, unknown>;
}

type AnalysisDict = ReturnType<typeof getDictionary>["analysis"];

const RANGE_OPTIONS: AnalysisRangeOption[] = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL"];
const EXTENDED_RANGE_OPTIONS: AnalysisRangeOption[] = [...RANGE_OPTIONS, "CUSTOM"];
const GRANULARITY_OPTIONS: AnalysisGranularity[] = ["daily", "weekly", "monthly", "yearly"];
const SELECTION_OPTIONS: AnalysisSelectionMode[] = ["top-drivers", "manual"];
const HOLDINGS_OPTIONS: AnalysisHoldingsState[] = ["current-only", "include-sold"];
const DETAIL_SORT_OPTIONS = ["ranking", "name", "end-pnl"] as const;
type DetailSortOption = typeof DETAIL_SORT_OPTIONS[number];

export function UnrealizedPnlAnalysisClient({
  explicitPreferenceKeys = EMPTY_ANALYSIS_EXPLICIT_PREFERENCE_KEYS,
  initialData,
  initialState,
  locale,
}: UnrealizedPnlAnalysisClientProps) {
  const router = useRouter();
  const shellData = useAppShellData();
  const resolvedLocale = locale ?? shellData.locale;
  const dict = useMemo(() => getDictionary(resolvedLocale).analysis, [resolvedLocale]);
  const [state, setState] = useState(initialState);
  const [focusIndex, setFocusIndex] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileTotalDetailOpen, setMobileTotalDetailOpen] = useState(false);
  const [detailSort, setDetailSort] = useState<DetailSortOption>("ranking");
  const [, startTransition] = useTransition();
  const didHydratePreferencesRef = useRef(false);
  const lastPersistedPreferencesRef = useRef<string | null>(null);
  const cacheScope = useMemo(() => getRouteDtoContextScope(shellData.sessionUserId), [shellData.sessionUserId]);
  const reducedMotion = useReducedMotion();
  const { cacheStatus, data, errorMessage, isBootstrapping, isRefreshing, refresh } = useUnrealizedPnlData({
    cachePolicy: shellData.routeCachePolicy ?? null,
    cacheScope,
    contextRefreshSignal: shellData.contextRefreshSignal,
    initialData,
    locale: resolvedLocale,
    state,
  });

  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
      .then((response) => {
        if (cancelled) return;
        const defaults = parseAnalysisPresentationDefaultsFromPreferences(response.preferences);
        didHydratePreferencesRef.current = true;
        if (!defaults) return;
        setState((current) => {
          const next = applyAnalysisPresentationDefaults(current, defaults, explicitPreferenceKeys);
          lastPersistedPreferencesRef.current = JSON.stringify(extractAnalysisPresentationDefaults(next));
          if (JSON.stringify(next) === JSON.stringify(current)) return current;
          const params = unrealizedPnlRouteStateToSearchParams(next);
          startTransition(() => {
            router.replace(`/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`, { scroll: false });
          });
          return next;
        });
      })
      .catch(() => {
        didHydratePreferencesRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [explicitPreferenceKeys, router, startTransition]);

  const selectedSet = useMemo(() => new Set(data?.selectedSeriesIds ?? state.selected), [data?.selectedSeriesIds, state.selected]);
  const chartDates = useMemo(() => collectChartDates(data?.tickerSeries ?? []), [data?.tickerSeries]);
  const maxFocusIndex = Math.max(0, chartDates.length - 1);
  const stateFocusIndex = state.focusDate ? chartDates.indexOf(state.focusDate) : -1;
  const activeFocusIndex = stateFocusIndex >= 0 ? stateFocusIndex : Math.min(focusIndex, maxFocusIndex);
  const focusDate = chartDates[activeFocusIndex] ?? null;
  const responseCurrency = data?.query.reportingCurrency ?? state.reportingCurrency;
  const isCurrencyStale = data !== null && data.query.reportingCurrency !== state.reportingCurrency;
  const staleCurrencyTitle = dict.staleCurrencyTitle.replace("{currency}", state.reportingCurrency);
  const staleCurrencyDetail = dict.staleCurrencyDetail.replace("{currency}", responseCurrency);
  const selectedSeries = useMemo(
    () => (data?.tickerSeries ?? []).filter((series) => selectedSet.has(series.seriesId)),
    [data?.tickerSeries, selectedSet],
  );
  const seriesById = useMemo(
    () => new Map((data?.tickerSeries ?? []).map((series) => [series.seriesId, series] as const)),
    [data?.tickerSeries],
  );
  const detailRows = useMemo(() => {
    const rows = data?.tickerSelection ?? [];
    const rankedRows = rows.filter((row) => !row.isManual);
    const manualRows = rows.filter((row) => row.isManual);
    const compareRows = (left: UnrealizedPnlTickerSelectionRow, right: UnrealizedPnlTickerSelectionRow) => {
      if (detailSort === "name") {
        return left.displayName.localeCompare(right.displayName) || left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
      }
      if (detailSort === "end-pnl") {
        const leftScore = left.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
        const rightScore = right.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return left.displayName.localeCompare(right.displayName) || left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
      }
      return left.rankSort - right.rankSort || left.displayName.localeCompare(right.displayName);
    };
    return [...rankedRows].sort(compareRows).concat([...manualRows].sort(compareRows));
  }, [data?.tickerSelection, detailSort]);
  const focusedSelectedValues = useMemo(
    () => selectedSeries.map((series) => {
      const point = focusDate ? series.points.find((candidate) => candidate.date === focusDate) : undefined;
      return {
        colorToken: series.colorToken,
        displayName: series.displayName,
        value: point?.unrealizedPnl ?? null,
      };
    }),
    [focusDate, selectedSeries],
  );

  function replaceState(next: UnrealizedPnlAnalysisRouteState): void {
    setState(next);
    persistPresentationDefaults(next);
    const params = unrealizedPnlRouteStateToSearchParams(next);
    startTransition(() => {
      router.replace(`/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`, { scroll: false });
    });
  }

  function persistPresentationDefaults(next: UnrealizedPnlAnalysisRouteState): void {
    if (!didHydratePreferencesRef.current) return;
    const payload = extractAnalysisPresentationDefaults(next);
    const serialized = JSON.stringify(payload);
    if (serialized === lastPersistedPreferencesRef.current) return;
    lastPersistedPreferencesRef.current = serialized;
    void patchJson(
      "/user-preferences",
      { [ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY]: payload },
      { contextScope: "session" },
    ).catch(() => {
      lastPersistedPreferencesRef.current = null;
    });
  }

  function toggleSeries(seriesId: string): void {
    const current = new Set(state.selectionMode === "manual" ? state.selected : data?.selectedSeriesIds ?? state.selected);
    if (current.has(seriesId)) {
      current.delete(seriesId);
    } else if (current.size < state.lineCount) {
      current.add(seriesId);
    }
    replaceState({
      ...updateAnalysisSelection(state, [...current], "manual"),
      view: "compare",
    });
  }

  function updateFocus(index: number): void {
    const nextDate = chartDates[Math.min(index, maxFocusIndex)] ?? null;
    setFocusIndex(index);
    replaceState({ ...state, focusDate: nextDate });
  }

  function positionLabel(positionStatus: "open_position" | "closed_position"): string {
    return formatPositionLabel(positionStatus, dict);
  }

  const totalCompositionContent = (
    <TotalCompositionContent
      composition={data?.tickerComposition ?? []}
      currency={data?.summary.totalUnrealized.currency ?? state.reportingCurrency}
      dict={dict}
      endDate={data?.summary.endDate ?? null}
      locale={resolvedLocale}
      totalValue={data?.summary.totalUnrealized.value ?? null}
    />
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/75">{dict.navLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground md:text-3xl">{dict.pageTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{dict.pageDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => replaceState(ANALYSIS_DEFAULT_STATE)}>{dict.resetFilters}</Button>
          <Button onClick={() => void refresh({ bypassCache: true })} disabled={isRefreshing}>{dict.retry}</Button>
        </div>
      </header>

      {data?.dataHealth.source === "preview" ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{dict.previewBanner}</strong> {dict.previewDetail}
        </div>
      ) : null}
      {isCurrencyStale ? (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary" data-testid="analysis-stale-currency-banner">
          <strong>{staleCurrencyTitle}</strong> {staleCurrencyDetail}
        </div>
      ) : null}
      {errorMessage ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage}</div> : null}
      {isBootstrapping && !data ? <AnalysisSkeleton /> : null}

      <button
        className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm font-medium md:hidden"
        type="button"
        onClick={() => setShowFilters((current) => !current)}
      >
        <span>{dict.filtersTitle}</span>
        <span>{showFilters ? dict.hideFilters : dict.showFilters}</span>
      </button>
      <section className={cn(
        "gap-3 rounded-lg border border-border/70 bg-card/70 p-3 md:grid md:grid-cols-2 xl:grid-cols-4",
        showFilters ? "grid" : "hidden",
      )}>
        <ControlGroup label={dict.rangeLabel}>
          <Segmented
            options={EXTENDED_RANGE_OPTIONS}
            value={state.range}
            onChange={(range) => replaceState({ ...state, range, granularity: range === "ALL" ? "yearly" : state.granularity })}
          />
        </ControlGroup>
        {state.range === "CUSTOM" ? (
          <div className="grid grid-cols-2 gap-2">
            <ControlGroup label={dict.customFrom}>
              <input
                aria-label={dict.customFrom}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={state.from ?? ""}
                onChange={(event) => replaceState({ ...state, from: event.currentTarget.value || null })}
              />
            </ControlGroup>
            <ControlGroup label={dict.customTo}>
              <input
                aria-label={dict.customTo}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={state.to ?? ""}
                onChange={(event) => replaceState({ ...state, to: event.currentTarget.value || null })}
              />
            </ControlGroup>
          </div>
        ) : null}
        <ControlGroup label={dict.granularityLabel}>
          <Segmented
            options={GRANULARITY_OPTIONS}
            value={state.granularity}
            onChange={(granularity) => replaceState({ ...state, granularity, range: state.range === "ALL" && granularity !== "yearly" ? "5Y" : state.range })}
          />
        </ControlGroup>
        <ControlGroup label={dict.linesLabel}>
          <input
            aria-label={dict.linesLabel}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            max={20}
            min={1}
            type="number"
            value={state.lineCount}
            onChange={(event) => replaceState({ ...state, lineCount: Math.max(1, Math.min(20, Number(event.currentTarget.value) || 5)) })}
          />
        </ControlGroup>
        <ControlGroup label={dict.selectionLabel}>
          <Segmented
            labelFor={(option) => option === "manual" ? dict.manualSelection : dict.topDrivers}
            options={SELECTION_OPTIONS}
            value={state.selectionMode}
            onChange={(selectionMode) => replaceState({ ...state, selectionMode })}
          />
        </ControlGroup>
        <ControlGroup label={dict.holdingsLabel}>
          <Segmented
            labelFor={(option) => option === "include-sold" ? dict.includeSold : dict.currentOnly}
            options={HOLDINGS_OPTIONS}
            value={state.holdingsState}
            onChange={(holdingsState) => replaceState({ ...state, holdingsState })}
          />
        </ControlGroup>
        <OptionChecklist
          label={dict.marketsLabel}
          options={data?.availableFilters.markets ?? []}
          selected={state.markets}
          onChange={(markets) => replaceState({ ...state, markets: markets as AnalysisMarketCode[] })}
        />
        <OptionChecklist
          label={dict.accountsLabel}
          options={data?.availableFilters.accounts ?? []}
          selected={state.accounts}
          onChange={(accounts) => replaceState({ ...state, accounts })}
        />
        <OptionChecklist
          label={dict.tickersLabel}
          options={data?.availableFilters.tickers ?? []}
          selected={state.tickers}
          onChange={(tickers) => replaceState({ ...state, tickers })}
        />
        <OptionChecklist
          label={dict.instrumentTypeLabel}
          options={data?.availableFilters.instrumentTypes ?? []}
          selected={state.instrumentTypes}
          onChange={(instrumentTypes) => replaceState({ ...state, instrumentTypes: instrumentTypes as AnalysisInstrumentType[] })}
        />
        <ControlGroup label={dict.currencyLabel}>
          <select
            aria-label={dict.currencyLabel}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={state.reportingCurrency}
            onChange={(event) => replaceState({ ...state, reportingCurrency: event.currentTarget.value as UnrealizedPnlAnalysisRouteState["reportingCurrency"] })}
          >
            {(data?.availableFilters.reportingCurrencies ?? [{ value: state.reportingCurrency, label: state.reportingCurrency }]).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </ControlGroup>
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm md:self-end">
          <input
            type="checkbox"
            checked={state.includeProvisional}
            onChange={(event) => replaceState({ ...state, includeProvisional: event.currentTarget.checked })}
          />
          {dict.provisionalLabel}
        </label>
      </section>

      <section className={cn("grid gap-3 md:grid-cols-4", isCurrencyStale && "opacity-45")} aria-busy={isCurrencyStale}>
        <div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="hidden w-full rounded-lg text-left md:block" data-testid="analysis-total-detail-trigger" type="button">
                <SummaryCard
                  actionIcon={<Info className="h-4 w-4" aria-hidden="true" />}
                  label={dict.summaryTotal}
                  value={data?.summary.totalUnrealized.value ?? null}
                  currency={data?.summary.totalUnrealized.currency ?? state.reportingCurrency}
                  locale={resolvedLocale}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-0">
              {totalCompositionContent}
            </PopoverContent>
          </Popover>
          <button className="w-full rounded-lg text-left md:hidden" data-testid="analysis-total-detail-trigger-mobile" type="button" onClick={() => setMobileTotalDetailOpen(true)}>
            <SummaryCard
              actionIcon={<Info className="h-4 w-4" aria-hidden="true" />}
              label={dict.summaryTotal}
              value={data?.summary.totalUnrealized.value ?? null}
              currency={data?.summary.totalUnrealized.currency ?? state.reportingCurrency}
              locale={resolvedLocale}
            />
          </button>
        </div>
        <SummaryCard label={dict.summaryChange} value={data?.summary.periodChange.value ?? null} currency={data?.summary.periodChange.currency ?? state.reportingCurrency} locale={resolvedLocale} />
        <DriverCard label={dict.summaryBest} text={data?.summary.bestDriver?.label ?? "-"} />
        <DriverCard label={dict.summaryHealth} text={data?.dataHealth.detail ?? (isBootstrapping ? dict.loadingBody : "-")} />
      </section>

      <Drawer
        open={mobileTotalDetailOpen}
        onOpenChange={setMobileTotalDetailOpen}
        title={dict.totalCompositionTitle}
        closeLabel={dict.closeTotalComposition}
        className="md:hidden"
      >
        {totalCompositionContent}
      </Drawer>

      <section className={cn(isCurrencyStale && "opacity-45")} aria-busy={isCurrencyStale}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{dict.decompositionTitle}</CardTitle>
            <CardDescription>
              {dict.decompositionDescription}
              {cacheStatus ? <span className="ml-2 text-xs uppercase text-muted-foreground">cache {cacheStatus}</span> : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
              <div className="min-w-0">
                <AnalysisSvgChart ariaLabel={dict.chartAriaLabel} dates={chartDates} focusDate={focusDate} locale={resolvedLocale} reducedMotion={reducedMotion} selectedSet={selectedSet} series={data?.tickerSeries ?? []} />
                <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="analysis-focus">{dict.focusLabel}</label>
                <input
                  data-testid="analysis-focus-scrub"
                  id="analysis-focus"
                  className="mt-2 w-full"
                  max={maxFocusIndex}
                  min={0}
                  type="range"
                  value={activeFocusIndex}
                  onChange={(event) => updateFocus(Number(event.currentTarget.value))}
                />
                <div className="mt-2 text-sm text-muted-foreground">
                  {focusDate ? formatDateLabel(focusDate, resolvedLocale) : dict.emptyBody}
                </div>
                {focusedSelectedValues.length > 0 ? (
                  <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-2" data-testid="analysis-focus-values">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">{dict.focusValuesLabel}</p>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {focusedSelectedValues.map((item) => (
                        <div key={item.displayName} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-0.5 text-xs">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.colorToken }} />
                            <span className="truncate">{item.displayName}</span>
                          </span>
                          <span className="max-w-[44vw] truncate text-right font-mono tabular-nums sm:max-w-none" title={formatNullableCurrency(item.value, responseCurrency, resolvedLocale)}>
                            {formatNullableCompactCurrency(item.value, responseCurrency, resolvedLocale)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-border/70 bg-muted/20 p-3" data-testid="analysis-ticker-selection">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{dict.rankingTitle}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{dict.rankingDescription}</p>
                </div>
                <div className="mt-3 grid max-h-[26rem] gap-2 overflow-y-auto pr-1">
                  {(data?.tickerSelection ?? []).map((row) => {
                    const isChecked = selectedSet.has(row.seriesId);
                    return (
                      <button
                        key={row.seriesId}
                        aria-checked={isChecked}
                        className={cn(
                          "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border bg-background p-2 text-left text-sm transition",
                          isChecked ? "border-primary/50" : "border-border/70 opacity-55",
                        )}
                        role="checkbox"
                        type="button"
                        onClick={() => toggleSeries(row.seriesId)}
                      >
                        <span className={cn("mt-0.5 grid h-5 w-5 place-items-center rounded border text-xs", isChecked ? "border-primary bg-primary text-primary-foreground" : "border-border")} aria-hidden="true">
                          {isChecked ? "✓" : ""}
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", row.isManual ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground")}>{row.isManual ? dict.manualBadge : row.rankLabel}</span>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.colorToken }} />
                            <span className="truncate font-medium text-foreground">{row.displayName}</span>
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">{row.ticker} {row.marketCode} · {positionLabel(row.positionStatus)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-border/70 pt-4" data-testid="analysis-selected-detail">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{dict.selectedDetailTitle}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{dict.selectedDetailDescription}</p>
                </div>
                <Segmented
                  labelFor={(option) => option === "ranking" ? dict.sortRanking : option === "name" ? dict.sortName : dict.sortEndPnl}
                  options={DETAIL_SORT_OPTIONS}
                  value={detailSort}
                  onChange={setDetailSort}
                />
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {detailRows.map((row) => {
                  const series = seriesById.get(row.seriesId);
                  const isChecked = selectedSet.has(row.seriesId);
                  const point = series ? (focusDate ? series.points.find((candidate) => candidate.date === focusDate) : series.points.at(-1)) : undefined;
                  const focusedMarkers = series?.markers.filter((marker) => marker.date === point?.date) ?? [];
                  const healthLabel = !point
                    ? dict.healthPending
                    : point.unrealizedPnl === null || point.marketValue === null || point.costBasis === null
                    ? dict.healthPartial
                    : dict.healthComplete;
                  return (
                    <div key={row.seriesId} className={cn("rounded-md border border-border p-3", !isChecked && "bg-muted/30 opacity-60")} data-testid={isChecked ? "analysis-detail-expanded" : "analysis-detail-collapsed"}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-center gap-2 font-medium">
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", row.isManual ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground")}>{row.isManual ? dict.manualBadge : row.rankLabel}</span>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.colorToken }} />
                            <span className="truncate">{row.displayName}</span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{row.ticker} {row.marketCode} · {positionLabel(row.positionStatus)}</p>
                        </div>
                        {!isChecked ? (
                          <button className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium" type="button" onClick={() => toggleSeries(row.seriesId)}>
                            {dict.showLine}
                          </button>
                        ) : null}
                      </div>
                      {isChecked ? (
                        <>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                            <DetailTerm label={focusDate ? dict.detailFocusedPnl : dict.detailEndPnl} value={formatNullableCurrency(point?.unrealizedPnl ?? null, series?.currency ?? responseCurrency, resolvedLocale)} />
                            <DetailTerm label={dict.detailQuantity} value={point ? formatNumber(point.quantity, resolvedLocale, 4) : "-"} />
                            <DetailTerm label={dict.detailMarketValue} value={formatNullableCurrency(point?.marketValue ?? null, series?.currency ?? responseCurrency, resolvedLocale)} />
                            <DetailTerm label={dict.detailCostBasis} value={formatNullableCurrency(point?.costBasis ?? null, series?.currency ?? responseCurrency, resolvedLocale)} />
                            <DetailTerm label={dict.detailClosePrice} value={point?.closePrice === null || point?.closePrice === undefined ? "-" : formatNumber(point.closePrice, resolvedLocale, 4)} />
                            <DetailTerm label={dict.detailState} value={healthLabel} />
                          </dl>
                          <p className="mt-3 text-xs text-muted-foreground">{point?.transactionContext ?? "-"}</p>
                          {focusedMarkers.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {focusedMarkers.map((marker) => (
                                <span key={`${marker.date}-${marker.type}-${marker.label}`} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                                  {marker.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function collectChartDates(series: UnrealizedPnlSeries[]): string[] {
  return [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
}

function TotalCompositionContent({
  composition,
  currency,
  dict,
  endDate,
  locale,
  totalValue,
}: {
  composition: UnrealizedPnlTickerCompositionRow[];
  currency: string;
  dict: AnalysisDict;
  endDate: string | null;
  locale: LocaleCode;
  totalValue: number | null;
}) {
  const hasUnavailableRows = composition.some((row) => row.endUnrealizedPnl === null);
  return (
    <div data-testid="analysis-total-composition">
      <div className="border-b border-border bg-muted/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">{dict.totalCompositionTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{dict.totalCompositionDescription}</p>
          </div>
          <div className="shrink-0 text-right text-xs font-medium text-muted-foreground">
            {endDate ? dict.totalCompositionAsOf.replace("{date}", endDate) : "-"}
          </div>
        </div>
        <div className="mt-3 text-lg font-semibold text-foreground">{formatNullableCurrency(totalValue, currency, locale)}</div>
      </div>
      {hasUnavailableRows ? (
        <div className="border-b border-amber-300/70 bg-amber-50 px-4 py-2 text-xs text-amber-900" data-testid="analysis-total-composition-warning">
          {dict.totalCompositionWarning}
        </div>
      ) : null}
      <div className="max-h-[22rem] overflow-y-auto p-2">
        {composition.length > 0 ? composition.map((row) => (
          <div key={row.seriesId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/70 px-2 py-2.5 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{row.displayName}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.ticker} {row.marketCode} · {formatPositionLabel(row.positionStatus, dict)}</div>
            </div>
            <div className="text-right">
              <div className={cn("font-mono text-sm font-semibold tabular-nums", row.endUnrealizedPnl === null ? "text-muted-foreground" : row.endUnrealizedPnl < 0 ? "text-red-600" : "text-emerald-700")}>
                {formatNullableCurrency(row.endUnrealizedPnl, currency, locale)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {row.contributionSharePercent === null ? "-" : `${formatNumber(row.contributionSharePercent, locale, 2)}%`}
              </div>
            </div>
          </div>
        )) : (
          <div className="px-2 py-6 text-sm text-muted-foreground">{dict.totalCompositionEmpty}</div>
        )}
      </div>
    </div>
  );
}

function formatPositionLabel(positionStatus: "open_position" | "closed_position", dict: AnalysisDict): string {
  return positionStatus === "open_position" ? dict.openPosition : dict.closedPosition;
}

function AnalysisSvgChart({
  ariaLabel,
  dates,
  focusDate,
  locale,
  reducedMotion,
  selectedSet,
  series,
}: {
  ariaLabel: string;
  dates: string[];
  focusDate: string | null;
  locale: LocaleCode;
  reducedMotion: boolean;
  selectedSet: ReadonlySet<string>;
  series: UnrealizedPnlSeries[];
}) {
  const values = series.flatMap((item) => item.points.map((point) => point.unrealizedPnl))
    .filter((value): value is number => value !== null);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const span = Math.max(1, max - min);
  const width = 920;
  const height = 280;
  const pad = 28;
  const xForDate = (date: string) => pad + (Math.max(0, dates.indexOf(date)) / Math.max(1, dates.length - 1)) * (width - pad * 2);
  const yForValue = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
  const focusX = focusDate ? xForDate(focusDate) : null;
  const focusPoints = focusDate
    ? series
      .filter((item) => selectedSet.has(item.seriesId))
      .map((item) => {
        const point = item.points.find((candidate) => candidate.date === focusDate);
        return point
          ? {
              colorToken: item.colorToken,
              displayName: item.displayName,
              value: point.unrealizedPnl,
              y: point.unrealizedPnl === null ? null : yForValue(point.unrealizedPnl),
            }
          : null;
      })
      .filter((item): item is { colorToken: string; displayName: string; value: number | null; y: number | null } => item !== null)
    : [];
  return (
    <div className="relative h-[300px] w-full overflow-hidden rounded-md border border-border bg-background">
      <div className="absolute left-2 top-2 z-10 grid max-h-[8.5rem] w-[calc(100%-1rem)] max-w-[24rem] grid-cols-1 gap-1 overflow-auto rounded-md border border-border/80 bg-background/95 p-2 text-[11px] shadow-sm sm:left-auto sm:right-2 sm:top-auto sm:bottom-2 sm:w-auto sm:max-w-[18rem]" data-testid="analysis-chart-legend">
        {series.map((item) => (
          <div key={item.seriesId} className={cn("flex min-w-0 items-start gap-1.5", !selectedSet.has(item.seriesId) && "opacity-50")}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.colorToken }} />
            <span className="min-w-0 break-words leading-tight">{item.displayName}</span>
          </div>
        ))}
      </div>
      <svg aria-label={ariaLabel} className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        <line stroke="hsl(var(--border))" x1={pad} x2={width - pad} y1={yForValue(0)} y2={yForValue(0)} />
        {series.map((item) => (
          <polyline
            key={item.seriesId}
            fill="none"
            points={item.points
              .flatMap((point) => point.unrealizedPnl === null ? [] : [`${xForDate(point.date)},${yForValue(point.unrealizedPnl)}`])
              .join(" ")}
            stroke={item.colorToken}
            strokeDasharray={item.state === "sold-out" ? "7 7" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={selectedSet.has(item.seriesId) ? 1 : 0.22}
            strokeWidth={selectedSet.has(item.seriesId) ? 4 : 2}
            style={reducedMotion ? undefined : { transition: "stroke-opacity 160ms ease, stroke-width 160ms ease" }}
          >
            <title>{`${item.displayName} ${formatNullableCurrency(item.endUnrealizedPnl, item.currency, locale)}`}</title>
          </polyline>
        ))}
        {focusDate && focusX !== null ? <line stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" x1={focusX} x2={focusX} y1={pad} y2={height - pad} /> : null}
        {focusX !== null ? focusPoints.map((point, index) => {
          const label = formatNullableCurrency(point.value, series[0]?.currency ?? "TWD", locale);
          const labelWidth = Math.min(150, Math.max(68, label.length * 7.2 + 16));
          const labelX = focusX > width - 190 ? focusX - labelWidth - 12 : focusX + 12;
          const labelY = point.y === null
            ? pad + 18 + index * 24
            : Math.max(pad + 12, Math.min(height - pad - 10, point.y - 8 + index * 4));
          return (
            <g key={`${point.displayName}-${index}`} className="hidden lg:block">
              {point.y !== null ? <circle cx={focusX} cy={point.y} fill={point.colorToken} r={5} stroke="white" strokeWidth={2} /> : null}
              <rect fill="hsl(var(--background))" height={20} opacity={0.92} rx={4} stroke={point.colorToken} strokeOpacity={0.45} width={labelWidth} x={labelX} y={labelY - 15} />
              <text fill="hsl(var(--foreground))" fontSize={12} fontWeight={600} x={labelX + 8} y={labelY}>
                {label}
              </text>
            </g>
          );
        }) : null}
      </svg>
    </div>
  );
}

function ControlGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string>({
  labelFor = (option) => option,
  onChange,
  options,
  value,
}: {
  labelFor?: (option: T) => string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option}
          className={cn("h-8 rounded-md border px-2 text-xs font-medium", option === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted")}
          type="button"
          onClick={() => onChange(option)}
        >
          {labelFor(option)}
        </button>
      ))}
    </div>
  );
}

function OptionChecklist({
  label,
  onChange,
  options,
  selected,
}: {
  label: string;
  onChange: (selected: string[]) => void;
  options: AnalysisFilterOption[];
  selected: string[];
}) {
  const selectedSet = new Set(selected);

  function toggle(value: string): void {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange([...next].sort((left, right) => left.localeCompare(right)));
  }

  return (
    <fieldset className="min-w-0 rounded-md border border-border bg-background/70 p-2">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-1">
        {options.length > 0 ? options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex h-7 max-w-full items-center gap-1 rounded border px-2 text-xs",
              selectedSet.has(option.value) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            <input
              checked={selectedSet.has(option.value)}
              className="sr-only"
              type="checkbox"
              onChange={() => toggle(option.value)}
            />
            <span className="truncate">{option.label}</span>
            {typeof option.count === "number" ? <span className="opacity-70">{option.count}</span> : null}
          </label>
        )) : <span className="text-xs text-muted-foreground">-</span>}
      </div>
    </fieldset>
  );
}

function formatNullableCurrency(value: number | null, currency: string, locale: LocaleCode): string {
  return value === null ? "-" : formatCurrencyAmount(value, currency as never, locale);
}

function formatNullableCompactCurrency(value: number | null, currency: string, locale: LocaleCode): string {
  return value === null ? "-" : formatCompactCurrencyAmount(value, currency as never, locale);
}

function SummaryCard({
  actionIcon,
  currency,
  label,
  locale,
  value,
}: {
  actionIcon?: ReactNode;
  currency: string;
  label: string;
  locale: LocaleCode;
  value: number | null;
}) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          {actionIcon ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary">{actionIcon}</span> : null}
        </div>
        <p className={cn("mt-2 text-xl font-semibold", value !== null && value < 0 ? "text-red-600" : "text-foreground")}>
          {value === null ? "-" : formatCurrencyAmount(value, currency as never, locale)}
        </p>
      </CardContent>
    </Card>
  );
}

function DriverCard({ label, text }: { label: string; text: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-sm font-medium text-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function DetailTerm({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-md border border-border bg-muted/50" />
      ))}
      <div className="h-80 animate-pulse rounded-md border border-border bg-muted/50 md:col-span-3" />
      <div className="h-80 animate-pulse rounded-md border border-border bg-muted/50" />
    </div>
  );
}
