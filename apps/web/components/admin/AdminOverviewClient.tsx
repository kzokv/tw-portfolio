"use client";

import Link from "next/link";
import type { AdminAuditLogEntryDto, ProviderHealthStatusDto } from "@vakwen/shared-types";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";

interface AdminOverviewClientProps {
  activeUsers: number;
  pendingInvites: number;
  instrumentCount: number;
  providers: ProviderHealthStatusDto[];
  recentActivity: AdminAuditLogEntryDto[];
  lastUpdatedAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  admin_role_change: "Role change",
  admin_disable_user: "Disabled user",
  admin_enable_user: "Enabled user",
  admin_delete_user: "Deleted user",
  admin_hard_purge_user: "Purged user",
  admin_invite_issued: "Invite issued",
  admin_invite_revoked: "Invite revoked",
  app_config_updated: "Settings updated",
  provider_health_rerun: "Provider re-run",
  impersonation_start: "Impersonation started",
  impersonation_end: "Impersonation ended",
  instrument_undelete: "Instrument restored",
  instrument_exclusion_toggle: "Detection toggled",
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value: string): string {
  const ts = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays < 7 ? `${diffDays}d ago` : new Date(value).toLocaleDateString();
}

function providerTone(status: ProviderHealthStatusDto["status"]): string {
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
  instrumentCount,
  providers,
  recentActivity,
  lastUpdatedAt,
}: AdminOverviewClientProps) {
  const providersNeedingAttention = providers.filter((provider) => provider.status !== "healthy");

  return (
    <div className="space-y-6" data-testid="admin-overview-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">Admin overview</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
            Operator status
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Snapshot of admin workload, provider health, and recent changes.
          </p>
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="admin-overview-last-updated"
          title={formatTimestamp(lastUpdatedAt)}
        >
          Last refreshed {formatRelativeTime(lastUpdatedAt)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-users">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Active users</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{activeUsers.toLocaleString()}</p>
          <p className="mt-2 text-sm text-muted-foreground">Accounts currently able to sign in.</p>
        </Card>
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-invites">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Pending invites</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{pendingInvites.toLocaleString()}</p>
          <p className="mt-2 text-sm text-muted-foreground">Outstanding onboarding tasks for operators.</p>
        </Card>
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-instruments">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">AU instruments</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">{instrumentCount.toLocaleString()}</p>
          <p className="mt-2 text-sm text-muted-foreground">Catalog rows currently visible in admin instruments.</p>
        </Card>
        <Card className="px-5 py-4 hover:translate-y-0" data-testid="admin-overview-metric-providers">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Providers needing attention</p>
          <p className="mt-3 text-3xl font-semibold text-foreground">
            {providersNeedingAttention.length.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {providers.length - providersNeedingAttention.length} healthy, {providers.length} total.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="admin-overview-provider-health">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Provider health</h2>
              <p className="mt-1 text-sm text-muted-foreground">Current ingestion and refresh posture.</p>
            </div>
            <Link
              href="/admin/providers"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Open providers
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {providers.map((provider) => (
              <li
                key={provider.providerId}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                data-testid={`admin-overview-provider-${provider.providerId}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", providerTone(provider.status))} aria-hidden="true" />
                    <p className="truncate font-medium text-foreground">{provider.providerId}</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Last success: {provider.lastSuccessfulRun ? formatRelativeTime(provider.lastSuccessfulRun) : "never"}
                  </p>
                </div>
                <div className="text-left text-sm text-muted-foreground sm:text-right">
                  <p>{provider.errorCount24h} errors / 24h</p>
                  <p className="mt-1">{provider.rateLimitCount24h} rate limits / 24h</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="admin-overview-activity">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Recent admin activity</h2>
              <p className="mt-1 text-sm text-muted-foreground">Latest audited operator actions.</p>
            </div>
            <Link
              href="/admin/audit-log"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Open audit log
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {recentActivity.map((entry) => (
              <li key={entry.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div className="text-sm text-muted-foreground" title={formatTimestamp(entry.createdAt)}>
                  {formatRelativeTime(entry.createdAt)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {entry.actorEmail ?? "System"}
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
