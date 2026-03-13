"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { Button } from "../ui/Button";
import { TooltipInfo } from "../ui/TooltipInfo";
import { UserAvatarButton } from "../profile/UserAvatarButton";
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
  userId?: string;
  onOpenSettings: () => void;
  onToggleNavigation?: () => void;
  navigationOpen?: boolean;
  onToggleDesktopNavigation?: () => void;
  desktopNavigationCollapsed?: boolean;
  productName: string;
  title: string;
  titleTooltip: string;
  openSettingsLabel: string;
  searchPlaceholder: string;
  searchLabel: string;
  searchEmptyLabel: string;
  searchRoutesLabel: string;
  searchSymbolsLabel: string;
  openSearchLabel: string;
  closeSearchLabel: string;
  openNavigationLabel: string;
  closeNavigationLabel: string;
  expandSidebarLabel: string;
  collapseSidebarLabel: string;
  searchItems: QuickSearchItem[];
  skeleton?: boolean;
}

export function TopBar({
  userId,
  onOpenSettings,
  onToggleNavigation,
  navigationOpen = false,
  onToggleDesktopNavigation,
  desktopNavigationCollapsed = false,
  productName,
  title,
  titleTooltip,
  openSettingsLabel,
  searchPlaceholder,
  searchLabel,
  searchEmptyLabel,
  searchRoutesLabel,
  searchSymbolsLabel,
  openSearchLabel,
  closeSearchLabel,
  openNavigationLabel,
  closeNavigationLabel,
  expandSidebarLabel,
  collapseSidebarLabel,
  searchItems,
  skeleton = false,
}: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  const desktopSearchPanel = (
    <QuickSearchPanel
      items={displayedItems}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onSelect={selectItem}
      searchRoutesLabel={searchRoutesLabel}
      searchSymbolsLabel={searchSymbolsLabel}
      searchEmptyLabel={searchEmptyLabel}
      dataTestId="topbar-search-results"
    />
  );

  if (skeleton) {
    return (
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-[rgba(243,247,255,0.92)] backdrop-blur-xl" aria-hidden="true" role="banner">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-5 xl:px-10">
          <div className="min-w-0 flex-1">
            <div className="skeleton-line h-3 w-28 rounded" />
            <div className="skeleton-line skeleton-line--delay mt-3 h-9 w-52 rounded-2xl" />
          </div>
          <div className="hidden lg:block lg:w-[28rem]">
            <div className="skeleton-line h-12 w-full rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton-line h-12 w-12 shrink-0 rounded-full" />
            <div className="skeleton-line h-12 w-12 shrink-0 rounded-full" />
          </div>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-slate-200/75 bg-[rgba(243,247,255,0.88)] backdrop-blur-xl" role="banner">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-4 md:px-8 md:py-5 xl:px-10">
          <Button
            variant="secondary"
            className="h-11 w-11 shrink-0 rounded-full lg:hidden"
            onClick={onToggleNavigation}
            aria-label={navigationOpen ? closeNavigationLabel : openNavigationLabel}
            data-testid="mobile-nav-toggle"
          >
            {navigationOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <Button
            variant="secondary"
            className="hidden h-11 w-11 shrink-0 rounded-full lg:inline-flex"
            onClick={onToggleDesktopNavigation}
            aria-label={desktopNavigationCollapsed ? expandSidebarLabel : collapseSidebarLabel}
            data-testid="desktop-nav-toggle"
          >
            {desktopNavigationCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.36em] text-slate-500">{productName}</p>
            <div className="mt-2 flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-slate-950 sm:text-[2rem]" data-testid="topbar-title">
                {title}
              </h1>
              <TooltipInfo
                label={title}
                content={titleTooltip}
                triggerTestId="tooltip-app-title-trigger"
                contentTestId="tooltip-app-title-content"
              />
            </div>
          </div>

          <div className="hidden lg:block lg:w-full lg:max-w-[24rem] xl:max-w-[26rem]">
            <div className="relative">
              <label className="block">
                <span className="sr-only">{searchLabel}</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    aria-label={searchLabel}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setDesktopSearchOpen(true);
                    }}
                    onFocus={() => setDesktopSearchOpen(true)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={searchPlaceholder}
                    className="field-base h-12 rounded-full border-slate-200/80 bg-white/72 !pl-14 pr-4 text-sm text-slate-800 shadow-[0_14px_30px_rgba(148,163,184,0.08)]"
                    data-testid="topbar-search"
                  />
                </span>
              </label>
              {desktopSearchOpen ? (
                <div
                  className="absolute inset-x-0 top-[calc(100%+0.75rem)] z-[80]"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {desktopSearchPanel}
                </div>
              ) : null}
            </div>
          </div>

          <Button
            variant="secondary"
            className="h-11 w-11 shrink-0 rounded-full lg:hidden"
            aria-label={mobileSearchOpen ? closeSearchLabel : openSearchLabel}
            onClick={() => setMobileSearchOpen((current) => !current)}
            data-testid="topbar-search-button"
          >
            {mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </Button>

          <div className="shrink-0">
            <UserAvatarButton userId={userId} onOpenSettings={onOpenSettings} openSettingsLabel={openSettingsLabel} />
          </div>
        </div>
      </header>

      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/24 backdrop-blur-sm transition lg:hidden",
          mobileSearchOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
        onClick={() => setMobileSearchOpen(false)}
      />
      <div
        className={cn(
          "fixed inset-x-0 top-[5.5rem] z-50 px-4 transition lg:hidden",
          mobileSearchOpen ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0",
        )}
        data-testid="topbar-search-sheet"
      >
        <div className="glass-panel rounded-[30px] border border-slate-200/80 bg-[rgba(255,255,255,0.96)] p-4 shadow-[0_28px_70px_rgba(15,23,42,0.16)]">
          <label className="block">
            <span className="sr-only">{searchLabel}</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                aria-label={searchLabel}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                className="field-base h-12 rounded-full border-slate-300/80 bg-white/90 !pl-14 pr-4 text-sm text-slate-800"
                data-testid="topbar-search-sheet-input"
                autoFocus={mobileSearchOpen}
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
              searchSymbolsLabel={searchSymbolsLabel}
              searchEmptyLabel={searchEmptyLabel}
              dataTestId="topbar-search-sheet-results"
            />
          </div>
        </div>
      </div>
    </>
  );
}

function QuickSearchPanel({
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  searchRoutesLabel,
  searchSymbolsLabel,
  searchEmptyLabel,
  dataTestId,
}: {
  items: QuickSearchItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: QuickSearchItem) => void;
  searchRoutesLabel: string;
  searchSymbolsLabel: string;
  searchEmptyLabel: string;
  dataTestId: string;
}) {
  const routes = items.filter((item) => item.kind === "route");
  const symbols = items.filter((item) => item.kind === "symbol");

  if (items.length === 0) {
    return (
      <div
        className="rounded-[26px] border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-[0_18px_40px_rgba(148,163,184,0.14)]"
        data-testid={dataTestId}
      >
        {searchEmptyLabel}
      </div>
    );
  }

  const itemOffset = 0;

  return (
    <div
      className="rounded-[26px] border border-slate-200 bg-white p-3 shadow-[0_22px_55px_rgba(15,23,42,0.14)]"
      data-testid={dataTestId}
    >
      {routes.length > 0 ? (
        <SearchGroup
          label={searchRoutesLabel}
          items={routes}
          activeIndex={activeIndex}
          itemOffset={itemOffset}
          onActiveIndexChange={onActiveIndexChange}
          onSelect={onSelect}
        />
      ) : null}
      {routes.length > 0 && symbols.length > 0 ? <div className="my-2 border-t border-slate-200" aria-hidden="true" /> : null}
      {symbols.length > 0 ? (
        <SearchGroup
          label={searchSymbolsLabel}
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
      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
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
                "flex w-full items-start justify-between gap-3 rounded-[20px] px-3 py-3 text-left transition",
                active
                  ? "bg-[rgba(79,70,229,0.1)] text-slate-950 shadow-[inset_0_0_0_1px_rgba(79,70,229,0.12)]"
                  : "text-slate-700 hover:bg-slate-100/90",
              )}
              data-testid={`quick-search-item-${item.kind}-${item.id}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block truncate text-xs text-slate-500">{item.description}</span>
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {item.kind}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
