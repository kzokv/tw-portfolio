import { Step } from "../decorators/Step.js";
import type { Page } from "@playwright/test";

import type { Constructor, TResponsePredicate } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ActionsMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Navigate To Route")
    async mxNavigateToRoute(path: string, appBaseUrl?: string): Promise<void> {
      const actor = this as unknown as {
        page: Page;
        mxWaitForAppReady: () => Promise<void>;
      };

      const destination = appBaseUrl ? new URL(path, appBaseUrl).href : path;
      await actor.page.goto(destination, { waitUntil: "domcontentloaded" });
      await actor.mxWaitForAppReady();
    }

    @Step("Reload Page")
    async mxReloadPage(): Promise<void> {
      const actor = this as unknown as {
        page: Page;
        mxWaitForAppReady: () => Promise<void>;
      };

      await actor.page.reload({ waitUntil: "domcontentloaded" });
      await actor.mxWaitForAppReady();
    }

    @Step("Wait For Response")
    async mxWaitForResponse(
      predicate: TResponsePredicate,
      action?: () => Promise<unknown>,
      timeout?: number,
    ): Promise<import("@playwright/test").Response> {
      const actor = this as unknown as {
        page: Page;
      };

      const responsePromise =
        timeout === undefined
          ? actor.page.waitForResponse(predicate)
          : actor.page.waitForResponse(predicate, { timeout });
      if (action) {
        await action();
      }

      return await responsePromise;
    }
  };
}
