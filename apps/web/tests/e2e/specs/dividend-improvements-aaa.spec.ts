import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { TestEnv } from "@vakwen/config/test";

function taipeiDateParts(): { date: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  return { date: `${year}-${month}-${value("day")}`, month: `${year}-${month}` };
}

function seededEventId(seedBody: Record<string, unknown>): string {
  const dividendEvent = seedBody.dividendEvent as { id?: string } | undefined;
  if (!dividendEvent?.id) {
    throw new Error("seeded dividend event id was missing");
  }
  return dividendEvent.id;
}

test.describe("locked dividend browser coverage", () => {
  test("[dividend overview]: daily and needs-action data → one card shows market-local today and only three prioritized rows on desktop and mobile", async ({
    appShell,
    dividends,
    page,
    ticker,
  }) => {
    const today = taipeiDateParts();
    const tickers = ["7761", "7762", "7763", "7764"];
    await ticker.arrange.seedInstruments(tickers.map((symbol) => ({
      ticker: symbol,
      name: `Overview ${symbol}`,
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    })));
    for (const symbol of tickers) {
      await dividends.arrange.seedPostedDividendWithReconciliation({
        ticker: symbol,
        exDividendDate: today.date,
        paymentDate: today.date,
        cashDividendPerShare: 0.12,
        receivedCashAmount: 108,
        reconciliationStatus: "open",
      });
    }

    await appShell.actions.navigateToRoute(`/dividends?month=${today.month}`);
    await dividends.assert.calendarLoaded();
    const payingToday = page.getByTestId("dividends-paying-today");
    await payingToday.waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(await payingToday.textContent(), "Overview 7761", "paying today card text");
    await appShell.assert.mxAssertIncludes(await payingToday.textContent(), "TW", "paying today market");
    const exDividendToday = page.getByTestId("dividends-ex-dividend-today");
    await exDividendToday.waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(
      await exDividendToday.textContent(),
      "Overview 7761",
      "ex-dividend today card text",
    );
    await appShell.assert.mxAssertEqual(await page.getByTestId("dividends-needs-action").count(), 1, "needs action card count");
    const actionCard = page.getByTestId("dividends-needs-action");
    await actionCard.waitFor({ state: "visible" });
    for (const symbol of tickers.slice(0, 3)) {
      await appShell.assert.mxAssertIncludes(await actionCard.textContent(), `Overview ${symbol}`, `needs action includes ${symbol}`);
    }
    await appShell.assert.mxAssertEqual(
      (await actionCard.textContent())?.includes("Overview 7764") ?? false,
      false,
      "needs action excludes fourth item",
    );
    await page.getByTestId("dividends-this-month").waitFor({ state: "visible" });

    await page.setViewportSize({ width: 390, height: 844 });
    await payingToday.waitFor({ state: "visible" });
    await exDividendToday.waitFor({ state: "visible" });
    await page.getByTestId("dividends-this-month").waitFor({ state: "visible" });
  });

  test("[dividend review]: server sort, ticker link, and row activation → navigation stays separate from an expected-first exact breakdown drawer", async ({
    appShell,
    dividendReview,
    page,
    settings,
  }) => {
    await settings.arrange.seedInstruments([{
      ticker: "7770",
      name: "Variance Exact",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    }]);
    const posted = await dividendReview.arrange.seedPostedDividend({
      ticker: "7770",
      exDividendDate: "2026-06-01",
      paymentDate: "2026-06-20",
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      deductions: [{
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "broker_statement",
      }],
      sourceLines: [{
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
        currencyCode: "TWD",
        source: "broker_statement",
      }],
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    const sortResponse = page.waitForResponse((response) =>
      response.url().includes("/portfolio/dividends/review")
      && response.url().includes("sortBy=varianceAmount"));
    await page.getByTestId("review-sort-variance").click();
    await dividendReview.assert.responseStatusIs(await sortResponse, 200);
    await dividendReview.assert.urlContains("sortBy=varianceAmount");

    await page.getByTestId(`review-ticker-link-${posted.dividendLedgerEntryId}`).click();
    await appShell.assert.isOnRoute(/\/tickers\/7770\?marketCode=TW/);
    const reviewDrawer = page.getByRole("dialog");
    await reviewDrawer.waitFor({ state: "hidden" });
    await appShell.assert.mxAssertEqual(await reviewDrawer.isVisible().catch(() => false), false, "review drawer hidden");

    await dividendReview.actions.navigateToReview();
    await dividendReview.actions.clickRow(posted.dividendLedgerEntryId);
    const drawer = page.getByRole("dialog");
    await drawer.waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(await drawer.textContent(), "Expected", "review drawer expected label");
    await appShell.assert.mxAssertIncludes(await drawer.textContent(), "Expected net", "review drawer expected net label");
    await appShell.assert.mxAssertIncludes(await drawer.textContent(), "Actual net", "review drawer actual net label");
    await appShell.assert.mxAssertIncludes(await drawer.textContent(), "Variance", "review drawer variance label");
    await appShell.assert.mxAssertMatches(await drawer.textContent(), /NT\$\s*120/, "review drawer gross amount");
    await appShell.assert.mxAssertMatches(await drawer.textContent(), /NT\$\s*108/, "review drawer net amount");
  });

  test("[holding and ticker dividends]: holding quick links and independent ticker sections → read-only activity and 10/25/50 pagination remain responsive", async ({
    appShell,
    dashboard,
    dividendReview,
    page,
    portfolio,
    request,
    testUser,
    ticker,
  }) => {
    await ticker.arrange.seedInstruments([{
      ticker: "7780",
      name: "Independent Dividend",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    }]);
    await dashboard.arrange.seedDailyBars([{
      ticker: "7780",
      marketCode: "TW",
      barDate: taipeiDateParts().date,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1000,
      source: "e2e",
    }]);
    await dividendReview.arrange.seedPostedDividend({
      ticker: "7780",
      exDividendDate: "2026-06-01",
      paymentDate: "2026-06-20",
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedExpectedDividend({
      ticker: "7780",
      exDividendDate: "2027-06-01",
      paymentDate: "2027-06-20",
      cashDividendPerShare: 0.15,
    });
    for (let index = 0; index < 10; index += 1) {
      const day = String(index + 2).padStart(2, "0");
      await dividendReview.arrange.seedPostedDividend({
        ticker: "7780",
        exDividendDate: `2026-04-${day}`,
        paymentDate: `2026-05-${day}`,
        cashDividendPerShare: 0.1,
        receivedCashAmount: 90,
      });
    }
    for (let index = 0; index < 11; index += 1) {
      const response = await request.post(new URL("/corporate-actions", TestEnv.apiBaseUrl).href, {
        headers: { "x-user-id": testUser.userId },
        data: {
          accountId: "acc-1",
          ticker: "7780",
          actionType: "SPLIT",
          numerator: 1,
          denominator: 1,
          actionDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        },
      });
      await appShell.assert.mxAssertEqual(response.ok(), true, await response.text());
    }

    await portfolio.actions.navigateToPortfolio();
    await page.getByTestId("holding-group-row-7780-TW")
      .getByTestId("holding-group-open-detail-7780-TW")
      .click();
    const activity = page.getByTestId("holding-activity-detail");
    await activity.waitFor({ state: "visible" });
    await appShell.assert.mxAssertMatches(await activity.textContent(), /Position actions/i, "holding activity position actions");
    await appShell.assert.mxAssertMatches(await activity.textContent(), /Upcoming dividends/i, "holding activity upcoming dividends");
    await appShell.assert.mxAssertMatches(await activity.textContent(), /Posted dividends/i, "holding activity posted dividends");
    await appShell.assert.mxAssertEqual(
      await activity.getByTestId("holding-split-impact-preview").count(),
      0,
      "holding split impact preview count",
    );
    const pageSizeSelects = activity.getByRole("combobox");
    await appShell.assert.mxAssertEqual(await pageSizeSelects.count(), 2, "holding activity page size select count");
    for (const select of await pageSizeSelects.all()) {
      await appShell.assert.mxAssertEqual(await select.inputValue(), "10", "holding activity page size default");
      await appShell.assert.mxAssertDeepEqual(
        await select.locator("option").allTextContents(),
        ["10", "25", "50"],
        "holding activity page size options",
      );
    }
    await appShell.assert.mxAssertEqual(
      await activity.getByTestId("holding-position-action-item").count(),
      10,
      "holding position action item count",
    );
    await appShell.assert.mxAssertEqual(
      await activity.getByTestId("holding-posted-dividend-item").count(),
      10,
      "holding posted dividend item count",
    );
    const positionPageResponse = page.waitForResponse((response) =>
      response.url().includes("/activity-dividends")
      && response.url().includes("positionActionsPage=2"));
    await activity.getByTestId("holding-position-actions-next").click();
    await dividendReview.assert.responseStatusIs(await positionPageResponse, 200);
    await appShell.assert.isOnRoute(/holdingActivityPositionActionsPage=2/);
    await appShell.assert.mxAssertEqual(
      await activity.getByTestId("holding-position-action-item").count(),
      1,
      "holding position action page 2 item count",
    );
    const postedPageResponse = page.waitForResponse((response) =>
      response.url().includes("/activity-dividends")
      && response.url().includes("postedPage=2"));
    await activity.getByTestId("holding-posted-dividends-next").click();
    await dividendReview.assert.responseStatusIs(await postedPageResponse, 200);
    await appShell.assert.isOnRoute(/holdingActivityPostedPage=2/);
    await appShell.assert.mxAssertEqual(
      await activity.getByTestId("holding-posted-dividend-item").count(),
      1,
      "holding posted dividend page 2 item count",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await activity.waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await activity.evaluate((element) => element.scrollWidth <= element.clientWidth),
      true,
      "holding activity has no horizontal overflow",
    );

    const tickerFailures: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes("/tickers/7780/dividends/")) {
        tickerFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    const upcomingResponse = page.waitForResponse((response) => response.url().includes("/tickers/7780/dividends/upcoming"));
    const openReconciliationResponse = page.waitForResponse((response) =>
      response.url().includes("/tickers/7780/dividends/open-reconciliation"));
    const postedHistoryResponse = page.waitForResponse((response) =>
      response.url().includes("/tickers/7780/dividends/posted-history"));
    await appShell.actions.navigateToRouteForResponsiveTest("/tickers/7780?marketCode=TW");
    await ticker.actions.openDividendsTabFromMobileSelect();
    await ticker.assert.dividendsPanelIsVisible();
    await appShell.assert.mxAssertIncludes((await upcomingResponse).url(), "/upcoming", "ticker upcoming request url");
    await appShell.assert.mxAssertIncludes(
      (await openReconciliationResponse).url(),
      "/open-reconciliation",
      "ticker open reconciliation request url",
    );
    await appShell.assert.mxAssertIncludes((await postedHistoryResponse).url(), "/posted-history", "ticker posted history request url");
    const upcomingRow = page.getByTestId("ticker-upcoming-dividend-0");
    await upcomingRow.waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(await upcomingRow.textContent(), "2027", "ticker upcoming dividend row");
    const postedTitle = page.getByTestId("ticker-posted-title-0");
    await postedTitle.waitFor({ state: "visible" });
    await appShell.assert.mxAssertIncludes(await postedTitle.textContent(), "7780 Independent Dividend", "ticker posted dividend title");
    const tickerPageSize = page.getByTestId("ticker-posted-page-size");
    await tickerPageSize.waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(await tickerPageSize.inputValue(), "10", "ticker posted page size default");
    await appShell.assert.mxAssertDeepEqual(
      await tickerPageSize.locator("option").allTextContents(),
      ["10", "25", "50"],
      "ticker posted page size options",
    );
    const postedHistoryRefetch = page.waitForResponse((response) =>
      response.url().includes("/tickers/7780/dividends/posted-history")
      && response.url().includes("limit=25"));
    await tickerPageSize.selectOption("25");
    await appShell.assert.isOnRoute(/tickerDividendPostedLimit=25/);
    await dividendReview.assert.responseStatusIs(await postedHistoryRefetch, 200);
    await appShell.assert.mxAssertDeepEqual(tickerFailures, [], tickerFailures.join("\n") || "ticker request failures");
  });

  test("[destructive delete UX]: dividend-linked trade delete → preview uses the destructive token route and exposes receipt impact before confirm", async ({
    appShell,
    dividendReview,
    page,
    ticker,
  }) => {
    await dividendReview.arrange.seedPostedDividend({
      ticker: "7790",
      tradeDate: "2026-01-10",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await ticker.actions.navigateToTicker("7790");
    const previewResponse = page.waitForResponse((response) => response.url().includes("/portfolio/transactions/mutations/delete-preview"));
    await ticker.actions.clickDeleteOnRow("BUY");
    await ticker.assert.deleteDialogIsVisible();
    await dividendReview.assert.responseStatusIs(await previewResponse, 200);
    const deleteImpact = page.getByTestId("delete-dividend-impact");
    await deleteImpact.waitFor({ state: "visible" });
    await appShell.assert.mxAssertMatches(await deleteImpact.textContent(), /dividend|receipt|re-enter/i, "delete impact text");
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("delete-confirm-button").isEnabled(),
      true,
      "delete confirm button enabled",
    );

    const confirmResponse = page.waitForResponse((response) => (
      response.url().includes("/portfolio/transactions/mutations/previews/")
      && response.url().endsWith("/confirm")
    ));
    await page.getByTestId("delete-confirm-button").click();
    await dividendReview.assert.responseStatusIs(await confirmResponse, 200);
    await ticker.assert.deleteDialogIsHidden();
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("transaction-row").filter({ hasText: "BUY" }).count(),
      0,
      "deleted BUY transaction row count",
    );
  });

  test("[dividend calculation settings]: posting drawer deep link → focused TW fallback saves in a new tab and return refresh preserves unsaved receipt input", async ({
    appShell,
    dividends,
    page,
    request,
    testUser,
  }) => {
    const settingsUrl = new URL("/accounts/acc-1/dividend-settings/TW", TestEnv.apiBaseUrl).href;
    const currentSettingsResponse = await request.get(settingsUrl, {
      headers: { "x-user-id": testUser.userId },
    });
    const currentSettings = await currentSettingsResponse.json() as { version: number };
    const clearResponse = await request.patch(settingsUrl, {
      headers: { "content-type": "application/json", "x-user-id": testUser.userId },
      data: { expectedVersion: currentSettings.version, fallbackParValue: null },
    });
    await appShell.assert.mxAssertEqual(clearResponse.ok(), true, await clearResponse.text());

    const seedBody = await dividends.arrange.seedDividendEvent({
      ticker: "2887",
      eventType: "STOCK",
      exDividendDate: "2026-08-05",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 1,
      stockDistributionAmountRaw: 1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockProviderValueUnit: "TWD_PER_SHARE",
      stockProviderSource: "finmind",
      stockProviderDataset: "TaiwanStockDividend",
    });
    const eventId = seededEventId(seedBody);

    await appShell.actions.navigateToRoute("/dividends?month=2026-08");
    await dividends.assert.calendarLoaded();
    await dividends.actions.openPostingDrawerForEvent(eventId);
    await dividends.assert.drawerIsVisible();

    await page.getByTestId("dividend-received-stock").fill("155");
    await page.getByText(/Par value|面額/i).first().click();
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("dividend-calculation-par-value").inputValue(),
      "",
      "dividend calculation par value starts empty",
    );

    await page.context().route("**/events/stream", async (route) => {
      await route.abort();
    });
    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("dividend-calculation-settings-link").click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await popup.bringToFront();

    const focusedSection = popup.getByTestId("dividend-settings-section-acc-1-TW");
    await focusedSection.waitFor({ state: "visible" });
    await popup.waitForFunction(
      () => document.activeElement?.getAttribute("data-testid") === "dividend-settings-section-acc-1-TW",
    );

    await popup.getByTestId("dividend-settings-edit-acc-1-TW").click();
    await popup.getByTestId("dividend-settings-par-value-acc-1-TW").fill("10");
    const saveResponse = popup.waitForResponse((response) => (
      response.request().method() === "PATCH"
      && response.url().endsWith("/accounts/acc-1/dividend-settings/TW")
    ));
    await popup.getByTestId("dividend-settings-save-acc-1-TW").click();
    await appShell.assert.mxAssertEqual((await saveResponse).ok(), true, "dividend settings save response");
    await popup.getByTestId("dividend-settings-edit-acc-1-TW").waitFor({ state: "visible" });
    await appShell.assert.mxAssertMatches(
      await focusedSection.textContent(),
      /TWD 10/,
      "focused dividend settings text",
    );

    const refreshResponse = page.waitForResponse((response) => (
      response.request().method() === "GET"
      && response.url().endsWith("/accounts/acc-1/dividend-settings/TW")
    ));
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await appShell.assert.mxAssertEqual((await refreshResponse).ok(), true, "dividend settings refresh response");
    await page.waitForFunction(() => (
      (document.querySelector('[data-testid="dividend-calculation-par-value"]') as HTMLInputElement | null)?.value === "10"
    ));
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("dividend-received-stock").inputValue(),
      "155",
      "unsaved received stock input preserved",
    );
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("dividend-calculation-par-value").inputValue(),
      "10",
      "refreshed calculation par value",
    );

    const previewResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().includes("/portfolio/dividends/calculations/preview"));
    await page.getByTestId("dividend-calculation-preview").click();
    await appShell.assert.mxAssertTruthy((await previewResponse).ok(), "dividend calculation preview response ok");
    await appShell.assert.mxAssertMatches(
      await page.getByTestId("dividend-calculation-result").textContent(),
      /100/,
      "dividend calculation preview result",
    );
  });

  test("[dividend review a11y]: labeled filters and keyboard row activation → drawer opens on desktop and mobile", async ({
    dividendReview,
    page,
  }) => {
    const posted = await dividendReview.arrange.seedPostedDividend({
      ticker: "2886",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      receivedCashAmount: 0,
      receivedStockQuantity: 150,
      deductions: [],
      sourceCompositionStatus: "unknown_pending_disclosure",
      sourceLines: [],
    });

    await dividendReview.actions.navigateToReviewWithParams("ticker=2886");
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.mxAssertMatches(
      await page.getByTestId("filter-ticker").evaluate((element) => (element as HTMLInputElement).labels?.[0]?.textContent ?? ""),
      /ticker/i,
      "ticker filter accessible label",
    );
    await dividendReview.assert.mxAssertMatches(
      await page.getByTestId("filter-account").evaluate((element) => (element as HTMLSelectElement).labels?.[0]?.textContent ?? ""),
      /account/i,
      "account filter accessible label",
    );
    await dividendReview.assert.mxAssertMatches(
      await page.getByTestId("filter-cash-status").evaluate((element) => (element as HTMLSelectElement).labels?.[0]?.textContent ?? ""),
      /cash status/i,
      "cash status filter accessible label",
    );
    await dividendReview.assert.mxAssertMatches(
      await page.getByTestId("filter-stock-status").evaluate((element) => (element as HTMLSelectElement).labels?.[0]?.textContent ?? ""),
      /stock status/i,
      "stock status filter accessible label",
    );

    const row = page.getByTestId(`review-row-${posted.dividendLedgerEntryId}`);
    await dividendReview.assert.mxAssertEqual(await row.getAttribute("role"), null, "review row has no nested button role");
    const openButton = page.getByTestId(`review-row-${posted.dividendLedgerEntryId}-open`);
    await openButton.focus();
    await page.keyboard.press("Enter");
    await dividendReview.assert.drawerIsVisible();
    await dividendReview.actions.closeDrawer();
    await dividendReview.assert.drawerIsHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await dividendReview.actions.navigateToReviewWithParams("ticker=2886");
    const mobileRow = page.getByTestId(`review-row-${posted.dividendLedgerEntryId}-open`);
    await mobileRow.focus();
    await page.keyboard.press("Enter");
    await dividendReview.assert.drawerIsVisible();
    await dividendReview.assert.mxAssertEqual(
      await page.getByTestId("dividend-received-stock").inputValue(),
      "150",
      "mobile review drawer received stock value",
    );
  });
});
