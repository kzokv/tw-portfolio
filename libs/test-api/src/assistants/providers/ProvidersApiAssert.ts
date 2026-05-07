import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { ProvidersEndpoint } from "../../endpoints/ProvidersEndpoint.js";
import type {
  AdminProvidersListBody,
  ProviderHealthRowShape,
} from "./ProvidersApiArrange.js";

export class ProvidersApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: ProvidersEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async hasFourProviders(body: AdminProvidersListBody): Promise<void> {
    await this.mxAssertEqual(body.providers.length, 4, "providers list length");
  }

  @Step()
  async providerStatusIs(
    body: AdminProvidersListBody,
    providerId: string,
    expected: ProviderHealthRowShape["status"],
  ): Promise<void> {
    const row = body.providers.find((p) => p.providerId === providerId);
    await this.mxAssertTruthy(row !== undefined, `providers[${providerId}] present`);
    await this.mxAssertEqual(row!.status, expected, `providers[${providerId}].status`);
  }

  @Step()
  async retryAfterHeaderIsPresent(response: APIResponse): Promise<void> {
    const header = response.headers()["retry-after"];
    await this.mxAssertTruthy(
      header !== undefined && header.length > 0,
      "Retry-After header present",
    );
  }
}
