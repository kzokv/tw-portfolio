import { test } from "@vakwen/test-e2e/fixtures/appPages";

function isoDateForMonth(day: number, monthOffset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day))
    .toISOString()
    .slice(0, 10);
}

// ─── Group 1: Source Composition Tab (calendar drawer) ─────────────────────

test.describe("source composition — calendar drawer", () => {
  test("ETF with provided source lines: Source Composition toggle visible, bucket table renders with NHI subtotal", async ({
    dividends,
  }) => {
    // Gross = receivedCash + withheldAtSource deductions = 21,000 + 2,000 = 23,000
    // Source lines must reconcile to gross within NT$1
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "0050",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(4),
      paymentDate: isoDateForMonth(20),
      cashDividendPerShare: 2.3,
      receivedCashAmount: 21_000,
      sourceCompositionStatus: "provided",
      sourceLines: [
        { sourceBucket: "DIVIDEND_INCOME", amount: 15_000, currencyCode: "TWD", source: "issuer_statement" },
        { sourceBucket: "INTEREST_INCOME", amount: 6_000, currencyCode: "TWD", source: "issuer_statement" },
      ],
      deductions: [],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    // Source Composition toggle should be visible for ETF
    await dividends.assert.sourceCompositionToggleIsVisible();

    // Open the source composition tab
    await dividends.actions.clickSourceCompositionToggle();
    await dividends.assert.sourceCompositionTabIsVisible();

    // NHI subtotal = DIVIDEND_INCOME (15,000) + INTEREST_INCOME (6,000) = 21,000
    await dividends.assert.sourceCompositionNhiSubtotalContains(/21,000|21000/);

    // No estimate warning in provided state
    await dividends.assert.sourceCompositionEstimateWarningIsHidden();
  });

  test("ETF with unknown_pending_disclosure: NHI estimate warning visible, estimate state in tab", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "0050",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(6),
      paymentDate: isoDateForMonth(22),
      cashDividendPerShare: 2.3,
      receivedCashAmount: 2_300,
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
      deductions: [],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    // NHI estimate warning should be visible in deductions section
    await dividends.assert.nhiEstimateWarningIsVisible();

    // Open source composition tab
    await dividends.actions.clickSourceCompositionToggle();
    await dividends.assert.sourceCompositionTabIsVisible();

    // Estimate warning in tab
    await dividends.assert.sourceCompositionEstimateWarningIsVisible();
  });

  test("STOCK instrument: Source Composition toggle not rendered", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(8),
      paymentDate: isoDateForMonth(24),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 120,
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
      deductions: [],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    // Source Composition toggle should NOT be visible for STOCK
    await dividends.assert.sourceCompositionToggleIsHidden();

    // No NHI estimate warning for STOCK
    await dividends.assert.nhiEstimateWarningIsHidden();
  });
});

// ─── Group 2: NHI Rollup Section (review page) ────────────────────────────

test.describe("NHI rollup — review page", () => {
  test("NHI rollup section visible with correct aggregation for ETF entries", async ({
    dividendReview,
  }) => {
    // Seed two ETF entries with provided source lines
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(3),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 2.3,
      receivedCashAmount: 21_000,
      sourceCompositionStatus: "provided",
      sourceLines: [
        { sourceBucket: "DIVIDEND_INCOME", amount: 15_000, currencyCode: "TWD", source: "issuer_statement" },
        { sourceBucket: "INTEREST_INCOME", amount: 6_000, currencyCode: "TWD", source: "issuer_statement" },
      ],
      deductions: [],
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(4),
      paymentDate: isoDateForMonth(16),
      cashDividendPerShare: 1.5,
      receivedCashAmount: 10_000,
      sourceCompositionStatus: "provided",
      sourceLines: [
        { sourceBucket: "DIVIDEND_INCOME", amount: 7_000, currencyCode: "TWD", source: "issuer_statement" },
        { sourceBucket: "CAPITAL_RETURN", amount: 3_000, currencyCode: "TWD", source: "issuer_statement" },
      ],
      deductions: [],
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();

    // NHI rollup section should be visible
    await dividendReview.assert.nhiRollupSectionIsVisible();

    // Should show ETF source bucket names
    await dividendReview.assert.nhiRollupSectionContains(/Dividend income|股利所得/);

    // NHI-subject total = (15,000 + 7,000) DIVIDEND_INCOME + (6,000) INTEREST_INCOME = 28,000
    // Per-entry threshold (NT$20,000): entry 1 NHI-subject=21,000 (≥ threshold → 443),
    // entry 2 NHI-subject=7,000 (< threshold → 0). Projected premium = 443.
    await dividendReview.assert.nhiRollupPremiumContains(/443/);
  });

  test("pending disclosure link visible and navigates with filter param", async ({
    dividendReview,
  }) => {
    // One provided, one pending
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(5),
      paymentDate: isoDateForMonth(17),
      cashDividendPerShare: 2.3,
      receivedCashAmount: 2_300,
      sourceCompositionStatus: "provided",
      sourceLines: [
        { sourceBucket: "DIVIDEND_INCOME", amount: 2_300, currencyCode: "TWD", source: "issuer_statement" },
      ],
      deductions: [],
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(6),
      paymentDate: isoDateForMonth(18),
      cashDividendPerShare: 1.0,
      receivedCashAmount: 1_000,
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
      deductions: [],
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.nhiRollupSectionIsVisible();

    // Pending link shows count
    await dividendReview.assert.nhiRollupPendingLinkContains(/1/);

    // Click the pending link
    await dividendReview.actions.clickNhiRollupPendingLink();

    // URL should contain sourceComposition=pending
    await dividendReview.assert.urlContains("sourceComposition=pending");
  });
});

// ─── Group 3: Responsive layouts ──────────────────────────────────────────

test.describe("source composition — responsive", () => {
  test("Source Composition tab at 375px renders mobile card layout", async ({
    dividends, page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    // Gross = 21,000, source lines sum = 15,000 + 6,000 = 21,000
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "0050",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(10),
      paymentDate: isoDateForMonth(25),
      cashDividendPerShare: 2.3,
      receivedCashAmount: 21_000,
      sourceCompositionStatus: "provided",
      sourceLines: [
        { sourceBucket: "DIVIDEND_INCOME", amount: 15_000, currencyCode: "TWD", source: "issuer_statement" },
        { sourceBucket: "INTEREST_INCOME", amount: 6_000, currencyCode: "TWD", source: "issuer_statement" },
      ],
      deductions: [],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    await dividends.actions.clickSourceCompositionToggle();
    await dividends.assert.sourceCompositionTabIsVisible();

    // At 375px, the desktop table (hidden sm:block) should not be visible
    // and the mobile cards (sm:hidden) should be visible
    const mobileSubtotal = page.getByTestId("source-composition-nhi-subtotal-mobile");
    await mobileSubtotal.waitFor({ state: "visible", timeout: 5000 });
  });

  test("NHI rollup section at 375px renders mobile card layout", async ({
    dividendReview, page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(12),
      paymentDate: isoDateForMonth(26),
      cashDividendPerShare: 2.3,
      receivedCashAmount: 21_000,
      sourceCompositionStatus: "provided",
      sourceLines: [
        { sourceBucket: "DIVIDEND_INCOME", amount: 15_000, currencyCode: "TWD", source: "issuer_statement" },
        { sourceBucket: "INTEREST_INCOME", amount: 6_000, currencyCode: "TWD", source: "issuer_statement" },
      ],
      deductions: [],
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();

    // At 375px, the mobile premium card should be visible instead of the desktop table cell
    const mobilePremium = page.getByTestId("nhi-rollup-premium-mobile");
    await mobilePremium.waitFor({ state: "visible", timeout: 5000 });
  });
});
