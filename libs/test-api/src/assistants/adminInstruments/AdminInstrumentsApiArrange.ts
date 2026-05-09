import type { APIResponse } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { ApiBaseArrange } from "../../mixins/index.js";
import type { AdminInstrumentsEndpoint } from "../../endpoints/AdminInstrumentsEndpoint.js";

/**
 * KZO-195 — arrange helpers for /admin/instruments mutation responses.
 *
 * The success path returns the updated instrument row shape (TBD by Backend
 * Implementer in Phase 7). For now we expose generic body / errorBody readers
 * so HTTP specs can assert on `body.error` / `body.message` per
 * `service-error-pattern.md`.
 */
export class AdminInstrumentsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: AdminInstrumentsEndpoint;

  @Step()
  async errorBody(response: APIResponse): Promise<{ error: string; message?: string }> {
    return (await this.body(response)) as { error: string; message?: string };
  }

  @Step()
  async instrumentBody(response: APIResponse): Promise<Record<string, unknown>> {
    return (await this.body(response)) as Record<string, unknown>;
  }
}
