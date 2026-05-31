import { expect } from "@playwright/test";
import { deepStrictEqual } from "node:assert/strict";
import { Step } from "../decorators/Step.js";
import type { Constructor } from "../core/types.js";

export function GenericAssertMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends Base {
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

    @Step("Assert Deep Equal")
    async mxAssertDeepEqual<T>(actual: T, expected: T, label = "value"): Promise<void> {
      try {
        deepStrictEqual(actual, expected);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} should deep equal expected value: ${message}`);
      }
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
  };
}
