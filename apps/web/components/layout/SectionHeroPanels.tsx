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
      className="overflow-hidden rounded-xl border border-border bg-card px-5 py-6 shadow-sm sm:px-6 sm:py-7 md:px-8"
      data-testid={testId}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)] xl:items-start">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-primary/80">{eyebrow}</p>
          <h2 className="mt-3 text-3xl leading-tight text-foreground sm:text-4xl">{title}</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">{description}</p>
          {actions ? <div className="mt-5">{actions}</div> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border bg-muted/30 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{metric.value}</p>
              {metric.detail ? <p className="mt-2 text-sm text-muted-foreground">{metric.detail}</p> : null}
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
    <Card data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">{eyebrow}</p>
      <h2 className="mt-2 text-2xl text-foreground">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{metric.label}</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{metric.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
