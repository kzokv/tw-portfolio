"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  type AccentPreset,
  type InstrumentCatalogItemDto,
  type MarketCode,
  MARKET_CODES,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { searchInstruments } from "../../features/settings/services/instrumentSearchService";
import { useDebouncedValue } from "../../lib/hooks/useDebouncedValue";
import { applyAccent } from "../../lib/theme";
import { patchJson } from "../../lib/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/shadcn/command";
import { DialogDescription, DialogTitle } from "../ui/shadcn/dialog";
import {
  type ActionCommandItem,
  type CommandPaletteActionId,
  type RouteCommandItem,
  getActionCommandItems,
  getRouteCommandItems,
} from "../../lib/command-registry";
import { useOptionalNavigationFeedback } from "./NavigationFeedbackContext";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial query value (used by §22 inline-search → palette handoff). */
  initialQuery?: string;
  dict: AppDictionary;
  /** Invoked when the user picks `action.transaction.add`. */
  onAddTransaction: () => void;
  /** Invoked when the user picks `action.recompute.all`. */
  onRecomputeAll: () => void;
}

const TICKER_DEBOUNCE_MS = 200;
const TICKER_MAX_RESULTS = 8;
const TICKER_SEARCH_MARKETS: MarketCode[] = [...MARKET_CODES];

interface TickerCommandItem {
  ticker: string;
  marketCode: MarketCode;
  name: string;
  /** Stable key — `command-palette-item-ticker-{symbol}-{marketCode}` suffix. */
  key: string;
}

/**
 * Phase 3e (§3e + §12 A2) — global ⌘K command palette.
 *
 * Surfaces three groups:
 *   - Routes: static list from `command-registry.ts`
 *   - Tickers: live typeahead via `GET /market-data/search` (200ms debounce,
 *              max 8 results, parallel across TW/US/AU markets)
 *   - Actions: theme / accent / transaction.add / recompute.all
 *
 * Live search failures (rate-limit, provider degradation) fail silent —
 * `searchInstruments` already throws typed `SearchUnavailableError`; we
 * swallow + log and leave the in-memory routes/actions usable.
 */
export function CommandPalette({
  open,
  onOpenChange,
  initialQuery = "",
  dict,
  onAddTransaction,
  onRecomputeAll,
}: CommandPaletteProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const navigationFeedback = useOptionalNavigationFeedback();

  const [query, setQuery] = useState(initialQuery);
  const [tickerResults, setTickerResults] = useState<TickerCommandItem[]>([]);
  const debouncedQuery = useDebouncedValue(query.trim(), TICKER_DEBOUNCE_MS);

  // Reset (or re-seed) the input whenever the palette re-opens. Reopening
  // with a handed-off query should preserve that query; reopening without
  // one starts fresh.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
    } else {
      setQuery("");
      setTickerResults([]);
    }
  }, [open, initialQuery]);

  // Live ticker search across supported markets. The 2-char min mirrors the backend
  // route's `q: z.string().min(2)` and avoids needless calls.
  useEffect(() => {
    if (!open) return;
    if (debouncedQuery.length < 2) {
      setTickerResults([]);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const settled = await Promise.allSettled(
          TICKER_SEARCH_MARKETS.map((market) =>
            searchInstruments(debouncedQuery, market, controller.signal),
          ),
        );
        if (controller.signal.aborted) return;
        const flat: InstrumentCatalogItemDto[] = settled.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        );
        const seen = new Set<string>();
        const merged: TickerCommandItem[] = [];
        for (const item of flat) {
          // The DTO declares `marketCode: string`, but the search endpoint
          // only emits the parsed MarketCode enum back. Defensive guard skips
          // anything else.
          if (!(MARKET_CODES as readonly string[]).includes(item.marketCode)) {
            continue;
          }
          const market = item.marketCode as MarketCode;
          const key = `${item.ticker}-${market}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            ticker: item.ticker,
            marketCode: market,
            name: item.name ?? item.ticker,
            key,
          });
          if (merged.length >= TICKER_MAX_RESULTS) break;
        }
        setTickerResults(merged);
      } catch {
        // Swallow — typed `SearchUnavailableError` already maps backend
        // 429/503s. The palette remains usable; route + action items still
        // resolve. A toast or warning indicator can be added in a later phase.
      }
    })();

    return () => controller.abort();
  }, [debouncedQuery, open]);

  const routeItems = useMemo<RouteCommandItem[]>(() => getRouteCommandItems(dict), [dict]);
  const actionItems = useMemo<ActionCommandItem[]>(() => getActionCommandItems(dict), [dict]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const runAction = useCallback(
    async (actionId: CommandPaletteActionId) => {
      // Each action ends by closing the palette. Async work (e.g. accent
      // persistence) starts before close so the optimistic UI fires
      // immediately; failures roll back via the existing accent applier.
      if (actionId.startsWith("theme.")) {
        const mode = actionId.slice("theme.".length);
        setTheme(mode);
        close();
        return;
      }
      if (actionId.startsWith("accent.")) {
        const preset = actionId.slice("accent.".length) as AccentPreset;
        const next = { kind: "preset" as const, preset };
        // Apply CSS vars first so the UI reflects the change immediately.
        const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
        applyAccent(next, mode);
        try {
          await patchJson("/user-preferences", { themeAccent: next });
        } catch {
          // Match DisplayTabSection's rollback semantics — but for the
          // palette we just leave the optimistic UI applied; the next
          // mount of AccentApplier will reconcile from /user-preferences.
        }
        close();
        return;
      }
      if (actionId === "transaction.add") {
        close();
        onAddTransaction();
        return;
      }
      if (actionId === "recompute.all") {
        close();
        onRecomputeAll();
        return;
      }
    },
    [close, onAddTransaction, onRecomputeAll, setTheme],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div data-testid="command-palette-dialog">
        {/* Radix Dialog accessibility — a Title is required (announced by
            screen readers) and a Description is strongly recommended. Both
            are visually hidden so they don't affect the cmdk surface. */}
        <DialogTitle className="sr-only">{dict.commandPalette.placeholder}</DialogTitle>
        <DialogDescription className="sr-only">
          {`${dict.commandPalette.groupRoutes} · ${dict.commandPalette.groupTickers} · ${dict.commandPalette.groupActions}`}
        </DialogDescription>
        <CommandInput
          data-testid="command-palette-input"
          placeholder={dict.commandPalette.placeholder}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty data-testid="command-palette-empty">{dict.commandPalette.empty}</CommandEmpty>

          <CommandGroup
            heading={dict.commandPalette.groupRoutes}
            data-testid="command-palette-group-routes"
          >
            {routeItems.map((item) => (
              <CommandItem
                key={item.key}
                value={`${item.label} ${item.keywords.join(" ")}`}
                data-testid={`command-palette-item-route-${item.key}`}
                onSelect={() => {
                  close();
                  navigationFeedback?.startNavigation({ href: item.href, label: item.label });
                  router.push(item.href);
                }}
              >
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>

          {tickerResults.length > 0 ? (
            <CommandGroup
              heading={dict.commandPalette.groupTickers}
              data-testid="command-palette-group-tickers"
            >
              {tickerResults.map((item) => (
                <CommandItem
                  key={item.key}
                  value={`${item.ticker} ${item.name} ${item.marketCode}`}
                  data-testid={`command-palette-item-ticker-${item.ticker}-${item.marketCode}`}
                  onSelect={() => {
                    close();
                    const href = `/tickers/${encodeURIComponent(item.ticker)}`;
                    navigationFeedback?.startNavigation({ href, label: item.ticker });
                    router.push(href);
                  }}
                >
                  <span className="font-medium">{item.ticker}</span>
                  <span className="text-xs text-muted-foreground">· {item.marketCode}</span>
                  <span className="ml-2 truncate text-sm text-muted-foreground">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          <CommandGroup
            heading={dict.commandPalette.groupActions}
            data-testid="command-palette-group-actions"
          >
            {actionItems.map((item) => (
              <CommandItem
                key={item.key}
                value={`${item.label} ${item.keywords.join(" ")}`}
                data-testid={`command-palette-item-action-${item.key}`}
                onSelect={() => {
                  void runAction(item.actionId);
                }}
              >
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
