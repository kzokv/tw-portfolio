// Phase 4 (commit 4j) — Mobile DataTable migration smoke specs.
//
// This spec runs under the two Phase 3g viewport projects:
//   - chromium-mobile (375 × 667) — exercises card-stack rendering at <sm
//   - chromium-tablet (768 × 1024) — exercises scroll-with-sticky at ≥sm
//
// Per scope-grill lock in `docs/004-notes/ui-reshape-shadcn/scope-todo-202605171244-phase-4.md`:
//   - 4 card-stack tables at <sm: TransactionHistory, RecentTransactionsCard,
//     AdminProviders, DividendReview. All emit the same `*-row-{id}` /
//     `provider-row-{id}` testid in both renderings; useIsSmallScreen ensures
//     only one variant is in DOM at any viewport.
//   - 5 scroll-only tables (Holdings, AdminInstruments, CashLedger,
//     NhiRollup, SourceComposition): scroll + sticky-first-column at narrow
//     viewports. Their `*-table` testid is in DOM at all viewports.
//
// This file is a SMOKE-LEVEL guard: each test loads the relevant route at
// the project viewport and asserts the table testid is in DOM. It does NOT
// deeply validate card-vs-table rendering — that is best caught by the
// component unit tests (DataTable.test.tsx) plus visual QA. The smoke
// coverage prevents the worst regression: "migration accidentally broke
// rendering at <sm".

import { test } from "@vakwen/test-e2e/fixtures/appPages";

const SM_BREAKPOINT_PX = 640;

test.describe("Phase 4 mobile DataTable smoke", () => {
  test("[mobile-table-overflow-A]: holdings table renders at <sm viewport with horizontal scroll", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= SM_BREAKPOINT_PX,
      "Mobile-only — verifies scroll-table at <sm",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/dashboard");
    // Holdings table is a scroll-only consumer at <sm — testid must be in DOM
    // and the page body should not horizontally overflow (sticky-column +
    // container overflow-x-auto means horizontal scroll lives inside the
    // table wrapper, not on the page body).
    await page.getByTestId("dashboard-holdings-section").waitFor({ state: "visible" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    await appShell.assert.mxAssertTruthy(
      scrollWidth <= clientWidth + 1,
      `body scroll-width (${scrollWidth}) must fit viewport (${clientWidth})`,
    );
  });

  test("[mobile-table-card-stack-A]: recent transactions card grid renders at <sm viewport", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= SM_BREAKPOINT_PX,
      "Mobile-only — verifies card-stack at <sm",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/transactions");
    // The `recent-transactions-card` Card wraps the DataTable;
    // `recent-transactions-table` is the DataTable container testid.
    await page.getByTestId("recent-transactions-card").waitFor({ state: "visible" });
    await page.getByTestId("recent-transactions-table").waitFor({ state: "attached" });
  });

  test("[mobile-table-overflow-B]: scroll tables fit within viewport at tablet ≥sm", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width < SM_BREAKPOINT_PX,
      "Tablet+ only — verifies scroll-table container hides horizontal overflow",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/dashboard");
    await page.getByTestId("dashboard-holdings-section").waitFor({ state: "visible" });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    await appShell.assert.mxAssertTruthy(
      scrollWidth <= clientWidth + 1,
      `body scroll-width (${scrollWidth}) must fit viewport (${clientWidth})`,
    );
  });
});
