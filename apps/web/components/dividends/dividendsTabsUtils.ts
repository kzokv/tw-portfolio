// Phase 5a — shared between server (page.tsx initial tab resolution) and
// client (DividendsTabsClient). Cannot live in DividendsTabsClient.tsx
// because it carries "use client" and Next.js then routes server callers
// through the client-reference shim, which throws at runtime.

export type DividendsTabValue = "calendar" | "ledger";

const LEDGER_ONLY_PARAMS = [
  "status",
  "preset",
  "fromPaymentDate",
  "toPaymentDate",
  "ticker",
  "marketCode",
  "accountId",
  "sortBy",
  "sortOrder",
  "page",
  "limit",
  "sourceComposition",
] as const;

export const DIVIDENDS_LEDGER_ONLY_PARAMS = LEDGER_ONLY_PARAMS;

/**
 * Resolve the initial tab from the URL. Used by both the server (initial
 * SSR) and the client (deep links).
 */
export function resolveInitialDividendsTab(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): DividendsTabValue {
  const get = (key: string): string | undefined => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key) ?? undefined;
    const v = searchParams[key];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };

  const view = get("view");
  if (view === "ledger") return "ledger";
  if (view === "calendar") return "calendar";

  // Implied ledger when any ledger-only param is present without view=.
  for (const key of LEDGER_ONLY_PARAMS) {
    if (get(key) !== undefined) return "ledger";
  }
  return "calendar";
}
