import { Step } from "../decorators/Step.js";
import type { APIRequestContext, Page } from "@playwright/test";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ArrangeMixin<TBase extends Constructor<{ page: Page; request: APIRequestContext; userId: string | undefined }>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Seed Data")
    async mxSeedData(apiBaseUrl: string): Promise<void> {
      if (!this.userId) {
        throw new Error("mxSeedData requires a userId");
      }

      const response = await this.request.post(new URL("/__e2e/reset", apiBaseUrl).href, {
        headers: {
          "x-user-id": this.userId,
        },
      });

      if (!response.ok()) {
        throw new Error(`Seed data failed: ${response.status()} ${response.statusText()}`);
      }
    }
  };
}
