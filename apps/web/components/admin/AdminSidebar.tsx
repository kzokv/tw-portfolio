"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Mail, Settings, Users } from "lucide-react";
import { cn } from "../../lib/utils";

interface AdminNavItem {
  id: string;
  href: string;
  label: string;
  icon: typeof Users;
}

const adminNavItems: AdminNavItem[] = [
  { id: "users", href: "/admin/users", label: "Users", icon: Users },
  { id: "invites", href: "/admin/invites", label: "Invites", icon: Mail },
  { id: "audit-log", href: "/admin/audit-log", label: "Audit Log", icon: ClipboardList },
  { id: "settings", href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className="flex h-full flex-col rounded-[32px] border border-indigo-100/80 bg-[linear-gradient(180deg,rgba(10,26,71,0.96),rgba(15,36,89,0.94))] p-4 shadow-[0_26px_70px_rgba(15,23,42,0.18)]"
      data-testid="admin-sidebar"
    >
      <div className="border-b border-white/12 px-2 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#ef4444,#dc2626)] text-sm font-semibold text-white shadow-[0_16px_32px_rgba(239,68,68,0.3)]">
            A
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.36em] text-indigo-100/65">Admin</p>
            <h2 className="mt-1 truncate text-xl font-semibold text-white">Management</h2>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-indigo-100/72">Manage users, invitations, and review audit logs.</p>
      </div>

      <div className="mt-5 flex flex-1 flex-col gap-2">
        {adminNavItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              data-testid={`admin-sidebar-link-${item.id}`}
              className={cn(
                "group relative overflow-hidden rounded-[24px] border px-4 py-4 transition",
                active
                  ? "border-[rgba(165,180,252,0.42)] bg-[linear-gradient(135deg,rgba(99,102,241,0.34),rgba(129,140,248,0.22))] shadow-[0_20px_44px_rgba(49,46,129,0.3)]"
                  : "border-transparent bg-white/0 hover:border-white/10 hover:bg-white/8",
              )}
            >
              {active ? <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-white/95" aria-hidden="true" /> : null}
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition",
                    active
                      ? "border-white/22 bg-white/14 text-white"
                      : "border-white/10 bg-white/6 text-indigo-100/82 group-hover:bg-white/10",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{item.label}</span>
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto border-t border-white/12 pt-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-indigo-100/72 transition hover:bg-white/8 hover:text-white"
          data-testid="admin-back-to-app"
        >
          Back to app
        </Link>
      </div>
    </nav>
  );
}
