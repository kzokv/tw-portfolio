import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { InstrumentsEndpoint } from "../../endpoints/InstrumentsEndpoint.js";

/**
 * KZO-169: arrange helpers for the `/instruments` catalog read and the
 * `/__e2e/seed-instruments` seed route.
 */
export class InstrumentsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: InstrumentsEndpoint;

  /**
   * Reads the JSON body and returns the `instruments` array. The route
   * response shape is `{ instruments: InstrumentCatalogItemDto[] }` per
   * `registerRoutes.ts:4172`.
   */
  @Step()
  async instruments(response: APIResponse): Promise<Record<string, unknown>[]> {
    const body = (await this.body(response)) as { instruments: Record<string, unknown>[] };
    return body.instruments;
  }
}
