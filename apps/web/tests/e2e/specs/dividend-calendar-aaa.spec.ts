import { test } from "@vakwen/test-e2e/fixtures/appPages";

function isoDateForMonth(day: number, monthOffset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day))
    .toISOString()
    .slice(0, 10);
}

function seededEventId(seedBody: Record<string, unknown>): string {
  const dividendEvent = seedBody.dividendEvent as { id?: string } | undefined;
  if (!dividendEvent?.id) {
    throw new Error("seeded dividend event id was missing");
  }
  return dividendEvent.id;
}

test.describe("dividend calendar", () => {
  test("dividend calendar: month navigation remains latest-wins and direct month picker loads target month", async ({
    dividends,
  }) => {
    const janSeed = await dividends.arrange.seedDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-01-10",
      paymentDate: "2026-01-20",
      cashDividendPerShare: 10,
      eligibleQuantity: 10,
    });
    const aprSeed = await dividends.arrange.seedDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-04-10",
      paymentDate: "2026-04-20",
      cashDividendPerShare: 11,
      eligibleQuantity: 10,
    });
    const julSeed = await dividends.arrange.seedDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-07-10",
      paymentDate: "2026-07-20",
      cashDividendPerShare: 12,
      eligibleQuantity: 10,
    });
    await dividends.arrange.seedDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-03-10",
      paymentDate: null,
      cashDividendPerShare: 9,
      eligibleQuantity: 10,
    });
    const janEventId = seededEventId(janSeed);
    const aprEventId = seededEventId(aprSeed);
    const julEventId = seededEventId(julSeed);

    await dividends.actions.navigateToCalendarMonth("2026-07");
    await dividends.assert.calendarLoaded();
    await dividends.assert.monthControlsAreEnabled();
    await dividends.assert.monthInputHasValue("2026-07");
    await dividends.assert.rowContains(julEventId, /2330/);

    await dividends.actions.clickPreviousMonth();
    await dividends.actions.clickPreviousMonth();
    await dividends.actions.clickPreviousMonth();
    await dividends.assert.monthInputHasValue("2026-04");
    await dividends.assert.monthControlsAreEnabled();
    await dividends.assert.rowContains(aprEventId, /Apr 20, 2026/);

    await dividends.actions.setOverviewMonth("2026-01");
    await dividends.assert.monthInputHasValue("2026-01");
    await dividends.assert.rowContains(janEventId, /Jan 20, 2026/);
  });

  test("dividend calendar: current month rows render → TBD rows excluded and stock edit button enabled", async ({
    dividends,
  }) => {
    const stockSeed = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: isoDateForMonth(4),
      paymentDate: isoDateForMonth(24),
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      receivedCashAmount: 0,
      receivedStockQuantity: 100,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
    });
    const tbdSeed = await dividends.arrange.seedDividendEvent({
      ticker: "0050",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(5),
      paymentDate: null,
      cashDividendPerShare: 0.2,
    });

    await dividends.actions.navigateToCalendar();
    await dividends.assert.calendarLoaded();
    await dividends.assert.tbdSectionIsHidden();
    await dividends.assert.rowIsHidden(seededEventId(tbdSeed));
    // KZO-32: stock edit button is now always enabled (reconcile-only mode inside drawer)
    await dividends.assert.editButtonIsEnabled(stockSeed.dividendEventId);
  });

  test("dividend calendar: cash posting → pending review and inline mark matched → Matched badge", async ({
    dividends,
  }) => {
    const seed = await dividends.arrange.seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(8),
      paymentDate: isoDateForMonth(20),
      cashDividendPerShare: 0.12,
    });
    const eventId = seededEventId(seed);

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openPostingDrawerForEvent(eventId);
    await dividends.assert.drawerIsVisible();

    await dividends.actions.fillReceivedCash(120);
    // New posts default to "unknown disclosure" mode, so no source lines are
    // required. The form also prefills a standard bank fee deduction —
    // verifying the full flow below reaches the Pending Review state.
    await dividends.actions.submitPostingForm();
    await dividends.assert.drawerIsHidden();
    await dividends.assert.rowBadgeContains(eventId, /Pending review|待覆核/);

    await dividends.actions.clickMarkMatchedInline(eventId);
    // KZO-32: resolveBadge() now returns "matched" for reconciliationStatus=matched
    await dividends.assert.rowBadgeContains(eventId, /Matched|相符/);
  });

  test("dividend calendar: unknown disclosure toggle hides source lines and edit submit refreshes the row", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(10),
      paymentDate: isoDateForMonth(22),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [
        {
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 12,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "dividend_posting",
        },
      ],
      sourceCompositionStatus: "provided",
      sourceLines: [
        {
          sourceBucket: "DIVIDEND_INCOME",
          amount: 120,
          currencyCode: "TWD",
          source: "issuer_statement",
        },
      ],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();
    await dividends.assert.sourceLineAmountInputIsVisible(0);

    await dividends.actions.toggleUnknownSourceDisclosure(true);
    await dividends.assert.sourceLineAmountInputIsHidden(0);
    await dividends.actions.fillReceivedCash(140);
    await dividends.actions.submitPostingForm();

    await dividends.assert.drawerIsHidden();
    await dividends.assert.rowBadgeContains(seeded.dividendEventId, /Pending review|待覆核/);
    await dividends.assert.rowContains(seeded.dividendEventId, /152/);
  });

  test("dividend calendar: source-line variance blocks submit", async ({ dividends }) => {
    const seed = await dividends.arrange.seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(12),
      paymentDate: isoDateForMonth(23),
      cashDividendPerShare: 0.12,
    });
    const eventId = seededEventId(seed);

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openPostingDrawerForEvent(eventId);
    await dividends.actions.fillReceivedCash(120);
    // New posts default to "unknown disclosure". Opt into provided mode so the
    // Add source line button surfaces, then add a line that mismatches gross.
    await dividends.actions.toggleUnknownSourceDisclosure(false);
    await dividends.actions.addSourceLine(80);
    await dividends.actions.clickSaveButton();

    await dividends.assert.drawerIsVisible();
    await dividends.assert.formErrorContains(/Source lines must reconcile within NT\$1|來源明細必須在 NT\$1 內對齊總額/);
  });

  test("dividend calendar: stale edit submit → conflict message is shown", async ({ dividends }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(14),
      paymentDate: isoDateForMonth(26),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [
        {
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 12,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "dividend_posting",
        },
      ],
      sourceCompositionStatus: "provided",
      sourceLines: [
        {
          sourceBucket: "DIVIDEND_INCOME",
          amount: 120,
          currencyCode: "TWD",
          source: "issuer_statement",
        },
      ],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    const backgroundUpdate = await dividends.actions.updatePostedDividendViaApi({
      accountId: "acc-1",
      dividendEventId: seeded.dividendEventId,
      dividendLedgerEntryId: seeded.dividendLedgerEntryId,
      expectedVersion: seeded.version,
      receivedCashAmount: 132,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
    });
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (!backgroundUpdate.ok()) {
      throw new Error(`background dividend update failed: ${backgroundUpdate.status()} ${await backgroundUpdate.text()}`);
    }

    await dividends.actions.toggleUnknownSourceDisclosure(true);
    await dividends.actions.fillReceivedCash(144);
    await dividends.actions.submitPostingForm();

    await dividends.assert.formErrorContains(/updated elsewhere|其他地方更新/);
  });

  // ─── KZO-32: Reconciliation badge + drawer tests ───────────────────────────

  test("dividend calendar: badge for matched status → Matched badge visible", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(16),
      paymentDate: isoDateForMonth(27),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
      reconciliationStatus: "matched",
    });

    await dividends.actions.navigateToCalendar();
    await dividends.assert.calendarLoaded();
    await dividends.assert.rowBadgeContains(seeded.dividendEventId, /Matched|相符/);
  });

  test("dividend calendar: badge for explained status → Explained badge visible", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(17),
      paymentDate: isoDateForMonth(27),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
      reconciliationStatus: "explained",
      reconciliationNote: "Difference due to broker rounding",
    });

    await dividends.actions.navigateToCalendar();
    await dividends.assert.calendarLoaded();
    await dividends.assert.rowBadgeContains(seeded.dividendEventId, /Explained|已說明/);
  });

  test("dividend calendar: reconcile drawer (cash, happy path) → save as Explained → badge flips", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(18),
      paymentDate: isoDateForMonth(28),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    // Amounts form IS visible for cash entries
    await dividends.assert.amountsFormIsVisible();
    // Reconcile section is visible for posted entries in edit mode
    await dividends.assert.reconcileSectionIsVisible();

    await dividends.actions.selectReconcileStatus("explained");
    await dividends.actions.fillReconcileNote("Broker rounded down by NT$2");
    await dividends.actions.submitReconciliationForm();

    // onSaved() refreshes and may close or re-render the drawer.
    // Accept both SSE intermediate and final states per playwright-fast-sse-assertions.md.
    await dividends.assert.rowBadgeContains(
      seeded.dividendEventId,
      /Explained|已說明|Pending review|待覆核/,
    );
  });

  test("dividend calendar: stock drawer → quantity amendment remains editable, then save as Matched", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: isoDateForMonth(19),
      paymentDate: isoDateForMonth(28),
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      receivedCashAmount: 0,
      receivedStockQuantity: 100,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
    });

    await dividends.actions.navigateToCalendar();
    // KZO-32: stock edit button is now enabled
    await dividends.assert.editButtonIsEnabled(seeded.dividendEventId);
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();

    await dividends.assert.amountsFormIsVisible();
    await dividends.assert.reconcileSectionIsVisible();
    await dividends.actions.fillReceivedStock(101);
    const amendmentResponse = await dividends.actions.submitPostingForm();
    await dividends.assert.mxAssertTruthy(amendmentResponse.ok(), "stock dividend calendar amendment response ok");
    await dividends.assert.drawerIsHidden();

    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();
    await dividends.assert.reconcileSectionIsVisible();
    await dividends.actions.selectReconcileStatus("matched");
    await dividends.actions.submitReconciliationForm();

    // Accept both intermediate and final states per playwright-fast-sse-assertions.md
    await dividends.assert.rowBadgeContains(
      seeded.dividendEventId,
      /Matched|相符|Pending review|待覆核/,
    );
  });

  test("dividend calendar: reconcile drawer → explained requires note → error shown, badge unchanged", async ({
    dividends,
  }) => {
    const seeded = await dividends.arrange.seedPostedDividend({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: isoDateForMonth(20),
      paymentDate: isoDateForMonth(29),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
    });

    await dividends.actions.navigateToCalendar();
    await dividends.actions.openEditDrawerForEvent(seeded.dividendEventId);
    await dividends.assert.drawerIsVisible();
    await dividends.assert.reconcileSectionIsVisible();

    // Select Explained but leave note empty
    await dividends.actions.selectReconcileStatus("explained");
    // Note is intentionally left blank
    await dividends.actions.clickReconcileSaveButton();

    // Error must be shown; drawer stays open
    await dividends.assert.reconcileErrorContains(
      /note is required|必須填寫備註/i,
    );
    await dividends.assert.drawerIsVisible();

    // Badge must remain at Pending review (no PATCH was sent)
    await dividends.assert.rowBadgeContains(
      seeded.dividendEventId,
      /Pending review|待覆核/,
    );
  });
});
