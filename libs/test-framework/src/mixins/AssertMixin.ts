import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";
import { GenericAssertMixin } from "./GenericAssertMixin.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timeoutOpt(timeout?: number) {
  return timeout === undefined ? undefined : { timeout };
}

async function assertUrl(page: Page, expected: RegExp | string, negate: boolean): Promise<void> {
  const pattern = typeof expected === "string" ? new RegExp(escapeRegExp(expected)) : expected;
  const assertion = negate ? expect(page).not : expect(page);
  await assertion.toHaveURL(pattern);
}

export function AssertMixin<TBase extends Constructor<{ page: Page }>>(Base: TBase) {
  const Mixed = GenericAssertMixin(CoreMixin(Base));

  return class extends Mixed {
    @Step("Assert Hidden")
    async mxAssertHidden(locator: Locator, timeout?: number): Promise<void> {
      await expect(locator).toBeHidden(timeoutOpt(timeout));
    }

    @Step("Assert URL Matches")
    async mxAssertUrlMatches(expected: RegExp | string): Promise<void> {
      await assertUrl(this.page, expected, false);
    }

    @Step("Assert URL Does Not Match")
    async mxAssertUrlNotMatches(expected: RegExp | string): Promise<void> {
      await assertUrl(this.page, expected, true);
    }

  };
}
