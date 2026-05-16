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
 *
 * Phase 3d iter 3 root-cause fix: the effect deps depend on `setItems`
 * (React-stable setState reference), NOT on `ctx` itself. `ctx` is the
 * result of `useMemo([items], …)` inside `BreadcrumbProvider`, so its
 * identity flips on every `setItems()` call — putting `ctx` in deps here
 * created an infinite cycle: setItems → ctx changes → effect re-fires →
 * setItems → … Surface symptom was a deterministic React #185
 * "Maximum update depth" failure on the 3 `portfolio-snapshots-aaa`
 * mutation-cluster specs (58, 103, 146) which navigate to
 * `/tickers/[ticker]` after generating snapshots. Read-only specs (19,
 * 199, 233) stay on `/dashboard` and don't mount `useBreadcrumb`.
 */
export function useBreadcrumb(items: BreadcrumbItem[]): void {
  const ctx = useContext(BreadcrumbContext);
  const setItems = ctx?.setItems ?? null;
  // Stringify is the cheapest stable signature for an array-of-objects.
  // Pages registering breadcrumbs typically have ≤4 items.
  const signature = JSON.stringify(items);
  useEffect(() => {
    if (!setItems) return;
    setItems(items);
    return () => {
      setItems(null);
    };
    // signature drives the effect; `items` itself is captured by closure.
    // setItems is the stable React setState reference; do NOT add `ctx`
    // here — see header comment for the cycle explanation.
  }, [signature, setItems]);
}
