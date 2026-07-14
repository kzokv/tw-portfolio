import type { Route } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type {
  RecomputeConfirmResponseDto,
  RecomputeFeeMode,
  RecomputePreviewDto,
} from "@vakwen/shared-types";

const viewports = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
] as const;

function preview(
  jobId: string,
  mode: RecomputeFeeMode,
  changed: number,
): RecomputePreviewDto {
  return {
    id: jobId,
    jobId,
    status: "PREVIEWED",
    mode,
    fingerprint: `fingerprint-${jobId}`,
    expiresAt: "2026-07-14T12:00:00.000Z",
    counts: {
      total: 4,
      calculated: 2,
      preserved: mode === "KEEP_RECORDED" ? 4 : 2,
      changed,
    },
    impactsByCurrency: [
      { currency: "TWD", commissionDelta: changed ? 12 : 0, taxDelta: changed ? -3 : 0 },
      { currency: "USD", commissionDelta: 0, taxDelta: 0 },
    ],
  };
}

function confirmed(job: RecomputePreviewDto): RecomputeConfirmResponseDto {
  return {
    jobId: job.jobId,
    status: "CONFIRMED",
    mode: job.mode,
    counts: job.counts,
    holdingSnapshotGenerationRunId: "run-e2e-recompute",
    walletSnapshotRefreshQueued: true,
  };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

for (const viewport of viewports) {
  test(`[recompute keep ${viewport.label}]: open Recompute History → recorded fees default → preview and explicit confirmation complete`, async ({
    dashboard,
    page,
  }) => {
    await page.setViewportSize(viewport);
    const keepPreview = preview(`keep-${viewport.label}`, "KEEP_RECORDED", 0);
    const requestBodies: unknown[] = [];
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });

    await page.route("**/portfolio/recompute/preview", async (route) => {
      requestBodies.push(route.request().postDataJSON());
      await fulfillJson(route, 200, keepPreview);
    });
    await page.route("**/portfolio/recompute/confirm", async (route) => {
      requestBodies.push(route.request().postDataJSON());
      await confirmationGate;
      await fulfillJson(route, 200, confirmed(keepPreview));
    });

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    const navigationCount = await page.evaluate(() => performance.getEntriesByType("navigation").length);

    await dashboard.actions.openRecomputeDialog();
    await dashboard.assert.recomputeModeIsSelected("KEEP_RECORDED");
    await dashboard.assert.recomputeActionContains(/Review impact|檢視影響/);
    await dashboard.actions.clickRecomputeDialogAction();

    await dashboard.assert.recomputeImpactContains(/TWD/);
    await dashboard.assert.recomputeImpactContains(/USD/);
    await dashboard.assert.recomputeZeroChangeIsVisible();
    await dashboard.assert.recomputeActionContains(/Apply recompute|套用重算/);

    await dashboard.actions.clickRecomputeDialogAction();
    await dashboard.assert.recomputeActionContains(/Recomputing|正在重算/);
    await dashboard.assert.recomputeActionIsDisabled();
    await dashboard.assert.recomputeCancelIsDisabled();
    await dashboard.assert.recomputeImpactIsVisible();

    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);
    await dashboard.assert.recomputeDialogIsVisible();

    releaseConfirmation();
    await dashboard.assert.recomputeDialogIsHidden();
    await dashboard.assert.recomputeStatusContains(/Recompute CONFIRMED|重算已確認/);
    await dashboard.assert.viewportHasNoHorizontalOverflow();
    await dashboard.assert.navigationCountIs(navigationCount);
    dashboard.assert.valueEquals(requestBodies, [
      { mode: "KEEP_RECORDED" },
      { jobId: keepPreview.jobId, fingerprint: keepPreview.fingerprint },
    ]);
  });

  test(`[recompute recalculation stale ${viewport.label}]: choose calculated fees → stale preview refreshes → second explicit confirmation succeeds`, async ({
    dashboard,
    page,
  }) => {
    await page.setViewportSize(viewport);
    const first = preview(`recalculate-${viewport.label}-1`, "RECALCULATE_CALCULATED", 2);
    const refreshed = preview(`recalculate-${viewport.label}-2`, "RECALCULATE_CALCULATED", 1);
    let previewCalls = 0;
    let confirmCalls = 0;
    const previewBodies: unknown[] = [];
    const confirmBodies: unknown[] = [];

    await page.route("**/portfolio/recompute/preview", async (route) => {
      previewCalls += 1;
      previewBodies.push(route.request().postDataJSON());
      await fulfillJson(route, 200, previewCalls === 1 ? first : refreshed);
    });
    await page.route("**/portfolio/recompute/confirm", async (route) => {
      confirmCalls += 1;
      confirmBodies.push(route.request().postDataJSON());
      if (confirmCalls === 1) {
        await fulfillJson(route, 409, {
          message: "Preview expired",
          error: "recompute_preview_expired",
        });
        return;
      }
      await fulfillJson(route, 200, confirmed(refreshed));
    });

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    const navigationCount = await page.evaluate(() => performance.getEntriesByType("navigation").length);

    await dashboard.actions.openRecomputeDialog();
    await dashboard.actions.chooseRecomputeMode("RECALCULATE_CALCULATED");
    await dashboard.assert.recomputeModeIsSelected("RECALCULATE_CALCULATED");
    await dashboard.actions.clickRecomputeDialogAction();
    await dashboard.assert.recomputeImpactContains(/12|TWD/);

    await dashboard.actions.clickRecomputeDialogAction();
    await dashboard.assert.recomputeDialogIsVisible();
    await dashboard.assert.recomputeStatusMessageContains(/refreshed|重新整理/);
    await dashboard.assert.recomputeImpactContains(/TWD/);
    dashboard.assert.valueEquals(confirmCalls, 1);

    await dashboard.actions.clickRecomputeDialogAction();
    await dashboard.assert.recomputeDialogIsHidden();
    dashboard.assert.valueEquals(confirmCalls, 2);
    dashboard.assert.valueEquals(previewCalls, 2);
    dashboard.assert.valueEquals(previewBodies, [
      { mode: "RECALCULATE_CALCULATED" },
      { mode: "RECALCULATE_CALCULATED" },
    ]);
    dashboard.assert.valueEquals(confirmBodies, [
      { jobId: first.jobId, fingerprint: first.fingerprint },
      { jobId: refreshed.jobId, fingerprint: refreshed.fingerprint },
    ]);
    await dashboard.assert.navigationCountIs(navigationCount);
    await dashboard.assert.viewportHasNoHorizontalOverflow();
  });
}
