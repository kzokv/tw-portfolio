import { request as apiRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { apiUrl } from "@tw-portfolio/test-framework/shared";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type {
  ProviderHealthSeedInput,
  ProvidersEndpoint,
} from "../../endpoints/ProvidersEndpoint.js";

/**
 * Run a one-shot request in a fresh APIRequestContext so the test's shared
 * `request` cookie jar (which can carry admin cookies set by earlier tests)
 * doesn't leak onto the "no cookie" anonymous-auth assertions.
 *
 * Per `.claude/rules/playwright-request-cookie-jar-isolation.md`.
 */
async function withFreshContext<T>(
  fn: (ctx: APIRequestContext) => Promise<T>,
): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

export class ProvidersApiActions extends ApiBaseActions {
  declare protected readonly _instance: ProvidersEndpoint;

  @Step()
  async list(): Promise<APIResponse> {
    return this._instance.list(this.authHeaders);
  }

  @Step()
  async listForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.list(headersForCookie(cookie));
  }

  /**
   * Anonymous (no cookie) — must use a fresh APIRequestContext so the shared
   * `request` cookie jar's admin cookies from earlier tests don't leak into
   * the auth assertion. See header doc for `withFreshContext`.
   */
  @Step()
  async listAnonymous(): Promise<APIResponse> {
    return withFreshContext((ctx) => ctx.get(apiUrl("/admin/providers")));
  }

  @Step()
  async rerun(providerId: string): Promise<APIResponse> {
    return this._instance.rerun(providerId, this.authHeaders);
  }

  @Step()
  async rerunForCookie(cookie: string, providerId: string): Promise<APIResponse> {
    return this._instance.rerun(providerId, headersForCookie(cookie));
  }

  /**
   * Anonymous (no cookie) — fresh APIRequestContext so the shared `request`
   * cookie jar doesn't pollute the auth assertion.
   */
  @Step()
  async rerunAnonymous(providerId: string): Promise<APIResponse> {
    return withFreshContext((ctx) =>
      ctx.post(apiUrl(`/admin/providers/${encodeURIComponent(providerId)}/rerun`), {
        data: {},
      }),
    );
  }

  /**
   * Test-only seed. No auth required (matches other seed-* endpoints).
   */
  @Step()
  async seedProviderHealthStatus(input: ProviderHealthSeedInput): Promise<APIResponse> {
    return this._instance.seedProviderHealthStatus(input);
  }
}
