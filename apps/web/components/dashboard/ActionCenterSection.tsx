import type { LocaleCode, UserSettings } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface ActionCenterSectionProps {
  locale: LocaleCode;
  settings: UserSettings | null;
  integrityIssue: { code: string; message: string } | null;
  pending: boolean;
  onRecompute: () => Promise<void>;
  onOpenSettings: () => void;
  dict: AppDictionary;
}

export function ActionCenterSection({
  locale,
  settings,
  integrityIssue,
  pending,
  onRecompute,
  onOpenSettings,
  dict,
}: ActionCenterSectionProps) {
  const localeLabel = locale === "zh-TW" ? dict.settings.localeOptionTraditionalChinese : dict.settings.localeOptionEnglish;

  return (
    <Card data-testid="dashboard-actions-section">
      <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-500/78">{dict.dashboardHome.actionTitle}</p>
      <h2 className="mt-2 text-2xl text-slate-950">{dict.dashboardHome.actionTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{dict.dashboardHome.actionDescription}</p>

      {integrityIssue ? (
        <div className="mt-6 rounded-[22px] border border-[rgba(251,113,133,0.24)] bg-[rgba(254,226,226,0.92)] p-4 text-sm text-rose-700">
          <p className="font-semibold text-rose-800">{dict.dialogs.integrityTitle}</p>
          <p className="mt-2">{integrityIssue.message}</p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              {dict.actions.openSettings}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[22px] border border-[rgba(52,211,153,0.2)] bg-[rgba(236,253,245,0.96)] p-4 text-sm text-emerald-700">
          <p className="font-semibold">{dict.dashboardHome.actionHealthyTitle}</p>
          <p className="mt-2 text-emerald-700/85">{dict.dashboardHome.actionHealthyDescription}</p>
        </div>
      )}

      <div className="mt-6 grid gap-3">
        <div className="glass-inset rounded-[22px] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.dashboardHome.recomputeSummaryTitle}</p>
          <dl className="mt-3 grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">{dict.recompute.localeTerm}</dt>
              <dd className="font-medium text-slate-900" data-testid="settings-locale-value">{localeLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">{dict.recompute.costBasisTerm}</dt>
              <dd className="font-medium text-slate-900" data-testid="settings-cost-basis-value">
                {dict.settings.costBasisWeightedAverageOption}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">{dict.recompute.quotePollTerm}</dt>
              <dd className="font-medium text-slate-900" data-testid="settings-quote-poll-value">
                {settings?.quotePollIntervalSeconds ?? "-"} {dict.settings.quotePollUnit}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6">
        <Button onClick={() => onRecompute()} disabled={pending} data-testid="recompute-button" className="w-full">
          {pending ? dict.actions.recomputing : dict.actions.recomputeHistory}
        </Button>
      </div>
    </Card>
  );
}
