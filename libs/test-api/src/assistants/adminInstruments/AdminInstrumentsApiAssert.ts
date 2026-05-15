import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { AdminInstrumentsEndpoint } from "../../endpoints/AdminInstrumentsEndpoint.js";

/**
 * KZO-195 — assertion helpers for /admin/instruments mutation responses.
 *
 * Per `.claude/rules/service-error-pattern.md`, the JSON envelope is
 * `{ error, message }` — `body.error` carries the machine-readable code, NOT
 * `body.code`. `errorCodeIs` enforces this against `body.error`.
 */
export class AdminInstrumentsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: AdminInstrumentsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async errorCodeIs(body: { error: string }, expected: string): Promise<void> {
    await this.mxAssertEqual(body.error, expected, "error code");
  }

  @Step()
  async tickerIs(body: Record<string, unknown>, expected: string): Promise<void> {
    await this.mxAssertEqual(body["ticker"], expected, "instrument.ticker");
  }

  @Step()
  async delistedAtIsNull(body: Record<string, unknown>): Promise<void> {
    await this.mxAssertEqual(body["delistedAt"] ?? null, null, "instrument.delistedAt");
  }

  @Step()
  async excludedIs(body: Record<string, unknown>, expected: boolean): Promise<void> {
    await this.mxAssertEqual(
      body["delistingDetectionExcluded"],
      expected,
      "instrument.delistingDetectionExcluded",
    );
  }
}
