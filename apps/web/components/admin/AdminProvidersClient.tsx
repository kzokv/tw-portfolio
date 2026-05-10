"use client";

import { useCallback, useState } from "react";
import type { ProviderHealthStatusDto, ProviderHealthStatus } from "@tw-portfolio/shared-types";
import { postJson, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TooltipInfo } from "../ui/TooltipInfo";
import { cn } from "../../lib/utils";
import { formatCooldownLabel } from "../../lib/formatCooldownLabel";

// i18n strings — string templates only, no function values
// (per .claude/rules/nextjs-i18n-serialization.md)
// Flat Record<string, string> — per .claude/rules/i18n-flat-record-dict-settings.md
const t: Record<string, string> = {
  pageTitle: "Provider Health",
  pageDescription: "Monitor market data provider status and trigger manual re-runs.",
  providerLabel: "Provider",
  statusLabel: "Status",
  lastSuccessLabel: "Last Success",
  lastFailedLabel: "Last Failed",
  errors24hLabel: "Errors (24h)",
  errors7dLabel: "Errors (7d)",
  rateLimits24hLabel: "Rate Limits (24h)",
  rerunButtonLabel: "Re-run now",
  rerunCooldownLabel: "Retry in {seconds}s",
  rerunningLabel: "Running…",
  collapseErrorsLabel: "Hide errors",
  expandErrorsLabel: "Show {count} errors",
  noErrorsLabel: "No recent errors",
  statusHealthy: "Healthy",
  statusDegraded: "Degraded",
  statusDown: "Down",
  statusAwaiting: "Awaiting first run",
  neverLabel: "Never",
  // Per-provider rerun tooltip strings — KZO-197.
  // {cooldown} placeholder is interpolated via formatCooldownLabel(provider.rerunCooldownMs).
  rerunTooltipFinmindTw:
    "Refreshes daily bars + dividends for monitored TW tickers via FinMind. Cooldown {cooldown}.",
  rerunTooltipFinmindUs:
    "Refreshes daily bars + dividends for monitored US tickers via FinMind. Cooldown {cooldown}.",
  rerunTooltipYahooFinanceAu:
    "Warms uncached AU catalog rows AND refreshes monitored AU tickers via Yahoo Finance. Fresh deploys process ~2,400 jobs over ~40 min. Cooldown {cooldown}.",
  rerunTooltipTwelveDataAu:
    "Re-syncs the AU instrument universe via Twelve Data (catalog metadata only — no bars). Cooldown {cooldown}.",
  rerunTooltipFrankfurter:
    "Refreshes today's FX rates from Frankfurter (ECB-backed). Cooldown {cooldown}.",
  rerunTooltipAsxGicsCsv:
    "Re-runs ASX GICS sector + industry-group enrichment from the S&P/ASX CSV. Cooldown {cooldown}.",
  rerunTooltipTriggerLabel: "About this provider's Re-run action",
};

/**
 * Convert a kebab-case providerId (e.g. "yahoo-finance-au") into the
 * PascalCase suffix used in the i18n dict keys ("YahooFinanceAu").
 * Unknown providerIds simply return an empty-suffix key, which the caller
 * handles via the `?? ""` fallback below.
 */
function pascalCase(input: string): string {
  return input
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function resolveRerunTooltipContent(provider: ProviderHealthStatusDto): string {
  const key = `rerunTooltip${pascalCase(provider.providerId)}`;
  const template = t[key] ?? "";
  return template.replace("{cooldown}", formatCooldownLabel(provider.rerunCooldownMs));
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return t.neverLabel;
  return new Date(ts).toLocaleString();
}

function StatusBadge({
  status,
  providerId,
  testIdPrefix = "provider-status-badge",
}: {
  status: ProviderHealthStatus;
  providerId: string;
  testIdPrefix?: string;
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
      data-testid={`${testIdPrefix}-${providerId}`}
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

function useProviderRow(provider: ProviderHealthStatusDto) {
  const [expanded, setExpanded] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [cooldownSecondsRemaining, setCooldownSecondsRemaining] = useState<number | null>(null);
  const [localStatus, setLocalStatus] = useState<ProviderHealthStatusDto>(provider);

  const handleRerun = useCallback(async () => {
    if (isRerunning || cooldownSecondsRemaining !== null) return;

    setIsRerunning(true);
    try {
      await postJson<void>(`/admin/providers/${encodeURIComponent(localStatus.providerId)}/rerun`, {});
      setLocalStatus((prev) => ({ ...prev, lastManualRerunAt: new Date().toISOString() }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // Prefer the server's `Retry-After` advice (the route writes the
        // *remaining* cooldown in seconds, which can be much shorter than
        // the configured window if the user clicks near the cooldown's
        // end). Fall back to `provider.rerunCooldownMs / 1000` only when
        // the header is absent or unparseable.
        const headerSeconds = err.retryAfterSeconds;
        const fallbackSeconds = Math.max(1, Math.ceil(localStatus.rerunCooldownMs / 1000));
        const retryAfter =
          typeof headerSeconds === "number" && Number.isFinite(headerSeconds) && headerSeconds > 0
            ? headerSeconds
            : fallbackSeconds;
        setCooldownSecondsRemaining(retryAfter);
        const interval = setInterval(() => {
          setCooldownSecondsRemaining((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(interval);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } finally {
      setIsRerunning(false);
    }
  }, [isRerunning, cooldownSecondsRemaining, localStatus.providerId, localStatus.rerunCooldownMs]);

  const rerunLabel = isRerunning
    ? t.rerunningLabel
    : cooldownSecondsRemaining !== null
      ? t.rerunCooldownLabel.replace("{seconds}", String(cooldownSecondsRemaining))
      : t.rerunButtonLabel;

  const hasErrors = localStatus.recentErrors.length > 0;

  return {
    localStatus,
    expanded,
    setExpanded,
    isRerunning,
    cooldownSecondsRemaining,
    handleRerun,
    rerunLabel,
    hasErrors,
  };
}

function ErrorTrail({
  provider,
  testIdPrefix = "provider-error-trail",
}: {
  provider: ProviderHealthStatusDto;
  testIdPrefix?: string;
}) {
  return (
    <div data-testid={`${testIdPrefix}-${provider.providerId}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Recent errors
      </p>
      <ol className="space-y-1.5">
        {provider.recentErrors.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-start gap-2 rounded-xl border border-rose-100 bg-white px-3 py-2 text-xs"
            data-testid={`provider-error-entry-${entry.id}`}
          >
            <span className="shrink-0 font-mono text-slate-500">
              {formatTimestamp(entry.occurredAt)}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                entry.errorClass === "rate_limit" && "bg-amber-100 text-amber-800",
                entry.errorClass === "http_4xx" && "bg-orange-100 text-orange-800",
                entry.errorClass === "http_5xx" && "bg-rose-100 text-rose-800",
                entry.errorClass === "network" && "bg-slate-100 text-slate-700",
                entry.errorClass === "parse" && "bg-violet-100 text-violet-800",
                entry.errorClass === "other" && "bg-slate-100 text-slate-700",
              )}
            >
              {entry.errorClass}
            </span>
            {entry.errorMessage && (
              <span className="min-w-0 flex-1 break-words text-slate-700">{entry.errorMessage}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProviderRow({ provider }: { provider: ProviderHealthStatusDto }) {
  const {
    localStatus,
    expanded,
    setExpanded,
    isRerunning,
    cooldownSecondsRemaining,
    handleRerun,
    rerunLabel,
    hasErrors,
  } = useProviderRow(provider);

  return (
    <>
      <tr
        className="border-b border-slate-200 last:border-0"
        data-testid={`provider-row-${localStatus.providerId}`}
      >
        <td className="px-4 py-4 font-mono text-sm font-medium text-slate-900 break-all">
          <span className="inline-flex items-center gap-1.5">
            <span>{localStatus.providerId}</span>
            <TooltipInfo
              label={t.rerunTooltipTriggerLabel}
              content={resolveRerunTooltipContent(localStatus)}
              triggerTestId={`provider-rerun-tooltip-trigger-${localStatus.providerId}`}
              contentTestId={`provider-rerun-tooltip-content-${localStatus.providerId}`}
            />
          </span>
        </td>
        <td className="px-4 py-4">
          <StatusBadge status={localStatus.status} providerId={localStatus.providerId} />
        </td>
        <td className="px-4 py-4 text-sm text-slate-600">
          {formatTimestamp(localStatus.lastSuccessfulRun)}
        </td>
        <td className="px-4 py-4 text-sm text-slate-600">
          {formatTimestamp(localStatus.lastFailedRun)}
        </td>
        <td className="px-4 py-4 text-right text-sm text-slate-700">
          {localStatus.errorCount24h}
        </td>
        <td className="px-4 py-4 text-right text-sm text-slate-700">
          {localStatus.errorCount7d}
        </td>
        <td className="px-4 py-4 text-right text-sm text-slate-700">
          {localStatus.rateLimitCount24h}
        </td>
        <td className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRerun}
              disabled={isRerunning || cooldownSecondsRemaining !== null}
              data-testid={`provider-rerun-btn-${localStatus.providerId}`}
            >
              {rerunLabel}
            </Button>
            {hasErrors && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-xs text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
                data-testid={`provider-errors-toggle-${localStatus.providerId}`}
              >
                {expanded
                  ? t.collapseErrorsLabel
                  : t.expandErrorsLabel.replace("{count}", String(localStatus.recentErrors.length))}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && hasErrors && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={8} className="px-4 pb-4 pt-2">
            <ErrorTrail provider={localStatus} />
          </td>
        </tr>
      )}
    </>
  );
}

function ProviderCard({ provider }: { provider: ProviderHealthStatusDto }) {
  const {
    localStatus,
    expanded,
    setExpanded,
    isRerunning,
    cooldownSecondsRemaining,
    handleRerun,
    rerunLabel,
    hasErrors,
  } = useProviderRow(provider);

  return (
    <article
      className="rounded-[22px] border border-slate-200 bg-white/92 p-4 shadow-[0_16px_30px_rgba(148,163,184,0.12)]"
      data-testid={`provider-card-${localStatus.providerId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t.providerLabel}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 break-all font-mono text-sm font-medium text-slate-900">
            <span>{localStatus.providerId}</span>
            <TooltipInfo
              label={t.rerunTooltipTriggerLabel}
              content={resolveRerunTooltipContent(localStatus)}
              triggerTestId={`provider-rerun-tooltip-trigger-card-${localStatus.providerId}`}
              contentTestId={`provider-rerun-tooltip-content-card-${localStatus.providerId}`}
            />
          </p>
        </div>
        <StatusBadge
          status={localStatus.status}
          providerId={localStatus.providerId}
          testIdPrefix="provider-status-badge-card"
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <CardDetail label={t.lastSuccessLabel} value={formatTimestamp(localStatus.lastSuccessfulRun)} />
        <CardDetail label={t.lastFailedLabel} value={formatTimestamp(localStatus.lastFailedRun)} />
        <CardDetail label={t.errors24hLabel} value={String(localStatus.errorCount24h)} />
        <CardDetail label={t.errors7dLabel} value={String(localStatus.errorCount7d)} />
        <CardDetail label={t.rateLimits24hLabel} value={String(localStatus.rateLimitCount24h)} />
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleRerun}
          disabled={isRerunning || cooldownSecondsRemaining !== null}
          data-testid={`provider-rerun-btn-card-${localStatus.providerId}`}
          className="w-full sm:w-auto"
        >
          {rerunLabel}
        </Button>
        {hasErrors && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
            data-testid={`provider-errors-toggle-card-${localStatus.providerId}`}
          >
            {expanded
              ? t.collapseErrorsLabel
              : t.expandErrorsLabel.replace("{count}", String(localStatus.recentErrors.length))}
          </button>
        )}
      </div>

      {expanded && hasErrors && (
        <div className="mt-3 rounded-xl bg-slate-50/60 p-3">
          <ErrorTrail provider={localStatus} testIdPrefix="provider-error-trail-card" />
        </div>
      )}
    </article>
  );
}

function CardDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

interface AdminProvidersClientProps {
  providers: ProviderHealthStatusDto[];
}

export function AdminProvidersClient({ providers }: AdminProvidersClientProps) {
  return (
    <Card data-testid="admin-providers-section">
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-500/78">{t.pageTitle}</p>
        <h1 className="mt-2 text-2xl text-slate-950 sm:text-3xl">{t.pageTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{t.pageDescription}</p>
      </div>

      <div className="hidden overflow-x-auto rounded-[22px] border border-slate-200 bg-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] lg:block">
        <table
          className="min-w-[900px] border-collapse text-sm text-slate-700"
          data-testid="admin-providers-table"
        >
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <th className="px-4 py-3 text-left font-medium">{t.providerLabel}</th>
              <th className="px-4 py-3 text-left font-medium">{t.statusLabel}</th>
              <th className="px-4 py-3 text-left font-medium">{t.lastSuccessLabel}</th>
              <th className="px-4 py-3 text-left font-medium">{t.lastFailedLabel}</th>
              <th className="px-4 py-3 text-right font-medium">{t.errors24hLabel}</th>
              <th className="px-4 py-3 text-right font-medium">{t.errors7dLabel}</th>
              <th className="px-4 py-3 text-right font-medium">{t.rateLimits24hLabel}</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <ProviderRow key={provider.providerId} provider={provider} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden" data-testid="admin-providers-cards">
        {providers.map((provider) => (
          <ProviderCard key={provider.providerId} provider={provider} />
        ))}
      </div>
    </Card>
  );
}
