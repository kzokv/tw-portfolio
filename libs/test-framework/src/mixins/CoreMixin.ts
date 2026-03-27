import type { Page } from "@playwright/test";

import type { Constructor } from "../core/types.js";

const LOAD_STATE_TIMEOUT_MS = 5_000;

/**
 * Generic page-readiness mixin. Methods are intentionally minimal stubs —
 * override in the app-specific layer (test-e2e) to add testId assertions.
 */
export function CoreMixin<TBase extends Constructor<{ page: Page }>>(Base: TBase) {
  return class extends Base {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for override signature compatibility
    async mxWaitForShellClientReady(timeoutMs?: number): Promise<void> {
      await this.page.waitForLoadState("domcontentloaded");
      await this.page.waitForLoadState("load", { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => undefined);
    }

    async mxWaitForAppReady(timeoutMs?: number): Promise<void> {
      await this.mxWaitForShellClientReady(timeoutMs);
    }
  };
}
