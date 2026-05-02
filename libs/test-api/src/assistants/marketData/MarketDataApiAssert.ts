import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { MarketDataEndpoint } from "../../endpoints/MarketDataEndpoint.js";

export class MarketDataApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: MarketDataEndpoint;

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
    await this.mxAssertObjectHasKey(body, field, "market-data body");
    await this.mxAssertEqual(body[field], expected, `market-data.${field}`);
  }

  @Step()
  async priceBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  @Step()
  async errorBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }
}
