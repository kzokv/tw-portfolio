import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { QuotesEndpoint } from "../../endpoints/QuotesEndpoint.js";

export class QuotesApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: QuotesEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async fieldEquals(
    body: Record<string, unknown>,
    field: string,
    expected: unknown,
  ): Promise<void> {
    await this.mxAssertObjectHasKey(body, field, "quotes body");
    await this.mxAssertEqual(body[field], expected, `quotes.${field}`);
  }

  @Step()
  async tickerIsNull(
    body: Record<string, Record<string, unknown> | null>,
    ticker: string,
  ): Promise<void> {
    await this.mxAssertNull(body[ticker], `quotes["${ticker}"]`);
  }

  @Step()
  async tickerHasField(
    body: Record<string, Record<string, unknown> | null>,
    ticker: string,
    field: string,
  ): Promise<void> {
    const snapshot = body[ticker];
    await this.mxAssertObjectHasKey(snapshot as Record<string, unknown>, field, `quotes["${ticker}"]`);
  }

  @Step()
  async quotesBody(response: APIResponse): Promise<Record<string, Record<string, unknown> | null>> {
    return (await response.json()) as Record<string, Record<string, unknown> | null>;
  }
}
