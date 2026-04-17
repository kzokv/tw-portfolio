"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminUserListItemDto,
  AdminUserListResponse,
  AdminUserStatus,
  UserRole,
} from "@tw-portfolio/shared-types";
import { getJson, patchJson, postJson, deleteJson, ApiError, API_BASE } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { UserStatusBadge } from "./UserStatusBadge";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";
import { HardPurgeDialog } from "./HardPurgeDialog";
import { cn } from "../../lib/utils";

interface AdminUsersClientProps {
  currentUserId: string;
  currentUserEmail: string | null;
}

type StatusFilter = AdminUserStatus | "all";

const ROLE_OPTIONS: UserRole[] = ["admin", "member", "viewer"];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

export function AdminUsersClient({ currentUserId, currentUserEmail }: AdminUsersClientProps) {
  const [users, setUsers] = useState<AdminUserListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: "danger" | "default";
    action: () => Promise<void>;
  } | null>(null);

  // Purge dialog state
  const [purgeTarget, setPurgeTarget] = useState<AdminUserListItemDto | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const data = await getJson<AdminUserListResponse>(`/admin/users?${params.toString()}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, debouncedSearch]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  function handleApiError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "last_admin_blocked") return "Cannot remove the last admin";
      if (err.code === "self_operation_blocked") return "Cannot modify yourself";
      if (err.code === "active_jobs_blocked") return "User has active background jobs";
      return err.message;
    }
    return err instanceof Error ? err.message : "Operation failed";
  }

  async function handleRoleChange(user: AdminUserListItemDto, newRole: UserRole) {
    if (user.userId === currentUserId) return;
    if (user.role === "admin" && newRole !== "admin") {
      setConfirmDialog({
        title: "Demote Admin",
        description: `Are you sure you want to change ${user.email ?? user.displayName ?? "this user"}'s role from Admin to ${ROLE_LABELS[newRole]}? They will lose admin access.`,
        confirmLabel: "Demote",
        variant: "danger",
        action: async () => {
          await patchJson(`/admin/users/${user.userId}/role`, { role: newRole });
        },
      });
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await patchJson(`/admin/users/${user.userId}/role`, { role: newRole });
      await fetchUsers();
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDisable(user: AdminUserListItemDto) {
    setConfirmDialog({
      title: "Disable User",
      description: `Are you sure you want to disable ${user.email ?? user.displayName ?? "this user"}? They will be unable to log in.`,
      confirmLabel: "Disable",
      variant: "danger",
      action: async () => {
        await postJson(`/admin/users/${user.userId}/disable`, {});
      },
    });
  }

  async function handleEnable(user: AdminUserListItemDto) {
    setActionLoading(true);
    setActionError(null);
    try {
      await postJson(`/admin/users/${user.userId}/enable`, {});
      await fetchUsers();
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(user: AdminUserListItemDto) {
    setConfirmDialog({
      title: "Delete User",
      description: `Are you sure you want to delete ${user.email ?? user.displayName ?? "this user"}? Their data will be preserved but they will be unable to log in.`,
      confirmLabel: "Delete",
      variant: "danger",
      action: async () => {
        await deleteJson(`/admin/users/${user.userId}`);
      },
    });
  }

  async function executeConfirmAction() {
    if (!confirmDialog) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await confirmDialog.action();
      setConfirmDialog(null);
      await fetchUsers();
    } catch (err) {
      setActionError(handleApiError(err));
      setConfirmDialog(null);
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePurge(confirmation: string, adminEmail: string) {
    if (!purgeTarget) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${purgeTarget.userId}/purge`, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation, adminEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
        throw new ApiError(data.message ?? data.error ?? "Purge failed", res.status, data.error);
      }
      setPurgeTarget(null);
      await fetchUsers();
    } catch (err) {
      setActionError(handleApiError(err));
    } finally {
      setActionLoading(false);
    }
  }

  const statusTabs: { value: StatusFilter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "disabled", label: "Disabled" },
    { value: "deleted", label: "Deleted" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="space-y-6" data-testid="admin-users-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Users</h1>
        <p className="mt-1 text-sm text-slate-600">Manage user accounts, roles, and access.</p>
      </div>

      {actionError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-testid="action-error"
        >
          {actionError}
          <button className="ml-2 text-red-500 hover:text-red-700" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white/80 p-1" data-testid="status-filter">
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
              data-testid={`status-filter-${tab.value}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name..."
          className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:max-w-xs"
          data-testid="user-search"
        />
      </div>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">Loading users...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void fetchUsers()}>
              Retry
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">No users found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="users-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Last Seen</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.userId === currentUserId;
                  return (
                    <tr
                      key={user.userId}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                      data-testid={`user-row-${user.userId}`}
                    >
                      <td className="px-4 py-3 text-slate-900">
                        {user.email ?? "—"}
                        {isSelf && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700" data-testid="you-badge">
                            you
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{user.displayName ?? "—"}</td>
                      <td className="px-4 py-3">
                        {isSelf ? (
                          <span className="text-sm font-medium text-slate-700">{ROLE_LABELS[user.role]}</span>
                        ) : (
                          <select
                            value={user.role}
                            onChange={(e) => void handleRoleChange(user, e.target.value as UserRole)}
                            disabled={actionLoading}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none"
                            data-testid={`role-select-${user.userId}`}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <UserStatusBadge status={user.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatRelativeTime(user.lastSeenAt)}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(user.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {user.status === "active" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isSelf || actionLoading}
                                onClick={() => void handleDisable(user)}
                                title={isSelf ? "Cannot modify yourself" : "Disable user"}
                                data-testid={`disable-btn-${user.userId}`}
                              >
                                Disable
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                disabled={isSelf || actionLoading}
                                onClick={() => void handleDelete(user)}
                                title={isSelf ? "Cannot modify yourself" : "Delete user"}
                                data-testid={`delete-btn-${user.userId}`}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                          {user.status === "disabled" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={actionLoading}
                                onClick={() => void handleEnable(user)}
                                data-testid={`enable-btn-${user.userId}`}
                              >
                                Enable
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                disabled={actionLoading}
                                onClick={() => void handleDelete(user)}
                                data-testid={`delete-btn-${user.userId}`}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                          {user.status === "deleted" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              disabled={isSelf || actionLoading}
                              onClick={() => setPurgeTarget(user)}
                              title={isSelf ? "Cannot modify yourself" : "Permanently purge user data"}
                              data-testid={`purge-btn-${user.userId}`}
                            >
                              Purge
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
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ""}
        description={confirmDialog?.description ?? ""}
        confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
        variant={confirmDialog?.variant ?? "default"}
        loading={actionLoading}
        onConfirm={() => void executeConfirmAction()}
        onCancel={() => setConfirmDialog(null)}
      />

      <HardPurgeDialog
        open={purgeTarget !== null}
        targetEmail={purgeTarget?.email ?? ""}
        adminEmail={currentUserEmail ?? ""}
        loading={actionLoading}
        error={actionError}
        onConfirm={(confirmation, adminEmail) => void handlePurge(confirmation, adminEmail)}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}
