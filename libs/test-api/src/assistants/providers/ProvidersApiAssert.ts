import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
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

  /**
   * KZO-200 — `twelve-data-au` row added (KZO-194 catalog provider). New
   * canonical assertion. Existing callers using `hasFourProviders` are
   * expected to migrate; that helper is retained for back-compat with old
   * snapshot expectations but should not be used for new tests.
   */
  @Step()
  async hasFiveProviders(body: AdminProvidersListBody): Promise<void> {
    await this.mxAssertEqual(body.providers.length, 5, "providers list length");
  }

  /**
   * KZO-196 — `asx-gics-csv` row added (ASX GICS catalog enrichment provider).
   * Retained for back-compat with pre-KR provider expectations.
   */
  @Step()
  async hasSixProviders(body: AdminProvidersListBody): Promise<void> {
    await this.mxAssertEqual(body.providers.length, 6, "providers list length");
  }

  /**
   * KR support adds `yahoo-finance-kr` and `twelve-data-kr`. This is the
   * current canonical assertion for provider-health tests.
   */
  @Step()
  async hasEightProviders(body: AdminProvidersListBody): Promise<void> {
    await this.mxAssertEqual(body.providers.length, 8, "providers list length");
  }

  /**
   * JP support adds `yahoo-finance-jp` and `twelve-data-jp`. Prefer the
   * explicit count helper in new tests so stale provider-count helper names do
   * not outlive the registry shape.
   */
  @Step()
  async hasProviderCount(body: AdminProvidersListBody, expected: number): Promise<void> {
    await this.mxAssertEqual(body.providers.length, expected, "providers list length");
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
