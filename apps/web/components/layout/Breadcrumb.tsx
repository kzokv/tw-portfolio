"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBreadcrumbContext, type BreadcrumbItem } from "./BreadcrumbProvider";
import { resolveBreadcrumbTitle } from "../../lib/breadcrumb-titles";
import { useOptionalAppShellData } from "./AppShellDataContext";
import type { AppDictionary } from "../../lib/i18n/types";
import {
  Breadcrumb as ShadBreadcrumb,
  BreadcrumbItem as ShadBreadcrumbItem,
  BreadcrumbLink as ShadBreadcrumbLink,
  BreadcrumbList as ShadBreadcrumbList,
  BreadcrumbSeparator as ShadBreadcrumbSeparator,
} from "../ui/shadcn/breadcrumb";

/**
 * Renders the active breadcrumb chain. Resolution precedence:
 *   1. Items registered via `useBreadcrumb([...])` from the active page.
 *   2. Locale-aware label from `AppShellDataContext.uiDict.navigation.*`
 *      (only the user shell provides this). This keeps i18n-driven specs
 *      like `settings-aaa` working without requiring every page to call
 *      useBreadcrumb in 3c.
 *   3. Static `breadcrumb-titles.ts` fallback (Preserves §8 item 17).
 *   4. As a last resort, a single capitalised segment derived from `pathname`.
 *
 * The rightmost item is rendered with `aria-current="page"` (shadcn's
 * `BreadcrumbPage` does that for us). Earlier items are links when an `href`
 * is provided.
 */
export function Breadcrumb() {
  const pathname = usePathname() ?? "/";
  const { items } = useBreadcrumbContext();
  const shellData = useOptionalAppShellData();
  const resolved = items && items.length > 0
    ? items
    : buildFallbackItems(pathname, shellData?.uiDict);

  if (resolved.length === 0) {
    // Render the nav anyway so the testid is always present for E2E waits.
    return (
      <ShadBreadcrumb data-testid="breadcrumb-root" className="min-w-0">
        <ShadBreadcrumbList />
      </ShadBreadcrumb>
    );
  }

  return (
    <ShadBreadcrumb data-testid="breadcrumb-root" className="min-w-0">
      <ShadBreadcrumbList>
        {resolved.map((item, index) => {
          const isLast = index === resolved.length - 1;
          return (
            <ShadBreadcrumbItem
              key={`${item.label}-${index}`}
              data-testid={`breadcrumb-item-${index}`}
              // Stamp aria-current on the <li> for the active page so QA
              // can locate it via testid + attribute without descending
              // into shadcn's BreadcrumbPage <span>. shadcn's page <span>
              // ALSO carries aria-current="page" for a11y; duplicating
              // on the <li> is harmless and unblocks the
              // `breadcrumbItemIsCurrentPage(index)` assertion.
              aria-current={isLast ? "page" : undefined}
            >
              {isLast ? (
                // Don't use shadcn `BreadcrumbPage` here — it stamps
                // aria-current="page" on its inner <span>, which would
                // collide with the aria-current we set on the <li> above
                // (Playwright strict mode complains when 2 descendants
                // match). The <li>'s aria-current is the single anchor
                // for QA's `breadcrumbItemIsCurrentPage(index)` helper.
                <span
                  role="link"
                  aria-disabled="true"
                  className="font-normal text-foreground"
                >
                  {item.label}
                </span>
              ) : item.href ? (
                <ShadBreadcrumbLink asChild>
                  <Link href={item.href}>{item.label}</Link>
                </ShadBreadcrumbLink>
              ) : (
                <span className="text-muted-foreground">{item.label}</span>
              )}
              {!isLast ? <ShadBreadcrumbSeparator /> : null}
            </ShadBreadcrumbItem>
          );
        })}
      </ShadBreadcrumbList>
    </ShadBreadcrumb>
  );
}

function buildFallbackItems(pathname: string, dict: AppDictionary | undefined): BreadcrumbItem[] {
  const localizedLabel = dict ? resolveLocalizedLabel(pathname, dict) : null;
  if (localizedLabel) {
    return [{ label: localizedLabel }];
  }
  const label = resolveBreadcrumbTitle(pathname);
  if (label) {
    return [{ label }];
  }
  // Last-resort: derive from the trailing segment so the breadcrumb still
  // renders SOMETHING. Avoid empty render so the `breadcrumb-root` testid
  // alone is not visually misleading.
  const segment = pathname.split("/").filter(Boolean).pop();
  if (!segment) return [];
  const humanised = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
  return [{ label: humanised }];
}

/**
 * Resolve a locale-aware label for top-level user routes from the navigation
 * dict. Returns `null` for routes the dict doesn't cover (admin, settings
 * sub-routes); the static fallback map takes over for those.
 */
function resolveLocalizedLabel(pathname: string, dict: AppDictionary): string | null {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return dict.navigation.dashboardLabel;
  if (pathname === "/portfolio" || pathname.startsWith("/portfolio/")) return dict.navigation.portfolioLabel;
  if (pathname === "/transactions" || pathname.startsWith("/transactions/")) return dict.navigation.transactionsLabel;
  if (pathname === "/cash-ledger" || pathname.startsWith("/cash-ledger/")) return dict.navigation.cashLedgerLabel;
  if (pathname === "/dividends" || pathname.startsWith("/dividends/")) return dict.navigation.dividendsLabel;
  return null;
}
