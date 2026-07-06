/**
 * OAuth E2E smoke for the retired standalone instruments page.
 *
 * Instruments now live inside market workspaces at
 * `/admin/market-data/:marketCode/instruments`.
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

test.describe("admin market-data instruments", () => {
  test("[market-data-instruments]: filters render AU instruments and support-state controls", async ({
    appShell,
    page,
  }) => {
    await seedInstrumentAsBrowser(page, {
      ticker: "AUE2EF1",
      name: "AU E2E Filter Fixture",
      marketCode: "AU",
      barsBackfillStatus: "pending",
    });

    await appShell.actions.navigateToRoute(
      "/admin/market-data/AU/instruments?search=AUE2EF1&backfillStatus=pending&sort=ticker_asc",
    );
    await page.waitForLoadState("load");

    await page.getByTestId("market-data-instruments").waitFor({ state: "visible" });
    await page.getByText("AUE2EF1").waitFor({ state: "visible" });
    await page.getByLabel("Search").fill("AUE2EF1");
    await page.getByLabel("Backfill", { exact: true }).selectOption("pending");

    const instrumentsPanel = page.getByTestId("market-data-instruments");
    await instrumentsPanel.getByTestId("market-data-instrument-row-AUE2EF1").click();
    const drawer = page.getByTestId("ui-drawer");
    await drawer.getByText("Support controls").waitFor({ state: "visible" });
    const retiredButton = drawer.getByRole("button", { name: "retired_by_admin" });
    await retiredButton.click();
    await drawer
      .getByRole("definition")
      .filter({ hasText: "retired_by_admin" })
      .waitFor({ state: "visible" });
  });
});
