"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { DisplayTabSection, type ReorderablePage } from "./DisplayTabSection";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import { useAutoSave } from "../../features/settings/hooks/useAutoSave";
import { patchSettings } from "../../features/settings/services/settingsService";
import { TooltipInfo } from "../ui/TooltipInfo";

/**
 * Phase 3d S4 — `/settings/display` body.
 *
 * Composition (per A5 / §3d):
 *   - UI language row (new — locale auto-saves via `PATCH /settings`)
 *   - <DisplayTabSection /> verbatim (theme · accent · density · timeframes
 *     · reporting-currency · layout reset — already shadcn-aesthetic from
 *     Phase 2)
 *   - Calculations subsection (new — `quotePollIntervalSeconds` input
 *     auto-saves via `PATCH /settings`; testid `display-calculations-section`)
 *
 * `costBasisMethod` UI is deleted entirely per A5 (vestigial one-option
 * select). The schema field stays in `UserSettings` for future FIFO/LIFO.
 */
export function DisplaySettingsClient() {
  const { locale: routeLocale, initialSettings } = useSettingsRouteContext();
  // The DisplayTabSection uses its own per-key PATCH /user-preferences flow
  // (theme/accent/density/range/reporting-currency). We pass an effective-
  // ranges refetch so timeframe saves propagate; reporting-currency saves
  // will be reflected on the next /dashboard visit (no dashboard refresh
  // required from the /settings route).
  const { refetch: refetchRanges } = useEffectiveRanges();

  // Locale + quotePoll auto-save state — these go to `/settings` (not
  // /user-preferences) because they live on the `UserSettings` row.
  const [locale, setLocale] = useState<LocaleCode>(initialSettings?.locale ?? routeLocale);
  const [quotePoll, setQuotePoll] = useState<string>(
    String(initialSettings?.quotePollIntervalSeconds ?? 10),
  );

  const dict = getDictionary(locale);

  // Auto-save: locale
  const localeSave = useAutoSave<LocaleCode>({
    save: async (value) => {
      await patchSettings({ locale: value });
    },
  });

  // Auto-save: quotePoll
  const quotePollSave = useAutoSave<number>({
    save: async (value) => {
      await patchSettings({ quotePollIntervalSeconds: value });
    },
    validate: (value) =>
      Number.isInteger(value) && value >= 1
        ? null
        : dict.settings.validationQuotePoll,
  });

  const onTimeframesSaved = useCallback(() => {
    void refetchRanges();
  }, [refetchRanges]);

  const onReportingCurrencySaved = useCallback(() => {
    // Dashboard surfaces fetch on next visit; no-op from /settings route.
  }, []);

  useEffect(() => {
    // Keep state in sync with locale prop from server (page reloads).
    setLocale(initialSettings?.locale ?? routeLocale);
    setQuotePoll(String(initialSettings?.quotePollIntervalSeconds ?? 10));
  }, [initialSettings, routeLocale]);

  return (
    <div
      className="space-y-6"
      data-testid="settings-section-display"
    >
      {/* UI language row (A5) */}
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        data-testid="display-language-section"
      >
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-foreground">
              {dict.settings.localeLabel}
            </h3>
            {/* Phase 3d §4.1 iter 2 — locale-tooltip a11y target so the
                `tooltip-settings-locale-{trigger,content}` page-object
                locators have a real surface to attach to in the new
                /settings/display body. */}
            <TooltipInfo
              label={dict.settings.localeLabel}
              content={dict.tooltips.settingsLocale}
              triggerTestId="tooltip-settings-locale-trigger"
              contentTestId="tooltip-settings-locale-content"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {dict.settings.localeOptionEnglish} · {dict.settings.localeOptionTraditionalChinese}
          </p>
        </div>
        <Select
          value={locale}
          onValueChange={(next) => {
            const nextLocale = (next === "zh-TW" ? "zh-TW" : "en") as LocaleCode;
            setLocale(nextLocale);
            localeSave.commit(nextLocale);
          }}
        >
          <SelectTrigger
            data-testid="display-language-select"
            className="w-full max-w-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{dict.settings.localeOptionEnglish}</SelectItem>
            <SelectItem value="zh-TW">{dict.settings.localeOptionTraditionalChinese}</SelectItem>
          </SelectContent>
        </Select>
        {localeSave.hasError ? (
          <p className="text-xs text-rose-600" role="alert">{localeSave.error}</p>
        ) : null}
      </section>

      {/* Existing Display tab content (theme/accent/density/timeframes/etc.) */}
      <DisplayTabSection
        dict={dict}
        onTimeframesSaved={onTimeframesSaved}
        onLayoutReset={() => undefined}
        onPageLayoutReset={(_page: ReorderablePage) => undefined}
        onReportingCurrencySaved={onReportingCurrencySaved}
      />

      {/* Calculations subsection (A5) — quotePollIntervalSeconds only */}
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        data-testid="display-calculations-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {dict.settings.quotePollLabel}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {dict.tooltips.settingsQuotePoll}
          </p>
        </div>
        <input
          type="number"
          min={1}
          value={quotePoll}
          onChange={(event) => {
            const next = event.target.value;
            setQuotePoll(next);
            const parsed = Number(next);
            if (Number.isInteger(parsed) && parsed >= 1) {
              quotePollSave.commit(parsed);
            }
          }}
          onBlur={() => {
            const parsed = Number(quotePoll);
            // Trigger validation surface even when invalid (e.g. blank).
            quotePollSave.commit(Number.isFinite(parsed) ? parsed : 0);
          }}
          className="block h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid="settings-quote-poll-input"
          aria-label={`${dict.settings.quotePollLabel} (${dict.settings.quotePollUnit})`}
        />
        <p className="text-xs text-muted-foreground">{dict.settings.quotePollUnit}</p>
        {quotePollSave.hasError ? (
          <p className="text-xs text-rose-600" role="alert">{quotePollSave.error}</p>
        ) : null}
      </section>
    </div>
  );
}
