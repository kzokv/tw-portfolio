"use client";

import { useEffect, useState } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
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
 * `/settings/general` — restored 2026-05-17 (user request) to host the
 * three classic engine-level toggles: UI language, Cost basis method,
 * Quote poll interval.
 *
 * Locale + Quote Poll previously moved to /settings/display per spec
 * §12 A5; that move is reverted here. The Cost Basis dropdown is
 * restored as a single-option select (`WEIGHTED_AVERAGE`) — the schema
 * field has been retained for future FIFO/LIFO and is intentionally
 * visible so operators can see the active rule.
 */
export function GeneralSettingsClient() {
  const { locale: routeLocale, initialSettings } = useSettingsRouteContext();

  const [locale, setLocale] = useState<LocaleCode>(initialSettings?.locale ?? routeLocale);
  const [costBasisMethod, setCostBasisMethod] = useState<UserSettings["costBasisMethod"]>(
    initialSettings?.costBasisMethod ?? "WEIGHTED_AVERAGE",
  );
  const [quotePoll, setQuotePoll] = useState<string>(
    String(initialSettings?.quotePollIntervalSeconds ?? 10),
  );

  const dict = getDictionary(locale);

  const localeSave = useAutoSave<LocaleCode>({
    save: async (value) => {
      await patchSettings({ locale: value }, { keepalive: true });
    },
  });

  const costBasisSave = useAutoSave<UserSettings["costBasisMethod"]>({
    save: async (value) => {
      await patchSettings({ costBasisMethod: value });
    },
  });

  const quotePollSave = useAutoSave<number>({
    save: async (value) => {
      await patchSettings({ quotePollIntervalSeconds: value });
    },
    validate: (value) =>
      Number.isInteger(value) && value >= 1
        ? null
        : dict.settings.validationQuotePoll,
  });

  useEffect(() => {
    setLocale(initialSettings?.locale ?? routeLocale);
    setCostBasisMethod(initialSettings?.costBasisMethod ?? "WEIGHTED_AVERAGE");
    setQuotePoll(String(initialSettings?.quotePollIntervalSeconds ?? 10));
  }, [initialSettings, routeLocale]);

  return (
    <div className="space-y-6" data-testid="settings-section-general">
      {/* UI language */}
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        data-testid="general-language-section"
      >
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-foreground">
              {dict.settings.localeLabel}
            </h3>
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
            void localeSave.flush();
          }}
        >
          <SelectTrigger data-testid="settings-locale-select" className="w-full max-w-xs">
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

      {/* Cost basis */}
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        data-testid="general-cost-basis-section"
      >
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-foreground">
              {dict.settings.costBasisLabel}
            </h3>
            <TooltipInfo
              label={dict.settings.costBasisLabel}
              content={dict.tooltips.settingsCostBasis}
              triggerTestId="tooltip-settings-cost-basis-trigger"
              contentTestId="tooltip-settings-cost-basis-content"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {dict.settings.costBasisGuideBody}
          </p>
        </div>
        <Select
          value={costBasisMethod}
          onValueChange={(next) => {
            const value = next as UserSettings["costBasisMethod"];
            setCostBasisMethod(value);
            costBasisSave.commit(value);
          }}
        >
          <SelectTrigger data-testid="settings-cost-basis-select" className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="WEIGHTED_AVERAGE">{dict.settings.costBasisWeightedAverageOption}</SelectItem>
          </SelectContent>
        </Select>
        {costBasisSave.hasError ? (
          <p className="text-xs text-rose-600" role="alert">{costBasisSave.error}</p>
        ) : null}
      </section>

      {/* Quote Poll Interval */}
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        data-testid="general-quote-poll-section"
      >
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-foreground">
              {dict.settings.quotePollLabel}
            </h3>
            <TooltipInfo
              label={dict.settings.quotePollLabel}
              content={dict.tooltips.settingsQuotePoll}
              triggerTestId="tooltip-settings-quote-poll-trigger"
              contentTestId="tooltip-settings-quote-poll-content"
            />
          </div>
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
