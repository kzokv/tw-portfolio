"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminInviteListItemDto,
  AdminInviteListResponse,
  InviteListStatus,
  UserRole,
} from "@tw-portfolio/shared-types";
import { getJson, postJson, deleteJson, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";
import { cn } from "../../lib/utils";

type StatusFilter = InviteListStatus | "all";

const ROLE_OPTIONS: UserRole[] = ["admin", "member", "viewer"];
const ROLE_LABELS: Record<UserRole, string> = { admin: "Admin", member: "Member", viewer: "Viewer" };

const EXPIRY_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "Custom", days: 0 },
];

const STATUS_BADGE: Record<InviteListStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "border-blue-200 bg-blue-50 text-blue-700" },
  used: { label: "Used", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  expired: { label: "Expired", className: "border-slate-200 bg-slate-50 text-slate-500" },
  revoked: { label: "Revoked", className: "border-red-200 bg-red-50 text-red-700" },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

export function AdminInvitesClient() {
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
      setError(err instanceof Error ? err.message : "Failed to load invites");
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
      setFormSuccess(`Invite sent to ${formEmail}`);
      setFormEmail("");
      setFormRole("member");
      await fetchInvites();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create invite");
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
      setError(err instanceof ApiError ? err.message : "Failed to revoke invite");
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
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "used", label: "Used" },
    { value: "expired", label: "Expired" },
    { value: "revoked", label: "Revoked" },
  ];

  return (
    <div className="space-y-6" data-testid="admin-invites-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Invites</h1>
        <p className="mt-1 text-sm text-slate-600">Send invitations and manage pending invites.</p>
      </div>

      <Card data-testid="invite-form">
        <h2 className="text-lg font-semibold text-slate-900">Create Invite</h2>
        <form onSubmit={(e) => void handleCreateInvite(e)} className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-medium text-slate-700">Email</label>
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
            <label htmlFor="invite-role" className="block text-sm font-medium text-slate-700">Role</label>
            <select
              id="invite-role"
              value={formRole}
              onChange={(e) => setFormRole(e.target.value as UserRole)}
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
              data-testid="invite-role-select"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="invite-expiry" className="block text-sm font-medium text-slate-700">Expires</label>
            <select
              id="invite-expiry"
              value={formExpiryPreset}
              onChange={(e) => setFormExpiryPreset(Number(e.target.value))}
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
              data-testid="invite-expiry-select"
            >
              {EXPIRY_PRESETS.map((p) => (
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
              {formSubmitting ? "Sending..." : "Send Invite"}
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
            <p className="text-sm text-slate-500">Loading invites...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void fetchInvites()}>Retry</Button>
          </div>
        ) : invites.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">No invites found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="invites-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Issued By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const badge = STATUS_BADGE[invite.status];
                  return (
                    <tr
                      key={invite.code}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                      data-testid={`invite-row-${invite.code}`}
                    >
                      <td className="px-4 py-3 text-slate-900">{invite.email}</td>
                      <td className="px-4 py-3 text-slate-700">{ROLE_LABELS[invite.role]}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", badge.className)} data-testid={`status-badge-${invite.status}`}>
                          {badge.label}
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
                            {copiedCode === invite.code ? "Copied!" : "Copy URL"}
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
                              Revoke
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
        title="Revoke Invite"
        description={`Are you sure you want to revoke the invite for ${revokeTarget?.email ?? ""}? They will no longer be able to use this invitation.`}
        confirmLabel="Revoke"
        variant="danger"
        loading={actionLoading}
        onConfirm={() => void handleRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
