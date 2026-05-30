import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type { FxTransfersEndpoint } from "../../endpoints/FxTransfersEndpoint.js";

export class FxTransfersApiActions extends ApiBaseActions {
  declare protected readonly _instance: FxTransfersEndpoint;

  @Step()
  async estimateFxTransfer(data: unknown): Promise<APIResponse> {
    return this._instance.estimate(data, this.authHeaders);
  }

  @Step()
  async createFxTransfer(data: unknown): Promise<APIResponse> {
    return this._instance.create(data, this.authHeaders);
  }

  @Step()
  async patchFxTransfer(fxTransferId: string, data: unknown): Promise<APIResponse> {
    return this._instance.patch(fxTransferId, data, this.authHeaders);
  }

  @Step()
  async reverseFxTransfer(fxTransferId: string, data: unknown = {}): Promise<APIResponse> {
    return this._instance.reverse(fxTransferId, data, this.authHeaders);
  }
}
