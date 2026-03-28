import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export class SessionEndpoint extends BaseEndpoint {
  createOauthSession = (data?: unknown): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/oauth-session"), data ? { data } : {});
}
