"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminAuditLogEntryDto,
  AdminAuditLogResponse,
} from "@tw-portfolio/shared-types";
import { getJson } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Pagination } from "./Pagination";
import { cn } from "../../lib/utils";

const ACTION_LABELS: Record<string, string> = {
  admin_role_change: "Changed role",
  admin_disable_user: "Disabled user",
  admin_enable_user: "Enabled user",
  admin_delete_user: "Deleted user",
  admin_hard_purge_user: "Purged user",
  admin_invite_issued: "Issued invite",
  admin_invite_revoked: "Revoked invite",
  session_force_logout: "Force logout",
  user_promoted_to_admin: "Promoted to admin",
  user_linked_identity: "Linked identity",
  user_login: "User login",
};

const ACTION_CATEGORIES: { label: string; actions: string[] }[] = [
  {
    label: "User Lifecycle",
    actions: ["admin_disable_user", "admin_enable_user", "admin_delete_user", "admin_hard_purge_user"],
  },
  {
    label: "Role Changes",
    actions: ["admin_role_change", "user_promoted_to_admin"],
  },
  {
    label: "Invites",
    actions: ["admin_invite_issued", "admin_invite_revoked"],
  },
  {
    label: "Session",
    actions: ["session_force_logout", "user_login", "user_linked_identity"],
  },
];

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  if (metadata.fromRole && metadata.toRole) {
    parts.push(`${String(metadata.fromRole)} → ${String(metadata.toRole)}`);
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
      setError(err instanceof Error ? err.message : "Failed to load audit log");
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
        <h1 className="text-2xl font-semibold text-slate-950">Audit Log</h1>
        <p className="mt-1 text-sm text-slate-600">Review administrative actions and system events.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen(!filtersOpen)}
          data-testid="toggle-filters"
        >
          {filtersOpen ? "Hide Filters" : "Filters"}
          {hasFilters && (
            <span className="ml-1 rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700">
              {selectedActions.size + (fromDate ? 1 : 0) + (toDate ? 1 : 0)}
            </span>
          )}
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="clear-filters">
            Clear all
          </Button>
        )}
      </div>

      {filtersOpen && (
        <Card data-testid="audit-filters">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">Date Range</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                  data-testid="filter-from-date"
                />
                <span className="self-center text-sm text-slate-400">to</span>
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
              <label className="block text-sm font-medium text-slate-700">Actions</label>
              <div className="mt-1 space-y-2">
                {ACTION_CATEGORIES.map((cat) => (
                  <div key={cat.label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{cat.label}</p>
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
                          {ACTION_LABELS[action] ?? action}
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
            <p className="text-sm text-slate-500">Loading audit log...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void fetchAuditLog()}>Retry</Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">No audit log entries found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="audit-log-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Actor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Target</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                    data-testid={`audit-row-${entry.id}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTimestamp(entry.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{entry.actorEmail ?? "System"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {entry.targetEmail ?? entry.targetDisplayName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatMetadata(entry.metadata)}</td>
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
