"use client";

import Link from "next/link";
import { useState } from "react";
import type { LocaleCode, ValuationHealthDto, ValuationHealthHoldingAction } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { Badge } from "../ui/shadcn/badge";
import { Button } from "../ui/Button";
import { Alert, AlertDescription, AlertTitle } from "../ui/shadcn/alert";
import { cn, formatCurrencyAmount, formatDateLabel, formatPercent } from "../../lib/utils";
import { getValuationHealthAdminRepairLinks, type ValuationHealthAdminRepairLink } from "./valuationHealthAdminLink";

type ValuationHealthCopy = AppDictionary["valuationHealth"];

interface ValuationHealthPanelProps {
  adminRepairHref?: string | null;
  className?: string;
  copy: ValuationHealthCopy;
  locale: LocaleCode;
  showAdminActions?: boolean;
  valuationHealth: ValuationHealthDto | null | undefined;
}

export function ValuationHealthPanel({
  adminRepairHref = null,
  className,
  copy,
  locale,
  showAdminActions = false,
  valuationHealth,
}: ValuationHealthPanelProps) {
  const [copiedHref, setCopiedHref] = useState<string | null>(null);

  if (!valuationHealth) return null;

  const hasBackfillAction = valuationHealth.recommendedActions.includes("run_backfill");
  const hasSnapshotRepairAction = valuationHealth.recommendedActions.includes("run_snapshot_repair");
  const hasRepairRecommendation = hasBackfillAction || hasSnapshotRepairAction;
  const hasMaterialNoRepair = valuationHealth.status === "material" && !hasRepairRecommendation;
  const adminRepairLinks = getValuationHealthAdminRepairLinks(valuationHealth);
  const repairLinks = adminRepairLinks.length > 0
    ? adminRepairLinks
    : adminRepairHref
      ? [{ href: adminRepairHref, marketCode: "", tickers: [], truncated: false }]
      : [];
  const deltaPercent = valuationHealth.relativeDeltaBps === null
    ? null
    : valuationHealth.relativeDeltaBps / 100;
  const userTipTitle = hasRepairRecommendation
    ? copy.userRepairTipTitle
    : hasMaterialNoRepair
      ? copy.userNoRepairTipTitle
      : copy.userInfoTipTitle;
  const userTipDescription = hasRepairRecommendation
    ? copy.userRepairHelp
    : hasMaterialNoRepair
      ? copy.userNoRepairHelp
      : copy.userInfoHelp;
  const adminHelp = hasRepairRecommendation
    ? copy.adminHelp
    : hasMaterialNoRepair
      ? copy.userNoRepairHelp
      : copy.userInfoHelp;
  const panelTitle = valuationHealth.status === "healthy" && valuationHealth.affectedHoldings.length === 0
    ? copy.title
    : copy.outOfSyncTitle;

  return (
    <section
      className={cn("rounded-xl border border-border/80 bg-muted/20 p-4", className)}
      data-testid="valuation-health-panel"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{panelTitle}</p>
            <Badge variant={badgeVariantForStatus(valuationHealth.status)}>
              {statusLabel(copy, valuationHealth.status)}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {explanationForReason(copy, valuationHealth.reason)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {copy.snapshotOnly}
          </p>
        </div>
        <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2 lg:min-w-[21rem]">
          <MetricRow
            label={copy.currentValue}
            value={formatMaybeCurrency(valuationHealth.currentValueAmount, valuationHealth.reportingCurrency, locale, copy)}
          />
          <MetricRow
            label={copy.chartValue}
            value={formatMaybeCurrency(valuationHealth.snapshotValueAmount, valuationHealth.reportingCurrency, locale, copy)}
          />
          <MetricRow
            label={copy.delta}
            value={formatMaybeCurrency(valuationHealth.deltaAmount, valuationHealth.reportingCurrency, locale, copy)}
          />
          <MetricRow
            label={copy.relativeDelta}
            value={deltaPercent === null ? copy.unavailable : formatPercent(deltaPercent, locale)}
          />
          <MetricRow
            label={copy.latestBarAsOf}
            value={formatMaybeDate(valuationHealth.latestBarAsOf, locale, copy)}
          />
          <MetricRow
            label={copy.latestSnapshotDate}
            value={formatMaybeDate(valuationHealth.latestSnapshotDate, locale, copy)}
          />
          <MetricRow
            label={copy.comparableSnapshotDate}
            value={formatMaybeDate(valuationHealth.latestComparableSnapshotDate ?? null, locale, copy)}
          />
          <MetricRow
            label={copy.partialSnapshotDate}
            value={formatMaybeDate(valuationHealth.latestPartialSnapshotDate ?? null, locale, copy)}
          />
        </div>
      </div>

      {valuationHealth.marketFreshness && valuationHealth.marketFreshness.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background" data-testid="valuation-health-market-freshness">
          <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
            {copy.marketFreshness}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{copy.market}</th>
                  <th className="px-4 py-2.5">{copy.latestBarAsOf}</th>
                  <th className="px-4 py-2.5">{copy.latestSnapshotDate}</th>
                  <th className="px-4 py-2.5">{copy.stale}</th>
                  <th className="px-4 py-2.5">{copy.missing}</th>
                </tr>
              </thead>
              <tbody>
                {valuationHealth.marketFreshness.map((market) => (
                  <tr key={market.marketCode} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">{market.marketCode}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMaybeDate(market.latestBarDate, locale, copy)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMaybeDate(market.latestSnapshotDate, locale, copy)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{market.staleTickerCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">{market.missingTickerCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {valuationHealth.affectedHoldings.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background" data-testid="valuation-health-holdings">
          <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
            {copy.affectedHoldings}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{copy.ticker}</th>
                  <th className="px-4 py-2.5">{copy.currentValue}</th>
                  <th className="px-4 py-2.5">{copy.latestBarAsOf}</th>
                  <th className="px-4 py-2.5">{copy.latestSnapshotDate}</th>
                  <th className="px-4 py-2.5">{copy.status}</th>
                  {showAdminActions ? <th className="px-4 py-2.5">{copy.action}</th> : null}
                </tr>
              </thead>
              <tbody>
                {valuationHealth.affectedHoldings.map((holding) => (
                  <tr key={`${holding.marketCode}:${holding.ticker}`} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">{holding.ticker} · {holding.marketCode}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatMaybeCurrency(holding.currentReportingValueAmount, valuationHealth.reportingCurrency, locale, copy)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMaybeDate(holding.latestBarDate, locale, copy)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMaybeDate(holding.latestSnapshotDate, locale, copy)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{holdingStatusLabel(copy, holding.status)}</td>
                    {showAdminActions ? (
                      <td className="px-4 py-3 text-muted-foreground">{holdingActionLabel(copy, holding.recommendedAction)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        {showAdminActions ? (
          <p className="text-sm text-muted-foreground">
            {adminHelp}
          </p>
        ) : (
          <Alert data-testid="valuation-health-user-tip">
            <AlertTitle>{userTipTitle}</AlertTitle>
            <AlertDescription>{userTipDescription}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {showAdminActions
            ? repairLinks.map((link) => (
                <Button
                  asChild
                  size="sm"
                  data-testid={link.marketCode ? `valuation-health-admin-repair-${link.marketCode}` : "valuation-health-admin-repair"}
                  key={link.href}
                >
                  <Link href={link.href}>
                    {repairActionLabel(copy, hasBackfillAction, hasSnapshotRepairAction, link.marketCode)}
                  </Link>
                </Button>
              ))
            : repairLinks.map((link) => (
                <Button
                  key={link.href}
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid={link.marketCode ? `valuation-health-copy-admin-link-${link.marketCode}` : "valuation-health-copy-admin-link"}
                  onClick={() => {
                    void copyAdminHelpText({
                      adminHelp,
                      link,
                      locale,
                      valuationHealth,
                    }).then((copied) => {
                      if (copied) setCopiedHref(link.href);
                    });
                  }}
                >
                  {copiedHref === link.href
                    ? copy.adminLinkCopied
                    : copy.copyAdminHelpLink.replace("{market}", link.marketCode || copy.action)}
                </Button>
              ))}
        </div>
      </div>
    </section>
  );
}

function repairActionLabel(
  copy: ValuationHealthCopy,
  hasBackfillAction: boolean,
  hasSnapshotRepairAction: boolean,
  marketCode: string,
): string {
  const action = hasBackfillAction && hasSnapshotRepairAction
    ? copy.adminRepairAction
    : hasSnapshotRepairAction
      ? copy.snapshotRepairAction
      : copy.backfillAction;
  return marketCode ? `${action} · ${marketCode}` : action;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium text-foreground">{value}</div>
    </div>
  );
}

function formatMaybeCurrency(
  value: number | null,
  currency: string,
  locale: LocaleCode,
  copy: ValuationHealthCopy,
): string {
  return value === null ? copy.unavailable : formatCurrencyAmount(value, currency, locale);
}

function formatMaybeDate(value: string | null, locale: LocaleCode, copy: ValuationHealthCopy): string {
  return value ? formatDateLabel(value, locale) : copy.unavailable;
}

async function copyAdminHelpText({
  adminHelp,
  link,
  locale,
  valuationHealth,
}: {
  adminHelp: string;
  link: ValuationHealthAdminRepairLink;
  locale: LocaleCode;
  valuationHealth: ValuationHealthDto;
}): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  const absoluteHref = typeof window === "undefined"
    ? link.href
    : new URL(link.href, window.location.origin).href;
  const lines = [
    adminHelp,
    `Market: ${link.marketCode || "all"}`,
    link.tickers.length > 0 ? `Tickers: ${link.tickers.join(", ")}` : null,
    valuationHealth.expectedLatestValuationDate ? `Target date: ${valuationHealth.expectedLatestValuationDate}` : null,
    valuationHealth.latestComparableSnapshotDate
      ? `Comparable snapshot: ${formatDateLabel(valuationHealth.latestComparableSnapshotDate, locale)}`
      : null,
    valuationHealth.latestPartialSnapshotDate
      ? `Partial snapshot: ${formatDateLabel(valuationHealth.latestPartialSnapshotDate, locale)}`
      : null,
    `Admin repair link: ${absoluteHref}`,
  ].filter((line): line is string => line !== null);

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    return true;
  } catch {
    return false;
  }
}

function badgeVariantForStatus(status: ValuationHealthDto["status"]) {
  if (status === "healthy") return "secondary" as const;
  if (status === "material") return "outline" as const;
  return "secondary" as const;
}

function statusLabel(copy: ValuationHealthCopy, status: ValuationHealthDto["status"]): string {
  if (status === "healthy") return copy.healthy;
  if (status === "material") return copy.material;
  return copy.unavailable;
}

function explanationForReason(copy: ValuationHealthCopy, reason: ValuationHealthDto["reason"]): string {
  switch (reason) {
    case "within_minor_unit_tolerance":
      return copy.withinTolerance;
    case "within_threshold":
      return copy.withinThreshold;
    case "absolute_threshold_exceeded":
      return copy.absoluteExceeded;
    case "relative_threshold_exceeded":
      return copy.relativeExceeded;
    case "missing_current_value":
      return copy.missingCurrentValue;
    case "missing_snapshot_value":
      return copy.missingSnapshotValue;
  }
}

function holdingStatusLabel(
  copy: ValuationHealthCopy,
  status: ValuationHealthDto["affectedHoldings"][number]["status"],
): string {
  switch (status) {
    case "healthy":
      return copy.healthy;
    case "missing_latest_bar":
      return copy.missingLatestBar;
    case "awaiting_latest_bar":
      return copy.awaitingLatestBar;
    case "backfill_pending":
      return copy.backfillPending;
    case "backfill_failed":
      return copy.backfillFailed;
    case "missing_snapshot":
      return copy.missingSnapshot;
    case "stale_snapshot":
      return copy.staleSnapshot;
  }
}

function holdingActionLabel(
  copy: ValuationHealthCopy,
  action: ValuationHealthHoldingAction,
): string {
  switch (action) {
    case "none":
      return copy.none;
    case "wait_for_backfill":
      return copy.waitForBackfill;
    case "run_backfill":
      return copy.backfillAction;
    case "run_snapshot_repair":
      return copy.snapshotRepairAction;
  }
}
