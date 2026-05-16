"use client";

import { cn } from "../../lib/utils";

export interface QuickSearchItem {
  id: string;
  kind: "route" | "symbol";
  label: string;
  description: string;
  href: string;
  keywords?: string[];
}

interface QuickSearchPanelProps {
  items: QuickSearchItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (item: QuickSearchItem) => void;
  searchRoutesLabel: string;
  searchTickersLabel: string;
  searchEmptyLabel: string;
  dataTestId: string;
}

export function QuickSearchPanel({
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  searchRoutesLabel,
  searchTickersLabel,
  searchEmptyLabel,
  dataTestId,
}: QuickSearchPanelProps) {
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
