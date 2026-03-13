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
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{dict.dashboardHome.actionTitle}</p>
      <h2 className="mt-2 text-2xl text-ink">{dict.dashboardHome.actionTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">{dict.dashboardHome.actionDescription}</p>

      {integrityIssue ? (
        <div className="mt-6 rounded-[22px] border border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.12)] p-4 text-sm text-rose-100">
          <p className="font-semibold text-rose-50">{dict.dialogs.integrityTitle}</p>
          <p className="mt-2">{integrityIssue.message}</p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              {dict.actions.openSettings}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[22px] border border-[rgba(52,211,153,0.24)] bg-[rgba(52,211,153,0.12)] p-4 text-sm text-emerald-50">
          <p className="font-semibold">{dict.dashboardHome.actionHealthyTitle}</p>
          <p className="mt-2 text-emerald-100/90">{dict.dashboardHome.actionHealthyDescription}</p>
        </div>
      )}

      <div className="mt-6 grid gap-3">
        <div className="glass-inset rounded-[22px] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{dict.dashboardHome.recomputeSummaryTitle}</p>
          <dl className="mt-3 grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-400">{dict.recompute.localeTerm}</dt>
              <dd className="font-medium text-slate-100" data-testid="settings-locale-value">{localeLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-400">{dict.recompute.costBasisTerm}</dt>
              <dd className="font-medium text-slate-100" data-testid="settings-cost-basis-value">
                {dict.settings.costBasisWeightedAverageOption}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-400">{dict.recompute.quotePollTerm}</dt>
              <dd className="font-medium text-slate-100" data-testid="settings-quote-poll-value">
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
