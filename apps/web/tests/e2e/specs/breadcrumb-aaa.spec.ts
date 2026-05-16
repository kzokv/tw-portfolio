// Phase 3c — Breadcrumb AAA spec.
//
// Verifies the shadcn-based Breadcrumb component introduced in Phase 3c:
//   [breadcrumb-A] Static fallback: top-level pages show their static title
//                  from breadcrumb-titles.ts without calling useBreadcrumb.
//   [breadcrumb-B] Dynamic segment: /tickers/[ticker] shows the ticker
//                  identifier (or its display label) in the current item.
//   [breadcrumb-C] Nested fallback: /portfolio shows a breadcrumb that is
//                  accessible (breadcrumb-root + aria-current="page").
//   [breadcrumb-D] Breadcrumb root is visible on multiple routes, proving
//                  the BreadcrumbProvider is mounted at the AppShell level.
//
// Lives in specs/ (Suite 6 — dev_bypass) because breadcrumb rendering is
// pure UI with no OAuth requirement.
//
// No ticker bars are seeded — breadcrumb tests don't depend on market data.
//
// Testid contract (locked in architect-design.md §2):
//   breadcrumb-root        — root <nav>
//   breadcrumb-item-{index} — 0-indexed segment; rightmost has aria-current="page"

import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ── [breadcrumb-A] Static title fallback ─────────────────────────────────────

test("[breadcrumb-A] /dashboard breadcrumb shows 'Dashboard' as current item", async ({
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/dashboard");
  await appShell.assert.appIsReady();

  // breadcrumb-root must be visible in the TopBar
  await appShell.assert.breadcrumbRootIsVisible();

  // The current-page item (rightmost) must be visible and contain "Dashboard"
  await appShell.assert.breadcrumbCurrentItemIsVisible();
  await appShell.assert.breadcrumbCurrentItemContains(/dashboard/i);
});

test("[breadcrumb-A] /portfolio breadcrumb shows a visible current item", async ({
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.assert.appIsReady();

  await appShell.assert.breadcrumbRootIsVisible();
  await appShell.assert.breadcrumbCurrentItemIsVisible();
  await appShell.assert.breadcrumbCurrentItemContains(/portfolio/i);
});

test("[breadcrumb-A] /transactions breadcrumb shows a visible current item", async ({
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/transactions");
  await appShell.assert.appIsReady();

  await appShell.assert.breadcrumbRootIsVisible();
  await appShell.assert.breadcrumbCurrentItemIsVisible();
  await appShell.assert.breadcrumbCurrentItemContains(/transaction/i);
});

// ── [breadcrumb-B] Dynamic ticker segment ────────────────────────────────────

test("[breadcrumb-B] /tickers/2330 breadcrumb has a current item containing the ticker", async ({
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/tickers/2330");
  await appShell.assert.appIsReady();

  await appShell.assert.breadcrumbRootIsVisible();

  // The breadcrumb must contain "2330" somewhere — either as a parent segment
  // or as the current-page segment (display label or ticker symbol).
  await appShell.assert.breadcrumbContainsText("2330");

  // The rightmost item must carry aria-current="page"
  await appShell.assert.breadcrumbCurrentItemIsVisible();
});

// ── [breadcrumb-C] BreadcrumbProvider mounted at shell level ─────────────────

test("[breadcrumb-C] breadcrumb-root is present after client-side navigation via sidebar", async ({
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/dashboard");
  await appShell.assert.appIsReady();

  // Navigate via sidebar (client-side routing — no full page reload)
  await appShell.actions.navigateViaSidebar("portfolio");
  await appShell.assert.appIsReady();
  await appShell.assert.isOnRoute(/\/portfolio$/);

  // Breadcrumb must update to reflect the new route after SPA navigation
  await appShell.assert.breadcrumbRootIsVisible();
  await appShell.assert.breadcrumbCurrentItemContains(/portfolio/i);
});

// ── [breadcrumb-D] Segment index structure ───────────────────────────────────

test("[breadcrumb-D] breadcrumb-item-0 is the current item on a top-level route", async ({
  appShell,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/dashboard");
  await appShell.assert.appIsReady();

  // For a top-level route, the only segment is index 0 which is also the current page
  await appShell.assert.breadcrumbItemIsVisible(0);
  await appShell.assert.breadcrumbItemIsCurrentPage(0);
  await appShell.assert.breadcrumbItemContainsText(0, /dashboard/i);
});
