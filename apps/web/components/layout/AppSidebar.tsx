"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  ClipboardList,
  CreditCard,
  Gauge,
  LayoutDashboard,
  LineChart,
  Mail,
  Settings,
  Share2,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/shadcn/sidebar";
import { cn } from "../../lib/utils";

export type AppSidebarVariant = "user" | "admin";

type NavKey =
  | "dashboard"
  | "portfolio"
  | "transactions"
  | "cash-ledger"
  | "dividends"
  | "sharing"
  | "tickers"
  | "settings"
  | "admin"
  // admin variant keys
  | "users"
  | "invites"
  | "audit-log"
  | "providers"
  | "instruments";

interface NavItem {
  key: NavKey;
  href?: string;
  label: string;
  /** Override the icon. */
  icon?: typeof LayoutDashboard;
  /** Click handler when this item should run JS rather than navigate. */
  onClick?: () => void;
  /** Whether the item should appear active for `pathname`. Default: prefix match on href. */
  isActiveOverride?: (pathname: string) => boolean;
}

interface AppSidebarProps {
  variant?: AppSidebarVariant;
  /** Role from `/profile` — used to gate the Admin entry on the user variant. */
  role?: string;
  /** Click handler used by the user variant's Settings nav-item; in Phase 3c
   *  this still routes through `setDrawerOpen(true)` on the AppShell. */
  onOpenSettings?: () => void;
  /** Visible product name in the brand header. Falls back to "Vakwen". */
  productName?: string;
  /** Brand subtitle. */
  productSubtitle?: string;
  /** Optional slot rendered inside `<SidebarHeader>` below the brand link.
   *  AppShell injects `<PortfolioSwitcher>` here so the switcher lives in
   *  the sidebar (per spec amendment #23). */
  switcherSlot?: ReactNode;
}

/**
 * Primary sidebar block built on shadcn `Sidebar`. Two variants:
 *
 *   - "user"  → primary app nav (Dashboard, Portfolio, …) + role-gated Admin entry.
 *   - "admin" → admin nav (Users, Invites, …) + "Back to app" link.
 *
 * Locked testid contract (design §2):
 *   - `app-sidebar` on the Sidebar root.
 *   - `app-sidebar-brand` on the brand link (also doubles as the mobile
 *     trigger because shadcn's `Sidebar` already renders inside a `Sheet`
 *     when `isMobile`; tapping the brand inside the Sheet navigates).
 *   - `app-sidebar-nav-{key}` on each menu button. Keys match the spec
 *     verbatim — see `NavKey` above.
 *   - `app-sidebar-rail` is a 3px warning rail rendered only when
 *     `variant === "admin"` (Preserves §8 item 15).
 *   - `app-sidebar-portfolio-switcher-slot` wraps the `switcherSlot` prop.
 *
 * The brand link routes to `/dashboard` on `≥md` (Preserves §8 item 13).
 * On `<md`, shadcn's `Sidebar` collapses into a `Sheet`, and tapping the
 * brand inside the Sheet closes the Sheet via `setOpenMobile(false)` plus
 * navigation. We do NOT wire a separate `SheetTrigger` on the brand — the
 * shadcn `Sidebar` already mounts the entire sidebar tree inside the Sheet
 * on mobile, so the brand IS the in-Sheet link.
 */
export function AppSidebar({
  variant = "user",
  role,
  onOpenSettings,
  productName = "Vakwen",
  productSubtitle,
  switcherSlot,
}: AppSidebarProps) {
  const pathname = usePathname() ?? "/";
  const { isMobile, setOpenMobile, state } = useSidebar();

  const items: NavItem[] = variant === "admin"
    ? getAdminNavItems()
    : getUserNavItems({ role, onOpenSettings });

  const handleNavClick = (item: NavItem) => {
    if (isMobile) setOpenMobile(false);
    if (item.onClick) item.onClick();
  };

  const brandHref = variant === "admin" ? "/admin" : "/dashboard";

  return (
    <Sidebar collapsible="icon">
      {/* The `app-sidebar` testid anchor lives on a `display:contents`
          wrapper INSIDE shadcn's Sidebar so it survives the mobile branch.
          shadcn renders `<Sidebar>` inside `<Sheet>` on `<md`; the outer
          Sheet is a Radix Dialog.Root which does NOT emit DOM, so any
          `data-testid` passed to `<Sidebar>` itself is dropped on mobile.
          Putting the testid on this child keeps it reachable at all
          viewports — both `getByTestId("app-sidebar").getByTestId(...)`
          and `toHaveAttribute("data-state", ...)` work uniformly. */}
      <div
        data-testid="app-sidebar"
        data-state={state}
        // Preserves §8 item 15 — `data-admin` drives the 3px warning rail
        // styling. The explicit `<span data-testid="app-sidebar-rail">`
        // below is the testid anchor for E2E presence/absence assertions.
        data-admin={variant === "admin" ? "true" : undefined}
        className="contents"
      >
      {variant === "admin" ? (
        <span
          aria-hidden="true"
          data-testid="app-sidebar-rail"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px] bg-[hsl(var(--warning,32_94%_50%))]"
        />
      ) : null}

      <SidebarHeader>
        <Link
          href={brandHref}
          // Preserves §8 item 13 — brand links to /dashboard on ≥md. On
          // <md the entire sidebar is inside shadcn's Sheet (mounted only
          // while open), so this in-Sheet link both navigates AND closes
          // the sheet on tap. The testid `app-sidebar-brand` is reserved
          // for the always-visible TopBar mobile brand-trigger (rendered
          // by AppShell when isMobile); applying it here on mobile would
          // create a strict-mode duplicate.
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
          // The `app-sidebar-brand` testid lives ONLY on the TopBar mobile
          // brand button (rendered when isMobile) — it is the mobile-nav
          // toggle anchor. The in-Sidebar brand link here is a distinct
          // element with its own testid so the page-object's
          // `mobileNavToggle` locator returns false on desktop viewports.
          // Were both elements to share `app-sidebar-brand`, a desktop
          // `isVisible()` check would resolve true here and clicking would
          // navigate to `/dashboard`, breaking helpers like
          // `openSettingsDrawer` that conditionally tap the mobile toggle.
          data-testid="app-sidebar-brand-link"
          className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-sidebar-accent"
          aria-label={isMobile ? `${productName} — close menu and go home` : `${productName} — go to dashboard`}
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-semibold text-white shadow-sm",
              variant === "admin"
                ? "bg-[linear-gradient(135deg,#ef4444,#dc2626)]"
                : "bg-[linear-gradient(135deg,#4f46e5,#6366f1)]",
            )}
            aria-hidden="true"
          >
            {variant === "admin" ? "A" : "V"}
          </span>
          <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.32em] text-sidebar-foreground/60">
              {productSubtitle ?? (variant === "admin" ? "Admin" : productName)}
            </span>
            <span className="truncate text-sm font-semibold text-sidebar-foreground">
              {variant === "admin" ? "Management" : productName}
            </span>
          </span>
        </Link>

        {switcherSlot ? (
          <div
            data-testid="app-sidebar-portfolio-switcher-slot"
            className="px-1 group-data-[collapsible=icon]:hidden"
          >
            {switcherSlot}
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon ?? LayoutDashboard;
                const active = item.isActiveOverride
                  ? item.isActiveOverride(pathname)
                  : item.href
                    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                    : false;
                const buttonContent = (
                  <>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </>
                );
                return (
                  <SidebarMenuItem key={item.key}>
                    {item.href && !item.onClick ? (
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                      >
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          data-testid={`app-sidebar-nav-${item.key}`}
                          onClick={() => handleNavClick(item)}
                        >
                          {buttonContent}
                        </Link>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        onClick={() => handleNavClick(item)}
                        data-testid={`app-sidebar-nav-${item.key}`}
                      >
                        {buttonContent}
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {variant === "admin" ? (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to app">
                <Link
                  href="/dashboard"
                  data-testid="admin-back-to-app"
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  <span>Back to app</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}
      </div>
    </Sidebar>
  );
}

function getUserNavItems({ role, onOpenSettings }: { role?: string; onOpenSettings?: () => void }): NavItem[] {
  const items: NavItem[] = [
    { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: Gauge },
    { key: "portfolio", href: "/portfolio", label: "Portfolio", icon: TrendingUp },
    { key: "transactions", href: "/transactions", label: "Transactions", icon: Wallet },
    { key: "cash-ledger", href: "/cash-ledger", label: "Cash Ledger", icon: CreditCard },
    { key: "dividends", href: "/dividends", label: "Dividends", icon: LineChart },
    { key: "sharing", href: "/sharing", label: "Sharing", icon: Share2 },
    // Settings in 3c still opens the drawer; 3d converts to /settings/*.
    {
      key: "settings",
      label: "Settings",
      icon: Settings,
      onClick: onOpenSettings,
      // The drawer is opened via query param ?drawer=settings; treat the
      // item as active when that query is present. usePathname() strips
      // query so we approximate via direct match on `/settings` for the
      // future-routed surface.
      isActiveOverride: (pathname) => pathname.startsWith("/settings"),
    },
  ];
  if (role === "admin") {
    items.push({ key: "admin", href: "/admin", label: "Admin", icon: ShieldAlert });
  }
  return items;
}

function getAdminNavItems(): NavItem[] {
  return [
    { key: "users", href: "/admin/users", label: "Users", icon: Users },
    { key: "invites", href: "/admin/invites", label: "Invites", icon: Mail },
    { key: "audit-log", href: "/admin/audit-log", label: "Audit Log", icon: ClipboardList },
    { key: "providers", href: "/admin/providers", label: "Providers", icon: Activity },
    { key: "instruments", href: "/admin/instruments", label: "Instruments", icon: LineChart },
    { key: "settings", href: "/admin/settings", label: "Settings", icon: Settings },
  ];
}
