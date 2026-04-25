"use client";

import { useCallback, useState } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { ApiError, patchJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { CustomizeRangesPopover } from "./CustomizeRangesPopover";

/**
 * KZO-161 — Settings drawer "Display" tab body (design §9).
 * KZO-162 — Layout section grew from 1 to 4 always-visible reset buttons:
 * three per-page resets (dashboard / transactions / portfolio) plus a
 * global "Reset all layouts" button. Per-page resets PATCH per-key null;
 * the global reset PATCHes `cardOrder: null`.
 */

export type ReorderablePage = "dashboard" | "transactions" | "portfolio";

export interface DisplayTabSectionProps {
  dict: AppDictionary;
  /** Called after a successful timeframe save so AppShell refetches effective ranges. */
  onTimeframesSaved: () => void;
  /** Called after a successful global "Reset all layouts" PATCH. */
  onLayoutReset: () => void;
  /** Called after a successful per-page reset PATCH (KZO-162). */
  onPageLayoutReset: (page: ReorderablePage) => void;
}

export function DisplayTabSection({
  dict,
  onTimeframesSaved,
  onLayoutReset,
  onPageLayoutReset,
}: DisplayTabSectionProps): JSX.Element {
  const [resetting, setResetting] = useState<ReorderablePage | "all" | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const runReset = useCallback(
    async (target: ReorderablePage | "all"): Promise<void> => {
      setResetting(target);
      setResetMessage(null);
      setResetError(null);
      try {
        if (target === "all") {
          await patchJson("/user-preferences", { cardOrder: null });
          onLayoutReset();
        } else {
          await patchJson("/user-preferences", { cardOrder: { [target]: null } });
          onPageLayoutReset(target);
        }
        setResetMessage(dict.settings.resetLayoutSuccess);
      } catch (err) {
        if (err instanceof ApiError) setResetError(err.message);
        else if (err instanceof Error) setResetError(err.message);
        else setResetError(dict.settings.resetLayoutError);
      } finally {
        setResetting(null);
      }
    },
    [
      dict.settings.resetLayoutSuccess,
      dict.settings.resetLayoutError,
      onLayoutReset,
      onPageLayoutReset,
    ],
  );

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

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void runReset("dashboard")}
            disabled={resetting !== null}
            data-testid="reset-dashboard-layout-btn"
          >
            {dict.settings.resetDashboardLayoutButton}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runReset("transactions")}
            disabled={resetting !== null}
            data-testid="reset-transactions-layout-btn"
          >
            {dict.settings.resetTransactionsLayoutButton}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runReset("portfolio")}
            disabled={resetting !== null}
            data-testid="reset-portfolio-layout-btn"
          >
            {dict.settings.resetPortfolioLayoutButton}
          </Button>
        </div>

        <div className="border-t border-slate-200 pt-3">
          <Button
            onClick={() => void runReset("all")}
            disabled={resetting !== null}
            data-testid="reset-all-layouts-btn"
          >
            {dict.settings.resetAllLayoutsButton}
          </Button>
        </div>
      </section>
    </div>
  );
}
