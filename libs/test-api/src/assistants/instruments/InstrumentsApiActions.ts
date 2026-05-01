import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseActions } from "../../mixins/index.js";
import type {
  InstrumentsEndpoint,
  InstrumentsMarketFilter,
  SeedInstrumentInput,
} from "../../endpoints/InstrumentsEndpoint.js";

/**
 * KZO-169: actions wrapper for the `/instruments` catalog read and the
 * test-only `/__e2e/seed-instruments` seed route.
 */
export class InstrumentsApiActions extends ApiBaseActions {
  declare protected readonly _instance: InstrumentsEndpoint;

  @Step()
  async listInstruments(marketCode?: InstrumentsMarketFilter): Promise<APIResponse> {
    return this._instance.list(marketCode, this.authHeaders);
  }

  @Step()
  async seedInstruments(instruments: SeedInstrumentInput[]): Promise<APIResponse> {
    return this._instance.seedInstruments(instruments, this.authHeaders);
  }
}
