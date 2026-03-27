import { expect } from "@playwright/test";
import type { Locator, Page, Response } from "@playwright/test";

import { Step } from "../decorators/Step.js";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timeoutOpt(timeout?: number) {
  return timeout === undefined ? undefined : { timeout };
}

export function AssertMixin<TBase extends Constructor<{ page: Page }>>(Base: TBase) {
  return class extends CoreMixin(Base) {

    @Step("Assert Visible")
    async mxAssertVisible(locator: Locator, timeout?: number): Promise<void> {
      await expect(locator).toBeVisible(timeoutOpt(timeout));
    }

    @Step("Assert Hidden")
    async mxAssertHidden(locator: Locator, timeout?: number): Promise<void> {
      await expect(locator).toBeHidden(timeoutOpt(timeout));
    }

    @Step("Assert Attached")
    async mxAssertAttached(locator: Locator, timeout?: number): Promise<void> {
      await expect(locator).toBeAttached(timeoutOpt(timeout));
    }

    @Step("Assert Text Contains")
    async mxAssertContainsText(
      locator: Locator,
      expected: string | RegExp,
      timeout?: number,
    ): Promise<void> {
      await expect(locator).toContainText(expected, timeoutOpt(timeout));
    }

    @Step("Assert Has Text")
    async mxAssertHasText(
      locator: Locator,
      expected: string | RegExp,
      timeout?: number,
    ): Promise<void> {
      await expect(locator).toHaveText(expected, timeoutOpt(timeout));
    }

    @Step("Assert Has Attribute")
    async mxAssertHasAttribute(
      locator: Locator,
      name: string,
      expected: string | RegExp,
      timeout?: number,
    ): Promise<void> {
      await expect(locator).toHaveAttribute(name, expected, timeoutOpt(timeout));
    }

    @Step("Assert Has Value")
    async mxAssertHasValue(
      locator: Locator,
      expected: string | RegExp,
      timeout?: number,
    ): Promise<void> {
      await expect(locator).toHaveValue(expected, timeoutOpt(timeout));
    }

    @Step("Assert Count")
    async mxAssertCount(locator: Locator, count: number, timeout?: number): Promise<void> {
      await expect(locator).toHaveCount(count, timeoutOpt(timeout));
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

    @Step("Assert Response Ok")
    async mxAssertResponseOk(response: Response): Promise<void> {
      expect(response.ok(), "response should be OK").toBeTruthy();
    }

    @Step("Assert Response Status")
    async mxAssertResponseStatus(response: Response, expectedStatus: number): Promise<void> {
      expect(response.status(), "response status should match").toBe(expectedStatus);
    }

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

  };
}
