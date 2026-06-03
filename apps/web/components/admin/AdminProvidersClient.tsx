"use client";

import { useCallback, useState } from "react";
import type { ProviderHealthStatusDto, ProviderHealthStatus } from "@vakwen/shared-types";
import { postJson, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { PopoverRoot, PopoverTrigger, PopoverContent } from "../ui/Popover";
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
  actionsLabel: "Actions",
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
  rerunTooltipYahooFinanceKr:
    "Warms pending or failed KR bar backfills AND refreshes monitored KR tickers via Yahoo Finance. Quote-first is the safe default; chart_probe_v1 requires acknowledgement. Cooldown {cooldown}.",
  rerunTooltipTwelveDataKr:
    "Re-syncs the KR instrument universe via Twelve Data (catalog metadata only — no bars). Cooldown {cooldown}.",
  rerunTooltipFrankfurter:
    "Refreshes today's FX rates from Frankfurter (ECB-backed). Cooldown {cooldown}.",
  rerunTooltipAsxGicsCsv:
    "Re-runs ASX GICS sector + industry-group enrichment from the S&P/ASX CSV. Cooldown {cooldown}.",
  resolverModeLabel: "KR resolver mode",
  resolverModeSafeLabel: "Quote-first (safer, lower upstream noise)",
  resolverModeProbeLabel: "chart_probe_v1 (repair mode, higher call cost)",
  resolverModeAckLabel:
    "I understand this mode is for resolver repair and may increase API calls.",
  resolverModeAckHint: "Enable only when KR symbols fail resolve in bulk.",
};

type ResolverMode = "quote_first" | "chart_probe_v1";

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

function useProviderRow(provider: ProviderHealthStatusDto) {
  const [expanded, setExpanded] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [cooldownSecondsRemaining, setCooldownSecondsRemaining] = useState<number | null>(null);
  const [localStatus, setLocalStatus] = useState<ProviderHealthStatusDto>(provider);
  const [resolverMode, setResolverMode] = useState<ResolverMode>("quote_first");
  const [resolverModeAcknowledged, setResolverModeAcknowledged] = useState(false);

  const handleRerun = useCallback(async () => {
    if (isRerunning || cooldownSecondsRemaining !== null) return;
    if (localStatus.providerId === "yahoo-finance-kr" && resolverMode === "chart_probe_v1" && !resolverModeAcknowledged) {
      return;
    }

    const body =
      localStatus.providerId === "yahoo-finance-kr"
        ? {
            resolverMode,
            ...(resolverMode === "chart_probe_v1"
              ? { resolverModeRiskAccepted: resolverModeAcknowledged }
              : {}),
          }
        : {};

    setIsRerunning(true);
    try {
      await postJson<void>(`/admin/providers/${encodeURIComponent(localStatus.providerId)}/rerun`, body);
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
  }, [
    isRerunning,
    cooldownSecondsRemaining,
    localStatus.providerId,
    localStatus.rerunCooldownMs,
    resolverMode,
    resolverModeAcknowledged,
  ]);

  const isKrResolverRepairMode = localStatus.providerId === "yahoo-finance-kr" && resolverMode === "chart_probe_v1";
  const rerunButtonDisabled =
    isRerunning || cooldownSecondsRemaining !== null || isKrResolverRepairMode && !resolverModeAcknowledged;

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
    isKrResolverRepairMode,
    resolverMode,
    setResolverMode,
    resolverModeAcknowledged,
    setResolverModeAcknowledged,
    rerunButtonDisabled,
    hasErrors,
  };
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
                entry.errorClass === "network" && "bg-slate-100 text-slate-700",
                entry.errorClass === "parse" && "bg-violet-100 text-violet-800",
                entry.errorClass === "other" && "bg-slate-100 text-slate-700",
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

// ProviderTableRow — desktop variant (Fragment with primary row + optional
// error-trail row when expanded). Used as `renderRow` on DataTable so the
// expandable details row can sit alongside the main row in <tbody>.
function ProviderTableRow({ provider }: { provider: ProviderHealthStatusDto }) {
  const {
    localStatus,
    expanded,
    setExpanded,
    handleRerun,
    rerunLabel,
    isKrResolverRepairMode,
    resolverMode,
    setResolverMode,
    resolverModeAcknowledged,
    setResolverModeAcknowledged,
    rerunButtonDisabled,
    hasErrors,
  } = useProviderRow(provider);

  const isKrProvider = localStatus.providerId === "yahoo-finance-kr";
  const renderKrResolverModeControls = isKrProvider
    ? (
      <div className="mt-3 grid gap-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">{t.resolverModeLabel}</span>
          <select
            className="rounded border border-input bg-background px-2 py-1 text-xs"
            value={resolverMode}
            onChange={(event) => {
              const nextMode = event.target.value as ResolverMode;
              setResolverMode(nextMode);
              if (nextMode !== "chart_probe_v1") {
                setResolverModeAcknowledged(false);
              }
            }}
            data-testid={`provider-resolver-mode-${localStatus.providerId}`}
          >
            <option value="quote_first">{t.resolverModeSafeLabel}</option>
            <option value="chart_probe_v1">{t.resolverModeProbeLabel}</option>
          </select>
        </label>
        {isKrResolverRepairMode && (
          <label className="inline-flex items-center gap-2 rounded border border-amber-300/70 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            <input
              type="checkbox"
              checked={resolverModeAcknowledged}
              onChange={(event) => setResolverModeAcknowledged(event.target.checked)}
              data-testid={`provider-resolver-ack-${localStatus.providerId}`}
            />
            {t.resolverModeAckLabel}
          </label>
        )}
      </div>
    )
    : null;

  const resolverModeNote = isKrResolverRepairMode
    ? (
      <p className="mt-1 text-[11px] text-amber-700" data-testid={`provider-resolver-note-${localStatus.providerId}`}>
        {t.resolverModeAckHint}
      </p>
    )
    : null;

  return (
    <>
      <tr
        className="border-b border-border last:border-0"
        data-testid={`provider-row-${localStatus.providerId}`}
      >
        <td
          className="sticky left-0 z-10 bg-card border-r border-border px-4 py-4 font-mono text-sm font-medium text-foreground md:static md:bg-transparent md:border-r-0"
          title={localStatus.providerId}
        >
          <PopoverRoot>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid={`provider-help-trigger-${localStatus.providerId}`}
                className="text-left break-all hover:text-primary cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {localStatus.providerId}
              </button>
            </PopoverTrigger>
            <PopoverContent
              data-testid={`provider-help-popover-${localStatus.providerId}`}
            >
              {resolveRerunTooltipContent(localStatus)}
            </PopoverContent>
          </PopoverRoot>
        </td>
        <td className="px-4 py-4">
          <StatusBadge status={localStatus.status} providerId={localStatus.providerId} />
        </td>
        <td
          className="px-4 py-4 text-sm text-muted-foreground"
          title={localStatus.lastSuccessfulRun ?? ""}
        >
          {formatTimestamp(localStatus.lastSuccessfulRun)}
        </td>
        <td
          className="px-4 py-4 text-sm text-muted-foreground"
          title={localStatus.lastFailedRun ?? ""}
        >
          {formatTimestamp(localStatus.lastFailedRun)}
        </td>
        <td className="px-4 py-4 text-right text-sm text-foreground">
          {localStatus.errorCount24h}
        </td>
        <td className="px-4 py-4 text-right text-sm text-foreground">
          {localStatus.errorCount7d}
        </td>
        <td className="px-4 py-4 text-right text-sm text-foreground">
          {localStatus.rateLimitCount24h}
        </td>
        <td className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRerun}
              disabled={rerunButtonDisabled}
              data-testid={`provider-rerun-btn-${localStatus.providerId}`}
            >
              {rerunLabel}
            </Button>
            {isKrProvider ? renderKrResolverModeControls : null}
            {resolverModeNote}
            {hasErrors && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-xs text-primary underline decoration-primary/30 underline-offset-2 hover:text-primary/80"
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
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={8} className="px-4 pb-4 pt-2">
            <ErrorTrail provider={localStatus} />
          </td>
        </tr>
      )}
    </>
  );
}

// ProviderMobileCard — mobile variant (<sm). Rendered by DataTable's
// mobileRow slot. Shares the same testid prefixes as the desktop row —
// useIsSmallScreen ensures only one is in DOM at any viewport.
function ProviderMobileCard({ provider }: { provider: ProviderHealthStatusDto }) {
  const {
    localStatus,
    expanded,
    setExpanded,
    handleRerun,
    rerunLabel,
    isKrResolverRepairMode,
    resolverMode,
    setResolverMode,
    resolverModeAcknowledged,
    setResolverModeAcknowledged,
    rerunButtonDisabled,
    hasErrors,
  } = useProviderRow(provider);

  const isKrProvider = localStatus.providerId === "yahoo-finance-kr";
  const renderKrResolverModeControls = isKrProvider
    ? (
      <div className="mt-3 grid gap-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">{t.resolverModeLabel}</span>
          <select
            className="rounded border border-input bg-background px-2 py-1 text-xs"
            value={resolverMode}
            onChange={(event) => {
              const nextMode = event.target.value as ResolverMode;
              setResolverMode(nextMode);
              if (nextMode !== "chart_probe_v1") {
                setResolverModeAcknowledged(false);
              }
            }}
            data-testid={`provider-resolver-mode-${localStatus.providerId}`}
          >
            <option value="quote_first">{t.resolverModeSafeLabel}</option>
            <option value="chart_probe_v1">{t.resolverModeProbeLabel}</option>
          </select>
        </label>
        {isKrResolverRepairMode && (
          <label className="inline-flex items-center gap-2 rounded border border-amber-300/70 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            <input
              type="checkbox"
              checked={resolverModeAcknowledged}
              onChange={(event) => setResolverModeAcknowledged(event.target.checked)}
              data-testid={`provider-resolver-ack-${localStatus.providerId}`}
            />
            {t.resolverModeAckLabel}
          </label>
        )}
      </div>
    )
    : null;

  const resolverModeNote = isKrResolverRepairMode
    ? (
      <p
        className="mt-1 text-[11px] text-amber-700"
        data-testid={`provider-resolver-note-${localStatus.providerId}`}
      >
        {t.resolverModeAckHint}
      </p>
    )
    : null;

  return (
    <article
      className="rounded-xl border border-border bg-card p-4"
      data-testid={`provider-row-${localStatus.providerId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t.providerLabel}</p>
          <p
            className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm font-medium text-foreground"
            title={localStatus.providerId}
          >
            <PopoverRoot>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid={`provider-help-trigger-${localStatus.providerId}`}
                  className="text-left break-all hover:text-primary cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {localStatus.providerId}
                </button>
              </PopoverTrigger>
              <PopoverContent
                data-testid={`provider-help-popover-${localStatus.providerId}`}
              >
                {resolveRerunTooltipContent(localStatus)}
              </PopoverContent>
            </PopoverRoot>
          </p>
        </div>
        <StatusBadge status={localStatus.status} providerId={localStatus.providerId} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <CardDetail label={t.lastSuccessLabel} value={formatTimestamp(localStatus.lastSuccessfulRun)} truncate />
        <CardDetail label={t.lastFailedLabel} value={formatTimestamp(localStatus.lastFailedRun)} truncate />
        <CardDetail label={t.errors24hLabel} value={String(localStatus.errorCount24h)} truncate />
        <CardDetail label={t.errors7dLabel} value={String(localStatus.errorCount7d)} truncate />
        <CardDetail label={t.rateLimits24hLabel} value={String(localStatus.rateLimitCount24h)} truncate />
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleRerun}
          disabled={rerunButtonDisabled}
          data-testid={`provider-rerun-btn-${localStatus.providerId}`}
          className="w-full sm:w-auto"
        >
          {rerunLabel}
        </Button>
        {isKrProvider ? renderKrResolverModeControls : null}
        {resolverModeNote}
        {hasErrors && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-primary underline decoration-primary/30 underline-offset-2 hover:text-primary/80"
            data-testid={`provider-errors-toggle-${localStatus.providerId}`}
          >
            {expanded
              ? t.collapseErrorsLabel
              : t.expandErrorsLabel.replace("{count}", String(localStatus.recentErrors.length))}
          </button>
        )}
      </div>

      {expanded && hasErrors && (
        <div className="mt-3 rounded-xl bg-muted/30 p-3">
          <ErrorTrail provider={localStatus} />
        </div>
      )}
    </article>
  );
}

function CardDetail({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  /** KZO-199 iter 3 — opt-in non-wrapping mode for opaque IDs / ISO timestamps. */
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

interface AdminProvidersClientProps {
  providers: ProviderHealthStatusDto[];
}

export function AdminProvidersClient({ providers }: AdminProvidersClientProps) {
  // Phase 4 — DataTable migration (single-DOM responsive).
  // Header columns defined for the desktop table; per-row rendering routed
  // through renderRow (because each row may emit an additional details <tr>
  // for the error-trail expand) and mobileRow (card-stack at <sm).
  // Both desktop and mobile share the same testid prefixes — useIsSmallScreen
  // ensures only one variant is in DOM at any viewport.
  const columns: DataTableColumn<ProviderHealthStatusDto>[] = [
    { key: "provider", header: t.providerLabel, render: (p) => p.providerId, cellClassName: "px-4 py-3.5 align-top" },
    { key: "status", header: t.statusLabel, render: (p) => p.status, cellClassName: "px-4 py-3.5 align-top" },
    { key: "lastSuccess", header: t.lastSuccessLabel, render: (p) => formatTimestamp(p.lastSuccessfulRun), cellClassName: "px-4 py-3.5 align-top" },
    { key: "lastFailed", header: t.lastFailedLabel, render: (p) => formatTimestamp(p.lastFailedRun), cellClassName: "px-4 py-3.5 align-top" },
    { key: "errors24h", header: t.errors24hLabel, render: (p) => p.errorCount24h, cellClassName: "px-4 py-3.5 align-top" },
    { key: "errors7d", header: t.errors7dLabel, render: (p) => p.errorCount7d, cellClassName: "px-4 py-3.5 align-top" },
    { key: "rateLimits24h", header: t.rateLimits24hLabel, render: (p) => p.rateLimitCount24h, cellClassName: "px-4 py-3.5 align-top" },
    { key: "actions", header: t.actionsLabel, render: () => null, cellClassName: "px-4 py-3.5 align-top" },
  ];

  return (
    <Card data-testid="admin-providers-section">
      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">{t.pageTitle}</p>
        <h1 className="mt-2 text-2xl text-foreground sm:text-3xl">{t.pageTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{t.pageDescription}</p>
      </div>

      <DataTable
        data-testid="admin-providers-table"
        data={providers}
        columns={columns}
        rowKey={(p) => p.providerId}
        tableClassName="[&_th]:bg-slate-50/80 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-slate-500 [&_tr]:border-slate-100"
        renderRow={(p) => <ProviderTableRow provider={p} key={p.providerId} />}
        mobileRow={(p) => <ProviderMobileCard provider={p} />}
      />
    </Card>
  );
}
