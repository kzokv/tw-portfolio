import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function AssertMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Assert URL Matches")
    async mxAssertUrlMatches(expected: RegExp | string): Promise<void> {
      const actor = this as unknown as {
        page: Page;
      };

      if (typeof expected === "string") {
        await expect(actor.page).toHaveURL(new RegExp(escapeRegExp(expected)));
        return;
      }

      await expect(actor.page).toHaveURL(expected);
    }

    @Step("Assert URL Does Not Match")
    async mxAssertUrlNotMatches(expected: RegExp | string): Promise<void> {
      const actor = this as unknown as {
        page: Page;
      };

      if (typeof expected === "string") {
        await expect(actor.page).not.toHaveURL(new RegExp(escapeRegExp(expected)));
        return;
      }

      await expect(actor.page).not.toHaveURL(expected);
    }

    @Step("Assert No Global Error")
    async mxAssertNoGlobalError(): Promise<void> {
      const actor = this as unknown as {
        page: Page;
      };

      await expect(actor.page.getByTestId("global-error-banner")).not.toBeVisible();
    }
  };
}
