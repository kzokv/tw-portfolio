/**
 * OAuth E2E smoke for the market-data admin console replacing `/admin/providers`.
 */

import {
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/oauthPages";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function getBrowserCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === TestEnv.sessionCookieName);
  if (!session) {
    throw new Error(`Session cookie "${TestEnv.sessionCookieName}" not found`);
  }
  return `${session.name}=${session.value}`;
}

async function seedInstrumentAsBrowser(
  page: Page,
  instrument: {
    ticker: string;
    name: string;
    marketCode: "TW" | "US" | "AU" | "KR";
    barsBackfillStatus: "pending" | "backfilling" | "ready" | "failed";
  },
): Promise<void> {
  const cookie = await getBrowserCookieHeader(page);
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/seed-instruments"), {
      headers: { cookie },
      data: {
        instruments: [
          {
            ticker: instrument.ticker,
            name: instrument.name,
            instrumentType: "STOCK",
            marketCode: instrument.marketCode,
            barsBackfillStatus: instrument.barsBackfillStatus,
          },
        ],
      },
    });
    if (!response.ok()) {
      throw new Error(`seed-instruments failed: ${response.status()} ${await response.text()}`);
    }
  });
}

test.describe.serial("admin market-data console", () => {
  test("[market-data-landing]: landing renders all market workspaces", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/market-data");
    await page.waitForLoadState("load");

    await page.getByTestId("admin-market-data-page").waitFor({ state: "visible" });
    for (const marketCode of ["TW", "US", "AU", "KR", "FX"]) {
      await page.getByTestId(`market-data-tile-${marketCode}`).waitFor({ state: "visible" });
    }
    await appShell.assert.mxAssertEqual(
      await page.locator('[data-testid="provider-console-page"]').count(),
      0,
      "retired provider console UI is absent",
    );
  });

  test("[market-data-backfill]: TW manual target preview explains guarded execution", async ({
    appShell,
    page,
  }) => {
    await seedInstrumentAsBrowser(page, {
      ticker: "TWE2EBF1",
      name: "TW E2E Backfill Fixture",
      marketCode: "TW",
      barsBackfillStatus: "pending",
    });

    await appShell.actions.navigateToRoute("/admin/market-data/TW/backfill");
    await page.waitForLoadState("load");

    await page.getByTestId("market-data-backfill").waitFor({ state: "visible" });
    await page.getByLabel("Scope").selectOption("manual_targets");
    await page.getByLabel("Manual tickers").fill("TWE2EBF1");
    await page.getByRole("button", { name: "Preview backfill" }).click();

    const backfillPanel = page.getByTestId("market-data-backfill");
    await page.getByText("Backfill estimate").waitFor({ state: "visible" });
    await backfillPanel.getByText("finmind-tw", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("I reviewed the preview").waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await page.getByRole("button", { name: "Execute backfill" }).isDisabled(),
      "backfill execute stays disabled until acknowledgement",
    );
  });

  test("[market-data-purge]: AU purge preview keeps delete-only and refill intent explicit", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/market-data/AU/purge");
    await page.waitForLoadState("load");

    await page.getByTestId("market-data-purge").waitFor({ state: "visible" });
    await page.getByText(/Delete-only removes selected data/i).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Preview purge" }).click();

    await page.getByText("Purge estimate").waitFor({ state: "visible" });
    await page.getByPlaceholder("PURGE AU").waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await page.getByRole("button", { name: "Execute purge" }).isDisabled(),
      "purge execute stays disabled until typed confirmation",
    );
  });

  test("[market-data-kr]: KR mappings stay mapping-only with explicit backfill separation", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/market-data/KR/mappings");
    await page.waitForLoadState("load");

    await page.getByTestId("market-data-mappings").waitFor({ state: "visible" });
    await page.getByText("KR mapping repair").waitFor({ state: "visible" });
    await page.getByText(/Backfill after mapping is a separate explicit action/i).waitFor({
      state: "visible",
    });
  });
});
