"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { NotificationDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { Button } from "../ui/Button";
import { SidebarTrigger, useSidebar } from "../ui/shadcn/sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { CommandPaletteTrigger } from "./CommandPaletteTrigger";
import { NotificationBell } from "./NotificationBell";
import { ProfileMenu } from "../profile/ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "../../lib/utils";

export interface QuickSearchItem {
  id: string;
  kind: "route" | "symbol";
  label: string;
  description: string;
  href: string;
  keywords?: string[];
}

interface TopBarProps {
  // Identity
  userId?: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  email?: string | null;
  role?: string;

  // Profile menu wiring
  onOpenProfile?: () => void;
  signOutHref: string;

  // Search
  searchItems: QuickSearchItem[];
  searchPlaceholder: string;
  searchLabel: string;
  searchEmptyLabel: string;
  searchRoutesLabel: string;
  searchTickersLabel: string;
  openSearchLabel: string;
  closeSearchLabel: string;
  /** Hide the inline search input (admin variant). */
  hideSearch?: boolean;

  // Notifications
  unreadCount?: number;
  notifications?: NotificationDto[];
  notificationDropdownOpen?: boolean;
  onNotificationOpenChange?: (open: boolean) => void;
  onNotificationMarkRead?: (id: string) => void;
  onNotificationMarkAllRead?: () => void;
  onNotificationDismiss?: (id: string) => void;
  notificationDict?: AppDictionary;
  /** Hide the bell (e.g. admin shell). */
  hideNotifications?: boolean;
}

/**
 * Decomposed Phase 3c TopBar. Slots in order:
 *   `<SidebarTrigger>` (desktop collapse) · `<Breadcrumb>` · inline search ·
 *   `<CommandPaletteTrigger>` · `<NotificationBell>` · `<ProfileMenu>` ·
 *   `<ThemeToggle>`.
 *
 * Brand link and PortfolioSwitcher have moved to `<AppSidebar>` (spec
 * amendments #18 + #23). The page-title H1 block is dropped — the breadcrumb
 * replaces it.
 *
 * Mobile-search drop-down renders as a position-relative panel below the
 * input (spec §3, ResizeObserver dropped per design §3).
 *
 * Locked testids per design §2.
 */
export function TopBar({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  onOpenProfile,
  signOutHref,
  searchItems,
  searchPlaceholder,
  searchLabel,
  searchEmptyLabel,
  searchRoutesLabel,
  searchTickersLabel,
  openSearchLabel,
  closeSearchLabel,
  hideSearch = false,
  unreadCount = 0,
  notifications = [],
  notificationDropdownOpen = false,
  onNotificationOpenChange,
  onNotificationMarkRead,
  onNotificationMarkAllRead,
  onNotificationDismiss,
  notificationDict,
  hideNotifications = false,
}: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    setDesktopSearchOpen(false);
    setMobileSearchOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [pathname]);

  const displayedItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    const source = normalized
      ? searchItems.filter((item) => {
        const haystack = [item.label, item.description, ...(item.keywords ?? [])].join(" ").toLowerCase();
        return haystack.includes(normalized);
      })
      : searchItems;
    const routes = source.filter((item) => item.kind === "route").slice(0, 3);
    const symbols = source.filter((item) => item.kind === "symbol").slice(0, normalized ? 8 : 6);
    return [...routes, ...symbols];
  }, [deferredQuery, searchItems]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (displayedItems.length === 0) return 0;
      return Math.min(current, displayedItems.length - 1);
    });
  }, [displayedItems]);

  function selectItem(item: QuickSearchItem) {
    router.push(item.href);
    setDesktopSearchOpen(false);
    setMobileSearchOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDesktopSearchOpen(true);
      setActiveIndex((current) => (displayedItems.length === 0 ? 0 : (current + 1) % displayedItems.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setDesktopSearchOpen(true);
      setActiveIndex((current) => {
        if (displayedItems.length === 0) return 0;
        return current === 0 ? displayedItems.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Enter" && displayedItems[activeIndex]) {
      event.preventDefault();
      selectItem(displayedItems[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDesktopSearchOpen(false);
      setMobileSearchOpen(false);
      return;
    }
    setDesktopSearchOpen(true);
  }

  return (
    <header
      role="banner"
      data-testid="topbar"
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:gap-2 md:px-4"
    >
      <SidebarTrigger
        data-testid="app-sidebar-trigger"
        className="shrink-0"
        aria-label="Toggle sidebar"
      />
      {isMobile ? (
        // Preserves §8 item 13 — mobile brand-as-trigger. Tapping opens the
        // sheet so the user lands inside the sidebar tree. The in-Sheet
        // brand link (inside AppSidebar's SidebarHeader) handles desktop
        // brand-link semantics; this element is the locator anchor for
        // `app-sidebar-brand` on `<md`.
        <Button
          variant="ghost"
          className="h-9 shrink-0 px-1.5 text-xs font-semibold"
          onClick={() => setOpenMobile(true)}
          data-testid="app-sidebar-brand"
          aria-label="Open navigation"
        >
          V
        </Button>
      ) : null}

      <div className="min-w-0 flex-1" data-testid="topbar-breadcrumb">
        <Breadcrumb />
      </div>

      {!hideSearch ? (
        <>
          {/* Desktop inline search */}
          <div className="relative hidden lg:block lg:w-[20rem] xl:w-[24rem]">
            <label className="block">
              <span className="sr-only">{searchLabel}</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label={searchLabel}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setDesktopSearchOpen(true);
                  }}
                  onFocus={() => setDesktopSearchOpen(true)}
                  onBlur={() => setTimeout(() => setDesktopSearchOpen(false), 150)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={searchPlaceholder}
                  className="h-9 w-full rounded-full border border-border bg-card pl-12 pr-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  data-testid="topbar-search-input"
                />
              </span>
            </label>
            {desktopSearchOpen ? (
              <div
                className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-[80]"
                onMouseDown={(event) => event.preventDefault()}
              >
                <QuickSearchPanel
                  items={displayedItems}
                  activeIndex={activeIndex}
                  onActiveIndexChange={setActiveIndex}
                  onSelect={selectItem}
                  searchRoutesLabel={searchRoutesLabel}
                  searchTickersLabel={searchTickersLabel}
                  searchEmptyLabel={searchEmptyLabel}
                  dataTestId="topbar-search-results"
                />
              </div>
            ) : null}
          </div>

          {/* Mobile/tablet search button */}
          <Button
            variant="secondary"
            className="h-10 w-10 shrink-0 rounded-full lg:hidden"
            aria-label={mobileSearchOpen ? closeSearchLabel : openSearchLabel}
            onClick={() => setMobileSearchOpen((current) => !current)}
            data-testid="topbar-search-button"
          >
            {mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </Button>
        </>
      ) : null}

      <CommandPaletteTrigger />

      {!hideNotifications
        && notificationDict
        && onNotificationOpenChange
        && onNotificationMarkRead
        && onNotificationMarkAllRead
        && onNotificationDismiss ? (
        <NotificationBell
          unreadCount={unreadCount}
          notifications={notifications}
          open={notificationDropdownOpen}
          onOpenChange={onNotificationOpenChange}
          onMarkRead={onNotificationMarkRead}
          onMarkAllRead={onNotificationMarkAllRead}
          onDismiss={onNotificationDismiss}
          dict={notificationDict}
        />
      ) : null}

      <div className="hidden shrink-0 md:block" data-testid="topbar-theme-toggle">
        <ThemeToggle />
      </div>

      <ProfileMenu
        userId={userId}
        displayName={displayName}
        pictureUrl={pictureUrl}
        email={email}
        role={role}
        onOpenProfile={onOpenProfile}
        signOutHref={signOutHref}
      />

      {/* Mobile search sheet — position-relative panel below the topbar to
          avoid the ResizeObserver chrome-height measurement (design §3). */}
      {mobileSearchOpen ? (
        <div
          className="fixed inset-x-0 top-14 z-40 border-b border-border bg-background p-3 shadow-md lg:hidden"
          data-testid="topbar-search-sheet"
        >
          <label className="block">
            <span className="sr-only">{searchLabel}</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label={searchLabel}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                className="h-10 w-full rounded-full border border-border bg-card pl-12 pr-3 text-sm text-foreground"
                data-testid="topbar-search-sheet-input"
                autoFocus
              />
            </span>
          </label>
          <div className="mt-3">
            <QuickSearchPanel
              items={displayedItems}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onSelect={selectItem}
              searchRoutesLabel={searchRoutesLabel}
              searchTickersLabel={searchTickersLabel}
              searchEmptyLabel={searchEmptyLabel}
              dataTestId="topbar-search-sheet-results"
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function QuickSearchPanel({
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  searchRoutesLabel,
  searchTickersLabel,
  searchEmptyLabel,
  dataTestId,
}: {
  items: QuickSearchItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: QuickSearchItem) => void;
  searchRoutesLabel: string;
  searchTickersLabel: string;
  searchEmptyLabel: string;
  dataTestId: string;
}) {
  const routes = items.filter((item) => item.kind === "route");
  const symbols = items.filter((item) => item.kind === "symbol");

  if (items.length === 0) {
    return (
      <div
        className="rounded-[18px] border border-border bg-popover p-4 text-sm text-muted-foreground shadow-md"
        data-testid={dataTestId}
      >
        {searchEmptyLabel}
      </div>
    );
  }

  return (
    <div
      className="rounded-[18px] border border-border bg-popover p-2 shadow-lg"
      data-testid={dataTestId}
    >
      {routes.length > 0 ? (
        <SearchGroup
          label={searchRoutesLabel}
          items={routes}
          activeIndex={activeIndex}
          itemOffset={0}
          onActiveIndexChange={onActiveIndexChange}
          onSelect={onSelect}
        />
      ) : null}
      {routes.length > 0 && symbols.length > 0 ? (
        <div className="my-2 border-t border-border" aria-hidden="true" />
      ) : null}
      {symbols.length > 0 ? (
        <SearchGroup
          label={searchTickersLabel}
          items={symbols}
          activeIndex={activeIndex}
          itemOffset={routes.length}
          onActiveIndexChange={onActiveIndexChange}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

function SearchGroup({
  label,
  items,
  activeIndex,
  itemOffset,
  onActiveIndexChange,
  onSelect,
}: {
  label: string;
  items: QuickSearchItem[];
  activeIndex: number;
  itemOffset: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: QuickSearchItem) => void;
}) {
  return (
    <div>
      <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
      <div className="grid gap-1">
        {items.map((item, index) => {
          const resolvedIndex = itemOffset + index;
          const active = resolvedIndex === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => onActiveIndexChange(resolvedIndex)}
              onClick={() => onSelect(item)}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-[12px] px-3 py-2 text-left transition",
                active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/60",
              )}
              data-testid={`quick-search-item-${item.kind}-${item.id}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {item.kind}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
