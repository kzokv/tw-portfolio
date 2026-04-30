import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { FxTransfersEndpoint } from "../../endpoints/FxTransfersEndpoint.js";

type TObject = Record<string, unknown>;

export class FxTransfersApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: FxTransfersEndpoint;

  @Step()
  async fxTransferBody(response: APIResponse): Promise<TObject> {
    return (await this.body(response)) as TObject;
  }

  @Step()
  async fxTransferId(response: APIResponse): Promise<string> {
    const body = await this.fxTransferBody(response);
    const id = body.fxTransferId;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Expected fxTransferId in FX transfer response");
    }
    return id;
  }
}
