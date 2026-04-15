"use client";

import { useEffect, useMemo, useState } from "react";
import type { InstrumentCatalogItemDto, MonitoredTickerDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { Lock, RefreshCw, Search, Settings2, Wrench, X } from "lucide-react";
import { RepairModal, type RepairModalValue } from "./RepairModal";
import type { RepairTargetRequest } from "../services/repairService";
import { getCooldownRemainingMinutes } from "../utils/cooldown";

interface RepairCapableItem {
  ticker: string;
  barsBackfillStatus: string | null;
  lastRepairAt?: string | null;
  repairAvailableAt?: string | null;
  name?: string | null;
  source?: "manual" | "position";
}

interface PerTickerRepairDraft extends RepairModalValue {
  ticker: string;
}

interface MonitoredTickersSectionProps {
  monitoredTickers: MonitoredTickerDto[];
  instruments: InstrumentCatalogItemDto[];
  selectedTickers: Set<string>;
  onToggleTicker: (ticker: string) => void;
  onBrowseCatalog: () => void;
  onRetryBackfill: (ticker: string) => void;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string;
  saveSuccess: string;
  onSave: () => void;
  isLoading: boolean;
  repairMode: boolean;
  onRepairModeChange: (enabled: boolean) => void;
  repairSelection: Set<string>;
  onToggleRepairSelection: (ticker: string) => void;
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

  const instrumentMap = useMemo(() => new Map(instruments.map((item) => [item.ticker, item])), [instruments]);

  const manualTickers = useMemo(() => {
    return [...selectedTickers]
      .map((ticker) => {
        const instrument = instrumentMap.get(ticker);
        return {
          ticker,
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
    const byTicker = new Map<string, RepairCapableItem>();
    for (const item of instruments as RepairCapableItem[]) {
      if (selectedTickers.has(item.ticker) || positionTickers.some((p) => p.ticker === item.ticker)) {
        byTicker.set(item.ticker, {
          ...item,
          source: positionTickers.some((p) => p.ticker === item.ticker) ? "position" : "manual",
        });
      }
    }

    for (const positionTicker of positionTickers) {
      if (!byTicker.has(positionTicker.ticker)) {
        byTicker.set(positionTicker.ticker, {
          ticker: positionTicker.ticker,
          name: positionTicker.name,
          barsBackfillStatus: positionTicker.barsBackfillStatus ?? null,
          source: "position",
          lastRepairAt: (positionTicker as RepairCapableItem).lastRepairAt ?? null,
          repairAvailableAt: (positionTicker as RepairCapableItem).repairAvailableAt ?? null,
        });
      }
    }

    return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
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

  const selectedRepairTickers = useMemo(() => [...repairSelection].sort((a, b) => a.localeCompare(b)), [repairSelection]);

  const [perTickerValues, setPerTickerValues] = useState<PerTickerRepairDraft[]>([]);

  useEffect(() => {
    setPerTickerValues((prev) => {
      const existing = new Map(prev.map((item) => [item.ticker, item]));
      return selectedRepairTickers.map((ticker) =>
        existing.get(ticker) ?? {
          ticker,
          startDate: repairDefaults.startDate,
          endDate: repairDefaults.endDate,
          includeBars: repairDefaults.includeBars,
          includeDividends: repairDefaults.includeDividends,
        },
      );
    });
  }, [selectedRepairTickers]);

  const selectedCountLabel = `${selectedRepairTickers.length} ${dict.settings.repairModeSelectedCount}`;

  function handleToggleRepairTicker(item: RepairCapableItem): void {
    const isSelected = repairSelection.has(item.ticker);
    const isBackfilling = item.barsBackfillStatus === "pending" || item.barsBackfillStatus === "backfilling";
    const remaining = getCooldownRemainingMinutes(item.repairAvailableAt);
    if (!isSelected && (isBackfilling || remaining > 0)) return;

    if (!isSelected && repairSelection.size >= 20) {
      setSelectionError(dict.settings.repairModeSelectionLimit);
      return;
    }

    setSelectionError("");
    onToggleRepairSelection(item.ticker);
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
              tickers: selectedRepairTickers,
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
    return <p className="text-sm text-slate-400">Loading...</p>;
  }

  return (
    <div className="space-y-4" data-testid="monitored-tickers-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{dict.settings.tickersSectionTitle}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {repairMode ? dict.settings.repairModeDescription : dict.settings.tickersSectionDescription}
          </p>
        </div>
        <Button
          type="button"
          variant={repairMode ? "default" : "secondary"}
          size="sm"
          className={repairMode ? "gap-1.5" : "gap-1.5 border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"}
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
          <h4 className="text-xs font-medium text-slate-600">{dict.settings.tickersAutoIncludedTitle}</h4>
          <p className="text-xs text-slate-400">{dict.settings.tickersAutoIncludedDescription}</p>
          <div className="space-y-1">
            {positionTickers.map((s) => (
              <div
                key={s.ticker}
                className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-sm"
                data-testid={`position-ticker-${s.ticker}`}
              >
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-mono font-medium text-slate-700">{s.ticker}</span>
                {s.name && <span className="text-slate-500">— {s.name}</span>}
                <span className="ml-auto text-xs text-slate-400">{dict.settings.tickersPositionLocked}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-slate-600">
            {repairMode ? dict.settings.repairModeTitle : dict.settings.tickersYourSelectionsTitle}
          </h4>
          {repairMode ? <span className="text-xs text-slate-500">{selectedCountLabel}</span> : null}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-[1.375rem] top-3.5 h-4 w-4 text-slate-400" />
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
              className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!repairMode ? (
          filteredManual.length === 0 && !search ? (
            <p className="py-3 text-center text-xs text-slate-400">{dict.settings.tickersYourSelectionsEmpty}</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {filteredManual.map((s) => (
                <label
                  key={s.ticker}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-slate-50"
                  data-testid={`manual-ticker-${s.ticker}`}
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onToggleTicker(s.ticker)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="font-mono font-medium text-slate-700">{s.ticker}</span>
                  {s.name && <span className="text-slate-500">— {s.name}</span>}
                  {s.barsBackfillStatus && (
                    <span className="ml-auto flex items-center gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          s.barsBackfillStatus === "ready"
                            ? "bg-green-50 text-green-700"
                            : s.barsBackfillStatus === "failed"
                              ? "bg-red-50 text-red-700"
                              : s.barsBackfillStatus === "backfilling"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-slate-100 text-slate-500"
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
                            onRetryBackfill(s.ticker);
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
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/35 p-2">
            {filteredRepairCandidates.map((item) => {
              const remaining = getCooldownRemainingMinutes(item.repairAvailableAt);
              const disabledReason =
                item.barsBackfillStatus === "pending" || item.barsBackfillStatus === "backfilling"
                  ? dict.settings.repairModeUnavailableBackfill
                  : remaining > 0
                    ? buildCooldownLabel(dict, remaining)
                    : "";
              const selected = repairSelection.has(item.ticker);
              const disabled = !selected && disabledReason.length > 0;

              return (
                <label
                  key={item.ticker}
                  data-testid={`repair-row-${item.ticker}`}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    disabled ? "cursor-not-allowed bg-slate-100/70 text-slate-400" : "cursor-pointer hover:bg-amber-100/55"
                  }`}
                  title={disabledReason || undefined}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => handleToggleRepairTicker(item)}
                    className={`h-4 w-4 rounded border-slate-300 ${repairMode ? "accent-amber-600" : ""}`}
                    data-testid={`repair-selection-${item.ticker}`}
                  />
                  <span className="font-mono font-medium">{item.ticker}</span>
                  {item.name ? <span className="truncate text-slate-500">— {item.name}</span> : null}
                  <span className="ml-auto text-[10px] text-slate-500" data-testid={`repair-cooldown-hint-${item.ticker}`}>
                    {disabledReason}
                  </span>
                </label>
              );
            })}
            {filteredRepairCandidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">{dict.settings.tickersYourSelectionsEmpty}</p>
            ) : null}
          </div>
        )}
      </div>

      {!repairMode ? (
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onBrowseCatalog} data-testid="browse-catalog-btn">
            {dict.settings.tickersBrowseCatalog}
          </Button>

          <div className="flex items-center gap-3 border-t border-slate-200 pt-3">
            <Button type="button" size="sm" disabled={!isDirty || isSaving} onClick={onSave} data-testid="tickers-save-btn">
              {isSaving ? dict.settings.tickersSaving : dict.settings.tickersSaveSelections}
            </Button>
            {saveSuccess && <span className="text-xs text-green-600">{dict.settings.tickersSaved}</span>}
            {saveError && <span className="text-xs text-red-600">{dict.settings.tickersSaveError}</span>}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-end gap-2 border-t border-amber-200 pt-3">
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
        subtitle={`${selectedRepairTickers.join(", ") || "-"}`}
        value={repairDefaults}
        onOpenChange={setRepairModalOpen}
        onChange={setRepairDefaults}
        onSubmit={submitRepair}
        dict={dict}
      >
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 inline-flex gap-1 rounded-md border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setRepairApplyMode("all")}
              className={`rounded px-2.5 py-1 text-xs ${repairApplyMode === "all" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              data-testid="repair-apply-all"
            >
              {dict.settings.repairApplyAllMode}
            </button>
            <button
              type="button"
              onClick={() => setRepairApplyMode("per-ticker")}
              className={`rounded px-2.5 py-1 text-xs ${repairApplyMode === "per-ticker" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              data-testid="repair-per-ticker"
            >
              {dict.settings.repairPerTickerMode}
            </button>
          </div>

          {repairApplyMode === "per-ticker" ? (
            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {perTickerValues.map((row, index) => (
                <div key={row.ticker} className="rounded-lg border border-slate-200 bg-white p-2">
                  <p className="mb-1 text-xs font-semibold text-slate-700">{row.ticker}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="date"
                      value={row.startDate}
                      onChange={(event) =>
                        setPerTickerValues((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, startDate: event.target.value } : item)),
                        )
                      }
                      className="h-9 rounded-lg border border-slate-200 px-2 text-xs"
                    />
                    <input
                      type="date"
                      value={row.endDate}
                      onChange={(event) =>
                        setPerTickerValues((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, endDate: event.target.value } : item)),
                        )
                      }
                      className="h-9 rounded-lg border border-slate-200 px-2 text-xs"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
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
