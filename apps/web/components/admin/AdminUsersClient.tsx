"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminUserListItemDto,
  AdminUserListResponse,
  AdminUserStatus,
  UserRole,
} from "@vakwen/shared-types";
import { getJson, patchJson, postJson, deleteJson, ApiError } from "../../lib/api";
import { PROFILE_REFRESH_EVENT } from "../../features/profile/hooks/useProfile";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { UserStatusBadge } from "./UserStatusBadge";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";
import { HardPurgeDialog } from "./HardPurgeDialog";
import { cn } from "../../lib/utils";
import { formatAdminRelativeTime, useAdminI18n } from "./admin-i18n";

interface AdminUsersClientProps {
  currentUserId: string;
  currentUserEmail: string | null;
}

type StatusFilter = AdminUserStatus | "all";

const ROLE_OPTIONS: UserRole[] = ["admin", "member", "viewer"];

function formatRelativeTime(dateStr: string | null, dict: ReturnType<typeof useAdminI18n>): string {
  if (!dateStr) return "—";
  const locale = dict.common.justNow === "剛剛" ? "zh-TW" : "en";
  return formatAdminRelativeTime(dateStr, locale, dict);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

export function AdminUsersClient({ currentUserId, currentUserEmail }: AdminUsersClientProps) {
  const dict = useAdminI18n();
  const router = useRouter();
  const roleLabels: Record<UserRole, string> = {
    admin: dict.common.roleAdmin,
    member: dict.common.roleMember,
    viewer: dict.common.roleViewer,
  };
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
      setError(err instanceof Error ? err.message : dict.users.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, debouncedSearch]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  function handleApiError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "impersonation_write_blocked") return "";
      if (err.code === "last_admin_blocked") return dict.users.lastAdminBlocked;
      if (err.code === "self_operation_blocked") return dict.users.selfBlocked;
      if (err.code === "active_jobs_blocked") return dict.users.activeJobsBlocked;
      if (err.code === "cannot_impersonate_self") return dict.users.cannotImpersonateSelf;
      return err.message;
    }
    return err instanceof Error ? err.message : dict.users.operationFailed;
  }

  function setHandledActionError(err: unknown): void {
    const nextMessage = handleApiError(err);
    if (nextMessage) {
      setActionError(nextMessage);
    }
  }

  async function handleRoleChange(user: AdminUserListItemDto, newRole: UserRole) {
    if (user.userId === currentUserId) return;
    if (user.role === "admin" && newRole !== "admin") {
      setConfirmDialog({
        title: dict.users.demoteTitle,
        description: dict.users.demoteDescription
          .replace("{user}", user.email ?? user.displayName ?? dict.users.thisUser)
          .replace("{role}", roleLabels[newRole]),
        confirmLabel: dict.users.demoteConfirm,
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
      setHandledActionError(err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDisable(user: AdminUserListItemDto) {
    setConfirmDialog({
      title: dict.users.disableTitle,
      description: dict.users.disableDescription.replace("{user}", user.email ?? user.displayName ?? dict.users.thisUser),
      confirmLabel: dict.users.disableConfirm,
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
      setHandledActionError(err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(user: AdminUserListItemDto) {
    setConfirmDialog({
      title: dict.users.deleteTitle,
      description: dict.users.deleteDescription.replace("{user}", user.email ?? user.displayName ?? dict.users.thisUser),
      confirmLabel: dict.users.deleteConfirm,
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
      setHandledActionError(err);
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
      await deleteJson<void>(`/admin/users/${purgeTarget.userId}/purge`, {
        body: { confirmation, adminEmail },
      });
      setPurgeTarget(null);
      await fetchUsers();
    } catch (err) {
      setHandledActionError(err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleImpersonate(user: AdminUserListItemDto) {
    if (user.userId === currentUserId || user.status !== "active") return;

    setActionLoading(true);
    setActionError(null);
    try {
      await postJson(`/admin/users/${user.userId}/impersonate`, {});
      window.dispatchEvent(new Event(PROFILE_REFRESH_EVENT));
      router.refresh();
    } catch (err) {
      setHandledActionError(err);
    } finally {
      setActionLoading(false);
    }
  }

  const statusTabs: { value: StatusFilter; label: string }[] = [
    { value: "active", label: dict.common.statusActive },
    { value: "disabled", label: dict.common.statusDisabled },
    { value: "deleted", label: dict.common.statusDeleted },
    { value: "all", label: dict.common.all },
  ];

  return (
    <div className="space-y-6" data-testid="admin-users-page">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{dict.users.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{dict.users.description}</p>
      </div>

      {actionError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-testid="action-error"
        >
          {actionError}
          <button className="ml-2 text-red-500 hover:text-red-700" onClick={() => setActionError(null)}>
            {dict.common.dismiss}
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
          placeholder={dict.users.searchPlaceholder}
          className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:max-w-xs"
          data-testid="user-search"
        />
      </div>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{dict.users.loading}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void fetchUsers()}>
              {dict.common.retry}
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-500">{dict.users.empty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm" data-testid="users-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.user}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.role}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.status}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.lastSeen}</th>
                  <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.joined}</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{dict.users.actions}</th>
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
                      <td className="px-5 py-4 align-top text-slate-900">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-950">
                              {user.displayName ?? user.email ?? dict.users.unknownUser}
                            </span>
                            {isSelf && (
                              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700" data-testid="you-badge">
                                {dict.users.you}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 break-all text-sm text-slate-500">{user.email ?? "—"}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        {isSelf ? (
                          <span className="text-sm font-medium text-slate-700">{roleLabels[user.role]}</span>
                        ) : (
                          <select
                            value={user.role}
                            onChange={(e) => void handleRoleChange(user, e.target.value as UserRole)}
                            disabled={actionLoading}
                            className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none"
                            data-testid={`role-select-${user.userId}`}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>{roleLabels[r]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <UserStatusBadge status={user.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 align-top text-slate-500" title={user.lastSeenAt ?? undefined}>
                        {formatRelativeTime(user.lastSeenAt, dict)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 align-top text-slate-500" title={user.createdAt}>
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {!isSelf ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                user.status !== "active"
                                  ? "text-slate-400 hover:bg-transparent hover:text-slate-400"
                                  : "text-red-700 hover:text-red-800",
                              )}
                              disabled={user.status !== "active" || actionLoading}
                              onClick={() => void handleImpersonate(user)}
                              title={dict.users.impersonateTitle}
                              data-testid={`impersonate-btn-${user.userId}`}
                            >
                              {dict.users.impersonate}
                            </Button>
                          ) : null}
                          {user.status === "active" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isSelf || actionLoading}
                                onClick={() => void handleDisable(user)}
                                title={isSelf ? dict.users.selfBlocked : dict.users.disableUserTitle}
                                data-testid={`disable-btn-${user.userId}`}
                              >
                                {dict.users.disableConfirm}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                disabled={isSelf || actionLoading}
                                onClick={() => void handleDelete(user)}
                                title={isSelf ? dict.users.selfBlocked : dict.users.deleteUserTitle}
                                data-testid={`delete-btn-${user.userId}`}
                              >
                                {dict.users.deleteConfirm}
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
                                {dict.users.enable}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                disabled={actionLoading}
                                onClick={() => void handleDelete(user)}
                                data-testid={`delete-btn-${user.userId}`}
                              >
                                {dict.users.deleteConfirm}
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
                              title={isSelf ? dict.users.selfBlocked : dict.users.purgeTitle}
                              data-testid={`purge-btn-${user.userId}`}
                            >
                              {dict.users.purge}
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
        confirmLabel={confirmDialog?.confirmLabel ?? dict.common.confirm}
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
