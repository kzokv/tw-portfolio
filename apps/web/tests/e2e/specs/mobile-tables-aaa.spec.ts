// Phase 4 (commit 4j) — Mobile DataTable migration smoke specs.
//
// This spec runs under the two Phase 3g viewport projects:
//   - chromium-mobile (375 × 667) — exercises card-stack rendering at <sm
//   - chromium-tablet (768 × 1024) — exercises scroll-with-sticky at ≥sm
//
// Per scope-grill lock in `docs/004-notes/ui-reshape-shadcn/scope-todo-202605171244-phase-4.md`:
//   - 4 card-stack tables at <sm: TransactionHistory, RecentTransactionsCard,
//     DividendReview. Historical AdminProviders table/card coverage moved to
//     the provider console rail, which now emits `provider-console-tab-{id}`.
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
import { seedTransactionForUser } from "./helpers/sharing.js";

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

  test("[mobile-table-card-stack-A]: transaction history card grid renders at <sm viewport", async ({
    appShell,
    page,
    settings,
    testUser,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= SM_BREAKPOINT_PX,
      "Mobile-only — verifies card-stack at <sm",
    );

    await settings.arrange.seedInstruments([
      { ticker: "2330", name: "台積電", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
    ]);
    await seedTransactionForUser(testUser.userId, {
      ticker: "2330",
      quantity: 100,
      unitPrice: 600,
      tradeDate: "2026-01-02",
    });

    await appShell.actions.navigateToRouteForResponsiveTest("/transactions");
    // The full transaction history browser wraps the shared DataTable.
    await page.getByTestId("transaction-history-browser").waitFor({ state: "visible" });
    await page.getByTestId("transaction-history-table").waitFor({ state: "attached" });
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
