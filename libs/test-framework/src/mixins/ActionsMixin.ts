import { Step } from "../decorators/Step.js";
import type { Page } from "@playwright/test";

import type { Constructor, TResponsePredicate } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ActionsMixin<TBase extends Constructor<{ page: Page }>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Navigate To Route")
    async mxNavigateToRoute(path: string, appBaseUrl?: string): Promise<void> {
      const destination = appBaseUrl ? new URL(path, appBaseUrl).href : path;
      await this.page.goto(destination, { waitUntil: "domcontentloaded" });
      await this.mxWaitForAppReady();
    }

    @Step("Reload Page")
    async mxReloadPage(): Promise<void> {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.mxWaitForAppReady();
    }

    @Step("Wait For Response")
    async mxWaitForResponse(
      predicate: TResponsePredicate,
      action?: () => Promise<unknown>,
      timeout?: number,
    ): Promise<import("@playwright/test").Response> {
      const responsePromise =
        timeout === undefined
          ? this.page.waitForResponse(predicate)
          : this.page.waitForResponse(predicate, { timeout });
      if (action) {
        await action();
      }

      return await responsePromise;
    }
  };
}
