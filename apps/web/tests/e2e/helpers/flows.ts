import { expect, type Page } from "@playwright/test";

const webPort = Number(process.env.WEB_PORT ?? 3333);
const e2eBaseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;

/** Full URL for an app path (use when fixture baseURL is not applied). */
export function appUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, e2eBaseURL).href;
}

/** Wait for the dashboard shell to finish bootstrapping and become interactive. */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("hero-title").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("avatar-button").waitFor({ state: "visible", timeout: 15_000 });
}

/** Navigate to app root and wait for the dashboard shell to be interactive. */
export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(appUrl(path));
  await waitForAppReady(page);
}

/** Open settings drawer via avatar and assert it is visible and URL updated. */
export async function openSettingsDrawer(page: Page): Promise<void> {
  await waitForAppReady(page);
  await page.getByTestId("avatar-button").click();
  await page.getByTestId("settings-drawer").waitFor({ state: "visible", timeout: 10_000 });
  await expect(page).toHaveURL(/drawer=settings/);
}
