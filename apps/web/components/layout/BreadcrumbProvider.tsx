"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface BreadcrumbItem {
  label: string;
  /** Optional href; the rightmost item is rendered as `aria-current="page"` and is non-link regardless. */
  href?: string;
}

interface BreadcrumbContextValue {
  /** Items registered by the most recently-mounted `useBreadcrumb([...])` caller, or `null` if no page registered. */
  items: BreadcrumbItem[] | null;
  /** Internal — replaces the items list. Most callers should use `useBreadcrumb([...])`. */
  setItems: (items: BreadcrumbItem[] | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/**
 * Provider that owns the breadcrumb registration slot. Mount inside
 * `<AppShell>` (after BreadcrumbProvider, the `<Breadcrumb>` component reads
 * via `useBreadcrumbContext()` and falls back to the static title map).
 *
 * Per spec amendment #21: BreadcrumbProvider always provides a slot. Pages
 * that don't call `useBreadcrumb` simply leave `items === null`, and the
 * fallback map drives the rendered chrome.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[] | null>(null);
  const value = useMemo<BreadcrumbContextValue>(() => ({ items, setItems }), [items]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Read the current breadcrumb registration. Returns `null` `items` if no page
 * has registered. Throws if called outside a `<BreadcrumbProvider>` — that
 * would always be a bug in shell wiring.
 */
export function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbContext must be used within <BreadcrumbProvider>.");
  }
  return ctx;
}

/**
 * Per-page breadcrumb registration hook. Call from a client component;
 * the hook registers on mount and clears on unmount. The most recently-
 * mounted caller wins, which is how the dynamic ticker page (e.g.
 * `/tickers/2330 → "TSMC (2330)"`) replaces the static fallback.
 *
 * Stringified-JSON dependency keeps the effect stable when callers pass
 * a literal array on each render — comparing element identity would cause
 * an infinite re-register loop.
 */
export function useBreadcrumb(items: BreadcrumbItem[]): void {
  const ctx = useContext(BreadcrumbContext);
  // Stringify is the cheapest stable signature for an array-of-objects.
  // Pages registering breadcrumbs typically have ≤4 items.
  const signature = JSON.stringify(items);
  useEffect(() => {
    if (!ctx) return;
    ctx.setItems(items);
    return () => {
      ctx.setItems(null);
    };
    // signature drives the effect; `items` itself is captured by closure.
  }, [signature, ctx]);
}
