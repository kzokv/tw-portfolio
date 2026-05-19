"use client";

import { useEffect, useMemo, useState } from "react";
import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { Lock, RefreshCw, Search, Settings2, Wrench, X } from "lucide-react";
import { RepairModal, type RepairModalValue } from "./RepairModal";
import type { RepairTargetRequest } from "../services/repairService";
import { getCooldownRemainingMinutes } from "../utils/cooldown";

interface RepairCapableItem {
  ticker: string;
  // KZO-169 (D7a): render `TICKER · MARKET` on every row so the user can
  // disambiguate the same ticker on multiple markets (e.g. BHP·AU + BHP·US).
  marketCode?: string | null;
  barsBackfillStatus: string | null;
  lastRepairAt?: string | null;
  repairAvailableAt?: string | null;
  name?: string | null;
  source?: "manual" | "position";
}

interface PerTickerRepairDraft extends RepairModalValue {
  key: string;
  ticker: string;
  marketCode: string;
}

interface MonitoredTickersSectionProps {
  monitoredTickers: MonitoredTickerDto[];
  instruments: InstrumentCatalogItemDto[];
  // Selection keys are `${ticker}|${marketCode}`.
  selectedTickers: Set<string>;
  onToggleTicker: (key: string) => void;
  onBrowseCatalog: () => void;
  onRetryBackfill: (key: string) => void;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string;
  saveSuccess: string;
  onSave: () => void;
  isLoading: boolean;
  repairMode: boolean;
  onRepairModeChange: (enabled: boolean) => void;
  repairSelection: Set<string>;
  onToggleRepairSelection: (key: string) => void;
  onClearRepairSelection: () => void;
  onSubmitRepairRequests: (requests: RepairTargetRequest[]) => Promise<void>;
  isRepairSubmitting: boolean;
  repairMessage: string;
  repairError: string;
  dict: AppDictionary;
}

function buildCooldownLabel(dict: AppDictionary, minutes: number): string {
  return dict.settings.repairModeUnavailableCooldown.replace("{minutes}", String(minutes));
}

function monitoredTickerKey(item: { ticker: string; marketCode?: string | null }): string {
  return `${item.ticker}|${item.marketCode ?? "TW"}`;
}

function parseMonitoredTickerKey(key: string): { ticker: string; marketCode: string } {
  const [ticker = "", marketCode = "TW"] = key.split("|");
  return { ticker, marketCode };
}

function formatTickerKeyLabel(key: string): string {
  const { ticker, marketCode } = parseMonitoredTickerKey(key);
  return `${ticker} · ${marketCode}`;
}

function groupRepairRequests(drafts: PerTickerRepairDraft[]): RepairTargetRequest[] {
  const groups = new Map<string, RepairTargetRequest>();
  for (const draft of drafts) {
    const key = `${draft.startDate}|${draft.endDate}|${String(draft.includeBars)}|${String(draft.includeDividends)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.tickers.push(draft.ticker);
    } else {
      groups.set(key, {
        tickers: [draft.ticker],
        startDate: draft.startDate || undefined,
        endDate: draft.endDate || undefined,
        includeBars: draft.includeBars,
        includeDividends: draft.includeDividends,
      });
    }
  }
  return [...groups.values()];
}

export function MonitoredTickersSection({
  monitoredTickers,
  instruments,
  selectedTickers,
  onToggleTicker,
  onBrowseCatalog,
  onRetryBackfill,
  isDirty,
  isSaving,
  saveError,
  saveSuccess,
  onSave,
  isLoading,
  repairMode,
  onRepairModeChange,
  repairSelection,
  onToggleRepairSelection,
  onClearRepairSelection,
  onSubmitRepairRequests,
  isRepairSubmitting,
  repairMessage,
  repairError,
  dict,
}: MonitoredTickersSectionProps) {
  const [search, setSearch] = useState("");
  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const [repairApplyMode, setRepairApplyMode] = useState<"all" | "per-ticker">("all");
  const [selectionError, setSelectionError] = useState("");
  const [repairDefaults, setRepairDefaults] = useState<RepairModalValue>({
    startDate: "",
    endDate: "",
    includeBars: true,
    includeDividends: true,
  });

  const positionTickers = useMemo(() => monitoredTickers.filter((s) => s.source === "position"), [monitoredTickers]);

  const instrumentMap = useMemo(() => new Map(instruments.map((item) => [monitoredTickerKey(item), item])), [instruments]);

  const manualTickers = useMemo(() => {
    return [...selectedTickers]
      .map((key) => {
        const { ticker, marketCode } = parseMonitoredTickerKey(key);
        const instrument = instrumentMap.get(key);
        return {
          ticker,
          key,
          // KZO-169 (D7a): include marketCode so the row can render
          // `TICKER · MARKET` for cross-market disambiguation.
          marketCode: instrument?.marketCode ?? marketCode,
          name: instrument?.name ?? null,
          instrumentType: instrument?.instrumentType ?? null,
          barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
          lastRepairAt: instrument?.lastRepairAt ?? null,
          repairAvailableAt: instrument?.repairAvailableAt ?? null,
        };
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [selectedTickers, instrumentMap]);

  const repairCandidates = useMemo(() => {
    const byKey = new Map<string, RepairCapableItem>();
    const positionKeys = new Set(positionTickers.map(monitoredTickerKey));
    for (const item of instruments as RepairCapableItem[]) {
      const key = monitoredTickerKey(item);
      if (selectedTickers.has(key) || positionKeys.has(key)) {
        byKey.set(key, {
          ...item,
          source: positionKeys.has(key) ? "position" : "manual",
        });
      }
    }

    for (const positionTicker of positionTickers) {
      const key = monitoredTickerKey(positionTicker);
      if (!byKey.has(key)) {
        byKey.set(key, {
          ticker: positionTicker.ticker,
          marketCode: positionTicker.marketCode,
          name: positionTicker.name,
          barsBackfillStatus: positionTicker.barsBackfillStatus ?? null,
          source: "position",
          lastRepairAt: (positionTicker as RepairCapableItem).lastRepairAt ?? null,
          repairAvailableAt: (positionTicker as RepairCapableItem).repairAvailableAt ?? null,
        });
      }
    }

    return [...byKey.values()].sort((a, b) => monitoredTickerKey(a).localeCompare(monitoredTickerKey(b)));
  }, [instruments, positionTickers, selectedTickers]);

  const filteredManual = useMemo(() => {
    if (!search) return manualTickers;
    const q = search.toLowerCase();
    return manualTickers.filter((s) => s.ticker.toLowerCase().includes(q) || (s.name?.toLowerCase().includes(q) ?? false));
  }, [manualTickers, search]);

  const filteredRepairCandidates = useMemo(() => {
    if (!search) return repairCandidates;
    const q = search.toLowerCase();
    return repairCandidates.filter((s) => s.ticker.toLowerCase().includes(q) || (s.name?.toLowerCase().includes(q) ?? false));
  }, [repairCandidates, search]);

  const selectedRepairKeys = useMemo(() => [...repairSelection].sort((a, b) => a.localeCompare(b)), [repairSelection]);

  const [perTickerValues, setPerTickerValues] = useState<PerTickerRepairDraft[]>([]);

  useEffect(() => {
    setPerTickerValues((prev) => {
      const existing = new Map(prev.map((item) => [item.key, item]));
      return selectedRepairKeys.map((key) => {
        const { ticker, marketCode } = parseMonitoredTickerKey(key);
        return existing.get(key) ?? {
          key,
          ticker,
          marketCode,
          startDate: repairDefaults.startDate,
          endDate: repairDefaults.endDate,
          includeBars: repairDefaults.includeBars,
          includeDividends: repairDefaults.includeDividends,
        };
      });
    });
  }, [selectedRepairKeys]);

  const selectedCountLabel = `${selectedRepairKeys.length} ${dict.settings.repairModeSelectedCount}`;

  function handleToggleRepairTicker(item: RepairCapableItem): void {
    const key = monitoredTickerKey(item);
    const isSelected = repairSelection.has(key);
    const isBackfilling = item.barsBackfillStatus === "pending" || item.barsBackfillStatus === "backfilling";
    const remaining = getCooldownRemainingMinutes(item.repairAvailableAt);
    if (!isSelected && (isBackfilling || remaining > 0)) return;

    if (!isSelected && repairSelection.size >= 20) {
      setSelectionError(dict.settings.repairModeSelectionLimit);
      return;
    }

    setSelectionError("");
    onToggleRepairSelection(key);
  }

  function resetRepairFlow(): void {
    setRepairModalOpen(false);
    setRepairApplyMode("all");
    setSelectionError("");
    onClearRepairSelection();
    onRepairModeChange(false);
  }

  async function submitRepair(): Promise<void> {
    const requests =
          repairApplyMode === "all"
        ? [
            {
              tickers: selectedRepairKeys.map((key) => parseMonitoredTickerKey(key).ticker),
              startDate: repairDefaults.startDate || undefined,
              endDate: repairDefaults.endDate || undefined,
              includeBars: repairDefaults.includeBars,
              includeDividends: repairDefaults.includeDividends,
            },
          ]
        : groupRepairRequests(perTickerValues);

    await onSubmitRepairRequests(requests);
    setRepairModalOpen(false);
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-4" data-testid="monitored-tickers-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{dict.settings.tickersSectionTitle}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {repairMode ? dict.settings.repairModeDescription : dict.settings.tickersSectionDescription}
          </p>
        </div>
        <Button
          type="button"
          variant={repairMode ? "default" : "secondary"}
          size="sm"
          className={repairMode ? "gap-1.5" : "gap-1.5 border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"}
          onClick={() => {
            if (repairMode) {
              resetRepairFlow();
            } else {
              onRepairModeChange(true);
            }
          }}
          data-testid="repair-mode-toggle-btn"
        >
          <Wrench className="h-3.5 w-3.5" />
          {repairMode ? dict.settings.repairModeExit : dict.settings.repairModeEnter}
        </Button>
      </div>

      {positionTickers.length > 0 && !repairMode && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{dict.settings.tickersAutoIncludedTitle}</h4>
          <p className="text-xs text-muted-foreground">{dict.settings.tickersAutoIncludedDescription}</p>
          <div className="space-y-1">
            {positionTickers.map((s) => (
              <div
                // KZO-169: monitored-tickers list keyed by (ticker, marketCode)
                // so the same ticker on different markets is unique.
                key={`${s.ticker}|${s.marketCode}`}
                className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm"
                data-testid={`position-ticker-${s.ticker}`}
              >
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono font-medium text-foreground">
                  {s.ticker} · {s.marketCode}
                </span>
                {s.name && <span className="text-muted-foreground">— {s.name}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{dict.settings.tickersPositionLocked}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground">
            {repairMode ? dict.settings.repairModeTitle : dict.settings.tickersYourSelectionsTitle}
          </h4>
          {repairMode ? <span className="text-xs text-muted-foreground">{selectedCountLabel}</span> : null}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-[1.375rem] top-3.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={dict.settings.tickersSearchPlaceholder}
            className={`${fieldClassName} !pl-12`}
            data-testid="tickers-search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-3.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!repairMode ? (
          filteredManual.length === 0 && !search ? (
            <p className="py-3 text-center text-xs text-muted-foreground">{dict.settings.tickersYourSelectionsEmpty}</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {filteredManual.map((s) => (
                <label
                  key={s.key}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted/50"
                  data-testid={`manual-ticker-${s.ticker}`}
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onToggleTicker(s.key)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="font-mono font-medium text-foreground">
                    {s.ticker} · {s.marketCode}
                  </span>
                  {s.name && <span className="text-muted-foreground">— {s.name}</span>}
                  {s.barsBackfillStatus && (
                    <span className="ml-auto flex items-center gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          s.barsBackfillStatus === "ready"
                            ? "bg-green-50 text-green-700"
                            : s.barsBackfillStatus === "failed"
                              ? "bg-red-50 text-red-700"
                              : s.barsBackfillStatus === "backfilling"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                        }`}
                        data-testid={`backfill-badge-${s.ticker}`}
                      >
                        {s.barsBackfillStatus}
                      </span>
                      {s.barsBackfillStatus === "failed" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRetryBackfill(s.key);
                          }}
                          className="rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                          title="Retry backfill"
                          data-testid={`retry-backfill-${s.ticker}`}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-warning/30 bg-warning/10 p-2">
            {filteredRepairCandidates.map((item) => {
              const remaining = getCooldownRemainingMinutes(item.repairAvailableAt);
              const disabledReason =
                item.barsBackfillStatus === "pending" || item.barsBackfillStatus === "backfilling"
                  ? dict.settings.repairModeUnavailableBackfill
                  : remaining > 0
                    ? buildCooldownLabel(dict, remaining)
                    : "";
              const key = monitoredTickerKey(item);
              const selected = repairSelection.has(key);
              const disabled = !selected && disabledReason.length > 0;

              return (
                <label
                  // KZO-169: repair candidate list also keyed by
                  // (ticker, marketCode).
                  key={key}
                  data-testid={`repair-row-${item.ticker}`}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    disabled ? "cursor-not-allowed bg-muted/70 text-muted-foreground" : "cursor-pointer hover:bg-warning/20"
                  }`}
                  title={disabledReason || undefined}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => handleToggleRepairTicker(item)}
                    className={`h-4 w-4 rounded border-input ${repairMode ? "accent-warning" : ""}`}
                    data-testid={`repair-selection-${item.ticker}`}
                  />
                  <span className="font-mono font-medium">
                    {item.ticker} · {item.marketCode ?? "TW"}
                  </span>
                  {item.name ? <span className="truncate text-muted-foreground">— {item.name}</span> : null}
                  <span className="ml-auto text-[10px] text-muted-foreground" data-testid={`repair-cooldown-hint-${item.ticker}`}>
                    {disabledReason}
                  </span>
                </label>
              );
            })}
            {filteredRepairCandidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{dict.settings.tickersYourSelectionsEmpty}</p>
            ) : null}
          </div>
        )}
      </div>

      {!repairMode ? (
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onBrowseCatalog} data-testid="browse-catalog-btn">
            {dict.settings.tickersBrowseCatalog}
          </Button>

          <div className="flex items-center gap-3 border-t border-border pt-3">
            <Button type="button" size="sm" disabled={!isDirty || isSaving} onClick={onSave} data-testid="tickers-save-btn">
              {isSaving ? dict.settings.tickersSaving : dict.settings.tickersSaveSelections}
            </Button>
            {saveSuccess && <span className="text-xs text-green-600">{dict.settings.tickersSaved}</span>}
            {saveError && <span className="text-xs text-red-600">{dict.settings.tickersSaveError}</span>}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-end gap-2 border-t border-warning/30 pt-3">
          {selectionError ? <span className="mr-auto text-xs text-rose-600">{selectionError}</span> : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={resetRepairFlow}
            className="gap-1.5"
            data-testid="repair-cancel-btn"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {dict.settings.repairModeExit}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={repairSelection.size === 0}
            onClick={() => setRepairModalOpen(true)}
            data-testid="repair-continue-btn"
          >
            {dict.settings.repairModeContinue}
          </Button>
        </div>
      )}

      {repairMessage === "queued" ? <p className="text-xs text-green-600">{dict.settings.repairRequestSuccess}</p> : null}
      {repairMessage === "partial" ? <p className="text-xs text-amber-600">{dict.settings.repairRequestPartial}</p> : null}
      {repairError ? <p className="text-xs text-rose-600">{repairError || dict.settings.repairRequestError}</p> : null}

      <RepairModal
        open={repairModalOpen}
        pending={isRepairSubmitting}
        title={dict.settings.repairModeTitle}
        subtitle={`${selectedRepairKeys.map(formatTickerKeyLabel).join(", ") || "-"}`}
        value={repairDefaults}
        onOpenChange={setRepairModalOpen}
        onChange={setRepairDefaults}
        onSubmit={submitRepair}
        dict={dict}
      >
        <div className="rounded-xl border border-border bg-muted/50 p-3">
          <div className="mb-2 inline-flex gap-1 rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setRepairApplyMode("all")}
              className={`rounded px-2.5 py-1 text-xs ${repairApplyMode === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              data-testid="repair-apply-all"
            >
              {dict.settings.repairApplyAllMode}
            </button>
            <button
              type="button"
              onClick={() => setRepairApplyMode("per-ticker")}
              className={`rounded px-2.5 py-1 text-xs ${repairApplyMode === "per-ticker" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              data-testid="repair-per-ticker"
            >
              {dict.settings.repairPerTickerMode}
            </button>
          </div>

          {repairApplyMode === "per-ticker" ? (
            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {perTickerValues.map((row, index) => (
                <div key={row.key} className="rounded-lg border border-border bg-background p-2">
                  <p className="mb-1 text-xs font-semibold text-foreground">{row.ticker} · {row.marketCode}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="date"
                      value={row.startDate}
                      onChange={(event) =>
                        setPerTickerValues((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, startDate: event.target.value } : item)),
                        )
                      }
                      className="h-9 rounded-lg border border-border px-2 text-xs"
                    />
                    <input
                      type="date"
                      value={row.endDate}
                      onChange={(event) =>
                        setPerTickerValues((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, endDate: event.target.value } : item)),
                        )
                      }
                      className="h-9 rounded-lg border border-border px-2 text-xs"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={row.includeBars}
                        onChange={(event) =>
                          setPerTickerValues((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, includeBars: event.target.checked } : item)),
                          )
                        }
                      />
                      <span>{dict.settings.repairIncludeBars}</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={row.includeDividends}
                        onChange={(event) =>
                          setPerTickerValues((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, includeDividends: event.target.checked } : item)),
                          )
                        }
                      />
                      <span>{dict.settings.repairIncludeDividends}</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </RepairModal>
    </div>
  );
}
