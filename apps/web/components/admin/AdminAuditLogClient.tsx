"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminAuditLogEntryDto,
  AdminAuditLogResponse,
} from "@vakwen/shared-types";
import { getJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Pagination } from "./Pagination";
import { cn } from "../../lib/utils";
import { useAdminI18n } from "./admin-i18n";

const ACTION_CATEGORIES: { key: keyof ReturnType<typeof useAdminI18n>["audit"]["categories"]; actions: string[] }[] = [
  {
    key: "userLifecycle",
    actions: ["admin_disable_user", "admin_enable_user", "admin_delete_user", "admin_hard_purge_user"],
  },
  {
    key: "roleChanges",
    actions: ["admin_role_change", "user_promoted_to_admin"],
  },
  {
    key: "invites",
    actions: ["admin_invite_issued", "admin_invite_revoked"],
  },
  {
    key: "sharing",
    actions: ["share_granted", "share_revoked", "share_token_created", "share_token_revoked"],
  },
  {
    key: "session",
    actions: ["session_force_logout", "user_login", "user_linked_identity"],
  },
  {
    key: "impersonation",
    actions: ["impersonation_start", "impersonation_end", "impersonation_blocked_write"],
  },
  {
    key: "settings",
    actions: ["app_config_updated"],
  },
  {
    key: "providerHealth",
    actions: ["provider_health_rerun"],
  },
  {
    key: "instruments",
    actions: ["instrument_undelete", "instrument_exclusion_toggle"],
  },
];

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];

  // KZO-198 — `app_config_updated` rows carry a discriminator under
  // `metadata.type`. `rotation` rows record secret rotations and intentionally
  // do NOT include before/after — the value is never stored. Legacy rows
  // (created before KZO-198) have no `type` key and fall through to the
  // existing `value_change` rendering below.
  if (metadata.type === "rotation") {
    const field = typeof metadata.field === "string" ? metadata.field : "secret";
    return `Rotated ${field} (value not stored in audit log)`;
  }

  // `value_change` (or absent type — backfilled to value_change). When
  // `before`/`after` are present, render a compact diff. Server may also
  // include `field` to disambiguate which knob changed when the row covers
  // the generic `app_config_updated` action.
  if (metadata.before !== undefined || metadata.after !== undefined) {
    const field = typeof metadata.field === "string" ? `${metadata.field}: ` : "";
    const before = metadata.before === undefined ? "—" : JSON.stringify(metadata.before);
    const after = metadata.after === undefined ? "—" : JSON.stringify(metadata.after);
    return `${field}${before} → ${after}`;
  }

  if (metadata.fromRole && metadata.toRole) {
    parts.push(`${String(metadata.fromRole)} → ${String(metadata.toRole)}`);
  }
  if (metadata.ownerEmail && metadata.granteeEmail) {
    parts.push(`${String(metadata.ownerEmail)} → ${String(metadata.granteeEmail)}`);
  }
  if (metadata.shareCoupled && metadata.shareOwnerEmail && metadata.targetEmail) {
    parts.push(`${String(metadata.shareOwnerEmail)} → ${String(metadata.targetEmail)}`);
  }
  if (metadata.inviteCode) {
    parts.push(`code: ${String(metadata.inviteCode)}`);
  }
  if (metadata.targetEmail && !parts.length) {
    parts.push(String(metadata.targetEmail));
  }
  return parts.join(", ") || "—";
}

export function AdminAuditLogClient() {
  const dict = useAdminI18n();
  const [entries, setEntries] = useState<AdminAuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchAuditLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (selectedActions.size > 0) params.set("action", [...selectedActions].join(","));
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);

      const data = await getJson<AdminAuditLogResponse>(`/admin/audit-log?${params.toString()}`);
      setEntries(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.audit.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [page, limit, selectedActions, fromDate, toDate]);

  useEffect(() => {
    void fetchAuditLog();
  }, [fetchAuditLog]);

  function toggleAction(action: string) {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return next;
    });
    setPage(1);
  }

  function clearFilters() {
    setSelectedActions(new Set());
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  const hasFilters = selectedActions.size > 0 || fromDate || toDate;

  return (
    <div className="space-y-6" data-testid="admin-audit-log-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{dict.audit.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{dict.audit.description}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen(!filtersOpen)}
          data-testid="toggle-filters"
        >
          {filtersOpen ? dict.audit.hideFilters : dict.audit.filters}
          {hasFilters && (
            <span className="ml-1 rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700">
              {selectedActions.size + (fromDate ? 1 : 0) + (toDate ? 1 : 0)}
            </span>
          )}
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="clear-filters">
            {dict.audit.clearAll}
          </Button>
        )}
      </div>

      {filtersOpen && (
        <Card data-testid="audit-filters">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">{dict.audit.dateRange}</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                  data-testid="filter-from-date"
                />
                <span className="self-center text-sm text-slate-400">{dict.audit.to}</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                  data-testid="filter-to-date"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">{dict.audit.actions}</label>
              <div className="mt-1 space-y-2">
                {ACTION_CATEGORIES.map((cat) => (
                  <div key={cat.key}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{dict.audit.categories[cat.key]}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {cat.actions.map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => toggleAction(action)}
                          className={cn(
                            "rounded-lg px-2 py-1 text-xs font-medium transition",
                            selectedActions.has(action)
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                          )}
                          data-testid={`action-filter-${action}`}
                        >
                          {dict.audit.actionLabels[action as keyof typeof dict.audit.actionLabels] ?? action}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{dict.audit.loading}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void fetchAuditLog()}>{dict.common.retry}</Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{dict.audit.empty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full text-sm" data-testid="audit-log-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.audit.timestamp}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.audit.actor}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.audit.action}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.audit.target}</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.audit.details}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                    data-testid={`audit-row-${entry.id}`}
                  >
                    <td className="whitespace-nowrap px-5 py-4 align-top text-slate-500">{formatTimestamp(entry.createdAt)}</td>
	                    <td className="px-4 py-4 align-top text-slate-700">
	                      <div className="min-w-[12rem]">
	                        <p className="font-medium text-slate-900">{entry.actorEmail ?? dict.common.system}</p>
	                        <p className="mt-1 text-xs text-slate-500">
	                          {entry.actorUserId ? dict.audit.userAction : dict.audit.systemEvent}
	                        </p>
	                      </div>
	                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {dict.audit.actionLabels[entry.action as keyof typeof dict.audit.actionLabels] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top text-slate-700">
                      <div className="min-w-[12rem]">
	                        <p className="font-medium text-slate-900">
	                          {entry.targetEmail ?? entry.targetDisplayName ?? "—"}
	                        </p>
	                        <p className="mt-1 text-xs text-slate-500">
	                          {entry.targetUserId ? dict.audit.userTarget : dict.audit.noDirectTarget}
	                        </p>
	                      </div>
	                    </td>
                    <td className="px-5 py-4 align-top text-slate-500">
                      <div className="max-w-[26rem] break-words">{formatMetadata(entry.metadata)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && total > 0 && (
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      )}
    </div>
  );
}
