// Static pathname → breadcrumb-title fallback map.
// Per spec amendment #21 (Phase 3 frozen spec): pages that don't call
// `useBreadcrumb([...])` fall back through this map so a breadcrumb is
// ALWAYS rendered.
//
// ADMIN_TITLES (previously inlined in AdminShell.tsx) migrate here so the
// admin shell mirror in Phase 3c can derive titles without owning a separate
// table.
//
// Entries are matched longest-prefix-first by `resolveBreadcrumbTitle` so
// `/settings/profile` wins over `/settings` when both are present.

interface BreadcrumbFallbackEntry {
  /** Full URL path (no query string). Longest prefix wins. */
  pathname: string;
  /** Human-readable label rendered in the breadcrumb. */
  label: string;
}

// Ordered longest-prefix-first to keep the lookup deterministic without
// a sort step at call time. Add new routes in the appropriate slot.
const BREADCRUMB_FALLBACK_MAP: ReadonlyArray<BreadcrumbFallbackEntry> = [
  // Admin sub-routes (longest prefixes first)
  { pathname: "/admin/users", label: "Users" },
  { pathname: "/admin/invites", label: "Invites" },
  { pathname: "/admin/audit-log", label: "Audit Log" },
  { pathname: "/admin/providers", label: "Provider Health" },
  { pathname: "/admin/instruments", label: "Instruments" },
  { pathname: "/admin/settings", label: "Settings" },
  { pathname: "/admin", label: "Admin" },

  // Settings sub-routes (Phase 3d will add these; keep entries ready)
  { pathname: "/settings/profile", label: "Profile" },
  { pathname: "/settings/accounts", label: "Accounts" },
  { pathname: "/settings/display", label: "Display" },
  { pathname: "/settings/tickers", label: "Tickers" },
  { pathname: "/settings/notifications", label: "Notifications" },
  { pathname: "/settings/privacy", label: "Privacy" },
  { pathname: "/settings", label: "Settings" },

  // Top-level user routes
  { pathname: "/dashboard", label: "Dashboard" },
  { pathname: "/portfolio", label: "Portfolio" },
  { pathname: "/transactions", label: "Transactions" },
  { pathname: "/cash-ledger", label: "Cash Ledger" },
  { pathname: "/dividends/review", label: "Dividend Review" },
  { pathname: "/dividends", label: "Dividends" },
  { pathname: "/sharing", label: "Sharing" },
  { pathname: "/tickers", label: "Tickers" },
];

/**
 * Resolve a fallback breadcrumb label for `pathname` via longest-prefix match.
 * Returns `null` when no entry matches; callers may then use a sensible
 * default (e.g. the route segment) or omit the breadcrumb entirely.
 */
export function resolveBreadcrumbTitle(pathname: string): string | null {
  for (const entry of BREADCRUMB_FALLBACK_MAP) {
    if (pathname === entry.pathname || pathname.startsWith(`${entry.pathname}/`)) {
      return entry.label;
    }
  }
  return null;
}

/** Exposed for unit tests / debugging. */
export const __BREADCRUMB_FALLBACK_MAP = BREADCRUMB_FALLBACK_MAP;
