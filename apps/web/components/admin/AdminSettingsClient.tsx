"use client";

// Validation strategy: client-side inline validation (see `admin-settings-validation-error`)
// blocks Save when the override is ON and the value is outside 1–10080 / non-integer / empty.
// A server 400 (defense-in-depth) is surfaced in the same error slot.

import { useState } from "react";
import {
  type AppConfigDto,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  dashboardPerformanceRangesSchema,
} from "@tw-portfolio/shared-types";
import { patchJson, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { SortableRangeList, type SortableRangeRow } from "../settings/SortableRangeList";

interface AdminSettingsClientProps {
  initial: AppConfigDto;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 10080;

// KZO-159: Predefined chip palette for the Dashboard Timeframe Defaults section.
// `DEFAULT_DASHBOARD_PERFORMANCE_RANGES` (4 items) is the fallback active selection;
// this 6-chip palette includes longer ranges that admins commonly toggle on.
const PREDEFINED_TIMEFRAME_CHIPS = ["1M", "3M", "YTD", "1Y", "5Y", "10Y"] as const;

// String-template i18n strings (per `.claude/rules/nextjs-i18n-serialization.md` —
// no functions in strings that may cross server→client boundaries).
const TIMEFRAME_HELPER_TEXT =
  "Users can override these defaults in their own Display Preferences.";
const TIMEFRAME_INVALID_FORMAT_MSG =
  "Invalid range format. Use e.g. 1M, 3M, 1Y, YTD, ALL.";
const TIMEFRAME_DUPLICATE_MSG = "That range is already in the list.";
const TIMEFRAME_EMPTY_LIST_MSG = "Add at least one timeframe.";
const TIMEFRAME_LIST_TOO_LONG_MSG = "Maximum 12 timeframes allowed.";

// Single-element validity check via the shared zod schema. Wrapping the
// candidate in a one-element array reuses the schema's element validator
// without duplicating the regex on the client (per design D9 — single
// source of truth for the range grammar).
function isValidPerformanceRange(value: string): boolean {
  return dashboardPerformanceRangesSchema.safeParse([value]).success;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function validateMinutesInput(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { value: null, error: "Enter a number between 1 and 10080." };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { value: null, error: "Value must be a whole number." };
  }
  if (num < MIN_MINUTES || num > MAX_MINUTES) {
    return { value: null, error: `Value must be between ${MIN_MINUTES} and ${MAX_MINUTES}.` };
  }
  return { value: num, error: null };
}

export function AdminSettingsClient({ initial }: AdminSettingsClientProps) {
  const [config, setConfig] = useState<AppConfigDto>(initial);
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(initial.repairCooldownMinutes !== null);
  const [minutesInput, setMinutesInput] = useState<string>(
    initial.repairCooldownMinutes !== null ? String(initial.repairCooldownMinutes) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // ── Dashboard Timeframe Defaults section state (KZO-159) ───────────────────
  const [pendingRanges, setPendingRanges] = useState<string[]>(
    initial.dashboardPerformanceRanges && initial.dashboardPerformanceRanges.length > 0
      ? [...initial.dashboardPerformanceRanges]
      : [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
  );
  const [customInput, setCustomInput] = useState("");
  const [timeframeSaving, setTimeframeSaving] = useState(false);
  const [timeframeServerError, setTimeframeServerError] = useState<string | null>(null);
  const [timeframeSaveSuccess, setTimeframeSaveSuccess] = useState<string | null>(null);

  // ── Metadata Enrichment Mode section state (KZO-189) ───────────────────────
  // The select value is "" when the admin is using the env default (override
  // cleared); otherwise the explicit override string. PATCH translates "" → null.
  const [metadataEnrichmentMode, setMetadataEnrichmentMode] = useState<string>(
    initial.metadataEnrichmentMode ?? "",
  );
  const [metadataModeSaving, setMetadataModeSaving] = useState(false);
  const [metadataModeError, setMetadataModeError] = useState<string | null>(null);
  const [metadataModeSuccess, setMetadataModeSuccess] = useState<string | null>(null);

  const clientValidation = overrideEnabled ? validateMinutesInput(minutesInput) : { value: null, error: null };
  const inlineError = overrideEnabled ? clientValidation.error : null;

  const canSave = !saving && (!overrideEnabled || clientValidation.error === null);

  // ── Timeframe section derived state ────────────────────────────────────────
  const trimmedCustomInput = customInput.trim();
  let customInputError: string | null = null;
  if (trimmedCustomInput !== "") {
    if (!isValidPerformanceRange(trimmedCustomInput)) {
      customInputError = TIMEFRAME_INVALID_FORMAT_MSG;
    } else if (pendingRanges.includes(trimmedCustomInput)) {
      customInputError = TIMEFRAME_DUPLICATE_MSG;
    } else if (pendingRanges.length >= 12) {
      customInputError = TIMEFRAME_LIST_TOO_LONG_MSG;
    }
  }

  const listValidation = dashboardPerformanceRangesSchema.safeParse(pendingRanges);
  const listValidationError =
    pendingRanges.length === 0
      ? TIMEFRAME_EMPTY_LIST_MSG
      : listValidation.success
        ? null
        : pendingRanges.length > 12
          ? TIMEFRAME_LIST_TOO_LONG_MSG
          : TIMEFRAME_INVALID_FORMAT_MSG;

  const displayedTimeframeError = customInputError ?? listValidationError ?? timeframeServerError;
  const canAddCustom = !timeframeSaving && trimmedCustomInput !== "" && customInputError === null;
  const canSaveTimeframes =
    !timeframeSaving && pendingRanges.length > 0 && listValidation.success;
  const availablePredefinedChips = PREDEFINED_TIMEFRAME_CHIPS.filter(
    (range) => !pendingRanges.includes(range),
  );

  function handleToggle(next: boolean) {
    setOverrideEnabled(next);
    setSaveError(null);
    setSaveSuccess(null);
    if (next && minutesInput.trim() === "") {
      setMinutesInput(String(config.effectiveRepairCooldownMinutes));
    }
  }

  async function handleSave() {
    setSaveError(null);
    setSaveSuccess(null);

    const payloadValue: number | null = overrideEnabled ? clientValidation.value : null;
    if (overrideEnabled && payloadValue === null) {
      // Client validation failed — Save button is already disabled, but guard defensively.
      return;
    }

    setSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", { repairCooldownMinutes: payloadValue });
      setConfig(updated);
      setOverrideEnabled(updated.repairCooldownMinutes !== null);
      setMinutesInput(updated.repairCooldownMinutes !== null ? String(updated.repairCooldownMinutes) : "");
      setSaveSuccess("Settings saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError("Failed to save settings.");
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Timeframe section handlers (KZO-159) ───────────────────────────────────
  function clearTimeframeFeedback() {
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
  }

  function reorderChips(nextOrder: string[]) {
    setPendingRanges(nextOrder);
    clearTimeframeFeedback();
  }

  function toggleChip(range: string) {
    setPendingRanges((prev) =>
      prev.includes(range) ? prev.filter((r) => r !== range) : [...prev, range],
    );
    clearTimeframeFeedback();
  }

  function handleAddCustom() {
    if (!canAddCustom) return;
    setPendingRanges((prev) => [...prev, trimmedCustomInput]);
    setCustomInput("");
    clearTimeframeFeedback();
  }

  async function handleSaveTimeframes() {
    if (!canSaveTimeframes) return;
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
    setTimeframeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        dashboardPerformanceRanges: pendingRanges,
      });
      setConfig(updated);
      setPendingRanges(
        updated.dashboardPerformanceRanges && updated.dashboardPerformanceRanges.length > 0
          ? [...updated.dashboardPerformanceRanges]
          : [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
      );
      setTimeframeSaveSuccess("Timeframes saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setTimeframeServerError(err.message);
      } else if (err instanceof Error) {
        setTimeframeServerError(err.message);
      } else {
        setTimeframeServerError("Failed to save timeframes.");
      }
    } finally {
      setTimeframeSaving(false);
    }
  }

  // ── Metadata Enrichment Mode handlers (KZO-189) ────────────────────────────
  async function handleSaveMetadataMode() {
    setMetadataModeError(null);
    setMetadataModeSuccess(null);
    setMetadataModeSaving(true);
    try {
      const next = metadataEnrichmentMode === "" ? null : metadataEnrichmentMode;
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        metadataEnrichmentMode: next,
      });
      setConfig(updated);
      setMetadataEnrichmentMode(updated.metadataEnrichmentMode ?? "");
      setMetadataModeSuccess("Metadata enrichment mode saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        setMetadataModeError(err.message);
      } else if (err instanceof Error) {
        setMetadataModeError(err.message);
      } else {
        setMetadataModeError("Failed to save metadata enrichment mode.");
      }
    } finally {
      setMetadataModeSaving(false);
    }
  }

  async function handleResetTimeframes() {
    setTimeframeServerError(null);
    setTimeframeSaveSuccess(null);
    setTimeframeSaving(true);
    try {
      const updated = await patchJson<AppConfigDto>("/admin/settings", {
        dashboardPerformanceRanges: null,
      });
      setConfig(updated);
      setPendingRanges([...DEFAULT_DASHBOARD_PERFORMANCE_RANGES]);
      setCustomInput("");
      setTimeframeSaveSuccess("Reset to defaults.");
    } catch (err) {
      if (err instanceof ApiError) {
        setTimeframeServerError(err.message);
      } else if (err instanceof Error) {
        setTimeframeServerError(err.message);
      } else {
        setTimeframeServerError("Failed to reset timeframes.");
      }
    } finally {
      setTimeframeSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="admin-settings-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Runtime configuration. Changes apply immediately and are recorded in the audit log.
        </p>
      </div>

      {saveError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-testid="admin-settings-save-error"
        >
          {saveError}
          <button
            type="button"
            className="ml-2 text-red-500 hover:text-red-700"
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {saveSuccess && (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          role="status"
          data-testid="admin-settings-save-success"
        >
          {saveSuccess}
        </div>
      )}

      <Card>
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Repair cooldown</h2>
            <p className="mt-1 text-sm text-slate-600">
              Minimum wait time (in minutes) between repair runs for the same symbol. Off = use the environment default.
            </p>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={overrideEnabled}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
              data-testid="admin-settings-override-toggle"
            />
            <span className="text-sm font-medium text-slate-700">Override repair cooldown</span>
          </label>

          {overrideEnabled ? (
            <div>
              <label className="block text-sm font-medium text-slate-700">Cooldown (minutes)</label>
              <input
                type="number"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={1}
                value={minutesInput}
                onChange={(e) => {
                  setMinutesInput(e.target.value);
                  setSaveError(null);
                  setSaveSuccess(null);
                }}
                disabled={saving}
                className="mt-1 w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                data-testid="admin-settings-minutes-input"
              />
              <p className="mt-1 text-xs text-slate-500">Allowed range: {MIN_MINUTES}–{MAX_MINUTES} minutes.</p>
              {inlineError && (
                <p
                  className="mt-2 text-sm text-red-600"
                  role="alert"
                  data-testid="admin-settings-validation-error"
                >
                  {inlineError}
                </p>
              )}
            </div>
          ) : (
            <div>
              <span
                className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                data-testid="admin-settings-env-default-badge"
              >
                Using env default · {config.effectiveRepairCooldownMinutes} min
              </span>
            </div>
          )}

          <div className="flex items-center justify-end">
            <Button
              onClick={() => void handleSave()}
              disabled={!canSave}
              data-testid="admin-settings-save-button"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── KZO-159: Dashboard Timeframe Defaults section ─────────────────── */}
      <Card data-testid="timeframe-defaults-section">
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Dashboard Timeframe Defaults</h2>
            <p className="mt-1 text-sm text-slate-600">{TIMEFRAME_HELPER_TEXT}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Active timeframes
            </p>
            {pendingRanges.length === 0 ? (
              <p className="text-sm text-slate-500">No active timeframes — add at least one.</p>
            ) : (
              // KZO-161 (158C) F4a: dnd-kit retrofit. Drop-in replacement for
              // the ↑/↓ arrow buttons — `timeframe-chip-{range}` testid is
              // preserved (referenced by `[timeframe-A..J]`); `-up/-down` are
              // intentionally dropped (no dnd-kit boundary-disabled concept).
              // Remove-from-active happens via a click on the chip itself
              // (SortableRangeList renders the chip as a button when
              // `onToggleVisibility` is provided). `toggleTestId` is
              // intentionally omitted — admin has one toggle affordance, the
              // chip; the popover variant adds a second dedicated button.
              <SortableRangeList
                rows={pendingRanges.map<SortableRangeRow>((range) => ({
                  range,
                  active: true,
                  disabled: timeframeSaving,
                }))}
                onReorder={reorderChips}
                onToggleVisibility={(range) => toggleChip(range)}
                dragHandleTestId={(r) => `timeframe-drag-handle-${r}`}
                chipTestId={(r) => `timeframe-chip-${r}`}
                toggleLabel={(r) => `Remove ${r} from active timeframes`}
              />
            )}
          </div>

          {availablePredefinedChips.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Available
              </p>
              <div className="flex flex-wrap gap-2">
                {availablePredefinedChips.map((range) => (
                  <button
                    key={range}
                    type="button"
                    aria-label={`Add ${range} to active timeframes`}
                    onClick={() => toggleChip(range)}
                    disabled={timeframeSaving}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid={`timeframe-chip-${range}`}
                    data-active="false"
                  >
                    + {range}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="timeframe-add-input">
              Add custom range
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="timeframe-add-input"
                type="text"
                value={customInput}
                onChange={(e) => {
                  setCustomInput(e.target.value);
                  clearTimeframeFeedback();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAddCustom) {
                    e.preventDefault();
                    handleAddCustom();
                  }
                }}
                disabled={timeframeSaving}
                placeholder="e.g. 5Y, 18M, ALL"
                className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                data-testid="timeframe-add-input"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddCustom}
                disabled={!canAddCustom}
                data-testid="timeframe-add-button"
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Format: {`{n}M`}, {`{n}Y`}, YTD, or ALL. Months ≤ 240, years ≤ 50.
            </p>
          </div>

          {displayedTimeframeError && (
            <p
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
              data-testid="timeframe-validation-error"
            >
              {displayedTimeframeError}
            </p>
          )}

          {timeframeSaveSuccess && (
            <p
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
              role="status"
              data-testid="timeframe-save-success"
            >
              {timeframeSaveSuccess}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleResetTimeframes()}
              disabled={timeframeSaving}
              data-testid="timeframe-reset-button"
            >
              Reset to defaults
            </Button>
            <Button
              onClick={() => void handleSaveTimeframes()}
              disabled={!canSaveTimeframes}
              data-testid="timeframe-save-button"
            >
              {timeframeSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── KZO-189: Metadata Enrichment Mode section ───────────────────── */}
      <Card data-testid="admin-settings-metadata-enrichment-mode-section">
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Metadata enrichment mode</h2>
            <p className="mt-1 text-sm text-slate-600">
              Controls whether AU instrument metadata (name, type) is enriched on every backfill or
              only on user-driven triggers. Use {`"Skip on daily refresh"`} to conserve the Yahoo
              budget when the daily-refresh cron sweeps every monitored ticker.
            </p>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-slate-700"
              htmlFor="admin-settings-metadata-enrichment-mode-select"
            >
              Mode
            </label>
            <select
              id="admin-settings-metadata-enrichment-mode-select"
              value={metadataEnrichmentMode}
              onChange={(e) => {
                setMetadataEnrichmentMode(e.target.value);
                setMetadataModeError(null);
                setMetadataModeSuccess(null);
              }}
              disabled={metadataModeSaving}
              className="mt-1 w-72 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              data-testid="admin-settings-metadata-enrichment-mode-select"
            >
              <option value="">
                Use environment default ({config.effectiveMetadataEnrichmentMode})
              </option>
              <option value="unconditional">Always enrich (unconditional)</option>
              <option value="conditional">Skip on daily refresh (conditional)</option>
            </select>
            <p
              className="mt-2 text-xs text-slate-500"
              data-testid="admin-settings-metadata-enrichment-mode-effective"
            >
              Effective: {config.effectiveMetadataEnrichmentMode}
              {config.metadataEnrichmentMode === null ? " (env default)" : " (admin override)"}
            </p>
          </div>

          {metadataModeError && (
            <p
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
              data-testid="admin-settings-metadata-enrichment-mode-error"
            >
              {metadataModeError}
            </p>
          )}

          {metadataModeSuccess && (
            <p
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
              role="status"
              data-testid="admin-settings-metadata-enrichment-mode-success"
            >
              {metadataModeSuccess}
            </p>
          )}

          <div className="flex items-center justify-end">
            <Button
              onClick={() => void handleSaveMetadataMode()}
              disabled={metadataModeSaving}
              data-testid="admin-settings-metadata-enrichment-mode-save"
            >
              {metadataModeSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-xs text-slate-500" data-testid="admin-settings-last-updated">
        Last updated {formatTimestamp(config.updatedAt)} · Change will be recorded in the audit log
      </p>
    </div>
  );
}
