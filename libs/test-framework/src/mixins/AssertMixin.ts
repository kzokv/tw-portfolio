import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function AssertMixin<TBase extends Constructor<{ page: Page }>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Assert URL Matches")
    async mxAssertUrlMatches(expected: RegExp | string): Promise<void> {
      if (typeof expected === "string") {
        await expect(this.page).toHaveURL(new RegExp(escapeRegExp(expected)));
        return;
      }

      await expect(this.page).toHaveURL(expected);
    }

    @Step("Assert URL Does Not Match")
    async mxAssertUrlNotMatches(expected: RegExp | string): Promise<void> {
      if (typeof expected === "string") {
        await expect(this.page).not.toHaveURL(new RegExp(escapeRegExp(expected)));
        return;
      }

      await expect(this.page).not.toHaveURL(expected);
    }

    @Step("Assert No Global Error")
    async mxAssertNoGlobalError(): Promise<void> {
      await expect(this.page.getByTestId("global-error-banner")).not.toBeVisible();
    }
  };
}
