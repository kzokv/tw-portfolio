"use client";

import type { ReactNode } from "react";
import { Card } from "../ui/Card";

export function RouteHeroPanel({
  eyebrow,
  title,
  description,
  metrics,
  testId,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metrics: Array<{ label: string; value: string; detail?: string }>;
  testId: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className="glass-panel overflow-hidden rounded-[34px] border border-slate-200/85 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(231,238,255,0.96))] px-5 py-6 shadow-[0_30px_70px_rgba(79,70,229,0.12)] sm:px-6 sm:py-7 md:px-8"
      data-testid={testId}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)] xl:items-start">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-indigo-500/80">{eyebrow}</p>
          <h2 className="mt-3 text-3xl leading-tight text-slate-950 sm:text-4xl">{title}</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
          {actions ? <div className="mt-5">{actions}</div> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-[24px] border border-indigo-100 bg-white/80 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{metric.value}</p>
              {metric.detail ? <p className="mt-2 text-sm text-slate-500">{metric.detail}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StatusStripCard({
  eyebrow,
  title,
  description,
  metrics,
  testId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metrics: Array<{ label: string; value: string }>;
  testId?: string;
}) {
  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.94)]" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">{eyebrow}</p>
      <h2 className="mt-2 text-2xl text-slate-950">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{metric.label}</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{metric.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
