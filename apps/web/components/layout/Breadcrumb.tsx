"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBreadcrumbContext, type BreadcrumbItem } from "./BreadcrumbProvider";
import { resolveExactBreadcrumbTitle } from "../../lib/breadcrumb-titles";
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
          // shadcn contract: BreadcrumbItem (<li>) and BreadcrumbSeparator
          // (<li role="presentation">) are SIBLINGS inside BreadcrumbList
          // (<ol>). Rendering the separator inside the item nests <li> inside
          // <li>, which Next.js / React hydration rejects.
          return (
            <Fragment key={`${item.label}-${index}`}>
              <ShadBreadcrumbItem
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
              </ShadBreadcrumbItem>
              {!isLast ? <ShadBreadcrumbSeparator /> : null}
            </Fragment>
          );
        })}
      </ShadBreadcrumbList>
    </ShadBreadcrumb>
  );
}

function buildFallbackItems(pathname: string, dict: AppDictionary | undefined): BreadcrumbItem[] {
  // Walk each prefix of the path so multi-segment routes render a real chain
  // (e.g. `/settings/display` → `Settings › Display`). Each prefix resolves
  // its own label via the same precedence as a top-level path. The terminal
  // (current) item is rendered with no `href`; earlier ones link back.
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  const items: BreadcrumbItem[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const prefix = `/${segments.slice(0, i + 1).join("/")}`;
    const isLast = i === segments.length - 1;
    const label = resolveSegmentLabel(prefix, segments[i], dict);
    items.push({
      label,
      href: isLast ? undefined : prefix,
    });
  }
  return items;
}

function resolveSegmentLabel(
  prefix: string,
  segment: string,
  dict: AppDictionary | undefined,
): string {
  const localized = dict ? resolveLocalizedLabel(prefix, dict) : null;
  if (localized) return localized;
  const fallback = resolveExactBreadcrumbTitle(prefix);
  if (fallback) return fallback;
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
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
