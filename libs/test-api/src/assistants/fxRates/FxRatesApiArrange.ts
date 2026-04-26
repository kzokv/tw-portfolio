import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { FxRatesEndpoint } from "../../endpoints/FxRatesEndpoint.js";

export interface FxRefreshResponseBody {
  status: "queued" | "skipped_existing_job";
  jobId?: string;
  reason?: string;
}

export interface FxFreshnessPair {
  baseCurrency: string;
  quoteCurrency: string;
  latestDate: string;
  ageInDays: number;
}

export interface FxFreshnessResponseBody {
  pairs: FxFreshnessPair[];
  queriedAt: string;
}

export interface FxSeedResponseBody {
  inserted: number;
}

export class FxRatesApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: FxRatesEndpoint;

  @Step()
  async refreshBody(response: APIResponse): Promise<FxRefreshResponseBody> {
    return (await this.body(response)) as FxRefreshResponseBody;
  }

  @Step()
  async freshnessBody(response: APIResponse): Promise<FxFreshnessResponseBody> {
    return (await this.body(response)) as FxFreshnessResponseBody;
  }

  @Step()
  async seedBody(response: APIResponse): Promise<FxSeedResponseBody> {
    return (await this.body(response)) as FxSeedResponseBody;
  }
}
