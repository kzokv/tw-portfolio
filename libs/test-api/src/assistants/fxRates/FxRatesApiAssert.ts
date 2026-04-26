import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { FxRatesEndpoint } from "../../endpoints/FxRatesEndpoint.js";
import type { FxRefreshResponseBody } from "./FxRatesApiArrange.js";

export class FxRatesApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: FxRatesEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async refreshStatusIs(body: FxRefreshResponseBody, expected: FxRefreshResponseBody["status"]): Promise<void> {
    await this.mxAssertEqual(body.status, expected, "fx-refresh status");
  }
}
