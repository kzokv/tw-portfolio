"use client";

import { cn } from "../../lib/utils";

type UserStatus = "active" | "disabled" | "deleted";

const statusConfig: Record<UserStatus, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  disabled: {
    label: "Disabled",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  deleted: {
    label: "Deleted",
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", config.className)}
      data-testid={`status-badge-${status}`}
    >
      {config.label}
    </span>
  );
}
