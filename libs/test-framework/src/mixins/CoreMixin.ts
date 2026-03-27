import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

const DEFAULT_APP_READY_TIMEOUT_MS = 20_000;
const LOAD_STATE_TIMEOUT_MS = 5_000;

export function CoreMixin<TBase extends Constructor<{ page: Page }>>(Base: TBase) {
  return class extends Base {
    @Step("Wait For Shell Client Ready")
    async mxWaitForShellClientReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
      await this.page.waitForLoadState("domcontentloaded");
      await this.page.waitForLoadState("load", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined);
      await expect(this.page.getByTestId("app-shell-ready")).toBeAttached({ timeout: timeoutMs });
      await expect(this.page.getByTestId("app-shell-client-ready")).toBeAttached({ timeout: timeoutMs });

      const globalError = this.page.getByTestId("global-error-banner");
      if (await globalError.isVisible().catch(() => false)) {
        throw new Error(`App failed to become ready: ${(await globalError.textContent())?.trim() ?? "unknown error"}`);
      }
    }

    @Step("Wait For App Ready")
    async mxWaitForAppReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
      await this.mxWaitForShellClientReady(timeoutMs);
      await expect(this.page.getByTestId("topbar-title")).toBeVisible({ timeout: timeoutMs });
    }
  };
}
