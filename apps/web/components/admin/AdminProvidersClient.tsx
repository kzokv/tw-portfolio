"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProviderHealthStatusDto, ProviderHealthStatus } from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../ui/Popover";
import { cn } from "../../lib/utils";

const t: Record<string, string> = {
  pageTitle: "Provider Health",
  pageDescription: "Read-only provider health overview. Diagnose resolver issues, staged repairs, and guarded executions in Provider fixer.",
  migrationNote: "Provider repair and rerun controls moved to Provider fixer.",
  providerLabel: "Provider",
  statusLabel: "Status",
  lastSuccessLabel: "Last Success",
  lastFailedLabel: "Last Failed",
  errors24hLabel: "Errors (24h)",
  errors7dLabel: "Errors (7d)",
  rateLimits24hLabel: "Rate Limits (24h)",
  actionsLabel: "Actions",
  openFixerLabel: "Open fixer",
  collapseErrorsLabel: "Hide errors",
  expandErrorsLabel: "Show {count} errors",
  statusHealthy: "Healthy",
  statusDegraded: "Degraded",
  statusDown: "Down",
  statusAwaiting: "Awaiting first run",
  neverLabel: "Never",
  providerInfoFinmindTw:
    "Monitor TW daily-bar and dividend refresh health here. Use Provider fixer to diagnose unresolved or noisy TW provider failures.",
  providerInfoFinmindUs:
    "Monitor US daily-bar and dividend refresh health here. Use Provider fixer to diagnose unresolved or noisy US provider failures.",
  providerInfoYahooFinanceAu:
    "Monitor AU Yahoo warm-up and monitored refresh health here. Use Provider fixer for staged repair, diagnostics, and operator logs.",
  providerInfoTwelveDataAu:
    "Monitor AU catalog sync health here. Use Provider fixer to inspect diagnostics, operation phases, and audit evidence.",
  providerInfoYahooFinanceKr:
    "Monitor KR Yahoo coverage here. Durable KR binding proposals, preview tokens, and guarded repair execution now live in Provider fixer.",
  providerInfoTwelveDataKr:
    "Monitor KR catalog sync health here. Use Provider fixer to inspect KR evidence, staged operations, and active batch state.",
  providerInfoFrankfurter:
    "Monitor FX refresh health here. Use Provider fixer to inspect provider diagnostics, operation logs, and guardrail posture.",
  providerInfoAsxGicsCsv:
    "Monitor ASX enrichment health here. Use Provider fixer when enrichment batches need diagnosis or guarded re-execution.",
};

const providerDefaultQuery: Record<string, Record<string, string>> = {
  "yahoo-finance-kr": {
    resolverMode: "quote_first",
    errorCode: "yahoo_finance_kr_symbol_unresolved",
  },
};

function pascalCase(input: string): string {
  return input
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function resolveProviderInfo(providerId: string): string {
  return t[`providerInfo${pascalCase(providerId)}`] ?? t.migrationNote;
}

function buildFixerHref(providerId: string): string {
  const params = new URLSearchParams({ providerId });
  const defaults = providerDefaultQuery[providerId];
  if (defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      params.set(key, value);
    }
  }
  return `/admin/provider-fixer?${params.toString()}`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return t.neverLabel;
  return new Date(ts).toLocaleString();
}

function StatusBadge({
  status,
  providerId,
}: {
  status: ProviderHealthStatus;
  providerId: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        status === "healthy" && "bg-emerald-100 text-emerald-800",
        status === "degraded" && "bg-amber-100 text-amber-800",
        status === "down" && "bg-rose-100 text-rose-800",
        status === "awaiting" && "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
      )}
      data-testid={`provider-status-badge-${providerId}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "healthy" && "bg-emerald-500",
          status === "degraded" && "bg-amber-500",
          status === "down" && "bg-rose-500",
          status === "awaiting" && "bg-slate-400",
        )}
        aria-hidden="true"
      />
      {status === "healthy"
        ? t.statusHealthy
        : status === "degraded"
          ? t.statusDegraded
          : status === "down"
            ? t.statusDown
            : t.statusAwaiting}
    </span>
  );
}

function ErrorTrail({ provider }: { provider: ProviderHealthStatusDto }) {
  return (
    <div data-testid={`provider-error-trail-${provider.providerId}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Recent errors
      </p>
      <ol className="space-y-1.5">
        {provider.recentErrors.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-start gap-2 rounded-xl border border-rose-100 bg-card px-3 py-2 text-xs"
            data-testid={`provider-error-entry-${entry.id}`}
          >
            <span className="shrink-0 font-mono text-muted-foreground">
              {formatTimestamp(entry.occurredAt)}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                entry.errorClass === "rate_limit" && "bg-amber-100 text-amber-800",
                entry.errorClass === "http_4xx" && "bg-orange-100 text-orange-800",
                entry.errorClass === "http_5xx" && "bg-rose-100 text-rose-800",
                (entry.errorClass === "network" || entry.errorClass === "other") &&
                  "bg-slate-100 text-slate-700",
                entry.errorClass === "parse" && "bg-violet-100 text-violet-800",
              )}
            >
              {entry.errorClass}
            </span>
            {entry.errorMessage && (
              <span className="min-w-0 flex-1 break-words text-foreground">{entry.errorMessage}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProviderHelpTrigger({ providerId }: { providerId: string }) {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`provider-help-trigger-${providerId}`}
          className="cursor-help rounded text-left break-all hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {providerId}
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid={`provider-help-popover-${providerId}`}>
        {resolveProviderInfo(providerId)}
      </PopoverContent>
    </PopoverRoot>
  );
}

function ProviderTableRow({ provider }: { provider: ProviderHealthStatusDto }) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = provider.recentErrors.length > 0;

  return (
    <>
      <tr
        className="border-b border-border last:border-0"
        data-testid={`provider-row-${provider.providerId}`}
      >
        <td
          className="sticky left-0 z-10 border-r border-border bg-card px-4 py-4 font-mono text-sm font-medium text-foreground md:static md:border-r-0 md:bg-transparent"
          title={provider.providerId}
        >
          <ProviderHelpTrigger providerId={provider.providerId} />
        </td>
        <td className="px-4 py-4">
          <StatusBadge status={provider.status} providerId={provider.providerId} />
        </td>
        <td className="px-4 py-4 text-sm text-muted-foreground" title={provider.lastSuccessfulRun ?? ""}>
          {formatTimestamp(provider.lastSuccessfulRun)}
        </td>
        <td className="px-4 py-4 text-sm text-muted-foreground" title={provider.lastFailedRun ?? ""}>
          {formatTimestamp(provider.lastFailedRun)}
        </td>
        <td className="px-4 py-4 text-right text-sm text-foreground">{provider.errorCount24h}</td>
        <td className="px-4 py-4 text-right text-sm text-foreground">{provider.errorCount7d}</td>
        <td className="px-4 py-4 text-right text-sm text-foreground">{provider.rateLimitCount24h}</td>
        <td className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link
                href={buildFixerHref(provider.providerId)}
                data-testid={`provider-open-fixer-${provider.providerId}`}
              >
                {t.openFixerLabel}
              </Link>
            </Button>
            {hasErrors ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-xs text-primary underline decoration-primary/30 underline-offset-2 hover:text-primary/80"
                data-testid={`provider-errors-toggle-${provider.providerId}`}
              >
                {expanded
                  ? t.collapseErrorsLabel
                  : t.expandErrorsLabel.replace("{count}", String(provider.recentErrors.length))}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded && hasErrors ? (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={8} className="px-4 pb-4 pt-2">
            <ErrorTrail provider={provider} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CardDetail({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 text-sm font-medium text-foreground ${truncate ? "truncate" : "break-words"}`}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function ProviderMobileCard({ provider }: { provider: ProviderHealthStatusDto }) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = provider.recentErrors.length > 0;

  return (
    <article
      className="rounded-xl border border-border bg-card p-4"
      data-testid={`provider-row-${provider.providerId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t.providerLabel}</p>
          <p
            className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm font-medium text-foreground"
            title={provider.providerId}
          >
            <ProviderHelpTrigger providerId={provider.providerId} />
          </p>
        </div>
        <StatusBadge status={provider.status} providerId={provider.providerId} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <CardDetail label={t.lastSuccessLabel} value={formatTimestamp(provider.lastSuccessfulRun)} truncate />
        <CardDetail label={t.lastFailedLabel} value={formatTimestamp(provider.lastFailedRun)} truncate />
        <CardDetail label={t.errors24hLabel} value={String(provider.errorCount24h)} truncate />
        <CardDetail label={t.errors7dLabel} value={String(provider.errorCount7d)} truncate />
        <CardDetail label={t.rateLimits24hLabel} value={String(provider.rateLimitCount24h)} truncate />
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button asChild size="sm" variant="secondary" className="w-full sm:w-auto">
          <Link
            href={buildFixerHref(provider.providerId)}
            data-testid={`provider-open-fixer-${provider.providerId}`}
          >
            {t.openFixerLabel}
          </Link>
        </Button>
        {hasErrors ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs text-primary underline decoration-primary/30 underline-offset-2 hover:text-primary/80"
            data-testid={`provider-errors-toggle-${provider.providerId}`}
          >
            {expanded
              ? t.collapseErrorsLabel
              : t.expandErrorsLabel.replace("{count}", String(provider.recentErrors.length))}
          </button>
        ) : null}
      </div>

      {expanded && hasErrors ? (
        <div className="mt-3 rounded-xl bg-muted/30 p-3">
          <ErrorTrail provider={provider} />
        </div>
      ) : null}
    </article>
  );
}

interface AdminProvidersClientProps {
  providers: ProviderHealthStatusDto[];
}

export function AdminProvidersClient({ providers }: AdminProvidersClientProps) {
  const columns: DataTableColumn<ProviderHealthStatusDto>[] = [
    { key: "provider", header: t.providerLabel, render: (provider) => provider.providerId, cellClassName: "px-4 py-3.5 align-top" },
    { key: "status", header: t.statusLabel, render: (provider) => provider.status, cellClassName: "px-4 py-3.5 align-top" },
    { key: "lastSuccess", header: t.lastSuccessLabel, render: (provider) => formatTimestamp(provider.lastSuccessfulRun), cellClassName: "px-4 py-3.5 align-top" },
    { key: "lastFailed", header: t.lastFailedLabel, render: (provider) => formatTimestamp(provider.lastFailedRun), cellClassName: "px-4 py-3.5 align-top" },
    { key: "errors24h", header: t.errors24hLabel, render: (provider) => provider.errorCount24h, cellClassName: "px-4 py-3.5 align-top" },
    { key: "errors7d", header: t.errors7dLabel, render: (provider) => provider.errorCount7d, cellClassName: "px-4 py-3.5 align-top" },
    { key: "rateLimits24h", header: t.rateLimits24hLabel, render: (provider) => provider.rateLimitCount24h, cellClassName: "px-4 py-3.5 align-top" },
    { key: "actions", header: t.actionsLabel, render: () => null, cellClassName: "px-4 py-3.5 align-top" },
  ];

  return (
    <Card data-testid="admin-providers-section">
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">{t.pageTitle}</p>
        <h1 className="mt-2 text-2xl text-foreground sm:text-3xl">{t.pageTitle}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{t.pageDescription}</p>
        <div
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="admin-providers-read-only-note"
        >
          {t.migrationNote}
        </div>
      </div>

      <DataTable
        data-testid="admin-providers-table"
        data={providers}
        columns={columns}
        rowKey={(provider) => provider.providerId}
        tableClassName="[&_th]:bg-slate-50/80 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-slate-500 [&_tr]:border-slate-100"
        renderRow={(provider) => <ProviderTableRow provider={provider} key={provider.providerId} />}
        mobileRow={(provider) => <ProviderMobileCard provider={provider} />}
      />
    </Card>
  );
}
