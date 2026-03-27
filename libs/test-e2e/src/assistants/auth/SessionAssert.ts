import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { BrowserSessionPage } from "../../pages/auth/BrowserSessionPage.js";

export class SessionAssert extends BaseAssert {
  declare protected readonly _instance: BrowserSessionPage;

  @Step()
  async responseStatusIs(response: import("@playwright/test").APIResponse, expectedStatus: number): Promise<void> {
    await this.mxAssertEqual(response.status(), expectedStatus, "response status");
  }

  @Step()
  async responseHeaderContains(
    response: import("@playwright/test").APIResponse,
    headerName: string,
    expected: string,
  ): Promise<void> {
    await this.mxAssertIncludes(response.headers()[headerName], expected, `${headerName} header`);
  }

  @Step()
  async responseHeaderMatches(
    response: import("@playwright/test").APIResponse,
    headerName: string,
    expected: RegExp,
  ): Promise<void> {
    await this.mxAssertMatches(response.headers()[headerName], expected, `${headerName} header`);
  }

  @Step()
  async redirectLocationContains(
    response: import("@playwright/test").APIResponse,
    expected: string,
  ): Promise<void> {
    await this.mxAssertIncludes(response.headers()["location"], expected, "redirect location");
  }

  @Step()
  async redirectLocationMatches(
    response: import("@playwright/test").APIResponse,
    expected: RegExp,
  ): Promise<void> {
    await this.mxAssertMatches(response.headers()["location"], expected, "redirect location");
  }

  @Step()
  async redirectLocationParamEquals(
    response: import("@playwright/test").APIResponse,
    paramName: string,
    expectedValue: string,
  ): Promise<void> {
    const location = response.headers()["location"];
    await this.mxAssertTruthy(location, "redirect location");
    const actualValue = new URL(location!).searchParams.get(paramName);
    await this.mxAssertEqual(actualValue, expectedValue, `${paramName} query param`);
  }

  @Step()
  async valueIsTruthy(value: unknown, label: string): Promise<void> {
    await this.mxAssertTruthy(value, label);
  }

  @Step()
  async valueIsDefined<T>(value: T, label: string): Promise<void> {
    await this.mxAssertDefined(value, label);
  }

  @Step()
  async valuesDiffer<T>(left: T, right: T, label: string): Promise<void> {
    await this.mxAssertNotEqual(left, right, label);
  }

  @Step()
  async valueEquals<T>(actual: T, expected: T, label: string): Promise<void> {
    await this.mxAssertEqual(actual, expected, label);
  }

  @Step()
  async valueMatches(value: string | null | undefined, expected: RegExp, label: string): Promise<void> {
    await this.mxAssertMatches(value, expected, label);
  }

  @Step()
  async valueIncludes(value: string | null | undefined, expected: string, label: string): Promise<void> {
    await this.mxAssertIncludes(value, expected, label);
  }

  @Step()
  async valueNotIncludes(value: string | null | undefined, unexpected: string, label: string): Promise<void> {
    if (value?.includes(unexpected)) {
      throw new Error(`${label} should not include "${unexpected}"`);
    }
  }

  @Step()
  async stateHasSegmentCount(state: string, count: number): Promise<void> {
    await this.mxAssertEqual(state.split(".").length, count, "state segment count");
  }

  @Step()
  async currentSessionCookieIsHttpOnly(cookie: { httpOnly?: boolean } | undefined): Promise<void> {
    await this.mxAssertDefined(cookie, "session cookie");
    await this.mxAssertTruthy(cookie?.httpOnly, "session cookie httpOnly flag");
  }

  @Step()
  async sessionStorageValueIs(actualValue: string | null, expectedValue: string): Promise<void> {
    await this.mxAssertEqual(actualValue, expectedValue, "sessionStorage value");
  }

  @Step()
  async noGlobalErrorBanner(): Promise<void> {
    await this.mxAssertHidden(this._instance.elements.globalErrorBanner, 10_000);
  }
}
