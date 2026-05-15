"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { ApiError, getJson, patchJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { CustomizeRangesPopover } from "./CustomizeRangesPopover";

/**
 * KZO-161 — Settings drawer "Display" tab body (design §9).
 * KZO-162 — Layout section grew from 1 to 4 always-visible reset buttons:
 * three per-page resets (dashboard / transactions / portfolio) plus a
 * global "Reset all layouts" button. Per-page resets PATCH per-key null;
 * the global reset PATCHes `cardOrder: null`.
 * KZO-180 — Reporting currency selector. Immediate save on change; mirrors
 * the `runReset` flash pattern in this same tab (not the
 * `CustomizeRangesPopover` save-button flow). When the PATCH succeeds,
 * fires `onReportingCurrencySaved` so AppShell can refetch
 * `/dashboard/overview` + `/dashboard/performance` with the new currency.
 */

export type ReorderablePage = "dashboard" | "transactions" | "portfolio";

const REPORTING_CURRENCY_OPTIONS: AccountDefaultCurrency[] = ["TWD", "USD", "AUD"];

interface UserPreferencesResponse {
  preferences?: {
    reportingCurrency?: AccountDefaultCurrency | null;
  } | null;
}

export interface DisplayTabSectionProps {
  dict: AppDictionary;
  /** Called after a successful timeframe save so AppShell refetches effective ranges. */
  onTimeframesSaved: () => void;
  /** Called after a successful global "Reset all layouts" PATCH. */
  onLayoutReset: () => void;
  /** Called after a successful per-page reset PATCH (KZO-162). */
  onPageLayoutReset: (page: ReorderablePage) => void;
  /**
   * KZO-180 — called after a successful reporting-currency PATCH so AppShell
   * can refetch `/dashboard/overview` + `/dashboard/performance` with the new
   * currency. Default no-op (mirrors the layout-reset callbacks).
   */
  onReportingCurrencySaved?: () => void;
}

const SAVED_FLASH_MS = 1800;

export function DisplayTabSection({
  dict,
  onTimeframesSaved,
  onLayoutReset,
  onPageLayoutReset,
  onReportingCurrencySaved,
}: DisplayTabSectionProps): JSX.Element {
  const [resetting, setResetting] = useState<ReorderablePage | "all" | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // KZO-180 — reporting currency state. Defaults to "TWD" until the GET
  // /user-preferences hydration lands; mirrors SortableCardGrid's pattern.
  const [reportingCurrency, setReportingCurrency] = useState<AccountDefaultCurrency>("TWD");
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencySavedFlash, setCurrencySavedFlash] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial hydration from GET /user-preferences (once per mount).
  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences")
      .then((res) => {
        if (cancelled) return;
        const saved = res?.preferences?.reportingCurrency;
        if (saved === "TWD" || saved === "USD" || saved === "AUD") {
          setReportingCurrency(saved);
        }
      })
      .catch(() => {
        // Silent fallback: "TWD" default stays in state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Clean up the flash timer on unmount.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

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

  const handleReportingCurrencyChange = useCallback(
    async (next: AccountDefaultCurrency): Promise<void> => {
      // Optimistic update — flip state first, roll back on failure.
      const previous = reportingCurrency;
      setReportingCurrency(next);
      setCurrencySaving(true);
      setCurrencyError(null);
      setCurrencySavedFlash(false);
      try {
        await patchJson("/user-preferences", { reportingCurrency: next });
        setCurrencySavedFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(
          () => setCurrencySavedFlash(false),
          SAVED_FLASH_MS,
        );
        onReportingCurrencySaved?.();
      } catch (err) {
        // Roll back the optimistic UI on failure.
        setReportingCurrency(previous);
        if (err instanceof ApiError) setCurrencyError(err.message);
        else if (err instanceof Error) setCurrencyError(err.message);
        else setCurrencyError(dict.settings.resetLayoutError);
      } finally {
        setCurrencySaving(false);
      }
    },
    [
      reportingCurrency,
      onReportingCurrencySaved,
      dict.settings.resetLayoutError,
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
        data-testid="display-reporting-currency-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayReportingCurrencyTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayReportingCurrencyDescription}
          </p>
        </div>

        {/* KZO-180 — currency codes render untranslated per the KZO-167 D9
            convention; the codes (TWD/USD/AUD) are inline string literals,
            not function values, in line with `nextjs-i18n-serialization.md`. */}
        <div className="flex items-center gap-3">
          <select
            data-testid="reporting-currency-select"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={reportingCurrency}
            disabled={currencySaving}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "TWD" || next === "USD" || next === "AUD") {
                void handleReportingCurrencyChange(next);
              }
            }}
          >
            {REPORTING_CURRENCY_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {currencySavedFlash ? (
            <span
              className="text-xs text-emerald-700"
              role="status"
              data-testid="reporting-currency-saved"
            >
              {dict.settings.displayReportingCurrencySaved}
            </span>
          ) : null}
        </div>

        {currencyError ? (
          <p
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            role="alert"
            data-testid="reporting-currency-error"
          >
            {currencyError}
          </p>
        ) : null}
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
