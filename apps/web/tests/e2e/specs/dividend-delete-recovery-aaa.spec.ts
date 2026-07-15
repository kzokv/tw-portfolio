import type { Page, Route } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

const viewports = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
] as const;

function transactionIdFrom(route: Route): string {
  const parts = new URL(route.request().url()).pathname.split("/");
  const index = parts.indexOf("transactions");
  return parts[index + 1] ?? "unknown-transaction";
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installDeletePreviewHarness(page: Page) {
  let impactCalls = 0;
  let destructivePreviewCalls = 0;

  await page.route("**/portfolio/transactions/*/preview-impact?*", async (route) => {
    impactCalls += 1;
    await fulfillJson(route, 200, {
      negativeLots: { wouldOccur: false, symbols: [], resultingQuantity: 100, ticker: "2330" },
      affectedRows: {
        cashLedgerEntries: 2,
        lotAllocations: 3,
        feePolicySnapshots: 1,
        holdingSnapshots: 12,
      },
    });
  });

  await page.route("**/portfolio/transactions/*/dividend-delete-preview", async (route) => {
    destructivePreviewCalls += 1;
    const transactionId = transactionIdFrom(route);
    await fulfillJson(route, 200, {
      preview: {
        previewId: `delete-preview-${destructivePreviewCalls}`,
        previewVersion: destructivePreviewCalls,
        fingerprint: `fingerprint-${destructivePreviewCalls}-abcdef`,
        accountId: "acc-1",
        targetTradeEventId: transactionId,
        expiresAt: "2026-07-14T12:00:00.000Z",
      },
      affectedCounts: {
        dividendLedgerEntries: destructivePreviewCalls,
        cashLedgerEntries: destructivePreviewCalls + 1,
        dividendDeductionEntries: 0,
        dividendSourceLines: 0,
        stockDividendPositionActions: 0,
      },
      affectedDividends: [{
        dividendLedgerEntryId: `dividend-${destructivePreviewCalls}`,
        requiresManualReceiptReentry: false,
      }],
      manualReceiptReentryLedgerEntryIds: [],
    });
  });

  return {
    impactCalls: () => impactCalls,
    destructivePreviewCalls: () => destructivePreviewCalls,
  };
}

for (const viewport of viewports) {
  test(`[transaction delete pending ${viewport.label}]: confirm impacted deletion → reviewed impact stays visible and dismissal stays locked until success`, async ({
    page,
    ticker,
  }) => {
    await page.setViewportSize(viewport);
    await ticker.arrange.seedTrade({ unitPrice: 501, tradeDate: "2026-01-10" });
    await installDeletePreviewHarness(page);
    let confirmCalls = 0;
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });

    await page.route("**/portfolio/transactions/*/dividend-delete-confirm", async (route) => {
      confirmCalls += 1;
      await confirmationGate;
      await fulfillJson(route, 200, {});
    });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickDeleteOnRow("501");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteImpactCountsAreVisible();
    await ticker.assert.deleteDividendImpactIsVisible();

    await ticker.actions.clickDeleteConfirmWithoutWaiting();
    await ticker.assert.deleteConfirmContains(/Deleting|刪除中/);
    await ticker.assert.deleteControlsAreDisabled();
    await ticker.assert.deleteImpactCountsAreVisible();
    await ticker.assert.deleteDividendImpactIsVisible();
    ticker.assert.valueEquals(confirmCalls, 1);

    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteDialogContainsFocus();

    releaseConfirmation();
    await ticker.assert.deleteDialogIsHidden();
    ticker.assert.valueEquals(confirmCalls, 1);
    await ticker.assert.viewportHasNoHorizontalOverflow();
  });

  test(`[transaction delete stale ${viewport.label}]: first confirmation drifts → refreshed impact waits for another explicit Delete click`, async ({
    page,
    ticker,
  }) => {
    await page.setViewportSize(viewport);
    await ticker.arrange.seedTrade({ unitPrice: 502, tradeDate: "2026-01-11" });
    const previews = await installDeletePreviewHarness(page);
    let confirmCalls = 0;
    const confirmBodies: unknown[] = [];

    await page.route("**/portfolio/transactions/*/dividend-delete-confirm", async (route) => {
      confirmCalls += 1;
      confirmBodies.push(route.request().postDataJSON());
      if (confirmCalls === 1) {
        await fulfillJson(route, 409, {
          message: "Underlying records changed after preview",
          error: "dividend_destructive_preview_row_drift",
        });
        return;
      }
      await fulfillJson(route, 200, {});
    });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickDeleteOnRow("502");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.eventuallyValueEquals(previews.destructivePreviewCalls, 1);

    await ticker.actions.clickDeleteConfirmWithoutWaiting();
    await ticker.assert.deleteStatusContains(/refreshed|重新整理/);
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteDividendImpactIsVisible();
    ticker.assert.valueEquals(previews.impactCalls(), 2);
    ticker.assert.valueEquals(previews.destructivePreviewCalls(), 2);
    ticker.assert.valueEquals(confirmCalls, 1);

    await ticker.actions.clickDeleteConfirmWithoutWaiting();
    await ticker.assert.deleteDialogIsHidden();
    ticker.assert.valueEquals(confirmCalls, 2);
    ticker.assert.valueMatchesObject(confirmBodies[1], {
      previewId: "delete-preview-2",
      previewVersion: 2,
      fingerprint: "fingerprint-2-abcdef",
    });
    await ticker.assert.viewportHasNoHorizontalOverflow();
  });
}
