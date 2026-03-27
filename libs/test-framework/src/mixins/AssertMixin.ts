import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

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
  return class extends CoreMixin(Base) {

    @Step("Assert Hidden")
    async mxAssertHidden(locator: Locator, timeout?: number): Promise<void> {
      await expect(locator).toBeHidden(timeoutOpt(timeout));
    }

    @Step("Assert Truthy")
    async mxAssertTruthy(value: unknown, label = "value"): Promise<void> {
      expect(value, `${label} should be truthy`).toBeTruthy();
    }

    @Step("Assert Defined")
    async mxAssertDefined<T>(value: T, label = "value"): Promise<void> {
      expect(value, `${label} should be defined`).toBeDefined();
    }

    @Step("Assert Equal")
    async mxAssertEqual<T>(actual: T, expected: T, label = "value"): Promise<void> {
      expect(actual, `${label} should equal expected value`).toBe(expected);
    }

    @Step("Assert Not Equal")
    async mxAssertNotEqual<T>(actual: T, unexpected: T, label = "value"): Promise<void> {
      expect(actual, `${label} should differ from unexpected value`).not.toBe(unexpected);
    }

    @Step("Assert Includes")
    async mxAssertIncludes(
      actual: string | null | undefined,
      expected: string,
      label = "value",
    ): Promise<void> {
      expect(actual, `${label} should include expected text`).toContain(expected);
    }

    @Step("Assert Matches")
    async mxAssertMatches(
      actual: string | null | undefined,
      expected: RegExp,
      label = "value",
    ): Promise<void> {
      expect(actual, `${label} should match expected pattern`).toMatch(expected);
    }

    @Step("Assert Greater Than Or Equal")
    async mxAssertGreaterThanOrEqual(
      actual: number,
      expectedMinimum: number,
      label = "value",
    ): Promise<void> {
      expect(actual, `${label} should be >= ${expectedMinimum}`).toBeGreaterThanOrEqual(expectedMinimum);
    }

    @Step("Assert Less Than Or Equal")
    async mxAssertLessThanOrEqual(
      actual: number,
      expectedMaximum: number,
      label = "value",
    ): Promise<void> {
      expect(actual, `${label} should be <= ${expectedMaximum}`).toBeLessThanOrEqual(expectedMaximum);
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
