import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type {
  FxRateSeedInput,
  FxRatesEndpoint,
  FxRefreshRequestBody,
} from "../../endpoints/FxRatesEndpoint.js";

export class FxRatesApiActions extends ApiBaseActions {
  declare protected readonly _instance: FxRatesEndpoint;

  @Step()
  async manualRefresh(body: FxRefreshRequestBody): Promise<APIResponse> {
    return this._instance.manualRefresh(body, this.authHeaders);
  }

  @Step()
  async manualRefreshForCookie(cookie: string, body: FxRefreshRequestBody): Promise<APIResponse> {
    return this._instance.manualRefresh(body, headersForCookie(cookie));
  }

  @Step()
  async getFreshness(): Promise<APIResponse> {
    return this._instance.getFreshness(this.authHeaders);
  }

  @Step()
  async getFreshnessForCookie(cookie: string): Promise<APIResponse> {
    return this._instance.getFreshness(headersForCookie(cookie));
  }

  /**
   * Test-only seed via `/__e2e/seed-fx-rates`. Gated by `assertE2ESeedEnabled()`
   * (NODE_ENV=development|test + PERSISTENCE_BACKEND=memory). No auth required —
   * matches the other `seed-*` E2E endpoints.
   */
  @Step()
  async seedFxRates(rates: ReadonlyArray<FxRateSeedInput>): Promise<APIResponse> {
    return this._instance.seedFxRates(rates);
  }

  /**
   * Test-only reset via `/__e2e/reset-fx-rates`. Gated by the same
   * `assertE2ESeedEnabled()` guard as seed (memory-only). Use in `beforeEach`
   * to isolate FX state across freshness/refresh HTTP/AAA tests.
   */
  @Step()
  async resetFxRates(): Promise<APIResponse> {
    return this._instance.resetFxRates();
  }
}
