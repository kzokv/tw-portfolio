"use client";

import { useCallback, useState } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { ApiError, patchJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { CustomizeRangesPopover } from "./CustomizeRangesPopover";

/**
 * KZO-161 — Settings drawer "Display" tab body (design §9).
 *
 * Two sections, both rendered unconditionally per locked decision 4:
 *   1. `display-timeframes-section` — inlined `<CustomizeRangesPopover variant="inline">`.
 *   2. `display-layout-section` — Reset Layout button that PATCHes
 *      `{ cardOrder: null }` and bumps a `resetCount` on success so the
 *      parent can remount `<SortableCardGrid>` via a key bump.
 */

export interface DisplayTabSectionProps {
  dict: AppDictionary;
  /** Called after a successful timeframe save so AppShell refetches effective ranges. */
  onTimeframesSaved: () => void;
  /** Called after a successful Reset Layout PATCH so AppShell remounts the grid. */
  onLayoutReset: () => void;
}

export function DisplayTabSection({
  dict,
  onTimeframesSaved,
  onLayoutReset,
}: DisplayTabSectionProps): JSX.Element {
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetLayout = useCallback(async () => {
    setResetting(true);
    setResetMessage(null);
    setResetError(null);
    try {
      await patchJson("/user-preferences", { cardOrder: null });
      setResetMessage(dict.settings.resetLayoutSuccess);
      onLayoutReset();
    } catch (err) {
      if (err instanceof ApiError) setResetError(err.message);
      else if (err instanceof Error) setResetError(err.message);
      else setResetError(dict.settings.resetLayoutError);
    } finally {
      setResetting(false);
    }
  }, [dict.settings.resetLayoutSuccess, dict.settings.resetLayoutError, onLayoutReset]);

  return (
    <div className="space-y-6" data-testid="display-tab-content">
      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-timeframes-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayTimeframesTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayTimeframesDescription}
          </p>
        </div>
        <CustomizeRangesPopover
          variant="inline"
          onSaved={onTimeframesSaved}
          copy={{
            title: dict.settings.customizeRangesTitle,
            activeSectionLabel: dict.settings.customizeRangesActiveLabel,
            addCustomLabel: dict.settings.customizeRangesAddCustomLabel,
            addCustomPlaceholder: dict.settings.customizeRangesAddPlaceholder,
            addCustomHint: dict.settings.customizeRangesAddHint,
            saveLabel: dict.settings.customizeRangesSaveLabel,
            savingLabel: dict.settings.customizeRangesSavingLabel,
            resetLabel: dict.settings.customizeRangesResetLabel,
            saveSuccess: dict.settings.customizeRangesSaveSuccess,
            saveError: dict.settings.customizeRangesSaveError,
            closeLabel: dict.settings.customizeRangesCloseLabel,
            toggleOnLabel: (range) =>
              dict.settings.customizeRangesToggleOnLabel.replace("{range}", range),
            toggleOffLabel: (range) =>
              dict.settings.customizeRangesToggleOffLabel.replace("{range}", range),
          }}
        />
      </section>

      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-layout-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayLayoutTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayLayoutDescription}
          </p>
        </div>

        {resetError ? (
          <p
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            role="alert"
            data-testid="reset-layout-error"
          >
            {resetError}
          </p>
        ) : null}
        {resetMessage ? (
          <p
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700"
            role="status"
            data-testid="reset-layout-success"
          >
            {resetMessage}
          </p>
        ) : null}

        <Button
          onClick={() => void handleResetLayout()}
          disabled={resetting}
          data-testid="reset-layout-btn"
        >
          {dict.settings.resetLayoutButton}
        </Button>
      </section>
    </div>
  );
}
