import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

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
  test("dividend calendar: current month rows render → tbd bucket and stock edit guard are visible", async ({
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
    await dividends.assert.tbdSectionIsVisible();
    await dividends.assert.editButtonIsDisabledWithTooltip(
      stockSeed.dividendEventId,
      /Stock and mixed dividends cannot be edited in place|股票股利與混合股利目前不能原地編輯/,
    );
    await dividends.assert.rowBadgeContains(
      seededEventId(tbdSeed),
      /Unposted|未入帳/,
    );
  });

  test("dividend calendar: cash posting → pending review and inline mark matched → posted", async ({
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
    await dividends.assert.rowBadgeContains(eventId, /Posted|已入帳/);
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
    if (!backgroundUpdate.ok()) {
      throw new Error(`background dividend update failed: ${backgroundUpdate.status()} ${await backgroundUpdate.text()}`);
    }

    await dividends.actions.toggleUnknownSourceDisclosure(true);
    await dividends.actions.fillReceivedCash(144);
    await dividends.actions.submitPostingForm();

    await dividends.assert.formErrorContains(/updated elsewhere|其他地方更新/);
  });
});
