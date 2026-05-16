"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "../ui/Button";
import { QuickSearchPanel, type QuickSearchItem } from "./QuickSearchPanel";

interface TopBarSearchProps {
  items: QuickSearchItem[];
  placeholder: string;
  label: string;
  emptyLabel: string;
  routesLabel: string;
  tickersLabel: string;
  openLabel: string;
  closeLabel: string;
}

/**
 * Quick-search slot rendered inside `<TopBar>`. Owns the desktop inline input,
 * the mobile toggle button, and the mobile sheet — and the keyboard/selection
 * state that backs both surfaces. Extracted from TopBar.tsx per Phase 3c
 * spec target (TopBar ≤200 LOC).
 *
 * Locked testids per design §2: `topbar-search-input`, `topbar-search-button`,
 * `topbar-search-sheet`, `topbar-search-sheet-input`, `topbar-search-results`,
 * `topbar-search-sheet-results`.
 */
export function TopBarSearch({
  items,
  placeholder,
  label,
  emptyLabel,
  routesLabel,
  tickersLabel,
  openLabel,
  closeLabel,
}: TopBarSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    setDesktopOpen(false);
    setMobileOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [pathname]);

  const displayedItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    const source = normalized
      ? items.filter((item) => {
        const haystack = [item.label, item.description, ...(item.keywords ?? [])].join(" ").toLowerCase();
        return haystack.includes(normalized);
      })
      : items;
    const routes = source.filter((item) => item.kind === "route").slice(0, 3);
    const symbols = source.filter((item) => item.kind === "symbol").slice(0, normalized ? 8 : 6);
    return [...routes, ...symbols];
  }, [deferredQuery, items]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (displayedItems.length === 0) return 0;
      return Math.min(current, displayedItems.length - 1);
    });
  }, [displayedItems]);

  function selectItem(item: QuickSearchItem) {
    router.push(item.href);
    setDesktopOpen(false);
    setMobileOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDesktopOpen(true);
      setActiveIndex((current) => (displayedItems.length === 0 ? 0 : (current + 1) % displayedItems.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setDesktopOpen(true);
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
      setDesktopOpen(false);
      setMobileOpen(false);
      return;
    }
    setDesktopOpen(true);
  }

  return (
    <>
      {/* Desktop inline search */}
      <div className="relative hidden lg:block lg:w-[20rem] xl:w-[24rem]">
        <label className="block">
          <span className="sr-only">{label}</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label={label}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setDesktopOpen(true);
              }}
              onFocus={() => setDesktopOpen(true)}
              onBlur={() => setTimeout(() => setDesktopOpen(false), 150)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="h-9 w-full rounded-full border border-border bg-card pl-12 pr-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="topbar-search-input"
            />
          </span>
        </label>
        {desktopOpen ? (
          <div
            className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-[80]"
            onMouseDown={(event) => event.preventDefault()}
          >
            <QuickSearchPanel
              items={displayedItems}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onSelect={selectItem}
              searchRoutesLabel={routesLabel}
              searchTickersLabel={tickersLabel}
              searchEmptyLabel={emptyLabel}
              dataTestId="topbar-search-results"
            />
          </div>
        ) : null}
      </div>

      {/* Mobile/tablet search button */}
      <Button
        variant="secondary"
        className="h-10 w-10 shrink-0 rounded-full lg:hidden"
        aria-label={mobileOpen ? closeLabel : openLabel}
        onClick={() => setMobileOpen((current) => !current)}
        data-testid="topbar-search-button"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </Button>

      {/* Mobile search sheet — position-relative panel below the topbar to
          avoid the ResizeObserver chrome-height measurement (design §3). */}
      {mobileOpen ? (
        <div
          className="fixed inset-x-0 top-14 z-40 border-b border-border bg-background p-3 shadow-md lg:hidden"
          data-testid="topbar-search-sheet"
        >
          <label className="block">
            <span className="sr-only">{label}</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label={label}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
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
              searchRoutesLabel={routesLabel}
              searchTickersLabel={tickersLabel}
              searchEmptyLabel={emptyLabel}
              dataTestId="topbar-search-sheet-results"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
