import { Step } from "../decorators/Step.js";
import type { Locator, Page } from "@playwright/test";

import type { Constructor, TResponsePredicate, TUIActions } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ActionsMixin<TBase extends Constructor<{ page: Page; uiActions: TUIActions }>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Set Viewport Size")
    async mxSetViewportSize(width: number, height: number): Promise<void> {
      await this.page.setViewportSize({ width, height });
    }

    @Step("Go To Url")
    async mxGotoUrl(url: string): Promise<void> {
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
    }

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

    @Step("Click Locator")
    async mxClick(locator: Locator): Promise<void> {
      await this.uiActions.click.perform(locator);
    }

    @Step("Fill Locator")
    async mxFill(locator: Locator, value: string): Promise<void> {
      await this.uiActions.fill.perform(locator, value);
    }

    @Step("Select Option")
    async mxSelectOption(locator: Locator, value: Parameters<Locator["selectOption"]>[0]): Promise<void> {
      await this.uiActions.select.perform(locator, value);
    }

    @Step("Clear Cookies")
    async mxClearCookies(): Promise<void> {
      await this.page.context().clearCookies();
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
