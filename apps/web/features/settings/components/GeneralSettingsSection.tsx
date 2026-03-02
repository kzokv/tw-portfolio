"use client";

import type { UserSettings } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { TooltipInfo } from "../../../components/ui/TooltipInfo";

interface GeneralSettingsSectionProps {
  locale: UserSettings["locale"];
  costBasisMethod: UserSettings["costBasisMethod"];
  quotePollInterval: string;
  onLocaleChange: (locale: UserSettings["locale"]) => void;
  onCostBasisChange: (costBasisMethod: UserSettings["costBasisMethod"]) => void;
  onQuotePollIntervalChange: (value: string) => void;
  dict: AppDictionary;
}

export function GeneralSettingsSection({
  locale,
  costBasisMethod,
  quotePollInterval,
  onLocaleChange,
  onCostBasisChange,
  onQuotePollIntervalChange,
  dict,
}: GeneralSettingsSectionProps) {
  return (
    <>
      <label className="block space-y-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {dict.settings.localeLabel}
          <TooltipInfo
            label={dict.settings.localeLabel}
            content={dict.tooltips.settingsLocale}
            triggerTestId="tooltip-settings-locale-trigger"
            contentTestId="tooltip-settings-locale-content"
          />
        </span>
        <select
          value={locale}
          onChange={(event) => onLocaleChange(event.target.value as UserSettings["locale"])}
          className={fieldClassName}
          data-testid="settings-locale-select"
        >
          <option value="en">{dict.settings.localeOptionEnglish}</option>
          <option value="zh-TW">{dict.settings.localeOptionTraditionalChinese}</option>
        </select>
      </label>

      <label className="block space-y-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {dict.settings.costBasisLabel}
          <TooltipInfo
            label={dict.settings.costBasisLabel}
            content={dict.tooltips.settingsCostBasis}
            triggerTestId="tooltip-settings-cost-basis-trigger"
            contentTestId="tooltip-settings-cost-basis-content"
          />
        </span>
        <select
          value={costBasisMethod}
          onChange={(event) => onCostBasisChange(event.target.value as UserSettings["costBasisMethod"])}
          className={fieldClassName}
          data-testid="settings-cost-basis-select"
        >
          <option value="FIFO">FIFO</option>
          <option value="LIFO">LIFO</option>
        </select>
      </label>

      <div className="glass-inset grid gap-2 rounded-[20px] p-4 text-xs text-slate-300">
        <p className="font-semibold text-ink">{dict.settings.costBasisGuideTitle}</p>
        <div className="flex items-center gap-1">
          <span className="font-semibold">FIFO</span>
          <TooltipInfo
            label="FIFO"
            content={dict.tooltips.fifoMethod}
            triggerTestId="tooltip-fifo-trigger"
            contentTestId="tooltip-fifo-content"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="font-semibold">LIFO</span>
          <TooltipInfo
            label="LIFO"
            content={dict.tooltips.lifoMethod}
            triggerTestId="tooltip-lifo-trigger"
            contentTestId="tooltip-lifo-content"
          />
        </div>
      </div>

      <label className="block space-y-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {dict.settings.quotePollLabel} ({dict.settings.quotePollUnit})
          <TooltipInfo
            label={dict.settings.quotePollLabel}
            content={dict.tooltips.settingsQuotePoll}
            triggerTestId="tooltip-settings-quote-poll-trigger"
            contentTestId="tooltip-settings-quote-poll-content"
          />
        </span>
        <input
          type="number"
          min={1}
          value={quotePollInterval}
          onChange={(event) => onQuotePollIntervalChange(event.target.value)}
          className={fieldClassName}
          data-testid="settings-quote-poll-input"
        />
      </label>
    </>
  );
}
