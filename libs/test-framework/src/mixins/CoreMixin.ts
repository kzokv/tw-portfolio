import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

const DEFAULT_APP_READY_TIMEOUT_MS = 20_000;
const LOAD_STATE_TIMEOUT_MS = 5_000;

export function CoreMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends Base {
    @Step("Wait For App Ready")
    async mxWaitForAppReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
      const { page } = this as unknown as { page: Page };
      if (!page) {
        throw new Error("Mixin requires a base class with a `page` property");
      }

      await page.waitForLoadState("domcontentloaded");
      await page.waitForLoadState("load", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined);
      await expect(page.getByTestId("topbar-title")).toBeVisible({ timeout: timeoutMs });
      await expect(page.getByTestId("app-shell-ready")).toBeAttached({ timeout: timeoutMs });

      const globalError = page.getByTestId("global-error-banner");
      if (await globalError.isVisible().catch(() => false)) {
        throw new Error(`App failed to become ready: ${(await globalError.textContent())?.trim() ?? "unknown error"}`);
      }
    }
  };
}
