import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { InstrumentsEndpoint } from "../../endpoints/InstrumentsEndpoint.js";

/**
 * KZO-169: assertion helpers for `/instruments` and `/__e2e/seed-instruments`.
 */
export class InstrumentsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: InstrumentsEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async instrumentsCount(
    instruments: Record<string, unknown>[],
    expected: number,
  ): Promise<void> {
    await this.mxAssertEqual(instruments.length, expected, "instruments.length");
  }

  /**
   * Asserts every catalog row's `marketCode` equals the expected value. Useful
   * for verifying the server-side `/instruments?market_code=…` filter.
   */
  @Step()
  async everyMarketCodeIs(
    instruments: Record<string, unknown>[],
    expected: string,
  ): Promise<void> {
    for (const instrument of instruments) {
      await this.mxAssertEqual(
        instrument["marketCode"],
        expected,
        `instruments[${String(instrument["ticker"])}].marketCode`,
      );
    }
  }

  /**
   * Asserts a row exists for the given `(ticker, marketCode)` pair. Composite
   * lookup so callers can verify ALL-mode disambiguation (BHP·AU + BHP·US).
   */
  @Step()
  async pairExists(
    instruments: Record<string, unknown>[],
    ticker: string,
    marketCode: string,
  ): Promise<void> {
    const found = instruments.some(
      (i) => i["ticker"] === ticker && i["marketCode"] === marketCode,
    );
    await this.mxAssertTruthy(
      found,
      `instruments contains (${ticker}, ${marketCode})`,
    );
  }

  @Step()
  async pairAbsent(
    instruments: Record<string, unknown>[],
    ticker: string,
    marketCode: string,
  ): Promise<void> {
    const found = instruments.some(
      (i) => i["ticker"] === ticker && i["marketCode"] === marketCode,
    );
    await this.mxAssertEqual(
      found,
      false,
      `instruments does not contain (${ticker}, ${marketCode})`,
    );
  }
}
