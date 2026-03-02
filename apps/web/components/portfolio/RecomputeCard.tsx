import type { UserSettings } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { TooltipInfo } from "../ui/TooltipInfo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface RecomputeCardProps {
  settings: UserSettings | null;
  pending: boolean;
  onRecompute: () => Promise<void>;
  dict: AppDictionary;
}

export function RecomputeCard({ settings, pending, onRecompute, dict }: RecomputeCardProps) {
  const localeLabel = settings?.locale === "zh-TW" ? dict.settings.localeOptionTraditionalChinese : dict.settings.localeOptionEnglish;

  return (
    <Card>
      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-xl leading-tight text-ink sm:text-2xl md:text-[2rem]">{dict.recompute.title}</h2>
            <TooltipInfo
              label={dict.recompute.title}
              content={dict.tooltips.recomputeTitle}
              triggerTestId="tooltip-recompute-title-trigger"
              contentTestId="tooltip-recompute-title-content"
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{dict.recompute.description}</p>
        </div>
        <Button
          onClick={() => onRecompute()}
          disabled={pending}
          data-testid="recompute-button"
          className="w-full min-w-0 whitespace-normal text-center sm:w-auto"
        >
          {pending ? dict.actions.recomputing : dict.actions.recomputeHistory}
        </Button>
      </div>

      <dl className="mt-6 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="glass-inset min-w-0 rounded-[20px] p-4">
          <dt className="flex min-w-0 items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <span className="min-w-0">{dict.recompute.localeTerm}</span>
            <TooltipInfo
              label={dict.recompute.localeTerm}
              content={dict.tooltips.recomputeLocale}
              triggerTestId="tooltip-recompute-locale-trigger"
              contentTestId="tooltip-recompute-locale-content"
            />
          </dt>
          <dd className="mt-2 min-w-0 break-words text-base font-semibold text-ink" data-testid="settings-locale-value">
            {localeLabel}
          </dd>
        </div>
        <div className="glass-inset min-w-0 rounded-[20px] p-4">
          <dt className="flex min-w-0 items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <span className="min-w-0">{dict.recompute.costBasisTerm}</span>
            <TooltipInfo
              label={dict.recompute.costBasisTerm}
              content={dict.tooltips.recomputeCostBasis}
              triggerTestId="tooltip-recompute-cost-basis-trigger"
              contentTestId="tooltip-recompute-cost-basis-content"
            />
          </dt>
          <dd className="mt-2 min-w-0 break-words text-base font-semibold text-ink" data-testid="settings-cost-basis-value">
            {settings?.costBasisMethod ?? "-"}
          </dd>
        </div>
        <div className="glass-inset min-w-0 rounded-[20px] p-4">
          <dt className="flex min-w-0 items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <span className="min-w-0">{dict.recompute.quotePollTerm}</span>
            <TooltipInfo
              label={dict.recompute.quotePollTerm}
              content={dict.tooltips.recomputeQuotePoll}
              triggerTestId="tooltip-recompute-quote-poll-trigger"
              contentTestId="tooltip-recompute-quote-poll-content"
            />
          </dt>
          <dd className="mt-2 min-w-0 break-words text-base font-semibold text-ink" data-testid="settings-quote-poll-value">
            {settings?.quotePollIntervalSeconds ?? "-"} {dict.settings.quotePollUnit}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
