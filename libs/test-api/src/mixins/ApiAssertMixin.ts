import { expect } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { deepStrictEqual } from "node:assert/strict";
import { Step } from "@tw-portfolio/test-framework/decorators";
import type { Constructor } from "@tw-portfolio/test-framework/core";
import { GenericAssertMixin } from "@tw-portfolio/test-framework/mixins";

export function ApiAssertMixin<TBase extends Constructor<object>>(Base: TBase) {
  const Mixed = GenericAssertMixin(Base);

  return class extends Mixed {
    @Step()
    async mxAssertResponseStatus(
      response: Pick<APIResponse, "status">,
      expectedStatus: number,
      label = "HTTP status",
    ): Promise<void> {
      await this.mxAssertEqual(response.status(), expectedStatus, label);
    }

    @Step()
    async mxAssertResponseOk(response: Pick<APIResponse, "ok">, label = "HTTP response ok"): Promise<void> {
      await this.mxAssertTruthy(response.ok(), label);
    }

    @Step()
    async mxAssertDeepEqual<T>(actual: T, expected: T, label = "value"): Promise<void> {
      try {
        deepStrictEqual(actual, expected);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} should deep equal expected value: ${message}`);
      }
    }

    @Step()
    async mxAssertArray(value: unknown, label = "value"): Promise<void> {
      expect(Array.isArray(value), `${label} should be an array`).toBe(true);
    }

    @Step()
    async mxAssertArrayLengthAtLeast(
      value: unknown[],
      expectedMinimum: number,
      label = "array length",
    ): Promise<void> {
      await this.mxAssertGreaterThanOrEqual(value.length, expectedMinimum, label);
    }

    @Step()
    async mxAssertNull(value: unknown, label = "value"): Promise<void> {
      expect(value, `${label} should be null`).toBeNull();
    }

    @Step()
    async mxAssertObjectHasKey(
      value: unknown,
      expectedKey: string,
      label = "object",
    ): Promise<void> {
      expect(value, `${label} should be an object`).toEqual(expect.any(Object));
      expect(value as Record<string, unknown>, `${label} should include key "${expectedKey}"`).toHaveProperty(
        expectedKey,
      );
    }
  };
}
