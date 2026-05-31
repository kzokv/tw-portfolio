import { expect } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import type { Constructor } from "@vakwen/test-framework/core";
import { GenericAssertMixin } from "@vakwen/test-framework/mixins";

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

    // KZO-162 — `mxAssertDeepEqual` was promoted to GenericAssertMixin so that
    // E2E AAA specs can use it through any assistant. Inherited from Mixed.

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
