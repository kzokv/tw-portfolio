import type { APIResponse } from "@playwright/test";
import type { AppConfigDto } from "@vakwen/shared-types";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { AdminEndpoint } from "../../endpoints/AdminEndpoint.js";

export class AdminApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: AdminEndpoint;

  @Step()
  async statusIs(response: APIResponse, expected: number): Promise<void> {
    await this.mxAssertResponseStatus(response, expected);
  }

  @Step()
  async errorCodeIs(body: { error: string }, expected: string): Promise<void> {
    await this.mxAssertEqual(body.error, expected, "error code");
  }

  @Step()
  async appConfigShape(body: AppConfigDto): Promise<void> {
    await this.mxAssertTruthy(
      body.repairCooldownMinutes === null || typeof body.repairCooldownMinutes === "number",
      "repairCooldownMinutes is number | null",
    );
    await this.mxAssertTruthy(
      typeof body.effectiveRepairCooldownMinutes === "number"
        && Number.isInteger(body.effectiveRepairCooldownMinutes)
        && body.effectiveRepairCooldownMinutes > 0,
      "effectiveRepairCooldownMinutes is a positive integer",
    );
    await this.mxAssertTruthy(
      typeof body.updatedAt === "string" && body.updatedAt.length > 0,
      "updatedAt is a non-empty string",
    );
    await this.mxAssertTruthy(
      body.metadataEnrichmentMode === null
        || body.metadataEnrichmentMode === "unconditional"
        || body.metadataEnrichmentMode === "conditional",
      "metadataEnrichmentMode is 'unconditional' | 'conditional' | null",
    );
    await this.mxAssertTruthy(
      body.effectiveMetadataEnrichmentMode === "unconditional"
        || body.effectiveMetadataEnrichmentMode === "conditional",
      "effectiveMetadataEnrichmentMode is 'unconditional' | 'conditional'",
    );
  }
}
