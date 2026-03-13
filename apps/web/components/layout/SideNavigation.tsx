"use client";

import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ArrowRightLeft, LayoutDashboard, PieChart } from "lucide-react";
import { cn } from "../../lib/utils";

type AppSection = "dashboard" | "portfolio" | "transactions";

interface NavigationItem {
  id: AppSection;
  href: string;
  label: string;
  description: string;
}

interface SideNavigationProps {
  items: NavigationItem[];
  activeSection: AppSection;
  eyebrow: string;
  title: string;
  description: string;
  mobile?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}

const iconMap = {
  dashboard: LayoutDashboard,
  portfolio: PieChart,
  transactions: ArrowRightLeft,
} satisfies Record<AppSection, typeof LayoutDashboard>;

export function SideNavigation({
  items,
  activeSection,
  eyebrow,
  title,
  description,
  mobile = false,
  collapsed = false,
  onNavigate,
}: SideNavigationProps) {
  return (
    <Tooltip.Provider delayDuration={120}>
      <nav
        aria-label="Primary"
        className={cn(
          "sidebar-shell flex h-full flex-col rounded-[32px] border border-indigo-100/80 bg-[linear-gradient(180deg,rgba(10,26,71,0.96),rgba(15,36,89,0.94))] p-4 shadow-[0_26px_70px_rgba(15,23,42,0.18)] transition-[width,padding] duration-200",
          mobile ? "min-h-[calc(100vh-7rem)] w-full" : collapsed ? "w-[5.75rem] px-3" : "w-[18.75rem]",
        )}
        data-testid={mobile ? "mobile-sidebar" : "desktop-sidebar"}
        data-collapsed={!mobile && collapsed ? "true" : "false"}
      >
        <div className={cn("border-b border-white/12 pb-5", collapsed && !mobile ? "px-0 text-center" : "px-2")}>
          <div className={cn("flex items-center gap-3", collapsed && !mobile && "justify-center")}>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c89ff,#4f46e5)] text-sm font-semibold text-white shadow-[0_16px_32px_rgba(79,70,229,0.3)]">
              TP
            </div>
            {collapsed && !mobile ? null : (
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.36em] text-indigo-100/65">{eyebrow}</p>
                <h2 className="mt-1 truncate text-xl font-semibold text-white">{title}</h2>
              </div>
            )}
          </div>
          {collapsed && !mobile ? null : (
            <p className="mt-4 text-sm leading-6 text-indigo-100/72">{description}</p>
          )}
        </div>

        <div className="mt-5 flex flex-1 flex-col gap-2">
          {items.map((item) => {
            const Icon = iconMap[item.id];
            const active = item.id === activeSection;
            const link = (
              <Link
                key={item.id}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed && !mobile ? item.label : undefined}
                title={collapsed && !mobile ? item.label : undefined}
                data-testid={`sidebar-link-${item.id}`}
                className={cn(
                  "group relative overflow-hidden rounded-[24px] border transition",
                  collapsed && !mobile ? "px-0 py-3" : "px-4 py-4",
                  active
                    ? "border-[rgba(165,180,252,0.42)] bg-[linear-gradient(135deg,rgba(99,102,241,0.34),rgba(129,140,248,0.22))] shadow-[0_20px_44px_rgba(49,46,129,0.3)]"
                    : "border-transparent bg-white/0 hover:border-white/10 hover:bg-white/8",
                )}
              >
                {active ? <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-white/95" aria-hidden="true" /> : null}
                <div className={cn("flex items-start gap-3", collapsed && !mobile && "justify-center")}>
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
                  {collapsed && !mobile ? null : (
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{item.label}</span>
                      <span className="mt-1 block text-sm leading-6 text-indigo-100/65">{item.description}</span>
                    </span>
                  )}
                </div>
              </Link>
            );

            if (!collapsed || mobile) {
              return link;
            }

            return (
              <Tooltip.Root key={item.id}>
                <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="right"
                    sideOffset={12}
                    className="glass-panel z-[70] max-w-[14rem] rounded-2xl border border-slate-200/90 bg-white/96 px-3 py-2 text-xs leading-5 text-slate-700 shadow-[0_22px_55px_rgba(15,23,42,0.16)]"
                  >
                    <p className="font-semibold text-slate-900">{item.label}</p>
                    <p className="mt-1 text-slate-500">{item.description}</p>
                    <Tooltip.Arrow className="fill-white" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </div>
      </nav>
    </Tooltip.Provider>
  );
}
