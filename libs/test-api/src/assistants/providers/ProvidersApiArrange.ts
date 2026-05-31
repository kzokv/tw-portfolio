import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { ProvidersEndpoint } from "../../endpoints/ProvidersEndpoint.js";

export interface ProviderErrorTrailEntryShape {
  id: number;
  occurredAt: string;
  errorClass: "rate_limit" | "http_4xx" | "http_5xx" | "network" | "parse" | "other";
  errorMessage: string | null;
}

export interface ProviderHealthRowShape {
  providerId: string;
  status: "healthy" | "degraded" | "down" | "awaiting";
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  errorCount24h: number;
  errorCount7d: number;
  rateLimitCount24h: number;
  lastErrorMessage: string | null;
  lastManualRerunAt: string | null;
  updatedAt: string;
  recentErrors: ProviderErrorTrailEntryShape[];
  rerunCooldownMs: number;
}

export interface AdminProvidersListBody {
  providers: ProviderHealthRowShape[];
}

export interface ProviderRerunResponseBody {
  status: "queued";
  jobId?: string;
}

export class ProvidersApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: ProvidersEndpoint;

  @Step()
  async listBody(response: APIResponse): Promise<AdminProvidersListBody> {
    return (await this.body(response)) as AdminProvidersListBody;
  }

  @Step()
  async rerunBody(response: APIResponse): Promise<ProviderRerunResponseBody> {
    return (await this.body(response)) as ProviderRerunResponseBody;
  }
}
