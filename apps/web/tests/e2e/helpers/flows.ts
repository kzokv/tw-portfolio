import { expect, type Page } from "@playwright/test";

const webPort = Number(process.env.WEB_PORT ?? 3333);
const e2eBaseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const DEFAULT_APP_READY_TIMEOUT_MS = 45_000;

interface WaitForAppReadyOptions {
  timeoutMs?: number;
}

/** Full URL for an app path (use when fixture baseURL is not applied). */
export function appUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, e2eBaseURL).href;
}

/** Wait for the dashboard shell to finish bootstrapping and become interactive. */
export async function waitForAppReady(page: Page, options: WaitForAppReadyOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_APP_READY_TIMEOUT_MS;
  await page.waitForLoadState("domcontentloaded");

  const readyState = await page.waitForFunction(
    () => {
      const byTestId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
      const isVisible = (element: HTMLElement | null): boolean => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const globalError = byTestId("global-error-banner");
      if (isVisible(globalError)) {
        return {
          state: "error",
          message: globalError?.textContent?.trim() || "Global error banner is visible.",
        };
      }

      const appLoading = byTestId("app-loading");
      const summarySection = byTestId("dashboard-summary-section");
      const avatarButton = byTestId("avatar-button");
      const loadingVisible = isVisible(appLoading);

      if (!loadingVisible && isVisible(summarySection) && isVisible(avatarButton)) {
        return { state: "ready" };
      }

      return null;
    },
    { timeout: timeoutMs },
  );

  const state = (await readyState.jsonValue()) as { state: "ready" | "error"; message?: string };
  if (state.state === "error") {
    throw new Error(`Dashboard failed to become ready: ${state.message ?? "Unknown error state."}`);
  }
}

/** Navigate to app root and wait for the dashboard shell to be interactive. */
export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(appUrl(path), { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

/** Open settings drawer via avatar and assert it is visible and URL updated. */
export async function openSettingsDrawer(page: Page): Promise<void> {
  await waitForAppReady(page);
  await page.getByTestId("avatar-button").click();
  await page.getByTestId("settings-drawer").waitFor({ state: "visible", timeout: 10_000 });
  await expect(page).toHaveURL(/drawer=settings/);
}

/** Expand the quick transaction card when the form is intentionally collapsed by default. */
export async function openQuickTransaction(page: Page): Promise<void> {
  const toggle = page.getByTestId("quick-transaction-toggle");
  if (await page.getByTestId("tx-account-select").count()) {
    return;
  }
  await toggle.click();
  await page.getByTestId("tx-account-select").waitFor({ state: "visible", timeout: 10_000 });
}
