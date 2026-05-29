"use client";

import { useEffect, useMemo, useState, type UIEvent } from "react";
import {
  type InstrumentCatalogItemDto,
  type MarketCode,
  gicsSectors,
  gicsIndustryGroups,
  industryGroupsForSector,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { useDebouncedValue } from "../../../lib/hooks/useDebouncedValue";
import {
  searchInstruments,
  SearchUnavailableError,
} from "../services/instrumentSearchService";
import { ArrowLeft, Lock, Search, X } from "lucide-react";

type TypeFilter = "ALL" | "STOCK" | "ETF" | "BOND_ETF";
type MarketChip = "ALL" | MarketCode;
// KZO-196 — `null` = "All sectors". Visible only for single-market chips
// that support sector browsing (TW/US/AU). Carries the canonical sector name
// (e.g. "Financials") so it feeds both AU's GICS expansion and TW/US's
// normalized `instrument.sector` equality match.
type SectorFilter = string | null;

// KZO-196 — Inverse lookup `industryGroup → displayKey`, built once per
// module load. Used for rendering the per-row industry-group label via
// `dict.settings.gicsIndustryGroups[displayKey]`.
const INDUSTRY_GROUP_DISPLAY_KEY: ReadonlyMap<string, string> = new Map(
  gicsIndustryGroups.map((g) => [g.industryGroup, g.displayKey] as const),
);

const MARKET_CHIPS_WITH_SECTOR_FILTER = new Set<MarketChip>(["TW", "US", "AU"]);

interface InstrumentCatalogSheetProps {
  instruments: InstrumentCatalogItemDto[];
  // Selection keys are `${ticker}|${marketCode}` so duplicate symbols across
  // markets remain independently selectable.
  selectedTickers: Set<string>;
  positionTickers: Set<string>;
  // KZO-188: optional `liveItem` is the synthetic catalog row for un-catalogued
  // AU tickers picked via live search; passed through to `useMonitoredTickers`
  // so it can append the synthetic to local state for backfill enrichment.
  onToggleTicker: (key: string, liveItem?: InstrumentCatalogItemDto) => void;
  onBack: () => void;
  dict: AppDictionary;
}

function instrumentKey(instrument: Pick<InstrumentCatalogItemDto, "ticker" | "marketCode">): string {
  return `${instrument.ticker}|${instrument.marketCode}`;
}

function getInstrumentSector(instrument: InstrumentCatalogItemDto): string | null {
  return instrument.sector;
}

function supportsSectorFilter(marketChip: MarketChip): marketChip is Exclude<MarketChip, "ALL"> {
  return MARKET_CHIPS_WITH_SECTOR_FILTER.has(marketChip);
}

export function InstrumentCatalogSheet({
  instruments,
  selectedTickers,
  positionTickers,
  onToggleTicker,
  onBack,
  dict,
}: InstrumentCatalogSheetProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  // KZO-188: market chip filters the catalog client-side; default `ALL`
  // shows every market just like before this ticket.
  const [marketChip, setMarketChip] = useState<MarketChip>("ALL");
  // KZO-196: shared sector filter for TW/US/AU. `null` = "All sectors".
  // Resets whenever the user moves back to ALL because the control is hidden
  // there and should never leave behind an invisible narrow.
  const [sectorFilter, setSectorFilter] = useState<SectorFilter>(null);

  // KZO-188: live-search state (only fires when chip === "AU" AND filtered
  // catalog count is 0). The state is cleared whenever the chip moves off
  // AU or the search box clears.
  const [liveResults, setLiveResults] = useState<InstrumentCatalogItemDto[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<SearchUnavailableError | null>(null);

  // Incremental rendering window — render the first 100 items and grow as the
  // user scrolls within 200px of the bottom. Resets whenever the filtered list
  // changes (e.g. search/market/type filter changes).
  const [visibleCount, setVisibleCount] = useState(100);

  const debouncedQuery = useDebouncedValue(search, 300);

  const filtered = useMemo(() => {
    let results = instruments;
    if (marketChip !== "ALL") {
      results = results.filter((i) => i.marketCode === marketChip);
    }
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (i) => i.ticker.toLowerCase().includes(q) || (i.name?.toLowerCase().includes(q) ?? false),
      );
    }
    if (typeFilter !== "ALL") {
      results = results.filter((i) => i.instrumentType === typeFilter);
    }
    // Search bypass — when the user has typed a query, the sector narrow is
    // skipped so a search hit for a ticker outside the active sector still
    // renders.
    if (supportsSectorFilter(marketChip) && sectorFilter !== null && !search) {
      if (marketChip === "AU") {
        const allowed = new Set(industryGroupsForSector(sectorFilter));
        results = results.filter(
          (i) => i.gicsIndustryGroup != null && allowed.has(i.gicsIndustryGroup),
        );
      } else {
        results = results.filter((i) => getInstrumentSector(i) === sectorFilter);
      }
    }
    return results;
  }, [instruments, marketChip, search, typeFilter, sectorFilter]);

  // Live results pass through the SAME type filter as catalog rows; rows
  // hidden by the filter are dropped silently.
  const filteredLiveResults = useMemo(() => {
    if (typeFilter === "ALL") return liveResults;
    return liveResults.filter((i) => i.instrumentType === typeFilter);
  }, [liveResults, typeFilter]);

  // Reset the incremental-render window whenever the filtered list changes.
  // Filter/market/search transitions should always start at the top with the
  // initial 100 rows visible.
  useEffect(() => {
    setVisibleCount(100);
  }, [filtered, filteredLiveResults]);

  // Clear the sector filter whenever the user navigates to ALL. The control
  // is hidden there, so keeping an active narrow would be invisible state.
  useEffect(() => {
    if (marketChip === "ALL" && sectorFilter !== null) {
      setSectorFilter(null);
    }
  }, [marketChip, sectorFilter]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      setVisibleCount((prev) => {
        // Growth window covers BOTH lists (catalog + live results) — slice each
        // independently below using min(visibleCount, list.length).
        const cap = Math.max(filtered.length, filteredLiveResults.length);
        if (prev >= cap) return prev;
        return Math.min(prev + 100, cap);
      });
    }
  };

  const visibleFiltered = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const visibleLiveResults = useMemo(
    () => filteredLiveResults.slice(0, visibleCount),
    [filteredLiveResults, visibleCount],
  );

  const liveSearchEnabled =
    debouncedQuery.length >= 2 && marketChip === "AU" && filtered.length === 0;

  useEffect(() => {
    // Reset live state when conditions stop matching so a stale message does
    // not linger after the user clears the query or switches markets.
    if (!liveSearchEnabled) {
      setLiveResults([]);
      setLiveLoading(false);
      setLiveError(null);
      return;
    }

    const controller = new AbortController();
    setLiveLoading(true);
    setLiveError(null);

    void (async () => {
      try {
        const found = await searchInstruments(debouncedQuery, "AU", controller.signal);
        if (controller.signal.aborted) return;
        setLiveResults(found);
        setLiveLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof SearchUnavailableError) {
          setLiveError(err);
          setLiveResults([]);
          setLiveLoading(false);
          return;
        }
        // Treat unexpected errors as the same degraded state — the user-facing
        // message intentionally collapses 3 backend codes (429, 503-rate,
        // 503-degraded) into one signal.
        setLiveError(new SearchUnavailableError(0, undefined));
        setLiveResults([]);
        setLiveLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, liveSearchEnabled]);

  const filters: { value: TypeFilter; label: string }[] = [
    { value: "ALL", label: dict.settings.tickersFilterAll },
    { value: "STOCK", label: dict.settings.tickersFilterStock },
    { value: "ETF", label: dict.settings.tickersFilterEtf },
    { value: "BOND_ETF", label: dict.settings.tickersFilterBondEtf },
  ];

  const marketChips: { value: MarketChip; label: string }[] = [
    { value: "ALL", label: dict.settings.tickersMarketChipAll },
    { value: "TW", label: dict.settings.tickersMarketChipTw },
    { value: "US", label: dict.settings.tickersMarketChipUs },
    { value: "AU", label: dict.settings.tickersMarketChipAu },
  ];

  const showLiveResults = liveSearchEnabled && filteredLiveResults.length > 0;
  const showLiveLoading = liveSearchEnabled && liveLoading;
  const showLiveUnavailable = liveSearchEnabled && liveError !== null;
  const showEmptyState =
    filtered.length === 0 && !showLiveResults && !showLiveLoading && !showLiveUnavailable;
  // Only render the count line when catalog has matches (per scope-todo Phase 2).
  const showCountLine = filtered.length > 0;

  return (
    <div className="flex h-full flex-col" data-testid="instrument-catalog-sheet">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          data-testid="catalog-back-btn"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-sm font-semibold text-slate-800">{dict.settings.tickersCatalogTitle}</h3>
      </div>

      {/* KZO-188 — Market chip group (above type-filter chips) */}
      <div className="pt-3">
        <div className="inline-flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {marketChips.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setMarketChip(c.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                marketChip === c.value
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`catalog-market-chip-${c.value.toLowerCase()}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-[1.375rem] top-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={dict.settings.tickersSearchPlaceholder}
            className={`${fieldClassName} !pl-12`}
            data-testid="catalog-search"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="inline-flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                typeFilter === f.value
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              data-testid={`catalog-filter-${f.value.toLowerCase()}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* KZO-196 — sector dropdown for single-market chips only. Hidden for
          ALL so mixed-market browsing does not imply a cross-market sector
          taxonomy. */}
      {supportsSectorFilter(marketChip) && (
        <div className="pb-3">
          <label
            htmlFor="catalog-sector-filter"
            className="mb-1 block text-xs font-medium text-slate-500"
          >
            {dict.settings.tickersFilterBySector}
          </label>
          <select
            id="catalog-sector-filter"
            value={sectorFilter ?? ""}
            onChange={(e) => setSectorFilter(e.target.value === "" ? null : e.target.value)}
            data-testid="catalog-sector-filter"
            className={fieldClassName}
          >
            <option value="" data-testid="catalog-sector-option-all">
              {dict.settings.tickersAllSectors}
            </option>
            {gicsSectors.map((sector) => {
              // The option value is the canonical sector NAME because
              // `industryGroupsForSector(...)` from shared-types keys on the
              // English name, not the displayKey. The label is i18n-resolved.
              // Architect's locked testid: `catalog-sector-option-{key}` where
              // {key} is the lowercased sector key — derived by stripping the
              // `gics_sector_` prefix from `displayKey`.
              const optionKey = sector.displayKey.replace(/^gics_sector_/, "");
              return (
                <option
                  key={sector.displayKey}
                  value={sector.sector}
                  data-testid={`catalog-sector-option-${optionKey}`}
                >
                  {dict.gics.sectors[sector.displayKey] ?? sector.sector}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Results count — only when catalog rows are visible */}
      {showCountLine && (
        <p className="mb-2 text-xs text-slate-400">
          {dict.settings.tickersCatalogCount.replace("{count}", String(filtered.length))}
        </p>
      )}

      {/* Instrument list */}
      <div
        className="flex-1 overflow-y-auto"
        data-testid="catalog-list"
        onScroll={handleScroll}
      >
        {filtered.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {visibleFiltered.map((instrument) => {
              const key = instrumentKey(instrument);
              const isPosition = positionTickers.has(key);
              const isSelected = selectedTickers.has(key);
              const isChecked = isPosition || isSelected;

              return (
                <label
                  // KZO-169: catalog rows keyed by (ticker, marketCode) so
                  // the same ticker on multiple markets is unambiguous.
                  key={`${instrument.ticker}|${instrument.marketCode}`}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-slate-50 ${
                    isPosition ? "cursor-default opacity-80" : ""
                  }`}
                  data-testid={`catalog-item-${instrument.ticker}`}
                >
                  {isPosition ? (
                    <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleTicker(key)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {instrument.ticker} · {instrument.marketCode}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {instrument.name ?? "—"}
                      </span>
                    </div>
                    {instrument.marketCode === "AU" &&
                      instrument.gicsIndustryGroup != null &&
                      (() => {
                        const displayKey = INDUSTRY_GROUP_DISPLAY_KEY.get(
                          instrument.gicsIndustryGroup,
                        );
                        const label = displayKey
                          ? dict.gics.industryGroups[displayKey] ??
                            dict.settings.tickersGicsOtherBucket
                          : dict.settings.tickersGicsOtherBucket;
                        return (
                          <p
                            className="mt-0.5 truncate text-[11px] text-slate-400"
                            data-testid={`catalog-row-industry-group-${instrument.ticker}`}
                          >
                            {label}
                          </p>
                        );
                      })()}
                    {(instrument.marketCode === "TW" || instrument.marketCode === "US") &&
                      getInstrumentSector(instrument) != null &&
                      (() => {
                        const sector = getInstrumentSector(instrument)!;
                        const sectorEntry = gicsSectors.find((entry) => entry.sector === sector);
                        const label = sectorEntry
                          ? dict.gics.sectors[sectorEntry.displayKey] ?? sector
                          : sector;
                        return (
                          <p
                            className="mt-0.5 truncate text-[11px] text-slate-400"
                            data-testid={`catalog-row-sector-${instrument.ticker}`}
                          >
                            {label}
                          </p>
                        );
                      })()}
                  </div>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {instrument.instrumentType}
                  </span>
                  {isPosition && (
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {dict.settings.tickersPositionLocked}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        ) : null}

        {/* KZO-188 — live results (only when catalog returns 0 AND chip === AU) */}
        {showLiveResults && (
          <div className="divide-y divide-slate-100" data-testid="catalog-live-list">
            {visibleLiveResults.map((instrument) => {
              // Live results may not have a stable `marketCode` from the
              // backend if the route ever expands beyond AU; for the AU-only
              // gate today we always stamp "AU" (the route always returns it).
              const enriched: InstrumentCatalogItemDto = {
                ...instrument,
                marketCode: instrument.marketCode || "AU",
                // The backend route always responds with `barsBackfillStatus:
                // "pending"` — make explicit just in case the upstream shape
                // ever ships a null in this field.
                barsBackfillStatus: instrument.barsBackfillStatus || "pending",
              };
              const key = instrumentKey(enriched);
              const isPosition = positionTickers.has(key);
              const isSelected = selectedTickers.has(key);
              const isChecked = isPosition || isSelected;

              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-slate-50"
                  data-testid={`catalog-item-${enriched.ticker}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleTicker(key, enriched)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {enriched.ticker} · {enriched.marketCode}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {enriched.name ?? "—"}
                      </span>
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                    data-testid={`catalog-live-badge-${enriched.ticker}`}
                  >
                    {dict.settings.tickersSearchLiveBadge}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {enriched.instrumentType ?? "—"}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {/* KZO-188 — loading and degraded-state messages */}
        {showLiveLoading && (
          <p
            className="py-8 text-center text-sm text-slate-400"
            data-testid="catalog-live-loading"
          >
            {dict.settings.tickersSearchLiveSearching}
          </p>
        )}

        {showLiveUnavailable && (
          <p
            className="py-8 text-center text-sm text-amber-600"
            data-testid="catalog-live-unavailable"
          >
            {dict.settings.tickersSearchLiveUnavailable}
          </p>
        )}

        {showEmptyState && (
          <p
            className="py-8 text-center text-sm text-slate-400"
            data-testid="catalog-empty-state"
          >
            {dict.settings.tickersSearchEmptyState}
          </p>
        )}

        {/* Incremental rendering hint — visible only when more rows remain. */}
        {(filtered.length > visibleCount ||
          (showLiveResults && filteredLiveResults.length > visibleCount)) && (
          <p
            className="py-3 text-center text-xs text-slate-400"
            data-testid="catalog-showing-of"
          >
            {dict.settings.tickersCatalogShowingOf
              .replace(
                "{showing}",
                String(
                  Math.min(
                    visibleCount,
                    showLiveResults ? filteredLiveResults.length : filtered.length,
                  ),
                ),
              )
              .replace(
                "{total}",
                String(showLiveResults ? filteredLiveResults.length : filtered.length),
              )}
          </p>
        )}
      </div>
    </div>
  );
}
