import type { Page, Route } from "@playwright/test";
import type {
  PostedTransactionMutationPreviewDto,
  PostedTransactionMutationRunDto,
} from "@vakwen/shared-types";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

const viewports = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
] as const;

function transactionIdFrom(route: Route): string {
  const body = route.request().postDataJSON() as { items?: Array<{ transactionId?: string }> };
  return body.items?.[0]?.transactionId ?? "unknown-transaction";
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function buildPreview(call: number, transactionId: string): PostedTransactionMutationPreviewDto {
  const previewId = `delete-preview-${call}`;
  return {
    previewId,
    previewVersion: call,
    status: "ready",
    operation: "delete",
    reason: "User requested a posted transaction deletion from ticker history.",
    confirmationSummary: `delete 1 posted transaction: preview ${call}`,
    confirmationDigest: `digest-${call}`,
    fingerprint: `fingerprint-${call}-abcdef`,
    expiresAt: "2030-07-14T12:00:00.000Z",
    createdAt: "2026-07-14T11:30:00.000Z",
    batchLimit: 50,
    affectedAccountIds: ["acc-1"],
    affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
    scopes: [{
      accountId: "acc-1",
      accountName: "Main",
      ticker: "2330",
      marketCode: "TW",
      earliestReplayDate: "2026-01-10",
      accountRevision: call,
      fingerprint: `scope-fingerprint-${call}`,
    }],
    warnings: ["Posted dividend receipt must be entered again after deletion."],
    blockers: [],
    errors: [],
    summary: {
      quantityDelta: -100,
      costBasisDelta: -50_100,
      realizedPnlDelta: 0,
      cashDelta: 50_100,
      reopenedDividendCount: call,
      deletedDividendCount: 0,
    },
    page: {
      total: 1,
      limit: 50,
      offset: 0,
      items: [{
        transactionId,
        status: "deleted",
        before: {
          transactionId,
          accountId: "acc-1",
          accountName: "Main",
          ticker: "2330",
          marketCode: "TW",
          priceCurrency: "TWD",
          tradeDate: "2026-01-10",
          side: "BUY",
          quantity: 100,
          unitPrice: 501,
          grossTradeValueAmount: 50_100,
          commissionAmount: 0,
          taxAmount: 0,
          settlementAmount: -50_100,
          settlementAvailable: true,
          bookedCostAmount: 50_100,
          isDayTrade: false,
          feesSource: "MANUAL",
        },
        after: null,
        impacts: {
          quantityDelta: -100,
          costBasisDelta: -50_100,
          realizedPnlDelta: 0,
          cashDelta: 50_100,
          reopenedDividendCount: call,
          deletedDividendCount: 0,
        },
        warnings: ["Posted dividend receipt must be entered again after deletion."],
        blockers: [],
        errors: [],
      }],
    },
    deepLinks: {
      previewPath: `/transactions/mutations/previews/${previewId}`,
      runPath: null,
      transactionPath: "/transactions",
      previewUrl: null,
      runUrl: null,
    },
  };
}

function buildRun(previewId: string): PostedTransactionMutationRunDto {
  return {
    runId: `run-${previewId}`,
    previewId,
    operation: "delete",
    status: "completed",
    rebuildStatus: "completed",
    createdAt: "2026-07-14T12:00:00.000Z",
    startedAt: "2026-07-14T12:00:01.000Z",
    completedAt: "2026-07-14T12:00:02.000Z",
    reason: "User requested a posted transaction deletion from ticker history.",
    warnings: [],
    blockers: [],
    errors: [],
    summary: {
      quantityDelta: -100,
      costBasisDelta: -50_100,
      realizedPnlDelta: 0,
      cashDelta: 50_100,
      reopenedDividendCount: 1,
      deletedDividendCount: 0,
    },
    affectedAccountIds: ["acc-1"],
    affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
    scopes: [],
    deepLinks: {
      previewPath: `/transactions/mutations/previews/${previewId}`,
      runPath: `/transactions/mutations/runs/run-${previewId}`,
      transactionPath: "/transactions",
      previewUrl: null,
      runUrl: null,
    },
  };
}

async function installDeletePreviewHarness(page: Page) {
  let previewCalls = 0;

  await page.route("**/portfolio/transactions/mutations/delete-preview", async (route) => {
    previewCalls += 1;
    const transactionId = transactionIdFrom(route);
    await fulfillJson(route, 200, buildPreview(previewCalls, transactionId));
  });

  return {
    previewCalls: () => previewCalls,
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

    await page.route("**/portfolio/transactions/mutations/previews/*/confirm", async (route) => {
      confirmCalls += 1;
      await confirmationGate;
      const previewId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "unknown-preview";
      await fulfillJson(route, 200, buildRun(previewId));
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
    const confirmUrls: string[] = [];

    await page.route("**/portfolio/transactions/mutations/previews/*/confirm", async (route) => {
      confirmCalls += 1;
      confirmBodies.push(route.request().postDataJSON());
      confirmUrls.push(route.request().url());
      if (confirmCalls === 1) {
        await fulfillJson(route, 409, {
          message: "Underlying records changed after preview",
          error: "posted_transaction_mutation_preview_stale",
        });
        return;
      }
      const previewId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "unknown-preview";
      await fulfillJson(route, 200, buildRun(previewId));
    });

    await ticker.actions.navigateToTicker("2330");
    await ticker.actions.clickDeleteOnRow("502");
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.eventuallyValueEquals(previews.previewCalls, 1);

    await ticker.actions.clickDeleteConfirmWithoutWaiting();
    await ticker.assert.deleteStatusContains(/refreshed|重新整理/);
    await ticker.assert.deleteDialogIsVisible();
    await ticker.assert.deleteDividendImpactIsVisible();
    ticker.assert.valueEquals(previews.previewCalls(), 2);
    ticker.assert.valueEquals(confirmCalls, 1);

    await ticker.actions.clickDeleteConfirmWithoutWaiting();
    await ticker.assert.deleteDialogIsHidden();
    ticker.assert.valueEquals(confirmCalls, 2);
    ticker.assert.valueEquals(confirmUrls[1]?.includes("/delete-preview-2/confirm"), true);
    ticker.assert.valueMatchesObject(confirmBodies[1], {
      previewVersion: 2,
      fingerprint: "fingerprint-2-abcdef",
      confirmationDigest: "digest-2",
    });
    await ticker.assert.viewportHasNoHorizontalOverflow();
  });
}
