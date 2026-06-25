"use client";

import Link from "next/link";
import type { AdminAuditLogEntryDto, AdminMarketDataTileDto } from "@vakwen/shared-types";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import { formatAdminRelativeTime, useAdminI18n } from "./admin-i18n";

interface AdminOverviewClientProps {
  activeUsers: number;
  pendingInvites: number;
  markets: AdminMarketDataTileDto[];
  recentActivity: AdminAuditLogEntryDto[];
  lastUpdatedAt: string;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function providerTone(status: AdminMarketDataTileDto["healthStatus"]): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "down":
      return "bg-rose-500";
    case "awaiting":
      return "bg-slate-400";
  }
}

export function AdminOverviewClient({
  activeUsers,
  pendingInvites,
  markets,
  recentActivity,
  lastUpdatedAt,
}: AdminOverviewClientProps) {
  const dict = useAdminI18n();
  const locale = dict.common.justNow === "剛剛" ? "zh-TW" : "en";
  const marketsNeedingAttention = markets.filter((market) => market.healthStatus !== "healthy");
  const pendingBackfillTotal = markets.reduce((sum, market) => sum + market.pendingBackfillCount, 0);

  return (
    <div className="space-y-6" data-testid="admin-overview-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">{dict.overview.eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
            {dict.overview.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {dict.overview.description}
          </p>
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="admin-overview-last-updated"
          title={formatTimestamp(lastUpdatedAt)}
        >
          {dict.overview.lastRefreshed.replace("{time}", formatAdminRelativeTime(lastUpdatedAt, locale, dict))}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-users">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{dict.overview.activeUsers}</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{activeUsers.toLocaleString()}</p>
          <p className="mt-2 text-sm text-muted-foreground">{dict.overview.activeUsersDescription}</p>
        </Card>
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-invites">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{dict.overview.pendingInvites}</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{pendingInvites.toLocaleString()}</p>
          <p className="mt-2 text-sm text-muted-foreground">{dict.overview.pendingInvitesDescription}</p>
        </Card>
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-instruments">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{dict.overview.pendingBackfill}</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{pendingBackfillTotal.toLocaleString()}</p>
          <p className="mt-2 text-sm text-muted-foreground">{dict.overview.pendingBackfillDescription}</p>
        </Card>
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-providers">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{dict.overview.marketsNeedingAttentionMetric}</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">
            {marketsNeedingAttention.length.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {dict.overview.marketsNeedingAttentionDescription
              .replace("{healthy}", (markets.length - marketsNeedingAttention.length).toLocaleString())
              .replace("{total}", markets.length.toLocaleString())}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="admin-overview-provider-health">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{dict.overview.marketDataTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{dict.overview.marketDataDescription}</p>
            </div>
            <Link
              href="/admin/market-data"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {dict.overview.openMarketData}
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {markets.map((market) => (
              <li
                key={market.marketCode}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                data-testid={`admin-overview-market-${market.marketCode}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", providerTone(market.healthStatus))} aria-hidden="true" />
                    <Link href={market.href} className="truncate font-medium text-foreground underline-offset-4 hover:underline">
                      {market.marketCode} - {market.label}
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {market.providers.map((provider) => (
                      <span key={provider.providerId} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {provider.providerId}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-left text-sm text-muted-foreground sm:text-right">
                  <p>{dict.overview.unresolvedSummary.replace("{count}", market.unresolvedCount.toLocaleString())}</p>
                  <p className="mt-1">
                    {dict.overview.backfillSummary
                      .replace("{pending}", market.pendingBackfillCount.toLocaleString())
                      .replace("{failed}", market.failedBackfillCount.toLocaleString())}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="admin-overview-activity">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{dict.overview.recentActivity}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{dict.overview.recentActivityDescription}</p>
            </div>
            <Link
              href="/admin/audit-log"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {dict.overview.openAuditLog}
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {recentActivity.map((entry) => (
              <li key={entry.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div className="text-sm text-muted-foreground" title={formatTimestamp(entry.createdAt)}>
                  {formatAdminRelativeTime(entry.createdAt, locale, dict)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {dict.overview.actionLabels[entry.action as keyof typeof dict.overview.actionLabels] ?? entry.action}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {entry.actorEmail ?? dict.common.system}
                    {entry.targetEmail || entry.targetDisplayName
                      ? ` -> ${entry.targetEmail ?? entry.targetDisplayName}`
                      : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
