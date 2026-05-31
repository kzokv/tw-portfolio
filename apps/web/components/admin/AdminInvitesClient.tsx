"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminInviteListItemDto,
  AdminInviteListResponse,
  InviteListStatus,
  UserRole,
} from "@vakwen/shared-types";
import { getJson, postJson, deleteJson, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";
import { cn } from "../../lib/utils";
import { useAdminI18n } from "./admin-i18n";

type StatusFilter = InviteListStatus | "all";

const ROLE_OPTIONS: UserRole[] = ["admin", "member", "viewer"];

const STATUS_BADGE_CLASS: Record<InviteListStatus, string> = {
  pending: "border-blue-200 bg-blue-50 text-blue-700",
  used: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expired: "border-slate-200 bg-slate-50 text-slate-500",
  revoked: "border-red-200 bg-red-50 text-red-700",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

export function AdminInvitesClient() {
  const dict = useAdminI18n();
  const roleLabels: Record<UserRole, string> = {
    admin: dict.common.roleAdmin,
    member: dict.common.roleMember,
    viewer: dict.common.roleViewer,
  };
  const expiryPresets = [
    { label: dict.invites.expiry1Day, days: 1 },
    { label: dict.invites.expiry7Days, days: 7 },
    { label: dict.invites.expiry14Days, days: 14 },
    { label: dict.invites.expiry30Days, days: 30 },
    { label: dict.invites.expiryCustom, days: 0 },
  ];
  const statusLabels: Record<InviteListStatus, string> = {
    pending: dict.common.statusPending,
    used: dict.common.statusUsed,
    expired: dict.common.statusExpired,
    revoked: dict.common.statusRevoked,
  };
  const [invites, setInvites] = useState<AdminInviteListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState<UserRole>("member");
  const [formExpiryPreset, setFormExpiryPreset] = useState(7);
  const [formCustomDate, setFormCustomDate] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminInviteListItemDto | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (statusFilter !== "all") params.set("status", statusFilter);

      const data = await getJson<AdminInviteListResponse>(`/admin/invites?${params.toString()}`);
      setInvites(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.invites.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter]);

  useEffect(() => {
    void fetchInvites();
  }, [fetchInvites]);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      let expiresAt: string;
      if (formExpiryPreset === 0 && formCustomDate) {
        expiresAt = new Date(formCustomDate).toISOString();
      } else {
        const d = new Date();
        d.setDate(d.getDate() + (formExpiryPreset || 7));
        expiresAt = d.toISOString();
      }

      await postJson("/invites", { email: formEmail, role: formRole, expiresAt });
      setFormSuccess(dict.invites.sent.replace("{email}", formEmail));
      setFormEmail("");
      setFormRole("member");
      await fetchInvites();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : dict.invites.createFailed);
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setActionLoading(true);
    try {
      await deleteJson(`/invites/${revokeTarget.code}`);
      setRevokeTarget(null);
      await fetchInvites();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : dict.invites.revokeFailed);
      setRevokeTarget(null);
    } finally {
      setActionLoading(false);
    }
  }

  async function copyToClipboard(text: string, code: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  const statusTabs: { value: StatusFilter; label: string }[] = [
    { value: "all", label: dict.common.all },
    { value: "pending", label: dict.common.statusPending },
    { value: "used", label: dict.common.statusUsed },
    { value: "expired", label: dict.common.statusExpired },
    { value: "revoked", label: dict.common.statusRevoked },
  ];

  return (
    <div className="space-y-6" data-testid="admin-invites-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{dict.invites.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{dict.invites.description}</p>
      </div>

      <Card data-testid="invite-form">
        <h2 className="text-lg font-semibold text-slate-900">{dict.invites.createTitle}</h2>
        <form onSubmit={(e) => void handleCreateInvite(e)} className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-medium text-slate-700">{dict.invites.email}</label>
            <input
              id="invite-email"
              type="email"
              required
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              data-testid="invite-email-input"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-sm font-medium text-slate-700">{dict.invites.role}</label>
            <select
              id="invite-role"
              value={formRole}
              onChange={(e) => setFormRole(e.target.value as UserRole)}
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
              data-testid="invite-role-select"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{roleLabels[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="invite-expiry" className="block text-sm font-medium text-slate-700">{dict.invites.expires}</label>
            <select
              id="invite-expiry"
              value={formExpiryPreset}
              onChange={(e) => setFormExpiryPreset(Number(e.target.value))}
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
              data-testid="invite-expiry-select"
            >
              {expiryPresets.map((p) => (
                <option key={p.days} value={p.days}>{p.label}</option>
              ))}
            </select>
            {formExpiryPreset === 0 && (
              <input
                type="date"
                value={formCustomDate}
                onChange={(e) => setFormCustomDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                data-testid="invite-custom-date"
                required
              />
            )}
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={formSubmitting} data-testid="invite-submit">
              {formSubmitting ? dict.invites.sending : dict.invites.sendInvite}
            </Button>
          </div>
        </form>
        {formError && (
          <p className="mt-3 text-sm text-red-600" data-testid="invite-form-error">{formError}</p>
        )}
        {formSuccess && (
          <p className="mt-3 text-sm text-emerald-600" data-testid="invite-form-success">{formSuccess}</p>
        )}
      </Card>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white/80 p-1" data-testid="invite-status-filter">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              statusFilter === tab.value
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100",
            )}
            data-testid={`invite-filter-${tab.value}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{dict.invites.loading}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void fetchInvites()}>{dict.common.retry}</Button>
          </div>
        ) : invites.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{dict.invites.empty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="invites-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.invites.email}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.invites.role}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.status}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.invites.issuedBy}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.invites.expires}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.invites.created}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.invites.actions}</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const badgeClassName = STATUS_BADGE_CLASS[invite.status];
                  return (
                    <tr
                      key={invite.code}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                      data-testid={`invite-row-${invite.code}`}
                    >
                      <td className="px-4 py-3 text-slate-900">{invite.email}</td>
                      <td className="px-4 py-3 text-slate-700">{roleLabels[invite.role]}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", badgeClassName)} data-testid={`status-badge-${invite.status}`}>
                          {statusLabels[invite.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{invite.issuedByEmail ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(invite.expiresAt)}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(invite.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void copyToClipboard(`${window.location.origin}/invite/${invite.code}`, invite.code)}
                            data-testid={`copy-url-${invite.code}`}
                          >
                            {copiedCode === invite.code ? dict.invites.copied : dict.invites.copyUrl}
                          </Button>
                          {invite.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => setRevokeTarget(invite)}
                              disabled={actionLoading}
                              data-testid={`revoke-btn-${invite.code}`}
                            >
                              {dict.invites.revoke}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && total > 0 && (
        <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        title={dict.invites.revokeTitle}
        description={dict.invites.revokeDescription.replace("{email}", revokeTarget?.email ?? "")}
        confirmLabel={dict.invites.revoke}
        variant="danger"
        loading={actionLoading}
        onConfirm={() => void handleRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
