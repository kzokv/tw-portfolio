"use client";

import { cn } from "../../lib/utils";
import { useAdminI18n } from "./admin-i18n";

type UserStatus = "active" | "disabled" | "deleted";

const statusConfig: Record<UserStatus, { className: string }> = {
  active: {
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  disabled: {
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  deleted: {
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const dict = useAdminI18n();
  const config = statusConfig[status];
  const label =
    status === "active"
      ? dict.common.statusActive
      : status === "disabled"
        ? dict.common.statusDisabled
        : dict.common.statusDeleted;
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", config.className)}
      data-testid={`status-badge-${status}`}
    >
      {label}
    </span>
  );
}
