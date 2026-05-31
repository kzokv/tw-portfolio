"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DashboardPerformanceRange,
  dashboardPerformanceRangesSchema,
} from "@vakwen/shared-types";
import { ApiError, getJson, patchJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";
import { SortableRangeList, type SortableRangeRow } from "./SortableRangeList";

/**
 * KZO-161 — shared "Customize ranges" UI for the F4 gear popover AND the
 * Display tab inline form (design §4 + §9).
 *
 * `variant="popover"` renders a floating panel anchored beneath the gear
 * with a backdrop click-close and ESC support. `variant="inline"` drops
 * the chrome and renders only the form body, for embedding inside the
 * SettingsDrawer's Display tab section.
 *
 * Reads EFFECTIVE ranges on open (not raw stored ranges) per locked
 * decision 6 — first-time users see the admin/default list as a starting
 * point. On Save, PATCHes `dashboardPerformanceRanges: [...rows]` and
 * calls `onSaved` so the parent can refetch `effectiveRanges`.
 */

// String-template copy (per `nextjs-i18n-serialization.md`). Popover localizes
// via the generic dict prop below; inline admin keys are reused where possible.
const INVALID_FORMAT_MSG = "Invalid range format. Use e.g. 1M, 3M, 1Y, YTD, ALL.";
const DUPLICATE_MSG = "That range is already in the list.";
const EMPTY_LIST_MSG = "Add at least one timeframe.";
const LIST_TOO_LONG_MSG = "Maximum 12 timeframes allowed.";

function isValidPerformanceRange(value: string): boolean {
  return dashboardPerformanceRangesSchema.safeParse([value]).success;
}

export interface CustomizeRangesCopy {
  title: string;
  activeSectionLabel: string;
  addCustomLabel: string;
  addCustomPlaceholder: string;
  addCustomHint: string;
  saveLabel: string;
  savingLabel: string;
  resetLabel: string;
  saveSuccess: string;
  saveError: string;
  /** Aria label for the close (popover variant only). */
  closeLabel: string;
  toggleOnLabel: (range: string) => string;
  toggleOffLabel: (range: string) => string;
}

export interface CustomizeRangesPopoverProps {
  variant: "popover" | "inline";
  /** Required when variant = "popover". Ignored otherwise. */
  onClose?: () => void;
  /** Called after a successful PATCH so the parent can refetch effective ranges. */
  onSaved?: () => void;
  /** Copy strings — callers pass i18n-localized values. */
  copy: CustomizeRangesCopy;
}

interface EffectiveRangesResponse {
  ranges: DashboardPerformanceRange[];
  source: "user" | "admin" | "default";
}

export function CustomizeRangesPopover({
  variant,
  onClose,
  onSaved,
  copy,
}: CustomizeRangesPopoverProps): JSX.Element {
  const [pendingRanges, setPendingRanges] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Load the effective list on mount. For the popover variant this fires
  // exactly once on open (the parent is expected to unmount/remount on
  // toggle). For the inline variant the Display tab mounts once while open.
  useEffect(() => {
    let cancelled = false;
    void getJson<EffectiveRangesResponse>("/user-preferences/effective-ranges")
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.ranges) && res.ranges.length > 0 ? res.ranges : [];
        setPendingRanges(list);
        setVisibility(Object.fromEntries(list.map((r) => [r, true])));
      })
      .catch(() => {
        // Silent: render an empty list; user can add a custom range or hit Reset.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC closes the popover variant.
  useEffect(() => {
    if (variant !== "popover") return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [variant, onClose]);

  const activeRanges = pendingRanges.filter((r) => visibility[r] !== false);

  const trimmedCustomInput = customInput.trim();
  let customInputError: string | null = null;
  if (trimmedCustomInput !== "") {
    if (!isValidPerformanceRange(trimmedCustomInput)) {
      customInputError = INVALID_FORMAT_MSG;
    } else if (pendingRanges.includes(trimmedCustomInput)) {
      customInputError = DUPLICATE_MSG;
    } else if (pendingRanges.length >= 12) {
      customInputError = LIST_TOO_LONG_MSG;
    }
  }

  const listValidation = dashboardPerformanceRangesSchema.safeParse(activeRanges);
  const listValidationError =
    activeRanges.length === 0
      ? EMPTY_LIST_MSG
      : listValidation.success
        ? null
        : activeRanges.length > 12
          ? LIST_TOO_LONG_MSG
          : INVALID_FORMAT_MSG;

  const displayedError = customInputError ?? listValidationError ?? serverError;
  const canAddCustom = !saving && trimmedCustomInput !== "" && customInputError === null;
  const canSave = !saving && activeRanges.length > 0 && listValidation.success;

  const clearFeedback = useCallback(() => {
    setServerError(null);
    setSaveSuccess(null);
  }, []);

  const handleReorder = useCallback(
    (nextOrder: string[]) => {
      setPendingRanges(nextOrder);
      clearFeedback();
    },
    [clearFeedback],
  );

  const handleToggleVisibility = useCallback(
    (range: string) => {
      setVisibility((prev) => ({ ...prev, [range]: !(prev[range] !== false) }));
      clearFeedback();
    },
    [clearFeedback],
  );

  const handleAddCustom = useCallback(() => {
    if (!canAddCustom) return;
    setPendingRanges((prev) => [...prev, trimmedCustomInput]);
    setVisibility((prev) => ({ ...prev, [trimmedCustomInput]: true }));
    setCustomInput("");
    clearFeedback();
  }, [canAddCustom, trimmedCustomInput, clearFeedback]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    clearFeedback();
    try {
      await patchJson("/user-preferences", {
        dashboardPerformanceRanges: activeRanges,
      });
      setSaveSuccess(copy.saveSuccess);
      onSaved?.();
      // Auto-close the popover variant on successful save. `onClose` is
      // undefined for the inline Display-tab variant, so the call is a
      // no-op there — inline form stays open so users can keep editing.
      onClose?.();
    } catch (err) {
      if (err instanceof ApiError) setServerError(err.message);
      else if (err instanceof Error) setServerError(err.message);
      else setServerError(copy.saveError);
    } finally {
      setSaving(false);
    }
  }, [canSave, activeRanges, copy.saveSuccess, copy.saveError, onSaved, onClose, clearFeedback]);

  const handleReset = useCallback(async () => {
    setSaving(true);
    clearFeedback();
    try {
      await patchJson("/user-preferences", { dashboardPerformanceRanges: null });
      // After reset, the server-effective list falls back to admin/default.
      // Re-fetch it so the UI reflects the new state without a full reload.
      const res = await getJson<EffectiveRangesResponse>(
        "/user-preferences/effective-ranges",
      );
      const list = Array.isArray(res?.ranges) && res.ranges.length > 0 ? res.ranges : [];
      setPendingRanges(list);
      setVisibility(Object.fromEntries(list.map((r) => [r, true])));
      setCustomInput("");
      setSaveSuccess(copy.saveSuccess);
      onSaved?.();
      // Auto-close on Reset success — same as Save. No-op for inline variant.
      onClose?.();
    } catch (err) {
      if (err instanceof ApiError) setServerError(err.message);
      else if (err instanceof Error) setServerError(err.message);
      else setServerError(copy.saveError);
    } finally {
      setSaving(false);
    }
  }, [copy.saveSuccess, copy.saveError, onSaved, onClose, clearFeedback]);

  const rows: SortableRangeRow[] = pendingRanges.map((range) => ({
    range,
    active: visibility[range] !== false,
    disabled: saving,
  }));

  const body = (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {copy.activeSectionLabel}
        </p>
        {pendingRanges.length === 0 ? (
          <p className="text-sm text-slate-500">{EMPTY_LIST_MSG}</p>
        ) : (
          <SortableRangeList
            rows={rows}
            onReorder={handleReorder}
            onToggleVisibility={handleToggleVisibility}
            dragHandleTestId={(r) => `timeframe-drag-handle-${r}`}
            rowTestId={(r) => `timeframe-customize-row-${r}`}
            chipTestId={(r) => `timeframe-chip-${r}`}
            toggleTestId={(r) => `timeframe-toggle-${r}`}
            toggleLabel={(r, active) => (active ? copy.toggleOnLabel(r) : copy.toggleOffLabel(r))}
          />
        )}
      </div>

      <div className="space-y-2">
        <label
          className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor="timeframe-custom-input"
        >
          {copy.addCustomLabel}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="timeframe-custom-input"
            type="text"
            value={customInput}
            onChange={(e) => {
              setCustomInput(e.target.value);
              clearFeedback();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAddCustom) {
                e.preventDefault();
                handleAddCustom();
              }
            }}
            disabled={saving}
            placeholder={copy.addCustomPlaceholder}
            className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            data-testid="timeframe-custom-input"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddCustom}
            disabled={!canAddCustom}
            data-testid="timeframe-add-btn"
          >
            +
          </Button>
        </div>
        <p className="text-xs text-slate-500">{copy.addCustomHint}</p>
      </div>

      {displayedError && (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
          role="alert"
          data-testid="timeframe-validation-error"
        >
          {displayedError}
        </p>
      )}

      {saveSuccess && (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700"
          role="status"
          data-testid="timeframe-save-success"
        >
          {saveSuccess}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleReset()}
          disabled={saving}
          data-testid="timeframe-reset-btn"
        >
          {copy.resetLabel}
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={!canSave}
          data-testid="timeframe-save-btn"
        >
          {saving ? copy.savingLabel : copy.saveLabel}
        </Button>
      </div>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="space-y-3" data-testid="timeframe-customize-inline">
        {body}
      </div>
    );
  }

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={() => onClose?.()}
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className={cn(
          "fixed right-4 top-24 z-50 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl",
          "sm:right-8 md:right-12",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        data-testid="timeframe-customize-popover"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{copy.title}</h3>
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label={copy.closeLabel}
            className="rounded p-1 text-slate-500 hover:text-slate-800"
          >
            ✕
          </button>
        </div>
        {body}
      </div>
    </>
  );
}
