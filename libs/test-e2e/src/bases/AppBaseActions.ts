import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import { SHARED_TEST_IDS } from "../pages/constants.js";

const DEFAULT_APP_READY_TIMEOUT_MS = 20_000;

/**
 * App-specific BaseActions with shell/app readiness checks tied to
 * this application's test IDs. All Actions assistants in test-e2e
 * should extend this instead of the generic BaseActions.
 */
export class AppBaseActions extends BaseActions {
  @Step("Wait For Shell Client Ready")
  override async mxWaitForShellClientReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
    await super.mxWaitForShellClientReady(timeoutMs);
    await expect(this.page.getByTestId("app-shell-ready")).toBeAttached({ timeout: timeoutMs });
    await expect(this.page.getByTestId("app-shell-client-ready")).toBeAttached({ timeout: timeoutMs });

    const globalError = this.page.getByTestId(SHARED_TEST_IDS.globalErrorBanner);
    if (await globalError.isVisible().catch(() => false)) {
      throw new Error(`App failed to become ready: ${(await globalError.textContent())?.trim() ?? "unknown error"}`);
    }
  }

  @Step("Wait For App Ready")
  override async mxWaitForAppReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
    await this.mxWaitForShellClientReady(timeoutMs);
    await expect(this.page.getByTestId("topbar-title")).toBeVisible({ timeout: timeoutMs });
  }
}
