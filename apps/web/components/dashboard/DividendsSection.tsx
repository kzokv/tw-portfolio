"use client";

import { useState } from "react";
import type {
  DashboardOverviewRecentDividendDto,
  DashboardOverviewUpcomingDividendDto,
  LocaleCode,
} from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel } from "../../lib/utils";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface DividendsSectionProps {
  upcoming: DashboardOverviewUpcomingDividendDto[];
  recent: DashboardOverviewRecentDividendDto[];
  dict: AppDictionary;
  locale: LocaleCode;
}

export function DividendsSection({ upcoming, recent, dict, locale }: DividendsSectionProps) {
  const [tab, setTab] = useState<"upcoming" | "recent">("upcoming");
  const items = tab === "upcoming" ? upcoming : recent;

  return (
    <Card data-testid="dashboard-dividends-section">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{dict.dashboardHome.dividendsTitle}</p>
          <h2 className="mt-2 text-2xl text-ink sm:text-3xl">{dict.dashboardHome.dividendsTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{dict.dashboardHome.dividendsDescription}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "upcoming" ? "default" : "secondary"}
            size="sm"
            onClick={() => setTab("upcoming")}
            data-testid="dividends-tab-upcoming"
          >
            {dict.dashboardHome.dividendsUpcomingTab}
          </Button>
          <Button
            variant={tab === "recent" ? "default" : "secondary"}
            size="sm"
            onClick={() => setTab("recent")}
            data-testid="dividends-tab-recent"
          >
            {dict.dashboardHome.dividendsRecentTab}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-[22px] border border-dashed border-white/15 bg-slate-950/30 px-5 py-8 text-sm text-slate-300">
          {tab === "upcoming" ? dict.dashboardHome.dividendsEmptyUpcoming : dict.dashboardHome.dividendsEmptyRecent}
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {tab === "upcoming"
            ? upcoming.map((item) => (
              <article
                key={`${item.accountId}-${item.symbol}-${item.paymentDate ?? item.exDividendDate ?? "na"}`}
                className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold tracking-[0.12em] text-slate-50">{item.symbol}</p>
                    <p className="mt-1 text-sm text-slate-400">{item.accountId}</p>
                  </div>
                  <StatusPill label={resolveUpcomingStatusLabel(dict, item.status)} />
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                  <DividendDetail
                    label={dict.dashboardHome.exDividendDateLabel}
                    value={item.exDividendDate ? formatDateLabel(item.exDividendDate, locale) : "-"}
                  />
                  <DividendDetail
                    label={dict.dashboardHome.paymentDateLabel}
                    value={item.paymentDate ? formatDateLabel(item.paymentDate, locale) : "-"}
                  />
                  <DividendDetail
                    label={dict.dashboardHome.expectedAmountLabel}
                    value={item.expectedAmount !== null ? formatCurrencyAmount(item.expectedAmount, item.currency, locale) : "-"}
                  />
                </dl>
              </article>
            ))
            : recent.map((item) => (
              <article
                key={`${item.accountId}-${item.symbol}-${item.postedAt}`}
                className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold tracking-[0.12em] text-slate-50">{item.symbol}</p>
                    <p className="mt-1 text-sm text-slate-400">{item.accountId}</p>
                  </div>
                  <StatusPill label={item.status === "posted" ? dict.dashboardHome.statusPosted : dict.dashboardHome.statusUnreconciled} />
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                  <DividendDetail label={dict.dashboardHome.paymentDateLabel} value={formatDateLabel(item.postedAt, locale)} />
                  <DividendDetail label={dict.dashboardHome.netAmountLabel} value={formatCurrencyAmount(item.netAmount, item.currency, locale)} />
                  <DividendDetail
                    label={dict.dashboardHome.grossAmountLabel}
                    value={item.grossAmount !== null ? formatCurrencyAmount(item.grossAmount, item.currency, locale) : "-"}
                  />
                  <DividendDetail
                    label={dict.dashboardHome.deductionAmountLabel}
                    value={item.deductionAmount !== null ? formatCurrencyAmount(item.deductionAmount, item.currency, locale) : "-"}
                  />
                </dl>
              </article>
            ))}
        </div>
      )}
    </Card>
  );
}

function DividendDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <p className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-200">
      {label}
    </p>
  );
}

function resolveUpcomingStatusLabel(
  dict: AppDictionary,
  status: DashboardOverviewUpcomingDividendDto["status"],
): string {
  if (status === "expected") return dict.dashboardHome.statusExpected;
  if (status === "paying-soon") return dict.dashboardHome.statusPayingSoon;
  return dict.dashboardHome.statusDeclared;
}
