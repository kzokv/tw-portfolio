import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";

const e2eBaseURL = TestEnv.appBaseUrl;
const e2eApiBaseURL = TestEnv.apiBaseUrl;
const E2E_USER_COOKIE = "tw_e2e_user";
const DEFAULT_APP_READY_TIMEOUT_MS = 20_000;

interface WaitForAppReadyOptions {
  timeoutMs?: number;
}

/** Full URL for an app path (use when fixture baseURL is not applied). */
export function appUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, e2eBaseURL).href;
}

/** Full URL for an API path. */
export function apiUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, e2eApiBaseURL).href;
}

export async function waitForAppReady(page: Page, options: WaitForAppReadyOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_APP_READY_TIMEOUT_MS;
  await page.waitForLoadState("domcontentloaded");
  // Soft-wait for full load (JS bundle) — cap at 5s to avoid eating test timeout budget
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  await expect(page.getByTestId("topbar-title")).toBeVisible({ timeout: timeoutMs });
  await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: timeoutMs });

  const globalError = page.getByTestId("global-error-banner");
  if (await globalError.isVisible().catch(() => false)) {
    throw new Error(`App failed to become ready: ${(await globalError.textContent())?.trim() ?? "unknown error"}`);
  }
}

export async function gotoRoute(page: Page, path = "/"): Promise<void> {
  await page.goto(appUrl(path), { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

export async function reloadRoute(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

export async function openSettingsDrawer(page: Page): Promise<void> {
  await waitForAppReady(page);
  await page.getByTestId("avatar-button").click();
  await page.getByTestId("avatar-menu-settings").click();
  await expect(page.getByTestId("settings-drawer")).toBeVisible();
  await expect(page).toHaveURL(/drawer=settings/);
}

export async function openMobileNavigation(page: Page): Promise<void> {
  await page.getByTestId("mobile-nav-toggle").click();
  await expect(page.getByTestId("mobile-sidebar")).toBeVisible();
}

export async function resetE2EUser(request: APIRequestContext, userId: string): Promise<void> {
  const response = await request.post(apiUrl("/__e2e/reset"), {
    headers: { "x-user-id": userId },
  });
  expect(response.ok()).toBeTruthy();
}

export async function assignE2EUser(page: Page, userId: string): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: E2E_USER_COOKIE,
      value: encodeURIComponent(userId),
      url: appUrl("/"),
    },
  ]);
}

export function buildE2EUserId(testInfo: TestInfo): string {
  const fileName = testInfo.file.split("/").pop() ?? "spec";
  const slug = `${fileName}-${testInfo.title}-${testInfo.workerIndex}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `qa-${slug || "e2e"}`;
}

/** Extract a cookie value from a Set-Cookie header string by cookie name. */
export function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookieHeader.match(new RegExp(`${escaped}=([^;]+)`));
  return match?.[1] ?? null;
}

export { TestEnv };